"""Tests for the COCO RLE mask codec.

A broken codec here does not raise — it silently writes masks that decode to the
wrong pixels, and the only symptom is "the exported segmentations look slightly
off" long after the data was created. So the cases below deliberately include
the ones that break naive implementations: column-major ordering, a foreground
pixel at the origin (zero-length leading run), disjoint regions, and holes.
"""
import random

import pytest

from labeling.mask_codec import (
    MaskError,
    decode_counts,
    encode_counts,
    rle_area,
    rle_bbox,
    validate_rle,
)


# ── Helpers: reference mask <-> counts, independent of the codec ──────────

def mask_to_counts(mask, h, w):
    """2D 0/1 mask -> column-major run lengths, starting with background."""
    flat = [mask[r][c] for c in range(w) for r in range(h)]
    counts, prev, run = [], 0, 0
    for v in flat:
        if v == prev:
            run += 1
        else:
            counts.append(run)
            run, prev = 1, v
    counts.append(run)
    return counts


def counts_to_mask(counts, h, w):
    flat, val = [], 0
    for c in counts:
        flat.extend([val] * c)
        val ^= 1
    mask = [[0] * w for _ in range(h)]
    for idx, v in enumerate(flat[: h * w]):
        mask[idx % h][idx // h] = v
    return mask


def roundtrip(mask, h, w):
    counts = mask_to_counts(mask, h, w)
    restored = decode_counts(encode_counts(counts))
    assert restored == counts
    assert counts_to_mask(restored, h, w) == mask
    return counts


# ── Codec roundtrip ──────────────────────────────────────────────────────

def test_all_background():
    roundtrip([[0] * 20 for _ in range(15)], 15, 20)


def test_all_foreground():
    """Leading background run is length 0 — a case naive encoders drop."""
    counts = roundtrip([[1] * 20 for _ in range(15)], 15, 20)
    assert counts[0] == 0


def test_solid_rectangle():
    m = [[1 if 3 <= r < 11 and 4 <= c < 15 else 0 for c in range(20)] for r in range(15)]
    roundtrip(m, 15, 20)


def test_single_pixel():
    m = [[0] * 20 for _ in range(15)]
    m[7][9] = 1
    roundtrip(m, 15, 20)


def test_checkerboard_worst_case():
    """Every pixel starts a new run: the encoding is larger than the mask."""
    roundtrip([[(r + c) % 2 for c in range(20)] for r in range(15)], 15, 20)


def test_two_disjoint_blobs():
    """Not representable as a single polygon — the reason masks exist."""
    m = [[0] * 40 for _ in range(30)]
    for r in range(3, 10):
        for c in range(3, 12):
            m[r][c] = 1
    for r in range(18, 27):
        for c in range(25, 36):
            m[r][c] = 1
    roundtrip(m, 30, 40)


def test_blob_with_hole():
    """Also beyond a simple polygon."""
    m = [[1 if 5 <= r < 25 and 5 <= c < 35 else 0 for c in range(40)] for r in range(30)]
    for r in range(12, 18):
        for c in range(15, 25):
            m[r][c] = 0
    roundtrip(m, 30, 40)


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_random_noise(seed):
    rng = random.Random(seed)
    h, w = 48, 48
    roundtrip([[rng.randint(0, 1) for _ in range(w)] for _ in range(h)], h, w)


def test_column_major_not_row_major():
    """Guards the single most likely regression.

    Row-major encoding round-trips fine against itself, so a codec that gets
    this wrong passes every symmetric test and still produces masks that appear
    transposed in COCO tooling. Pin the ordering with an asymmetric mask.
    """
    h, w = 4, 3
    m = [[0] * w for _ in range(h)]
    m[0][1] = 1            # row 0, col 1 -> column-major index 1*4 + 0 = 4
    counts = mask_to_counts(m, h, w)
    assert counts[0] == 4, "leading background run must be column-major"
    roundtrip(m, h, w)


# ── Derived values ───────────────────────────────────────────────────────

def test_area_counts_foreground_only():
    m = [[1 if 3 <= r < 11 and 4 <= c < 15 else 0 for c in range(20)] for r in range(15)]
    assert rle_area(mask_to_counts(m, 15, 20)) == (11 - 3) * (15 - 4)


def test_area_of_empty_mask_is_zero():
    assert rle_area(mask_to_counts([[0] * 5 for _ in range(5)], 5, 5)) == 0


def test_bbox_is_tight():
    """COCO consumers use bbox for cropping and mAP matching, so it has to be
    the real extent, not the whole frame."""
    h, w = 30, 40
    m = [[1 if 5 <= r < 12 and 8 <= c < 20 else 0 for c in range(w)] for r in range(h)]
    assert rle_bbox(mask_to_counts(m, h, w), h, w) == (8, 5, 12, 7)


def test_bbox_of_empty_mask():
    assert rle_bbox(mask_to_counts([[0] * 5 for _ in range(5)], 5, 5), 5, 5) == (0, 0, 0, 0)


# ── Validation ───────────────────────────────────────────────────────────

def _valid_payload(h=10, w=12):
    m = [[1 if 2 <= r < 6 and 3 <= c < 9 else 0 for c in range(w)] for r in range(h)]
    return {"size": [h, w], "counts": encode_counts(mask_to_counts(m, h, w))}


def test_validate_accepts_a_good_mask():
    payload = _valid_payload()
    assert validate_rle(payload, width=12, height=10) == payload


def test_validate_rejects_size_mismatch_with_the_image():
    """A mask that does not describe its image is meaningless, and the
    misalignment would otherwise only surface at export time."""
    with pytest.raises(MaskError, match="does not match the image"):
        validate_rle(_valid_payload(10, 12), width=640, height=480)


def test_validate_rejects_runs_that_do_not_fill_the_mask():
    bad = {"size": [10, 12], "counts": encode_counts([5, 5])}   # 10 != 120
    with pytest.raises(MaskError, match="runs sum to"):
        validate_rle(bad)


@pytest.mark.parametrize("payload", [
    "not-an-object",
    {"counts": "abc"},                       # no size
    {"size": [10], "counts": "abc"},         # malformed size
    {"size": [10, 12]},                      # no counts
    {"size": [10, 12], "counts": ""},        # empty counts
    {"size": [0, 12], "counts": "abc"},      # non-positive dimension
    {"size": [-1, 12], "counts": "abc"},
])
def test_validate_rejects_malformed_payloads(payload):
    with pytest.raises(MaskError):
        validate_rle(payload)


def test_validate_rejects_oversized_payload():
    from labeling.mask_codec import MAX_RLE_CHARS
    with pytest.raises(MaskError, match="exceeds"):
        validate_rle({"size": [10, 12], "counts": "0" * (MAX_RLE_CHARS + 1)})
