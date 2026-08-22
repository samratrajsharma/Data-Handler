"""Annotation export builders: YOLO / COCO / VOC / classification."""
import json
from labeling.annotation_exporter import (
    build_yolo, build_coco, build_voc, build_classification,
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
