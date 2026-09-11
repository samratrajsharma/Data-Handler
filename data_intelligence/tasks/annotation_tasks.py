"""
Celery tasks for annotation export.
Packages image annotations into standard formats (YOLO / COCO / VOC /
classification / CreateML / TensorFlow CSV / segmentation masks) as a
downloadable zip stored in MinIO.
"""

import logging
import os
import tempfile
import zipfile

import core.paths  # noqa: F401

from core.celery_app import app
from core.database_sync import SyncSessionLocal
from core.services.task_service import update_task_progress, complete_task

logger = logging.getLogger(__name__)


@app.task(bind=True, name="annotation.export_images")
def export_image_annotations(
    self, dataset_id: str, export_format: str, include_images: bool = True,
    include_unannotated: bool = False,
):
    """Export a dataset's image annotations to a zip in MinIO.

    Args:
        dataset_id: UUID of the dataset to export.
        export_format: one of EXPORT_BUILDERS' keys — 'yolo', 'coco', 'voc',
            'classification', 'createml', 'tfcsv', 'segmentation'.
        include_images: Copy the original images into the zip. Formats whose
            layout is image-centric (yolo/voc/classification) always include
            them.
        include_unannotated: Include images still in the 'unannotated' workflow
            state. Off by default so exports (and their train/ split) don't fill
            up with blank images. Rejected images are always excluded.
    """
    celery_task_id = self.request.id
    db = SyncSessionLocal()

    try:
        # ── Step 1: Load annotation data ────────────────────────────────
        update_task_progress(db, celery_task_id, 0.05, "Querying annotations...")

        from core.models.annotation import (
            AnnotationClass, ImageAnnotation, ImageAnnotationState,
        )
        from core.models.image_asset import ImageAsset

        assets = (
            db.query(ImageAsset)
            .filter(ImageAsset.dataset_id == dataset_id)
            .all()
        )

        states = (
            db.query(ImageAnnotationState)
            .filter(ImageAnnotationState.dataset_id == dataset_id)
            .all()
        )
        split_map = {str(s.asset_id): s.split for s in states}

        classes = (
            db.query(AnnotationClass)
            .filter(AnnotationClass.dataset_id == dataset_id)
            .order_by(AnnotationClass.order_index, AnnotationClass.name)
            .all()
        )
        class_names = [c.name for c in classes]
        class_index_map = {str(c.id): i for i, c in enumerate(classes)}

        ann_rows = (
            db.query(ImageAnnotation, AnnotationClass)
            .join(AnnotationClass, ImageAnnotation.class_id == AnnotationClass.id)
            .filter(ImageAnnotation.dataset_id == dataset_id)
            .all()
        )
        ann_map: dict = {}
        for ann, cls in ann_rows:
            ann_map.setdefault(str(ann.asset_id), []).append(
                {
                    "kind": ann.kind,
                    "class_name": cls.name,
                    "class_index": class_index_map.get(str(ann.class_id), 0),
                    "x": ann.x,
                    "y": ann.y,
                    "w": ann.w,
                    "h": ann.h,
                    "points": ann.points,
                    # COCO RLE for kind == "mask"; None otherwise.
                    "mask": ann.mask,
                }
            )

        # ── Filter assets by annotation-state workflow status ───────────
        # Never ship rejected images. Unannotated images (no labels / not yet
        # reviewed) are excluded by default and only included when the caller
        # explicitly opts in, so exports and their train/ split don't fill up
        # with blank images. An asset with no state row is treated as
        # unannotated unless it already carries annotations.
        status_map = {str(s.asset_id): s.status for s in states}
        kept_assets = []
        rejected_excluded = 0
        unannotated_count = 0
        for asset in assets:
            asset_id = str(asset.id)
            asset_status = status_map.get(asset_id)
            if asset_status == "rejected":
                rejected_excluded += 1
                continue
            is_unannotated = asset_status == "unannotated" or (
                asset_status is None and not ann_map.get(asset_id)
            )
            if is_unannotated:
                unannotated_count += 1
                if not include_unannotated:
                    continue
            kept_assets.append(asset)
        assets = kept_assets

        # ── Step 2: Build the exporter's input structure ────────────────
        update_task_progress(db, celery_task_id, 0.08, "Building export files...")

        images = []
        for asset in assets:
            asset_id = str(asset.id)
            images.append(
                {
                    "asset_id": asset_id,
                    "file_name": asset.file_name,
                    "width": asset.width,
                    "height": asset.height,
                    "split": split_map.get(asset_id) or "train",
                    "annotations": ann_map.get(asset_id, []),
                }
            )
        annotation_count = sum(len(img["annotations"]) for img in images)

        from labeling.annotation_exporter import (
            build_yolo, build_coco, build_voc, build_classification,
            build_createml, build_tfcsv, build_segmentation_masks,
        )

        builders = {
            "yolo": build_yolo,
            "coco": build_coco,
            "voc": build_voc,
            "classification": build_classification,
            "createml": build_createml,
            "tfcsv": build_tfcsv,
            "segmentation": build_segmentation_masks,
        }
        builder = builders.get(export_format)
        if builder is None:
            raise ValueError(f"Unsupported export format: {export_format}")

        files, image_targets, warnings = builder(images, class_names)

        # Surface how many images were dropped / defaulted-out so the caller
        # can see why the export count is smaller than the dataset.
        if rejected_excluded:
            warnings.append(
                f"Excluded {rejected_excluded} rejected image(s) from the export."
            )
        if unannotated_count:
            if include_unannotated:
                warnings.append(
                    f"Included {unannotated_count} unannotated image(s) "
                    f"(include_unannotated=true)."
                )
            else:
                warnings.append(
                    f"Excluded {unannotated_count} unannotated image(s); pass "
                    f"include_unannotated=true to include them."
                )

        # ── Step 3: Assemble the zip ────────────────────────────────────
        from core.settings import settings
        from core.storage import get_minio_client

        bucket = settings.MINIO_BUCKET_NAME
        client = get_minio_client()

        # These layouts are image-centric: the label files address images by a
        # path inside the zip, so an export without them is unusable rather
        # than merely smaller. 'segmentation' is here because a mask PNG is
        # meaningless without the frame it masks.
        copy_images = include_images or export_format in (
            "yolo", "voc", "classification", "createml", "tfcsv", "segmentation",
        )

        def _download_one(meta):
            # meta is a plain (asset_id, path, file_name) tuple — never an ORM
            # object, so the worker threads never touch the DB session.
            asset_id, path, file_name = meta
            try:
                response = client.get_object(bucket, path)
                try:
                    raw = response.read()
                finally:
                    response.close()
                    response.release_conn()
                return asset_id, raw, None
            except Exception as exc:  # skip-and-warn per image
                return asset_id, None, f"{file_name}: image download failed — {exc}"

        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = os.path.join(
                tmpdir, f"annotations_{export_format}.zip"
            )
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for rel_path, content in files.items():
                    data = (
                        content.encode("utf-8")
                        if isinstance(content, str) else content
                    )
                    zf.writestr(rel_path, data)

                if copy_images and image_targets:
                    metas = [
                        (str(a.id), a.original_path, a.file_name)
                        for a in assets
                        if str(a.id) in image_targets
                    ]
                    total_dl = len(metas)
                    if metas:
                        from concurrent.futures import ThreadPoolExecutor

                        done = 0
                        with ThreadPoolExecutor(
                            max_workers=min(8, total_dl)
                        ) as pool:
                            for asset_id, raw, err in pool.map(
                                _download_one, metas
                            ):
                                done += 1
                                if err is not None:
                                    logger.warning(err)
                                    warnings.append(err)
                                else:
                                    zf.writestr(image_targets[asset_id], raw)
                                if done % 20 == 0 or done == total_dl:
                                    progress = 0.1 + 0.8 * (done / total_dl)
                                    update_task_progress(
                                        db, celery_task_id, progress,
                                        f"Packaging images ({done}/{total_dl})...",
                                    )

            # ── Step 4: Upload the zip to MinIO ─────────────────────────
            update_task_progress(
                db, celery_task_id, 0.9, "Uploading export to storage...",
            )
            export_path = (
                f"datasets/{dataset_id}/exports/"
                f"annotations_{export_format}.zip"
            )
            client.fput_object(
                bucket, export_path, zip_path,
                content_type="application/zip",
            )

        # ── Done ────────────────────────────────────────────────────────
        result = {
            "export_path": export_path,
            "format": export_format,
            "image_count": len(images),
            "annotation_count": annotation_count,
            "warnings": warnings,
        }
        complete_task(db, celery_task_id, result=result)
        logger.info(
            "Annotation export (%s) complete for dataset %s: "
            "%d images, %d annotations",
            export_format, dataset_id, len(images), annotation_count,
        )
        return result

    except Exception as exc:
        logger.error(
            "Annotation export failed for dataset %s: %s",
            dataset_id, exc, exc_info=True,
        )
        complete_task(db, celery_task_id, error=str(exc))
        raise
    finally:
        db.close()
