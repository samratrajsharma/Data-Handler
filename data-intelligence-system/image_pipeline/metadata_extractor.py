"""
Image Metadata Extractor — validates images and extracts metadata using Pillow.
"""

import io
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

from PIL import Image, ExifTags, ImageOps, UnidentifiedImageError

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif", ".bmp"}


@dataclass
class ImageMetadata:
    """Structured metadata extracted from an image."""

    width: int
    height: int
    color_mode: str
    channels: int
    has_exif: bool
    exif_data: dict = field(default_factory=dict)
    file_size: int = 0


@dataclass
class ValidationResult:
    """Result of image validation."""

    is_valid: bool
    error: Optional[str] = None
    metadata: Optional[ImageMetadata] = None


def extract_metadata(image_bytes: bytes) -> ImageMetadata:
    """
    Extract metadata from raw image bytes.

    Args:
        image_bytes: Raw bytes of the image file.

    Returns:
        ImageMetadata dataclass with extracted fields.

    Raises:
        ValueError: If image_bytes cannot be opened as a valid image.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.verify()  # Verify integrity without fully decoding
        # Re-open after verify (verify can close the file)
        img = Image.open(io.BytesIO(image_bytes))
    except (UnidentifiedImageError, Exception) as exc:
        raise ValueError(f"Cannot open image: {exc}") from exc

    # EXIF extraction
    exif_data: dict = {}
    has_exif = False
    try:
        raw_exif = img.getexif()
        if raw_exif:
            has_exif = True
            for tag_id, value in raw_exif.items():
                tag_name = ExifTags.TAGS.get(tag_id, str(tag_id))
                # Convert non-serializable values to string
                try:
                    exif_data[tag_name] = value if isinstance(value, (str, int, float)) else str(value)
                except Exception:
                    exif_data[tag_name] = str(value)
    except Exception as exc:
        logger.debug("EXIF extraction failed: %s", exc)

    # Apply EXIF orientation BEFORE reading width/height so the stored
    # dimensions match how the image is actually displayed (thumbnails are
    # already transposed). Portrait phone photos use EXIF orientation 5-8,
    # which swap width/height; without this the stored W/H would be transposed
    # relative to the pixels, and exported bounding boxes would be wrong.
    # exif_transpose returns the image unchanged when there is no orientation
    # tag. (EXIF is captured above first, so the raw orientation is preserved.)
    try:
        transposed = ImageOps.exif_transpose(img)
        if transposed is not None:
            img = transposed
    except Exception as exc:
        logger.debug("exif_transpose failed, using original orientation: %s", exc)

    # Channel count
    mode_channels = {
        "1": 1, "L": 1, "P": 1,
        "RGB": 3, "RGBA": 4, "CMYK": 4,
        "YCbCr": 3, "LAB": 3, "HSV": 3,
        "I": 1, "F": 1, "LA": 2, "RGBa": 4,
    }
    channels = mode_channels.get(img.mode, len(img.getbands()))

    metadata = ImageMetadata(
        width=img.width,
        height=img.height,
        color_mode=img.mode,
        channels=channels,
        has_exif=has_exif,
        exif_data=exif_data,
        file_size=len(image_bytes),
    )

    logger.debug(
        "Extracted metadata: %dx%d %s (%d channels)",
        metadata.width, metadata.height, metadata.color_mode, metadata.channels,
    )
    return metadata


def validate_image(image_bytes: bytes, filename: str) -> ValidationResult:
    """
    Validate that the given bytes represent a valid image with an allowed extension.

    Args:
        image_bytes: Raw bytes of the file.
        filename: Original filename (used for extension check).

    Returns:
        ValidationResult with is_valid flag, optional error, and metadata if valid.
    """
    # Check extension
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return ValidationResult(
            is_valid=False,
            error=f"Extension '{ext}' not allowed. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    # Check if bytes are empty
    if not image_bytes:
        return ValidationResult(is_valid=False, error="Empty image bytes")

    # Try to extract metadata (validates the image in the process)
    try:
        metadata = extract_metadata(image_bytes)
    except ValueError as exc:
        return ValidationResult(is_valid=False, error=str(exc))

    return ValidationResult(is_valid=True, metadata=metadata)
