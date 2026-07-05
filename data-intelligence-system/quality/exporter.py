"""
Dataset Exporter — exports labeled datasets to CSV, JSON, COCO, and YOLO formats.
"""

import csv
import json
import logging
import os

logger = logging.getLogger(__name__)


def export_csv(items: list[dict], output_path: str) -> str:
    """Export labeled items to CSV.

    Args:
        items: List of dicts with "item_id", "data" (dict of columns),
            "label", and "confidence".
        output_path: Destination file path for the CSV.

    Returns:
        The output file path.
    """
    if not items:
        logger.warning("No items to export to CSV")
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            f.write("")
        return output_path

    # Collect all data column names across items
    data_columns: list[str] = []
    seen_columns: set[str] = set()
    for item in items:
        for key in item.get("data", {}):
            if key not in seen_columns:
                data_columns.append(key)
                seen_columns.add(key)

    fieldnames = ["item_id"] + data_columns + ["label", "confidence"]

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for item in items:
            row = {"item_id": item["item_id"]}
            row.update(item.get("data", {}))
            row["label"] = item["label"]
            row["confidence"] = item["confidence"]
            writer.writerow(row)

    logger.info("Exported %d items to CSV: %s", len(items), output_path)
    return output_path


def export_json(items: list[dict], output_path: str) -> str:
    """Export labeled items to JSON.

    Args:
        items: List of dicts to serialize.
        output_path: Destination file path for the JSON.

    Returns:
        The output file path.
    """
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)

    logger.info("Exported %d items to JSON: %s", len(items), output_path)
    return output_path


def export_coco(
    image_items: list[dict],
    output_path: str,
    categories: list[str],
) -> str:
    """Export labeled image items in COCO classification format.

    Args:
        image_items: List of dicts with "item_id", "file_name", "width",
            "height", and "label".
        output_path: Destination file path for the COCO JSON.
        categories: Ordered list of category names.

    Returns:
        The output file path.
    """
    category_id_map = {name: idx for idx, name in enumerate(categories)}

    coco = {
        "images": [],
        "annotations": [],
        "categories": [
            {"id": idx, "name": name} for idx, name in enumerate(categories)
        ],
    }

    for ann_id, item in enumerate(image_items):
        image_id = ann_id  # use sequential int ids
        coco["images"].append(
            {
                "id": image_id,
                "file_name": item["file_name"],
                "width": item["width"],
                "height": item["height"],
            }
        )
        coco["annotations"].append(
            {
                "id": ann_id,
                "image_id": image_id,
                "category_id": category_id_map.get(item["label"], -1),
            }
        )

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(coco, f, indent=2, ensure_ascii=False)

    logger.info(
        "Exported %d images to COCO format: %s", len(image_items), output_path
    )
    return output_path


def export_yolo(
    image_items: list[dict],
    output_dir: str,
    categories: list[str],
) -> str:
    """Export labeled image items in YOLO classification format.

    Creates:
        <output_dir>/classes.txt — one category per line
        <output_dir>/labels/<item_id>.txt — category index per image

    Args:
        image_items: List of dicts with "item_id", "file_name", and "label".
        output_dir: Root directory for YOLO output.
        categories: Ordered list of category names.

    Returns:
        The output directory path.
    """
    category_id_map = {name: idx for idx, name in enumerate(categories)}

    os.makedirs(output_dir, exist_ok=True)
    labels_dir = os.path.join(output_dir, "labels")
    os.makedirs(labels_dir, exist_ok=True)

    # Write classes.txt
    classes_path = os.path.join(output_dir, "classes.txt")
    with open(classes_path, "w", encoding="utf-8") as f:
        for name in categories:
            f.write(f"{name}\n")

    # Write per-image label files
    for item in image_items:
        item_id = item["item_id"]
        label = item["label"]
        cat_id = category_id_map.get(label, -1)
        label_path = os.path.join(labels_dir, f"{item_id}.txt")
        with open(label_path, "w", encoding="utf-8") as f:
            f.write(f"{cat_id}\n")

    logger.info(
        "Exported %d images to YOLO format: %s", len(image_items), output_dir
    )
    return output_dir
