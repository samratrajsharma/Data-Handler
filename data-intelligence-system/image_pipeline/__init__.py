"""
Image Processing Pipeline — metadata extraction, thumbnail generation,
CLIP embedding, and image clustering.
"""

from .metadata_extractor import (
    ImageMetadata,
    ValidationResult,
    extract_metadata,
    validate_image,
)
from .thumbnail_generator import generate_thumbnail
from .clip_embedder import (
    load_clip_model,
    embed_images,
    embed_text,
    store_image_vectors_in_qdrant,
    search_similar,
)
from .image_clusterer import ImageClusterReport, cluster_images

__all__ = [
    "ImageMetadata",
    "ValidationResult",
    "extract_metadata",
    "validate_image",
    "generate_thumbnail",
    "load_clip_model",
    "embed_images",
    "embed_text",
    "store_image_vectors_in_qdrant",
    "search_similar",
    "ImageClusterReport",
    "cluster_images",
]
