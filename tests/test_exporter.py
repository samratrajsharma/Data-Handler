"""Exporters: CSV/JSON + COCO/YOLO classification formats."""
import json
import os
import tempfile
from quality.exporter import export_csv, export_json, export_coco, export_yolo


def test_export_csv_and_empty():
    items = [{"item_id": "1", "data": {"text": "hi"}, "label": "greet", "confidence": 0.9}]
    with tempfile.TemporaryDirectory() as d:
        p = export_csv(items, os.path.join(d, "o.csv"))
        content = open(p).read()
        assert "item_id" in content and "greet" in content and "text" in content
        assert open(export_csv([], os.path.join(d, "empty.csv"))).read() == ""


def test_export_json_roundtrip():
    items = [{"item_id": "1", "label": "a", "confidence": 0.5}]
    with tempfile.TemporaryDirectory() as d:
        assert json.load(open(export_json(items, os.path.join(d, "o.json")))) == items


def test_export_coco_structure():
    items = [
        {"item_id": "1", "file_name": "a.jpg", "width": 100, "height": 80, "label": "cat"},
        {"item_id": "2", "file_name": "b.jpg", "width": 50, "height": 40, "label": "dog"},
    ]
    with tempfile.TemporaryDirectory() as d:
        c = json.load(open(export_coco(items, os.path.join(d, "c.json"), ["cat", "dog"])))
        assert len(c["images"]) == 2 and len(c["annotations"]) == 2
        assert {cat["name"] for cat in c["categories"]} == {"cat", "dog"}
        assert c["annotations"][0]["category_id"] == 0


def test_export_yolo_files_and_unknown_label():
    items = [
        {"item_id": "img1", "file_name": "a.jpg", "label": "cat"},
        {"item_id": "img2", "file_name": "b.jpg", "label": "unknownlabel"},
    ]
    with tempfile.TemporaryDirectory() as d:
        out = export_yolo(items, os.path.join(d, "yolo"), ["cat", "dog"])
        assert os.path.exists(os.path.join(out, "classes.txt"))
        assert open(os.path.join(out, "labels", "img1.txt")).read().strip() == "0"
        assert open(os.path.join(out, "labels", "img2.txt")).read().strip() == "-1"
