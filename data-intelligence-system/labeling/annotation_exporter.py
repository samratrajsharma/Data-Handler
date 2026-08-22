"""Annotation export builders — pure functions, no DB or network access.

Each builder converts in-memory annotation structures into the non-image
files of a standard export layout (YOLO, COCO, Pascal VOC, or folder-based
classification). The Celery task lays out the final zip: it writes the
returned file mapping verbatim and copies each image into the path given by
the returned per-image target map.

Input data model (plain dicts)
------------------------------
``images`` — list of::

    {
        "asset_id": str,               # unique id, used as the target-map key
        "file_name": str,              # original upload name, e.g. "cat.jpg"
        "width": int | None,           # natural pixel size (None = unknown)
        "height": int | None,
        "split": "train" | "valid" | "test",
        "annotations": [
            {
                "kind": "bbox" | "polygon" | "classification",
                "class_name": str,
                "class_index": int,    # index into class_names
                "x": float | None,     # normalized 0..1, top-left corner
                "y": float | None,
                "w": float | None,
                "h": float | None,
                "points": [[x, y], ...] | None,  # normalized 0..1
            },
            ...
        ],
    }

``class_names`` — ordered list of class-name strings; an annotation's
``class_index`` indexes into this list.

All geometry is normalized (0..1). Builders re-project to absolute pixels
where a format requires it, using the image's ``width``/``height``.

Return shape
------------
Every builder returns a 3-tuple::

    (files, image_targets, warnings)

* ``files`` — ``{relative_path_in_zip: str_or_bytes}`` for the non-image files.
* ``image_targets`` — ``{asset_id: relative_path_in_zip}`` telling the caller
  where to copy each image (empty when a format skips an image).
* ``warnings`` — human-readable strings for anything skipped or degraded.

Duplicate file names (same stem twice) are disambiguated with ``_2``, ``_3``
suffixes, consistently across label files and image targets.
"""

import csv
import io
import json
import logging
import os
import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)

# Type aliases (documentation only)
ExportFiles = dict          # {relative_path_in_zip: str | bytes}
ImageTargets = dict         # {asset_id: relative_path_in_zip}

_SPLITS = ("train", "valid", "test")


# ── Shared helpers ───────────────────────────────────────────────────────


def _split_of(image: dict) -> str:
    """Return the image's split, defaulting to 'train'."""
    split = image.get("split") or "train"
    return split if split in _SPLITS else "train"


def _clamp01(value: float) -> float:
    """Clamp a float into the [0, 1] range."""
    return max(0.0, min(1.0, float(value)))


def _unique_names(images: list) -> dict:
    """Map asset_id -> (stem, ext, unique_file_name), suffixing duplicate
    stems with _2, _3, ... so label files and image files never collide."""
    seen: dict = {}
    out: dict = {}
    for image in images:
        file_name = image.get("file_name") or f"{image['asset_id']}.jpg"
        stem, ext = os.path.splitext(os.path.basename(file_name))
        stem = stem or image["asset_id"]
        count = seen.get(stem, 0) + 1
        seen[stem] = count
        unique_stem = stem if count == 1 else f"{stem}_{count}"
        out[image["asset_id"]] = (unique_stem, ext, f"{unique_stem}{ext}")
    return out


def _norm_rect(ann: dict):
    """Normalized (x, y, w, h) top-left rect for a bbox/polygon annotation,
    clamped to [0, 1], or None when the geometry is missing/invalid.
    Polygons yield their bounding rectangle."""
    kind = ann.get("kind")
    if kind == "bbox":
        x, y, w, h = ann.get("x"), ann.get("y"), ann.get("w"), ann.get("h")
        if x is None or y is None or w is None or h is None:
            return None
        x, y = _clamp01(x), _clamp01(y)
        w = max(0.0, min(float(w), 1.0 - x))
        h = max(0.0, min(float(h), 1.0 - y))
        return (x, y, w, h)
    if kind == "polygon":
        points = ann.get("points") or []
        if len(points) < 2:
            return None
        xs = [_clamp01(p[0]) for p in points]
        ys = [_clamp01(p[1]) for p in points]
        x, y = min(xs), min(ys)
        return (x, y, max(xs) - x, max(ys) - y)
    return None


def _safe_folder(name: str) -> str:
    """Make a class name usable as a zip folder segment."""
    cleaned = (name or "").replace("/", "_").replace("\\", "_").strip()
    return cleaned or "_unlabeled_"


# ── YOLO ─────────────────────────────────────────────────────────────────


def build_yolo(images: list, class_names: list):
    """Build a YOLO export: one '{split}/labels/{stem}.txt' per image with
    'class_idx cx cy w h' lines (normalized CENTER coordinates), plus a
    'data.yaml'. Images are copied by the caller to '{split}/images/...'.

    Classification annotations are skipped; polygons use their bounding rect.
    """
    files: dict = {}
    image_targets: dict = {}
    warnings: list = []
    names = _unique_names(images)

    for image in images:
        stem, _ext, unique_name = names[image["asset_id"]]
        split = _split_of(image)

        lines = []
        for ann in image.get("annotations") or []:
            if ann.get("kind") == "classification":
                continue
            rect = _norm_rect(ann)
            if rect is None:
                warnings.append(
                    f"{image.get('file_name')}: skipped {ann.get('kind')} "
                    "annotation with missing/invalid geometry"
                )
                continue
            x, y, w, h = rect
            cx, cy = x + w / 2.0, y + h / 2.0
            lines.append(
                f"{int(ann.get('class_index', 0))} "
                f"{cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"
            )

        files[f"{split}/labels/{stem}.txt"] = "\n".join(lines) + ("\n" if lines else "")
        image_targets[image["asset_id"]] = f"{split}/images/{unique_name}"

    quoted = ", ".join("'" + str(n).replace("'", "''") + "'" for n in class_names)
    files["data.yaml"] = (
        "train: train/images\n"
        "val: valid/images\n"
        "test: test/images\n"
        "\n"
        f"nc: {len(class_names)}\n"
        f"names: [{quoted}]\n"
    )
    return files, image_targets, warnings


# ── COCO ─────────────────────────────────────────────────────────────────


def build_coco(images: list, class_names: list):
    """Build a COCO export: one '{split}/_annotations.coco.json' per
    non-empty split with absolute-pixel bboxes/segmentations. Images whose
    width/height is unknown are skipped with a warning (absolute coordinates
    cannot be computed). Classification annotations are skipped.
    """
    files: dict = {}
    image_targets: dict = {}
    warnings: list = []
    names = _unique_names(images)

    categories = [
        {"id": i + 1, "name": name, "supercategory": "none"}
        for i, name in enumerate(class_names)
    ]
    per_split: dict = {}  # split -> {"images": [...], "annotations": [...]}

    for image in images:
        width, height = image.get("width"), image.get("height")
        if not width or not height:
            warnings.append(
                f"{image.get('file_name')}: skipped — missing width/height "
                "(required for absolute pixel coordinates)"
            )
            continue

        _stem, _ext, unique_name = names[image["asset_id"]]
        split = _split_of(image)
        bucket = per_split.setdefault(split, {"images": [], "annotations": []})

        image_id = len(bucket["images"])
        bucket["images"].append(
            {"id": image_id, "file_name": unique_name, "width": width, "height": height}
        )
        image_targets[image["asset_id"]] = f"{split}/{unique_name}"

        for ann in image.get("annotations") or []:
            kind = ann.get("kind")
            if kind == "classification":
                continue
            rect = _norm_rect(ann)
            if rect is None:
                warnings.append(
                    f"{image.get('file_name')}: skipped {kind} annotation "
                    "with missing/invalid geometry"
                )
                continue
            x, y, w, h = rect
            abs_box = [
                round(x * width, 2), round(y * height, 2),
                round(w * width, 2), round(h * height, 2),
            ]
            segmentation = []
            if kind == "polygon":
                flat = []
                for px, py in ann.get("points") or []:
                    flat.append(round(_clamp01(px) * width, 2))
                    flat.append(round(_clamp01(py) * height, 2))
                segmentation = [flat]
            bucket["annotations"].append(
                {
                    "id": len(bucket["annotations"]),
                    "image_id": image_id,
                    "category_id": int(ann.get("class_index", 0)) + 1,
                    "bbox": abs_box,
                    "area": round(abs_box[2] * abs_box[3], 2),
                    "segmentation": segmentation,
                    "iscrowd": 0,
                }
            )

    for split, payload in per_split.items():
        files[f"{split}/_annotations.coco.json"] = json.dumps(
            {
                "images": payload["images"],
                "categories": categories,
                "annotations": payload["annotations"],
            },
            indent=2,
        )
    return files, image_targets, warnings


# ── Pascal VOC ───────────────────────────────────────────────────────────


def build_voc(images: list, class_names: list):
    """Build a Pascal VOC export: one '{split}/{stem}.xml' per image with
    folder/filename/size/object nodes; bndbox values are absolute integers
    clamped to a minimum of 1. Polygons use their bounding rect and
    classification annotations are skipped. Images without known
    width/height are skipped with a warning.
    """
    files: dict = {}
    image_targets: dict = {}
    warnings: list = []
    names = _unique_names(images)

    for image in images:
        width, height = image.get("width"), image.get("height")
        if not width or not height:
            warnings.append(
                f"{image.get('file_name')}: skipped — missing width/height "
                "(required for absolute pixel coordinates)"
            )
            continue

        stem, _ext, unique_name = names[image["asset_id"]]
        split = _split_of(image)

        root = ET.Element("annotation")
        ET.SubElement(root, "folder").text = split
        ET.SubElement(root, "filename").text = unique_name
        size = ET.SubElement(root, "size")
        ET.SubElement(size, "width").text = str(int(width))
        ET.SubElement(size, "height").text = str(int(height))
        ET.SubElement(size, "depth").text = "3"

        for ann in image.get("annotations") or []:
            kind = ann.get("kind")
            if kind == "classification":
                continue
            rect = _norm_rect(ann)
            if rect is None:
                warnings.append(
                    f"{image.get('file_name')}: skipped {kind} annotation "
                    "with missing/invalid geometry"
                )
                continue
            x, y, w, h = rect
            xmin = max(1, int(round(x * width)))
            ymin = max(1, int(round(y * height)))
            xmax = max(xmin, min(int(width), int(round((x + w) * width))))
            ymax = max(ymin, min(int(height), int(round((y + h) * height))))

            obj = ET.SubElement(root, "object")
            ET.SubElement(obj, "name").text = str(ann.get("class_name", ""))
            ET.SubElement(obj, "pose").text = "Unspecified"
            ET.SubElement(obj, "truncated").text = "0"
            ET.SubElement(obj, "difficult").text = "0"
            bndbox = ET.SubElement(obj, "bndbox")
            ET.SubElement(bndbox, "xmin").text = str(xmin)
            ET.SubElement(bndbox, "ymin").text = str(ymin)
            ET.SubElement(bndbox, "xmax").text = str(xmax)
            ET.SubElement(bndbox, "ymax").text = str(ymax)

        files[f"{split}/{stem}.xml"] = ET.tostring(root, encoding="unicode")
        image_targets[image["asset_id"]] = f"{split}/{unique_name}"

    return files, image_targets, warnings


# ── Folder-based classification ──────────────────────────────────────────


def build_classification(images: list, class_names: list):
    """Build a classification export: a 'labels.csv' manifest
    ("filename,split,labels" with pipe-joined classification labels; empty
    when an image has none) plus per-image folder targets
    '{split}/{first_class_or__unlabeled_}/{file_name}'.
    """
    files: dict = {}
    image_targets: dict = {}
    warnings: list = []
    names = _unique_names(images)

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["filename", "split", "labels"])

    for image in images:
        _stem, _ext, unique_name = names[image["asset_id"]]
        split = _split_of(image)
        labels = [
            str(ann.get("class_name"))
            for ann in image.get("annotations") or []
            if ann.get("kind") == "classification" and ann.get("class_name")
        ]
        writer.writerow([unique_name, split, "|".join(labels)])
        folder = _safe_folder(labels[0]) if labels else "_unlabeled_"
        image_targets[image["asset_id"]] = f"{split}/{folder}/{unique_name}"

    files["labels.csv"] = buffer.getvalue()
    return files, image_targets, warnings
