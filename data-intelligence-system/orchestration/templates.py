"""
Pre-built workflow templates for common data processing scenarios.
"""

import logging

logger = logging.getLogger(__name__)

# ── Text Classification Pipeline ──────────────────────────────────────────

TEXT_CLASSIFICATION_PIPELINE = {
    "name": "Text Classification Pipeline",
    "description": (
        "End-to-end text classification: structure raw data, run EDA, "
        "auto-label with AI, evaluate quality, and export as CSV."
    ),
    "category": "text_classification",
    "steps": [
        {
            "step_type": "structuring",
            "name": "Data Structuring",
            "config": {"null_strategy": "drop", "normalize_text": True},
        },
        {
            "step_type": "eda",
            "name": "Exploratory Data Analysis",
            "config": {},
        },
        {
            "step_type": "ai_labeling",
            "name": "AI-Powered Labeling",
            "config": {},
        },
        {
            "step_type": "quality_eval",
            "name": "Quality Evaluation",
            "config": {},
        },
        {
            "step_type": "export",
            "name": "Export Dataset",
            "config": {"format": "csv"},
        },
    ],
}

# ── Image Classification Pipeline ─────────────────────────────────────────

IMAGE_CLASSIFICATION_PIPELINE = {
    "name": "Image Classification Pipeline",
    "description": (
        "Image classification workflow: generate CLIP embeddings, cluster images, "
        "auto-label with AI, evaluate quality, and export in COCO format."
    ),
    "category": "image_labeling",
    "steps": [
        {
            "step_type": "image_embeddings",
            "name": "Generate Image Embeddings",
            "config": {},
        },
        {
            "step_type": "clustering",
            "name": "Cluster Images",
            "config": {"min_cluster_size": 5},
        },
        {
            "step_type": "ai_labeling",
            "name": "AI-Powered Labeling",
            "config": {},
        },
        {
            "step_type": "quality_eval",
            "name": "Quality Evaluation",
            "config": {},
        },
        {
            "step_type": "export",
            "name": "Export Dataset",
            "config": {"format": "coco"},
        },
    ],
}

# ── Data Cleaning Pipeline ────────────────────────────────────────────────

DATA_CLEANING_PIPELINE = {
    "name": "Data Cleaning Pipeline",
    "description": (
        "Clean and validate a raw dataset: structure, run EDA to profile data, "
        "evaluate quality, and export the cleaned result as CSV."
    ),
    "category": "data_cleaning",
    "steps": [
        {
            "step_type": "structuring",
            "name": "Data Structuring",
            "config": {"null_strategy": "drop", "normalize_text": True},
        },
        {
            "step_type": "eda",
            "name": "Exploratory Data Analysis",
            "config": {},
        },
        {
            "step_type": "quality_eval",
            "name": "Quality Evaluation",
            "config": {},
        },
        {
            "step_type": "export",
            "name": "Export Dataset",
            "config": {"format": "csv"},
        },
    ],
}

# ── Full Pipeline ─────────────────────────────────────────────────────────

FULL_PIPELINE = {
    "name": "Full Pipeline",
    "description": (
        "Complete data processing pipeline: structure, EDA, rule-based labeling, "
        "AI-powered labeling, quality evaluation, and CSV export."
    ),
    "category": "full_pipeline",
    "steps": [
        {
            "step_type": "structuring",
            "name": "Data Structuring",
            "config": {"null_strategy": "drop", "normalize_text": True},
        },
        {
            "step_type": "eda",
            "name": "Exploratory Data Analysis",
            "config": {},
        },
        {
            "step_type": "labeling",
            "name": "Rule-Based Labeling",
            "config": {},
        },
        {
            "step_type": "ai_labeling",
            "name": "AI-Powered Labeling",
            "config": {},
        },
        {
            "step_type": "quality_eval",
            "name": "Quality Evaluation",
            "config": {},
        },
        {
            "step_type": "export",
            "name": "Export Dataset",
            "config": {"format": "csv"},
        },
    ],
}

# ── All templates ─────────────────────────────────────────────────────────

ALL_TEMPLATES = [
    TEXT_CLASSIFICATION_PIPELINE,
    IMAGE_CLASSIFICATION_PIPELINE,
    DATA_CLEANING_PIPELINE,
    FULL_PIPELINE,
]
