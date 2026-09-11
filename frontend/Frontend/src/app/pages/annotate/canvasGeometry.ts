// Geometry helpers + the local (client-side) annotation model for the
// image annotation editor. All stored geometry is NORMALIZED 0..1 — it is
// multiplied by the image's natural width/height only for rendering and
// hit-testing.
import type {
  AnnotationKind,
  ImageAnnotationIn,
  ImageAnnotationOut,
} from "../../../shared/api/annotations";
import type { RleMask } from "./maskCodec";

// ── Local annotation model ───────────────────────────────────────────────

export interface LocalAnnotation {
  /** Stable client-side identity (survives saves). */
  clientId: string;
  /** Server id, if this annotation has been persisted. */
  serverId: string | null;
  class_id: string;
  kind: AnnotationKind;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  points: [number, number][] | null;
  /** Segmentation mask for kind === "mask", COCO RLE.
   *  Absolute pixels, unlike everything above it: RLE is defined over a pixel
   *  grid, so a mask does not survive a resize the way normalized geometry
   *  does. `size` pins it to the image it was painted on. */
  mask?: RleMask | null;
}

let idCounter = 0;
export function newClientId(): string {
  idCounter += 1;
  return `c${Date.now().toString(36)}_${idCounter}`;
}

export function fromServer(a: ImageAnnotationOut): LocalAnnotation {
  return {
    clientId: newClientId(),
    serverId: a.id,
    class_id: a.class_id,
    kind: a.kind,
    x: a.x,
    y: a.y,
    w: a.w,
    h: a.h,
    points: a.points,
    mask: (a as { mask?: RleMask | null }).mask ?? null,
  };
}

/** Strip client-only fields for the replace-all save payload. */
export function toServer(a: LocalAnnotation): ImageAnnotationIn {
  if (a.kind === "bbox") {
    return { class_id: a.class_id, kind: "bbox", x: a.x, y: a.y, w: a.w, h: a.h, points: null };
  }
  if (a.kind === "polygon") {
    return { class_id: a.class_id, kind: "polygon", x: null, y: null, w: null, h: null, points: a.points };
  }
  if (a.kind === "mask") {
    return {
      class_id: a.class_id, kind: "mask",
      x: null, y: null, w: null, h: null, points: null,
      mask: a.mask ?? null,
    };
  }
  return { class_id: a.class_id, kind: "classification", x: null, y: null, w: null, h: null, points: null };
}

// ── Scalars ──────────────────────────────────────────────────────────────

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);

// ── View transform (stage translate + scale) ─────────────────────────────

export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/** Letterbox the W×H image into a cw×ch container. */
export function fitView(W: number, H: number, cw: number, ch: number): ViewTransform {
  const scale = Math.min(cw / W, ch / H) * 0.96 || 1;
  return { scale, tx: (cw - W * scale) / 2, ty: (ch - H * scale) / 2 };
}

// ── Areas / bounds (normalized space) ────────────────────────────────────

export function polygonArea(pts: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function shapeArea(a: LocalAnnotation): number {
  if (a.kind === "bbox") return (a.w ?? 0) * (a.h ?? 0);
  if (a.kind === "polygon" && a.points) return polygonArea(a.points);
  return 0;
}

export function shapeBounds(a: LocalAnnotation): { x: number; y: number; w: number; h: number } {
  if (a.kind === "bbox") {
    return { x: a.x ?? 0, y: a.y ?? 0, w: a.w ?? 0, h: a.h ?? 0 };
  }
  if (a.kind === "polygon" && a.points && a.points.length) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const [px, py] of a.points) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

// ── Hit testing ──────────────────────────────────────────────────────────

export function pointInPolygon(pts: [number, number][], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInShape(a: LocalAnnotation, px: number, py: number): boolean {
  if (a.kind === "bbox" && a.x != null && a.y != null && a.w != null && a.h != null) {
    return px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h;
  }
  if (a.kind === "polygon" && a.points && a.points.length >= 3) {
    return pointInPolygon(a.points, px, py);
  }
  return false;
}

/** Smallest containing shape wins — "topmost smallest first". */
export function hitTest(
  annotations: LocalAnnotation[],
  px: number,
  py: number
): LocalAnnotation | null {
  let best: LocalAnnotation | null = null;
  let bestArea = Infinity;
  for (const a of annotations) {
    if (a.kind === "classification") continue;
    if (!pointInShape(a, px, py)) continue;
    const ar = shapeArea(a);
    if (ar < bestArea) {
      best = a;
      bestArea = ar;
    }
  }
  return best;
}

// ── BBox handles / resize ────────────────────────────────────────────────

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLE_IDS: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function handlePoint(
  x: number,
  y: number,
  w: number,
  h: number,
  id: HandleId
): [number, number] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (id) {
    case "nw": return [x, y];
    case "n": return [cx, y];
    case "ne": return [x + w, y];
    case "e": return [x + w, cy];
    case "se": return [x + w, y + h];
    case "s": return [cx, y + h];
    case "sw": return [x, y + h];
    case "w": return [x, cy];
  }
}

export function handleCursor(id: HandleId): string {
  if (id === "nw" || id === "se") return "nwse-resize";
  if (id === "ne" || id === "sw") return "nesw-resize";
  if (id === "n" || id === "s") return "ns-resize";
  return "ew-resize";
}

/** Resize a bbox by dragging one handle; supports flipping past the anchor. */
export function resizeBBox(
  orig: LocalAnnotation,
  id: HandleId,
  px: number,
  py: number
): { x: number; y: number; w: number; h: number } {
  let x1 = orig.x ?? 0;
  let y1 = orig.y ?? 0;
  let x2 = x1 + (orig.w ?? 0);
  let y2 = y1 + (orig.h ?? 0);
  if (id.includes("w")) x1 = px;
  if (id.includes("e")) x2 = px;
  if (id.includes("n")) y1 = py;
  if (id.includes("s")) y2 = py;
  const nx = clamp01(Math.min(x1, x2));
  const ny = clamp01(Math.min(y1, y2));
  const mx = clamp01(Math.max(x1, x2));
  const my = clamp01(Math.max(y1, y2));
  return { x: nx, y: ny, w: Math.max(mx - nx, 0.001), h: Math.max(my - ny, 0.001) };
}

/** Translate a shape by (dx, dy) normalized units, clamped fully inside 0..1. */
export function moveShape(orig: LocalAnnotation, dx: number, dy: number): LocalAnnotation {
  if (orig.kind === "bbox" && orig.x != null && orig.y != null) {
    return {
      ...orig,
      x: clamp(orig.x + dx, 0, 1 - (orig.w ?? 0)),
      y: clamp(orig.y + dy, 0, 1 - (orig.h ?? 0)),
    };
  }
  if (orig.kind === "polygon" && orig.points && orig.points.length) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const [px, py] of orig.points) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    const cdx = clamp(dx, -minX, 1 - maxX);
    const cdy = clamp(dy, -minY, 1 - maxY);
    return {
      ...orig,
      points: orig.points.map(([px, py]) => [px + cdx, py + cdy] as [number, number]),
    };
  }
  return orig;
}

/** Rect from two corner points (any drag direction), normalized ordering. */
export function rectFromPoints(
  ax: number,
  ay: number,
  bx: number,
  by: number
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x, y, w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** Drop consecutive near-duplicate vertices (double-click close leaves them). */
export function dedupePoints(
  pts: [number, number][],
  eps = 0.002
): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < eps) continue;
    out.push(p);
  }
  while (
    out.length > 1 &&
    Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < eps
  ) {
    out.pop();
  }
  return out;
}
