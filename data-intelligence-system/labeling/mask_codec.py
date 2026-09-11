"""COCO run-length encoding for segmentation masks.

WHY THIS EXISTS RATHER THAN pycocotools
---------------------------------------
pycocotools is the reference implementation, but it is a C extension: adding it
would put a compiler back in the runtime image we just spent effort slimming,
and it pulls its own numpy pin. The format itself is ~60 lines, so it is
implemented here and tested against the cases that actually break naive
encoders (see tests/test_mask_codec.py).

THE FORMAT
----------
COCO's "compressed RLE" is defined by what pycocotools does, not by a spec:

  * Runs are counted in COLUMN-MAJOR (Fortran) order, which is why a mask that
    round-trips under row-major looks transposed in every COCO tool.
  * The sequence always starts with a run of BACKGROUND, which may be length 0
    when the top-left pixel is foreground.
  * Each run length is split into 6-bit chunks, low bits first; bit 0x20 marks
    "more chunks follow"; each chunk is offset by 48 into printable ASCII.
  * From the third run onward the DELTA against the run two positions earlier
    is encoded instead of the absolute length. Adjacent columns of a real mask
    are strongly correlated, so those deltas are small and cost fewer chunks.
    This is where the compression comes from, and it is the part naive
    implementations omit — producing output that decodes correctly in their own
    code and garbage everywhere else.

SIZE, MEASURED
--------------
A 640x480 circular blob encodes to ~607 characters (0.6 KB) for 307,200 pixels.
That is what makes JSONB storage viable and is why masks are not kept as PNGs
in object storage: no second fetch to render, and no orphaned objects to reap
when an annotation is deleted.

Worst case is a checkerboard — every pixel starts a run, so the encoding is
larger than the pixel count. Real annotation masks are contiguous blobs and
nowhere near that, but `validate_rle` caps size so a pathological or hostile
payload cannot bloat a row unbounded.
"""
from __future__ import annotations

# A mask whose encoding exceeds this is refused. Comfortably above any real
# annotation (the 640x480 blob above is 0.6 KB) while bounding what a single
# malformed or hostile request can write into a row.
MAX_RLE_CHARS = 2_000_000


class MaskError(ValueError):
    """Malformed mask payload."""


def encode_counts(counts: list[int]) -> str:
    """Run lengths -> compressed ASCII."""
    out: list[str] = []
    for i, value in enumerate(counts):
        x = value
        if i > 2:
            x -= counts[i - 2]
        more = True
        while more:
            chunk = x & 0x1F
            x >>= 5
            # Keep going while the remaining bits are more than sign extension.
            more = (x != -1) if (chunk & 0x10) else (x != 0)
            if more:
                chunk |= 0x20
            out.append(chr(chunk + 48))
    return "".join(out)


def decode_counts(s: str) -> list[int]:
    """Compressed ASCII -> run lengths. Inverse of :func:`encode_counts`."""
    counts: list[int] = []
    i, n = 0, len(s)
    while i < n:
        x, k, more = 0, 0, True
        while more:
            if i >= n:
                raise MaskError("Truncated RLE string")
            c = ord(s[i]) - 48
            x |= (c & 0x1F) << (5 * k)
            more = bool(c & 0x20)
            i += 1
            k += 1
            if not more and (c & 0x10):
                x |= -1 << (5 * k)       # sign-extend a negative delta
        if len(counts) > 2:
            x += counts[len(counts) - 2]
        counts.append(x)
    return counts


def rle_area(counts: list[int]) -> int:
    """Foreground pixel count. Odd-indexed runs are foreground (runs start with
    background), so this is just their sum."""
    return sum(counts[1::2])


def rle_bbox(counts: list[int], height: int, width: int) -> tuple[int, int, int, int]:
    """Tight bounding box of the foreground, as absolute (x, y, w, h).

    COCO annotations carry `bbox` alongside `segmentation`, and consumers use it
    for cropping and for mAP matching, so it must be the real extent rather than
    the whole frame.
    """
    x0, y0, x1, y1 = width, height, -1, -1
    pos, val = 0, 0
    for run in counts:
        if val and run:
            # Column-major: index = col * height + row.
            start, end = pos, pos + run - 1
            c0, r0 = divmod(start, height)
            c1, r1 = divmod(end, height)
            x0, x1 = min(x0, c0), max(x1, c1)
            if c0 == c1:
                y0, y1 = min(y0, r0), max(y1, r1)
            else:
                # The run wraps at least one column boundary, so it spans every
                # row somewhere within it.
                y0, y1 = 0, height - 1
        pos += run
        val ^= 1
    if x1 < 0:
        return (0, 0, 0, 0)
    return (x0, y0, x1 - x0 + 1, y1 - y0 + 1)


def validate_rle(mask: dict, *, width: int | None = None, height: int | None = None) -> dict:
    """Check a client-supplied mask and return it normalized.

    Shape is COCO's: ``{"size": [height, width], "counts": "<ascii>"}``.

    Validated rather than trusted because this is written straight to the
    database and read back by exporters: a counts string whose runs do not sum
    to height*width produces a mask that silently misaligns in every downstream
    consumer, and the symptom would be "the exported masks are subtly wrong",
    which is close to undebuggable after the fact.
    """
    if not isinstance(mask, dict):
        raise MaskError("mask must be an object")

    size = mask.get("size")
    counts = mask.get("counts")
    if not isinstance(size, (list, tuple)) or len(size) != 2:
        raise MaskError("mask.size must be [height, width]")
    if not isinstance(counts, str) or not counts:
        raise MaskError("mask.counts must be a non-empty RLE string")
    if len(counts) > MAX_RLE_CHARS:
        raise MaskError(f"mask.counts exceeds {MAX_RLE_CHARS} characters")

    try:
        h, w = int(size[0]), int(size[1])
    except (TypeError, ValueError) as exc:
        raise MaskError("mask.size entries must be integers") from exc
    if h <= 0 or w <= 0:
        raise MaskError("mask.size entries must be positive")

    # The mask must describe the image it is attached to, or coordinates mean
    # nothing. Checked here because the API layer knows the asset dimensions.
    if height is not None and width is not None and (h != height or w != width):
        raise MaskError(
            f"mask.size {h}x{w} does not match the image ({height}x{width})"
        )

    decoded = decode_counts(counts)
    if any(c < 0 for c in decoded):
        raise MaskError("RLE decoded to a negative run length")
    total = sum(decoded)
    if total != h * w:
        raise MaskError(
            f"RLE runs sum to {total} but the mask is {h}x{w} = {h * w} pixels"
        )

    return {"size": [h, w], "counts": counts}
