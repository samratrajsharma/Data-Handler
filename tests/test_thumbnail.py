"""Thumbnail generation (resize, format, RGBA->RGB)."""
import io
from PIL import Image
from image_pipeline.thumbnail_generator import generate_thumbnail
from helpers import make_png, assert_raises


def test_thumbnail_shrinks_and_is_jpeg():
    thumb = generate_thumbnail(make_png((512, 256), "RGB"), max_size=128)
    img = Image.open(io.BytesIO(thumb))
    assert max(img.size) <= 128 and img.format == "JPEG"


def test_thumbnail_rgba_to_rgb():
    thumb = generate_thumbnail(make_png((64, 64), "RGBA", (1, 2, 3, 4)), max_size=32)
    assert Image.open(io.BytesIO(thumb)).mode == "RGB"


def test_thumbnail_bad_bytes_raises():
    assert_raises(ValueError, generate_thumbnail, b"nope")
