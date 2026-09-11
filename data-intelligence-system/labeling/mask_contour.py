"""Trace a binary mask into polygon contours, for polygon-only export formats.

WHY THIS IS NEEDED
COCO takes RLE directly, so masks export losslessly there. YOLO segmentation
and Pascal VOC have no mask representation at all — they want a polygon per
instance. Without tracing, a painted mask would degrade to its bounding box in
those formats, which throws away the entire reason for painting it.

WHAT IT DOES NOT DO
Only the OUTER boundary of each connected region is traced. Holes (a mask
shaped like a doughnut) are lost, because the YOLO polygon format cannot express
them — it is one ring per instance. That is a limitation of the target format,
not of the mask, and COCO export keeps the hole intact. Callers should prefer
COCO when fidelity matters.

No OpenCV and no scikit-image: both are large dependencies to add for ~100 lines
of well-understood geometry, and neither is currently in the image.
"""
from __future__ import annotations


def rle_to_grid(counts: list[int], height: int, width: int) -> bytearray:
    """Run lengths -> flat row-major grid, 1 byte per pixel.

    The runs are column-major (COCO's ordering); the output is row-major
    because every consumer below indexes by (row, col).
    """
    grid = bytearray(height * width)
    pos = 0
    val = 0
    total = height * width
    for run in counts:
        if val and run:
            end = min(pos + run, total)
            for p in range(pos, end):
                r = p % height
                c = p // height
                grid[r * width + c] = 1
        pos += run
        val ^= 1
        if pos >= total:
            break
    return grid


def _neighbours8(r: int, c: int):
    """Clockwise from due east — the order Moore tracing expects."""
    return (
        (r, c + 1), (r + 1, c + 1), (r + 1, c), (r + 1, c - 1),
        (r, c - 1), (r - 1, c - 1), (r - 1, c), (r - 1, c + 1),
    )


def trace_outer_contours(
    grid: bytearray, height: int, width: int, min_area: int = 8
) -> list[list[tuple[int, int]]]:
    """Outer boundary of every connected foreground region, as (x, y) pixels.

    Moore-neighbour tracing with Jacob's stopping criterion: walk the boundary
    clockwise, and stop when the start pixel is re-entered from the same
    direction. Checking only "back at the start" is the classic bug — it
    terminates early on shapes that touch their own start pixel twice, such as a
    figure-of-eight.

    Regions smaller than `min_area` pixels are dropped: a stray brush dab or a
    single-pixel speck becomes a degenerate polygon that most trainers reject.
    """
    seen = bytearray(height * width)
    contours: list[list[tuple[int, int]]] = []

    def get(r: int, c: int) -> int:
        if r < 0 or c < 0 or r >= height or c >= width:
            return 0
        return grid[r * width + c]

    for sr in range(height):
        for sc in range(width):
            if not get(sr, sc) or seen[sr * width + sc]:
                continue
            # A foreground pixel with background to its left starts an
            # unvisited outer boundary.
            if get(sr, sc - 1):
                continue

            contour: list[tuple[int, int]] = []
            start = (sr, sc)
            # Previous position, used to pick where to resume the neighbour
            # scan; starting to the west matches entering from the left.
            prev = (sr, sc - 1)
            cur = start
            first_step = None
            guard = 0
            limit = 8 * height * width          # cannot loop longer than this

            while True:
                guard += 1
                if guard > limit:
                    break                        # malformed input; bail rather than hang
                contour.append((cur[1], cur[0]))  # (x, y)
                seen[cur[0] * width + cur[1]] = 1

                nb = _neighbours8(cur[0], cur[1])
                try:
                    start_idx = (nb.index(prev) + 1) % 8
                except ValueError:
                    start_idx = 0

                moved = False
                for k in range(8):
                    idx = (start_idx + k) % 8
                    nr, nc = nb[idx]
                    if get(nr, nc):
                        prev = cur
                        cur = (nr, nc)
                        moved = True
                        break
                if not moved:
                    break                        # isolated pixel

                if first_step is None:
                    first_step = cur
                elif cur == start and prev == first_step:
                    break                        # Jacob's criterion
                elif cur == start and len(contour) > 2 and first_step == contour[1][::-1]:
                    break

            if len(contour) >= 3 and _polygon_area(contour) >= min_area:
                contours.append(contour)

    return contours


def _polygon_area(points: list[tuple[int, int]]) -> float:
    """Absolute shoelace area."""
    n = len(points)
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        x0, y0 = points[i]
        x1, y1 = points[(i + 1) % n]
        total += x0 * y1 - x1 * y0
    return abs(total) / 2.0


def simplify(points: list[tuple[int, int]], epsilon: float) -> list[tuple[int, int]]:
    """Ramer-Douglas-Peucker simplification.

    A traced boundary has one vertex PER PIXEL — a medium blob easily runs to
    thousands. Written out per instance that bloats label files enormously and
    slows every downstream loader, while adding no real detail. Dropping
    vertices that sit within `epsilon` pixels of the line they lie on typically
    removes 95%+ of them with no visible change.

    Iterative rather than recursive: a 50,000-vertex contour would blow the
    Python stack.
    """
    if len(points) < 3 or epsilon <= 0:
        return points

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]

    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        x0, y0 = points[first]
        x1, y1 = points[last]
        dx, dy = x1 - x0, y1 - y0
        denom = (dx * dx + dy * dy) ** 0.5

        max_d = -1.0
        max_i = first
        for i in range(first + 1, last):
            px, py = points[i]
            if denom == 0:
                d = ((px - x0) ** 2 + (py - y0) ** 2) ** 0.5
            else:
                d = abs(dy * px - dx * py + x1 * y0 - y1 * x0) / denom
            if d > max_d:
                max_d, max_i = d, i

        if max_d > epsilon:
            keep[max_i] = True
            stack.append((first, max_i))
            stack.append((max_i, last))

    return [p for p, k in zip(points, keep) if k]


def mask_to_polygons(
    mask: dict, *, simplify_px: float = 1.5, min_area: int = 8
) -> list[list[tuple[float, float]]]:
    """RLE mask -> normalized 0..1 polygons, largest region first.

    Returns [] rather than raising on a malformed mask: an export covering
    hundreds of images should skip one bad annotation, not abort the job.
    """
    try:
        from labeling.mask_codec import decode_counts

        height, width = int(mask["size"][0]), int(mask["size"][1])
        if height <= 0 or width <= 0:
            return []
        grid = rle_to_grid(decode_counts(mask["counts"]), height, width)
        rings = trace_outer_contours(grid, height, width, min_area=min_area)
        rings.sort(key=_polygon_area, reverse=True)
        out: list[list[tuple[float, float]]] = []
        for ring in rings:
            pts = simplify(ring, simplify_px)
            if len(pts) < 3:
                continue
            out.append([(x / width, y / height) for x, y in pts])
        return out
    except Exception:
        return []
