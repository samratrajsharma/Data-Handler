"""Tests for tracing segmentation masks into polygons.

COCO takes RLE directly, so masks export losslessly there. YOLO and VOC have no
mask representation, so a painted mask must be traced into a polygon — and a
broken tracer produces polygons that look plausible while enclosing the wrong
pixels. These cover the cases that distinguish a correct tracer from one that
merely runs: disjoint regions, specks, and vertex explosion.
"""
import pytest

from labeling.mask_codec import encode_counts
from labeling.mask_contour import mask_to_polygons, rle_to_grid, simplify


def counts_of(mask, h, w):
    """Reference column-major run lengths."""
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


def rle_of(mask, h, w):
    return {"size": [h, w], "counts": encode_counts(counts_of(mask, h, w))}


def test_rle_to_grid_is_row_major():
    """The runs are column-major but every consumer indexes (row, col)."""
    h, w = 30, 40
    mask = [[1 if 5 <= r < 15 and 8 <= c < 25 else 0 for c in range(w)] for r in range(h)]
    grid = rle_to_grid(counts_of(mask, h, w), h, w)
    for r in range(h):
        for c in range(w):
            assert grid[r * w + c] == mask[r][c], f"mismatch at ({r},{c})"


def test_square_traces_to_one_simple_polygon():
    h = w = 30
    mask = [[1 if 5 <= r < 20 and 5 <= c < 20 else 0 for c in range(w)] for r in range(h)]
    polys = mask_to_polygons(rle_of(mask, h, w))
    assert len(polys) == 1
    # A square needs four corners; simplification should not leave many more.
    assert 4 <= len(polys[0]) <= 12


def test_disjoint_regions_become_separate_polygons():
    """The reason masks exist — and YOLO has no multi-part instance, so each
    region has to become its own line."""
    h, w = 40, 60
    mask = [[0] * w for _ in range(h)]
    for r in range(3, 15):
        for c in range(3, 18):
            mask[r][c] = 1
    for r in range(22, 36):
        for c in range(35, 55):
            mask[r][c] = 1
    polys = mask_to_polygons(rle_of(mask, h, w))
    assert len(polys) == 2


def test_regions_are_sorted_largest_first():
    h, w = 40, 60
    mask = [[0] * w for _ in range(h)]
    for r in range(2, 8):
        for c in range(2, 8):
            mask[r][c] = 1                      # small
    for r in range(15, 35):
        for c in range(20, 50):
            mask[r][c] = 1                      # large
    polys = mask_to_polygons(rle_of(mask, h, w))
    assert len(polys) == 2
    assert len(polys[0]) >= 3
    # The large region spans further right than the small one.
    assert max(p[0] for p in polys[0]) > max(p[0] for p in polys[1])


def test_single_pixel_speck_is_dropped():
    """A stray brush dab becomes a degenerate polygon most trainers reject."""
    h = w = 20
    mask = [[0] * w for _ in range(h)]
    mask[10][10] = 1
    assert mask_to_polygons(rle_of(mask, h, w)) == []


def test_simplify_removes_most_vertices_of_a_circle():
    """A traced boundary has one vertex per pixel. Left alone, label files
    balloon and every downstream loader slows for no added detail."""
    h = w = 200
    cy = cx = 100
    mask = [[1 if (r - cy) ** 2 + (c - cx) ** 2 < 70 * 70 else 0 for c in range(w)] for r in range(h)]
    raw = mask_to_polygons(rle_of(mask, h, w), simplify_px=0.0)[0]
    simplified = mask_to_polygons(rle_of(mask, h, w), simplify_px=1.5)[0]
    assert len(simplified) < len(raw) * 0.35
    assert len(simplified) >= 8          # still recognisably a circle


def test_output_is_normalized():
    h = w = 50
    mask = [[1 if 10 <= r < 30 and 10 <= c < 30 else 0 for c in range(w)] for r in range(h)]
    for x, y in mask_to_polygons(rle_of(mask, h, w))[0]:
        assert 0.0 <= x <= 1.0
        assert 0.0 <= y <= 1.0


def test_simplify_keeps_endpoints():
    pts = [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)]
    out = simplify(pts, 0.5)
    assert out[0] == (0, 0)
    assert out[-1] == (4, 0)
    assert len(out) == 2                 # a straight line needs only its ends


@pytest.mark.parametrize("bad", [
    {},
    {"size": [0, 0], "counts": "x"},
    {"size": [10, 10]},
    {"size": [10, 10], "counts": "!!!invalid!!!"},
])
def test_malformed_masks_return_empty_not_raise(bad):
    """An export covering hundreds of images should skip one bad annotation,
    not abort the whole job."""
    assert mask_to_polygons(bad) == []


def test_empty_mask_returns_no_polygons():
    h = w = 20
    assert mask_to_polygons(rle_of([[0] * w for _ in range(h)], h, w)) == []
