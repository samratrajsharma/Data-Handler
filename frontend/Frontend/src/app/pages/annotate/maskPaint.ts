/**
 * Painting primitives for segmentation masks.
 *
 * Pure functions over a flat row-major byte buffer (1 = foreground), kept apart
 * from React and from the canvas so they can be reasoned about and tested on
 * their own. The editor owns the buffer; this module only mutates it.
 *
 * The buffer is at IMAGE resolution, not screen resolution. Painting at screen
 * resolution would make a stroke's thickness depend on the zoom level, so a
 * mask drawn at 400% would be a quarter as thick once exported.
 */

/** Rectangle of a buffer that changed, for a partial canvas repaint. */
export interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An empty rect, distinguishable from a 1x1 one. */
export const EMPTY_RECT: DirtyRect = { x: 0, y: 0, w: 0, h: 0 };

export function isEmptyRect(r: DirtyRect): boolean {
  return r.w <= 0 || r.h <= 0;
}

/** Smallest rect containing both inputs; either may be empty. */
export function unionRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  if (isEmptyRect(a)) return b;
  if (isEmptyRect(b)) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x1 - x, h: y1 - y };
}

/**
 * Paint a filled circle, returning the rect actually touched.
 *
 * `value` is 1 to paint and 0 to erase, which is the only difference between
 * the brush and the eraser — they are the same operation with a different
 * fill, so the eraser cannot drift out of sync with the brush.
 *
 * Uses a squared-distance test to avoid a sqrt per pixel; at brush sizes of a
 * few hundred pixels this loop runs on every mouse move.
 */
export function stampCircle(
  buf: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  value: 0 | 1
): DirtyRect {
  const r = Math.max(0.5, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  if (x1 < x0 || y1 < y0) return EMPTY_RECT;   // entirely off-image

  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    const rowBase = y * width;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy2 <= r2) buf[rowBase + x] = value;
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Paint a stroke between two points by stamping along it.
 *
 * Mouse-move events arrive every ~8-16ms, so a fast drag jumps tens of pixels
 * between samples. Stamping only at the sampled points leaves a dotted line
 * with visible gaps. Interpolating at half-radius steps guarantees consecutive
 * stamps overlap, giving a continuous stroke at any pointer speed.
 */
export function stampLine(
  buf: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  value: 0 | 1
): DirtyRect {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(1, radius * 0.5);
  const steps = Math.max(1, Math.ceil(dist / step));

  let dirty = EMPTY_RECT;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    dirty = unionRect(
      dirty,
      stampCircle(buf, width, height, x0 + dx * t, y0 + dy * t, radius, value)
    );
  }
  return dirty;
}

/** Tight bounding box of the foreground; empty rect when nothing is set. */
export function bufferBounds(buf: Uint8Array, width: number, height: number): DirtyRect {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      if (buf[rowBase + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return EMPTY_RECT;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** True when no pixel is set — used to discard a stroke that painted nothing. */
export function bufferIsEmpty(buf: Uint8Array): boolean {
  for (let i = 0; i < buf.length; i++) if (buf[i]) return false;
  return true;
}

/**
 * Write a mask into RGBA pixels for display.
 *
 * Foreground takes the class colour at `alpha`; background is fully
 * transparent so the image shows through. Only `rect` is touched, so a stroke
 * repaints its own bounding box rather than the whole frame — the difference
 * between a responsive brush and a stuttering one on a large image.
 */
export function paintRgba(
  rgba: Uint8ClampedArray,
  buf: Uint8Array,
  width: number,
  rect: DirtyRect,
  color: [number, number, number],
  alpha: number
): void {
  const [cr, cg, cb] = color;
  const a = Math.round(alpha * 255);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const rowBase = y * width;
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (rowBase + x) * 4;
      if (buf[rowBase + x]) {
        rgba[i] = cr;
        rgba[i + 1] = cg;
        rgba[i + 2] = cb;
        rgba[i + 3] = a;
      } else {
        rgba[i + 3] = 0;
      }
    }
  }
}

/** "#rrggbb" -> [r, g, b]. Falls back to grey on anything unparseable. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [148, 163, 184];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
