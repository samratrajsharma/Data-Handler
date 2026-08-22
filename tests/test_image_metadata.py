"""Image metadata extraction + validation (Pillow)."""
from image_pipeline.metadata_extractor import extract_metadata, validate_image
from helpers import make_png, assert_raises


def test_extract_metadata_rgb():
    b = make_png((64, 48), "RGB")
    m = extract_metadata(b)
    assert m.width == 64 and m.height == 48 and m.color_mode == "RGB" and m.channels == 3
    assert m.file_size == len(b)


def test_extract_metadata_rgba_channels():
    m = extract_metadata(make_png((10, 10), "RGBA", (1, 2, 3, 4)))
    assert m.color_mode == "RGBA" and m.channels == 4


def test_validate_valid_png():
    r = validate_image(make_png(), "photo.png")
    assert r.is_valid and r.metadata is not None


def test_validate_bad_extension():
    r = validate_image(make_png(), "notes.txt")
    assert r.is_valid is False and "not allowed" in (r.error or "")


def test_validate_empty_and_corrupt():
    assert validate_image(b"", "x.png").is_valid is False
    assert validate_image(b"not an image at all", "x.png").is_valid is False


def test_extract_bad_bytes_raises():
    assert_raises(ValueError, extract_metadata, b"nonsense-bytes")
