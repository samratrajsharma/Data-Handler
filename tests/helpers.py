"""Shared test helpers (usable by pytest and the lightweight sandbox runner)."""
import io
from PIL import Image


def make_png(size=(64, 48), mode="RGB", color=(120, 120, 120)):
    img = Image.new(mode, size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def assert_raises(exc, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except exc:
        return True
    except Exception as e:  # noqa: BLE001
        raise AssertionError(f"Expected {exc.__name__}, got {type(e).__name__}: {e}")
    raise AssertionError(f"Expected {exc.__name__}, but nothing was raised")
