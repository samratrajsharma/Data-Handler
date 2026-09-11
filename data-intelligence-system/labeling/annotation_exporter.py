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
    if kind == "mask":
        # A mask stores absolute pixels; every consumer here works in
        # normalized coordinates, so divide by the size the RLE declares
        # rather than by the image row's width/height. They should agree (the
        # API rejects a mismatch on write), but the RLE is self-describing and
        # is the authority for its own geometry.
        box = _mask_bbox_norm(ann.get("mask"))
        return box
    return None


def _mask_bbox_norm(mask: dict):
    """Normalized (x, y, w, h) bounding box of an RLE mask, or None."""
    if not isinstance(mask, dict):
        return None
    try:
        from labeling.mask_codec import decode_counts, rle_bbox
        h, w = int(mask["size"][0]), int(mask["size"][1])
        if h <= 0 or w <= 0:
            return None
        bx, by, bw, bh = rle_bbox(decode_counts(mask["counts"]), h, w)
        if bw <= 0 or bh <= 0:
            return None
        return (bx / w, by / h, bw / w, bh / h)
    except Exception:
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

    Masks are written in YOLO SEGMENTATION form instead —
    'class_idx x1 y1 x2 y2 ...' with normalized polygon vertices — because
    collapsing a painted mask to a box would discard exactly the information it
    was painted to capture. Ultralytics accepts both shapes of line, and reads
    the format from the point count.
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

            if ann.get("kind") == "mask":
                # One line per connected region: YOLO has no way to express a
                # multi-part instance, so a mask with two disjoint blobs
                # becomes two instances of the same class. Holes are lost —
                # the format has no representation for them. Export to COCO if
                # that matters; it keeps the RLE intact.
                from labeling.mask_contour import mask_to_polygons
                polys = mask_to_polygons(ann.get("mask") or {})
                if not polys:
                    warnings.append(
                        f"{image.get('file_name')}: mask annotation produced no "
                        "traceable region and was skipped"
                    )
                    continue
                cls = int(ann.get("class_index", 0))
                for poly in polys:
                    flat = " ".join(f"{_clamp01(px):.6f} {_clamp01(py):.6f}" for px, py in poly)
                    lines.append(f"{cls} {flat}")
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
            area = round(abs_box[2] * abs_box[3], 2)
            if kind == "polygon":
                flat = []
                for px, py in ann.get("points") or []:
                    flat.append(round(_clamp01(px) * width, 2))
                    flat.append(round(_clamp01(py) * height, 2))
                segmentation = [flat]
            elif kind == "mask":
                # COCO's `segmentation` accepts RLE as {"size", "counts"}
                # directly, so a painted mask exports LOSSLESSLY — no polygon
                # approximation, and holes and disjoint regions survive.
                mask = ann.get("mask") or {}
                segmentation = {"size": list(mask.get("size") or []), "counts": mask.get("counts")}
                # Real foreground pixel count, not the bbox area: for masks the
                # two differ a lot, and mAP scoring uses this field.
                try:
                    from labeling.mask_codec import decode_counts, rle_area
                    area = float(rle_area(decode_counts(mask["counts"])))
                except Exception:
                    pass
            bucket["annotations"].append(
                {
                    "id": len(bucket["annotations"]),
                    "image_id": image_id,
                    "category_id": int(ann.get("class_index", 0)) + 1,
                    "bbox": abs_box,
                    "area": area,
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


# ── CreateML ─────────────────────────────────────────────────────────────


def build_createml(images: list, class_names: list):
    """Build a CreateML export: one '{split}/_annotations.createml.json' per
    non-empty split.

    Apple's Create ML object-detection format is a flat JSON array of
    ``{"image": name, "annotations": [{"label", "coordinates": {x, y, width,
    height}}]}``. Its coordinates are absolute pixels measured from the box's
    CENTER — not the top-left, which is the single most common way this export
    is written wrong. Boxes land offset by half their size and the error is
    invisible until training accuracy is inexplicably poor.

    Polygons and masks are reduced to their bounding box: the format has no
    segmentation representation at all. Classification annotations are skipped.
    """
    files: dict = {}
    image_targets: dict = {}
    warnings: list = []
    names = _unique_names(images)
    per_split: dict = {}
    reduced = 0

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

        entries = []
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
            if kind in ("polygon", "mask"):
                reduced += 1
            x, y, w, h = rect
            entries.append(
                {
                    "label": str(ann.get("class_name", "")),
                    "coordinates": {
                        # CENTER, not top-left. See the docstring.
                        "x": round((x + w / 2.0) * width, 2),
                        "y": round((y + h / 2.0) * height, 2),
                        "width": round(w * width, 2),
                        "height": round(h * height, 2),
                    },
                }
            )

        per_split.setdefault(split, []).append(
            {"image": unique_name, "annotations": entries}
        )
        image_targets[image["asset_id"]] = f"{split}/{unique_name}"

    for split, payload in per_split.items():
        files[f"{split}/_annotations.createml.json"] = json.dumps(payload, indent=2)

    if reduced:
        warnings.append(
            f"{reduced} polygon/mask annotation(s) were reduced to bounding "
            "boxes — CreateML has no segmentation format. Export COCO to keep "
            "the shapes."
        )
    return files, image_targets, warnings


# ── TensorFlow Object Detection CSV ──────────────────────────────────────


def build_tfcsv(images: list, class_names: list):
    """Build a TensorFlow Object Detection CSV export: one
    '{split}/_annotations.csv' per non-empty split with the column set
    ``filename,width,height,class,xmin,ymin,xmax,ymax`` that
    ``generate_tfrecord.py`` reads.

    Corners are absolute integers (the TF tooling casts to int anyway), and
    every box is clamped inside the image so a degenerate row can never reach
    the record writer — ``xmin >= xmax`` there raises deep inside the graph
    with no indication of which file caused it.

    One row per object; an image with no objects still gets no row, which is
    how the reference tooling represents a negative sample.
    """
    files: dict = {}
    image_targets: dict = {}
    warnings: list = []
    names = _unique_names(images)
    per_split: dict = {}
    reduced = 0

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
        rows = per_split.setdefault(split, [])

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
            if kind in ("polygon", "mask"):
                reduced += 1
            x, y, w, h = rect
            xmin = max(0, min(int(width) - 1, int(round(x * width))))
            ymin = max(0, min(int(height) - 1, int(round(y * height))))
            xmax = max(xmin + 1, min(int(width), int(round((x + w) * width))))
            ymax = max(ymin + 1, min(int(height), int(round((y + h) * height))))
            rows.append(
                [
                    unique_name, int(width), int(height),
                    str(ann.get("class_name", "")),
                    xmin, ymin, xmax, ymax,
                ]
            )

        image_targets[image["asset_id"]] = f"{split}/{unique_name}"

    for split, rows in per_split.items():
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(
            ["filename", "width", "height", "class", "xmin", "ymin", "xmax", "ymax"]
        )
        writer.writerows(rows)
        files[f"{split}/_annotations.csv"] = buffer.getvalue()

    # A label map is not part of the CSV spec, but generate_tfrecord.py needs
    # one and writing it by hand is where people fumble the 1-based indexing.
    files["label_map.pbtxt"] = "".join(
        "item {\n"
        f"  id: {i + 1}\n"
        f'  name: "{str(name)}"\n'
        "}\n\n"
        for i, name in enumerate(class_names)
    )

    if reduced:
        warnings.append(
            f"{reduced} polygon/mask annotation(s) were reduced to bounding "
            "boxes — this format stores boxes only."
        )
    return files, image_targets, warnings


# ── Semantic segmentation masks (indexed PNG) ────────────────────────────


def build_segmentation_masks(images: list, class_names: list):
    """Build a semantic-segmentation export: one 8-bit indexed PNG per image
    under '{split}/masks/{stem}.png', where pixel value 0 is background and
    value ``class_index + 1`` marks that class.

    WHY INDEXED PNG RATHER THAN RGB
    Every segmentation training pipeline (torchvision, mmseg, Keras) expects a
    single-channel label map whose pixel VALUE is the class id. An RGB mask
    looks nicer and is useless: the loader has to reverse-map colours to ids,
    and anti-aliasing or a lossy re-save silently invents classes that were
    never labelled. A palette PNG is lossless, is one byte per pixel, and
    displays in colour anyway because the palette travels with the file.

    PAINT ORDER IS SIGNIFICANT. Masks are drawn in the order they appear, so a
    later annotation overwrites an earlier one where they overlap — semantic
    segmentation has exactly one label per pixel and something has to win. The
    caller's ordering is preserved rather than sorted, so the result is at
    least deterministic and matches what the annotator saw on screen.

    Polygons are rasterised with the same fill rule as the editor. Bounding
    boxes are NOT rasterised: filling a box would assert that every pixel in it
    belongs to the class, which is false for anything that is not rectangular
    and would poison the training signal. They are counted and reported instead.
    """
    files: dict = {}
    image_targets: dict = {}
    warnings: list = []
    names = _unique_names(images)

    try:
        from PIL import Image, ImageDraw
    except ImportError:  # pragma: no cover - Pillow ships in the runtime image
        return (
            {},
            {},
            ["Segmentation export needs Pillow, which is not installed."],
        )

    # A 256-entry palette: index 0 black (background), then one distinct hue per
    # class, generated by golden-angle rotation so neighbouring ids never look
    # alike. Colour is cosmetic here — the INDEX is the label.
    palette = [0, 0, 0]
    for i in range(255):
        hue = (i * 0.61803398875) % 1.0
        r, g, b = _hsv_to_rgb(hue, 0.75, 0.95)
        palette += [r, g, b]

    skipped_boxes = 0
    blank = 0

    for image in images:
        width, height = image.get("width"), image.get("height")
        if not width or not height:
            warnings.append(
                f"{image.get('file_name')}: skipped — missing width/height "
                "(required to rasterise a mask)"
            )
            continue

        stem, _ext, unique_name = names[image["asset_id"]]
        split = _split_of(image)
        width, height = int(width), int(height)

        canvas = Image.new("P", (width, height), 0)
        canvas.putpalette(palette)
        draw = ImageDraw.Draw(canvas)
        painted = False

        for ann in image.get("annotations") or []:
            kind = ann.get("kind")
            if kind == "classification":
                continue
            value = int(ann.get("class_index", 0)) + 1

            if kind == "polygon":
                points = ann.get("points") or []
                if len(points) < 3:
                    continue
                draw.polygon(
                    [
                        (_clamp01(px) * width, _clamp01(py) * height)
                        for px, py in points
                    ],
                    fill=value,
                )
                painted = True
            elif kind == "mask":
                stamped = _stamp_rle(canvas, ann.get("mask") or {}, value, width, height)
                if stamped:
                    painted = True
                else:
                    warnings.append(
                        f"{image.get('file_name')}: mask annotation could not be "
                        "decoded and was skipped"
                    )
            elif kind == "bbox":
                skipped_boxes += 1

        buffer = io.BytesIO()
        canvas.save(buffer, format="PNG", optimize=True)
        files[f"{split}/masks/{stem}.png"] = buffer.getvalue()
        image_targets[image["asset_id"]] = f"{split}/images/{unique_name}"
        if not painted:
            blank += 1

    files["classes.txt"] = "\n".join(
        ["0: background"] + [f"{i + 1}: {name}" for i, name in enumerate(class_names)]
    ) + "\n"

    if skipped_boxes:
        warnings.append(
            f"{skipped_boxes} bounding-box annotation(s) were NOT rasterised — "
            "filling a box would label every pixel inside it, including "
            "background. Use the brush or polygon tool for segmentation."
        )
    if blank:
        warnings.append(
            f"{blank} mask(s) are entirely background. That is valid as a "
            "negative sample, but if it is most of the export the dataset "
            "probably holds boxes rather than segmentations."
        )
    return files, image_targets, warnings


def _hsv_to_rgb(h: float, s: float, v: float):
    """Minimal HSV->RGB (0..255 ints). Avoids importing colorsys for six lines."""
    i = int(h * 6.0)
    f = h * 6.0 - i
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    r, g, b = [
        (v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)
    ][i % 6]
    return int(r * 255), int(g * 255), int(b * 255)


def _stamp_rle(canvas, mask: dict, value: int, width: int, height: int) -> bool:
    """Paint an RLE mask's foreground onto an indexed canvas. Returns success.

    COCO RLE runs are COLUMN-major (the run index walks down each column, then
    across), which is the transpose of PIL's row-major buffer. Rather than
    building a full transposed bytearray, the runs are walked directly and each
    foreground run is written as a vertical span — a run that spills past the
    bottom of a column continues at the top of the next, exactly as the codec
    defines it.
    """
    try:
        from labeling.mask_codec import decode_counts

        size = mask.get("size") or []
        if int(size[0]) != height or int(size[1]) != width:
            return False
        runs = decode_counts(mask["counts"])
    except Exception:
        return False

    pixels = canvas.load()
    position = 0           # linear index in column-major order
    foreground = False     # runs alternate, starting with background
    total = width * height

    for run in runs:
        if foreground and run:
            end = min(position + run, total)
            for index in range(position, end):
                # column-major: index = column * height + row
                pixels[index // height, index % height] = value
        position += run
        foreground = not foreground
        if position >= total:
            break
    return True
