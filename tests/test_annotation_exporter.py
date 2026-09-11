"""Annotation export builders: YOLO / COCO / VOC / classification /
CreateML / TensorFlow CSV / segmentation masks."""
import json
from labeling.annotation_exporter import (
    build_yolo, build_coco, build_voc, build_classification,
    build_createml, build_tfcsv, build_segmentation_masks,
)


def _img(**kw):
    base = {"asset_id": "a1", "file_name": "cat.jpg", "width": 100, "height": 200,
            "split": "train", "annotations": []}
    base.update(kw)
    return base


def _bbox(ci=0, name="cat", x=0.1, y=0.2, w=0.4, h=0.4):
    return {"kind": "bbox", "class_name": name, "class_index": ci,
            "x": x, "y": y, "w": w, "h": h, "points": None}


def test_yolo_center_coords_and_yaml():
    files, targets, warns = build_yolo([_img(annotations=[_bbox()])], ["cat", "dog"])
    assert files["train/labels/cat.txt"].strip() == "0 0.300000 0.400000 0.400000 0.400000"
    assert targets["a1"] == "train/images/cat.jpg"
    assert "nc: 2" in files["data.yaml"] and "'cat', 'dog'" in files["data.yaml"]


def test_yolo_skips_classification():
    imgs = [_img(annotations=[{"kind": "classification", "class_name": "cat", "class_index": 0}])]
    files, _, _ = build_yolo(imgs, ["cat"])
    assert files["train/labels/cat.txt"] == ""


def test_yolo_polygon_bounding_rect():
    poly = {"kind": "polygon", "class_name": "cat", "class_index": 0,
            "points": [[0.2, 0.2], [0.6, 0.2], [0.6, 0.8], [0.2, 0.8]]}
    files, _, _ = build_yolo([_img(annotations=[poly])], ["cat"])
    assert files["train/labels/cat.txt"].strip() == "0 0.400000 0.500000 0.400000 0.600000"


def test_coco_absolute_pixels():
    files, targets, warns = build_coco([_img(annotations=[_bbox()])], ["cat", "dog"])
    data = json.loads(files["train/_annotations.coco.json"])
    assert len(data["images"]) == 1 and len(data["annotations"]) == 1
    a = data["annotations"][0]
    assert a["bbox"] == [10.0, 40.0, 40.0, 80.0]
    assert a["category_id"] == 1 and a["area"] == 3200.0
    assert data["categories"][0]["name"] == "cat"


def test_coco_skips_missing_dims():
    files, targets, warns = build_coco([_img(width=None, height=None, annotations=[_bbox()])], ["cat"])
    assert files == {} and any("missing width/height" in w for w in warns)


def test_voc_bndbox_absolute_ints():
    files, _, _ = build_voc([_img(annotations=[_bbox()])], ["cat"])
    xml = files["train/cat.xml"]
    assert "<xmin>10</xmin>" in xml and "<ymin>40</ymin>" in xml
    assert "<xmax>50</xmax>" in xml and "<ymax>120</ymax>" in xml
    assert "<name>cat</name>" in xml


def test_classification_manifest_and_folders():
    imgs = [_img(annotations=[{"kind": "classification", "class_name": "cat", "class_index": 0}])]
    files, targets, warns = build_classification(imgs, ["cat"])
    assert "filename,split,labels" in files["labels.csv"]
    assert "cat.jpg,train,cat" in files["labels.csv"]
    assert targets["a1"] == "train/cat/cat.jpg"


def test_duplicate_stems_disambiguated():
    files, targets, warns = build_yolo([_img(asset_id="a1"), _img(asset_id="a2")], ["cat"])
    assert targets["a1"] == "train/images/cat.jpg"
    assert targets["a2"] == "train/images/cat_2.jpg"
    assert "train/labels/cat.txt" in files and "train/labels/cat_2.txt" in files


# ── CreateML ─────────────────────────────────────────────────────────────


def test_createml_uses_center_coordinates():
    """Apple's format measures from the box CENTRE, not the top-left corner.

    Getting this wrong offsets every box by half its own size, and nothing
    downstream complains — it just trains badly. Pinned with explicit numbers.
    """
    files, targets, _ = build_createml([_img(annotations=[_bbox()])], ["cat"])
    payload = json.loads(files["train/_annotations.createml.json"])
    assert len(payload) == 1
    entry = payload[0]
    assert entry["image"] == "cat.jpg"
    coords = entry["annotations"][0]["coordinates"]
    # x=0.1 w=0.4 on a 100px image -> centre 0.3 * 100 = 30, width 40
    # y=0.2 h=0.4 on a 200px image -> centre 0.4 * 200 = 80, height 80
    assert coords == {"x": 30.0, "y": 80.0, "width": 40.0, "height": 80.0}
    assert entry["annotations"][0]["label"] == "cat"
    assert targets["a1"] == "train/cat.jpg"


def test_createml_reduces_polygon_and_warns():
    poly = {"kind": "polygon", "class_name": "cat", "class_index": 0,
            "points": [[0.2, 0.2], [0.6, 0.2], [0.6, 0.8], [0.2, 0.8]]}
    files, _, warns = build_createml([_img(annotations=[poly])], ["cat"])
    payload = json.loads(files["train/_annotations.createml.json"])
    coords = payload[0]["annotations"][0]["coordinates"]
    assert coords["width"] == 40.0 and coords["height"] == 120.0
    assert any("reduced to bounding boxes" in w for w in warns)


def test_createml_image_with_no_objects_still_listed():
    """A negative sample must appear with an empty list, not vanish."""
    files, _, _ = build_createml([_img(annotations=[])], ["cat"])
    payload = json.loads(files["train/_annotations.createml.json"])
    assert payload == [{"image": "cat.jpg", "annotations": []}]


def test_createml_skips_image_without_dimensions():
    _files, targets, warns = build_createml([_img(width=None)], ["cat"])
    assert targets == {}
    assert any("missing width/height" in w for w in warns)


# ── TensorFlow Object Detection CSV ──────────────────────────────────────


def test_tfcsv_corner_columns_and_label_map():
    files, targets, _ = build_tfcsv([_img(annotations=[_bbox()])], ["cat", "dog"])
    rows = files["train/_annotations.csv"].strip().split("\n")
    assert rows[0] == "filename,width,height,class,xmin,ymin,xmax,ymax"
    # x 0.1..0.5 of 100 -> 10..50 ; y 0.2..0.6 of 200 -> 40..120
    assert rows[1] == "cat.jpg,100,200,cat,10,40,50,120"
    assert targets["a1"] == "train/cat.jpg"
    # label_map is 1-based: id 0 is reserved for background in the TF tooling.
    assert 'id: 1\n  name: "cat"' in files["label_map.pbtxt"]
    assert 'id: 2\n  name: "dog"' in files["label_map.pbtxt"]


def test_tfcsv_never_emits_a_degenerate_box():
    """A sliver box must still satisfy xmin < xmax, or generate_tfrecord blows
    up deep in the graph with no hint which file caused it."""
    tiny = _bbox(x=0.5, y=0.5, w=0.0001, h=0.0001)
    files, _, _ = build_tfcsv([_img(annotations=[tiny])], ["cat"])
    _header, row = files["train/_annotations.csv"].strip().split("\n")
    _f, _w, _h, _c, xmin, ymin, xmax, ymax = row.split(",")
    assert int(xmax) > int(xmin) and int(ymax) > int(ymin)


def test_tfcsv_empty_image_produces_header_only():
    files, _, _ = build_tfcsv([_img(annotations=[])], ["cat"])
    assert files["train/_annotations.csv"].strip() == (
        "filename,width,height,class,xmin,ymin,xmax,ymax"
    )


# ── Segmentation masks ───────────────────────────────────────────────────


def _solid_rle(height, width, x0, y0, x1, y1):
    """Build a real COCO RLE for the rectangle [x0,x1) x [y0,y1)."""
    from labeling.mask_codec import encode_counts
    # Column-major: walk columns left to right, rows top to bottom.
    flat = []
    for col in range(width):
        for row in range(height):
            flat.append(1 if (x0 <= col < x1 and y0 <= row < y1) else 0)
    runs, current, length = [], 0, 0
    for value in flat:
        if value == current:
            length += 1
        else:
            runs.append(length)
            current, length = value, 1
    runs.append(length)
    return {"size": [height, width], "counts": encode_counts(runs)}


def test_segmentation_writes_indexed_png_with_class_index_plus_one():
    from PIL import Image
    import io as _io
    mask = {"kind": "mask", "class_name": "dog", "class_index": 1,
            "mask": _solid_rle(200, 100, 10, 20, 30, 60)}
    files, targets, _ = build_segmentation_masks(
        [_img(annotations=[mask])], ["cat", "dog"]
    )
    png = Image.open(_io.BytesIO(files["train/masks/cat.png"]))
    assert png.mode == "P" and png.size == (100, 200)
    pixels = png.load()
    # class_index 1 -> pixel value 2 ; background stays 0
    assert pixels[15, 30] == 2
    assert pixels[50, 30] == 0
    assert pixels[15, 100] == 0
    assert targets["a1"] == "train/images/cat.jpg"
    assert files["classes.txt"].startswith("0: background\n1: cat\n2: dog")


def test_segmentation_rle_geometry_matches_the_codec_exactly():
    """The stamper walks column-major runs by hand. If its index arithmetic
    drifts from the codec's, the mask lands transposed or offset — which looks
    plausible on a square test image and wrong on a real one. Asserted on a
    NON-square image with an off-centre rectangle so both axes are pinned."""
    from PIL import Image
    import io as _io
    from labeling.mask_codec import decode_counts
    height, width = 200, 100
    rle = _solid_rle(height, width, 12, 33, 41, 77)
    mask = {"kind": "mask", "class_name": "cat", "class_index": 0, "mask": rle}
    files, _, _ = build_segmentation_masks([_img(annotations=[mask])], ["cat"])
    png = Image.open(_io.BytesIO(files["train/masks/cat.png"])).load()

    # Rebuild the expected grid straight from the codec and compare every pixel.
    runs = decode_counts(rle["counts"])
    expected, position, foreground = set(), 0, False
    for run in runs:
        if foreground:
            for index in range(position, position + run):
                expected.add((index // height, index % height))  # (col, row)
        position += run
        foreground = not foreground
    for col in range(width):
        for row in range(height):
            want = 1 if (col, row) in expected else 0
            assert png[col, row] == want, f"pixel ({col},{row})"


def test_segmentation_refuses_a_mask_sized_for_a_different_image():
    mask = {"kind": "mask", "class_name": "cat", "class_index": 0,
            "mask": _solid_rle(50, 50, 1, 1, 10, 10)}   # image is 100x200
    files, _, warns = build_segmentation_masks([_img(annotations=[mask])], ["cat"])
    assert any("could not be decoded" in w for w in warns)
    assert "train/masks/cat.png" in files  # still writes an all-background mask


def test_segmentation_does_not_rasterise_bounding_boxes():
    """Filling a box would assert every pixel in it belongs to the class."""
    files, _, warns = build_segmentation_masks(
        [_img(annotations=[_bbox()])], ["cat"]
    )
    from PIL import Image
    import io as _io
    png = Image.open(_io.BytesIO(files["train/masks/cat.png"])).load()
    assert png[30, 60] == 0
    assert any("NOT rasterised" in w for w in warns)


def test_segmentation_later_annotation_wins_on_overlap():
    """Semantic segmentation allows one label per pixel; paint order decides."""
    from PIL import Image
    import io as _io
    first = {"kind": "polygon", "class_name": "cat", "class_index": 0,
             "points": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]}
    second = {"kind": "polygon", "class_name": "dog", "class_index": 1,
              "points": [[0.2, 0.2], [0.5, 0.2], [0.5, 0.5], [0.2, 0.5]]}
    files, _, _ = build_segmentation_masks(
        [_img(annotations=[first, second])], ["cat", "dog"]
    )
    png = Image.open(_io.BytesIO(files["train/masks/cat.png"])).load()
    assert png[30, 60] == 2    # inside the later 'dog' polygon
    assert png[90, 190] == 1   # outside it, still 'cat'
