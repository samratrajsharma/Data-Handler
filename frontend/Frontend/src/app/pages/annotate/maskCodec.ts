/**
 * COCO run-length encoding for segmentation masks — browser side.
 *
 * MUST STAY BYTE-IDENTICAL to data-intelligence-system/labeling/mask_codec.py.
 * The browser encodes what the user paints; Python decodes it for export. A
 * divergence between the two does not throw — it produces masks that decode to
 * the wrong pixels, and the only symptom is "the exported segmentations look
 * slightly off" long after the data was written. The two implementations are
 * cross-checked against shared vectors rather than trusted to agree.
 *
 * Format notes (see the Python module for the full description):
 *  - runs are counted COLUMN-MAJOR, starting with a background run that may be
 *    length 0
 *  - from the third run onward the delta against run i-2 is encoded
 *  - each value is split into 6-bit chunks, low bits first, 0x20 = "more
 *    follows", each chunk offset by 48 into printable ASCII
 *
 * JAVASCRIPT-SPECIFIC HAZARDS, both handled below:
 *  1. Bitwise operators coerce to int32. Run lengths are bounded by width x
 *     height, so a 4K image (~8.3M) needs 23 bits and is safe; deltas are
 *     smaller still.
 *  2. Shift counts are taken mod 32, so `-1 << 35` silently becomes `-1 << 3`.
 *     Python has no such wrap. The decoder therefore only sign-extends while
 *     the shift is in range — reachable in principle, and a wrong answer rather
 *     than an error if ignored.
 */

export interface RleMask {
  /** [height, width] in absolute pixels. */
  size: [number, number];
  /** Compressed run lengths. */
  counts: string;
}

/** Run lengths -> compressed ASCII. */
export function encodeCounts(counts: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < counts.length; i++) {
    let x = counts[i];
    // Adjacent columns of a real mask are strongly correlated, so from the
    // third run on the delta is small and costs fewer chunks. This is where
    // the compression comes from.
    if (i > 2) x -= counts[i - 2];
    let more = true;
    while (more) {
      let chunk = x & 0x1f;
      // Arithmetic shift (>>), not logical (>>>): negative deltas must keep
      // their sign, matching Python's >>.
      x >>= 5;
      more = (chunk & 0x10) !== 0 ? x !== -1 : x !== 0;
      if (more) chunk |= 0x20;
      out.push(String.fromCharCode(chunk + 48));
    }
  }
  return out.join("");
}

/** Compressed ASCII -> run lengths. Inverse of {@link encodeCounts}. */
export function decodeCounts(s: string): number[] {
  const counts: number[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    let x = 0;
    let k = 0;
    let more = true;
    while (more) {
      if (i >= n) throw new Error("Truncated RLE string");
      const c = s.charCodeAt(i) - 48;
      x |= (c & 0x1f) << (5 * k);
      more = (c & 0x20) !== 0;
      i += 1;
      k += 1;
      // Sign-extend a negative delta once the final chunk is consumed. Guarded
      // because JS takes shift counts mod 32 — without the check, 5*k >= 32
      // would wrap and corrupt the value instead of failing.
      if (!more && (c & 0x10) !== 0 && 5 * k < 32) {
        x |= -1 << (5 * k);
      }
    }
    if (counts.length > 2) x += counts[counts.length - 2];
    counts.push(x);
  }
  return counts;
}

/**
 * Binary mask (row-major, 1 byte per pixel, non-zero = foreground) -> RLE.
 *
 * The input is row-major because that is what `CanvasRenderingContext2D`
 * produces; the walk below reads it column-major, which is what COCO requires.
 * Getting that backwards is the single most likely defect here and is pinned by
 * a test.
 */
export function maskToRle(data: Uint8Array | Uint8ClampedArray, height: number, width: number): RleMask {
  const counts: number[] = [];
  let prev = 0;
  let run = 0;
  for (let c = 0; c < width; c++) {
    for (let r = 0; r < height; r++) {
      const v = data[r * width + c] ? 1 : 0;
      if (v === prev) {
        run += 1;
      } else {
        counts.push(run);
        run = 1;
        prev = v;
      }
    }
  }
  counts.push(run);
  return { size: [height, width], counts: encodeCounts(counts) };
}

/** RLE -> binary mask, row-major, 1 byte per pixel. Inverse of {@link maskToRle}. */
export function rleToMask(rle: RleMask): Uint8Array {
  const [height, width] = rle.size;
  const out = new Uint8Array(height * width);
  const counts = decodeCounts(rle.counts);
  let idx = 0;
  let val = 0;
  for (const run of counts) {
    if (val) {
      for (let k = 0; k < run; k++) {
        const pos = idx + k;
        if (pos >= height * width) break;
        // Column-major position -> row-major offset.
        const r = pos % height;
        const c = (pos / height) | 0;
        out[r * width + c] = 1;
      }
    }
    idx += run;
    val ^= 1;
  }
  return out;
}

/** Foreground pixel count, without materialising the mask. */
export function rleArea(rle: RleMask): number {
  const counts = decodeCounts(rle.counts);
  let area = 0;
  for (let i = 1; i < counts.length; i += 2) area += counts[i];
  return area;
}

/** True when the mask has no foreground — used to discard empty strokes. */
export function rleIsEmpty(rle: RleMask): boolean {
  return rleArea(rle) === 0;
}
