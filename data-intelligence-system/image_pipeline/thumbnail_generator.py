"""
Thumbnail Generator — creates resized thumbnail images using Pillow.
"""

import io
import logging

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)


def generate_thumbnail(
    image_bytes: bytes,
    max_size: int = 256,
    output_format: str = "JPEG",
) -> bytes:
    """
    Generate a thumbnail from raw image bytes.

    Handles EXIF orientation correction and converts RGBA to RGB when
    saving as JPEG. Uses LANCZOS resampling for high-quality downscaling.

    Args:
        image_bytes: Raw bytes of the source image.
        max_size: Maximum width or height of the thumbnail (default 256).
        output_format: Output image format (default "JPEG").

    Returns:
        Bytes of the generated thumbnail image.

    Raises:
        ValueError: If image_bytes cannot be opened as a valid image.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
    except Exception as exc:
        raise ValueError(f"Cannot open image for thumbnail: {exc}") from exc

    # Correct EXIF orientation
    try:
        img = ImageOps.exif_transpose(img)
    except Exception as exc:
        logger.debug("EXIF transpose skipped: %s", exc)

    # Resize using LANCZOS resampling, maintaining aspect ratio
    img.thumbnail((max_size, max_size), Image.LANCZOS)

    # Convert RGBA to RGB for JPEG output
    if output_format.upper() == "JPEG" and img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGB")

    # Save to bytes
    buffer = io.BytesIO()
    img.save(buffer, format=output_format)
    thumbnail_bytes = buffer.getvalue()

    logger.debug(
        "Generated %s thumbnail: %dx%d (%d bytes)",
        output_format, img.width, img.height, len(thumbnail_bytes),
    )
    return thumbnail_bytes
