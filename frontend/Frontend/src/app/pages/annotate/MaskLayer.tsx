import { memo, useEffect, useMemo, useRef } from "react";
import type { RleMask } from "./maskCodec";
import { rleToMask } from "./maskCodec";
import { hexToRgb, paintRgba } from "./maskPaint";

/**
 * Renders segmentation masks over the image.
 *
 * WHY A CANVAS AND NOT SVG
 * The shape overlay beside this is SVG, which suits boxes and polygons — a
 * handful of vector elements. A mask is per-pixel: at 1920x1080 that is two
 * million values, with no vector primitive to express it. Canvas draws it in
 * one ImageData write.
 *
 * WHY TWO CANVASES
 * Committed masks change rarely; the in-progress stroke changes on every mouse
 * move. A single canvas meant one shared repaint, so each brush stamp
 * re-decoded and re-composited every committed mask on the image — and
 * allocated a throwaway canvas per mask to do it. On a large image with
 * several masks that is tens of milliseconds per pointer event, which is
 * exactly the lag you feel as a sticky brush.
 *
 * Splitting them means the expensive layer repaints only when the annotations
 * actually change, and the live stroke repaints alone. The browser composites
 * the two, which is work it is already optimised for.
 *
 * SIZING
 * Both canvases are at the image's NATURAL pixel size and are scaled by the
 * same CSS transform as the <img>, so one mask pixel is one image pixel at any
 * zoom and nothing is re-rasterised when zooming.
 */

export interface MaskShape {
  clientId: string;
  mask: RleMask;
  color: string;
  selected: boolean;
}

interface Props {
  width: number;
  height: number;
  shapes: MaskShape[];
  /** In-progress stroke at image resolution, or null when not painting. */
  liveBuffer: Uint8Array | null;
  liveColor: string;
  /** Bumped by the editor after each stamp to request a live repaint. */
  liveVersion: number;
  visible: boolean;
}

const ALPHA = 0.4;
const ALPHA_SELECTED = 0.6;
const ALPHA_LIVE = 0.55;

function MaskLayer({ width, height, shapes, liveBuffer, liveColor, liveVersion, visible }: Props) {
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  // One reusable staging canvas instead of a fresh one per mask per repaint.
  const stageRef = useRef<HTMLCanvasElement | null>(null);

  // Identity of the committed masks. Decoding RLE is the expensive part, so it
  // is keyed on what actually affects the pixels — recomputing on every parent
  // render would defeat the whole split.
  const key = useMemo(
    () => shapes.map((s) => `${s.clientId}:${s.mask.counts.length}:${s.color}:${s.selected}`).join("|"),
    [shapes]
  );

  // ── Committed masks: repaint only when they change ────────────────────
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || width <= 0 || height <= 0) return;

    ctx.clearRect(0, 0, width, height);
    if (!visible) return;

    if (!stageRef.current) stageRef.current = document.createElement("canvas");
    const stage = stageRef.current;
    stage.width = width;
    stage.height = height;
    const sctx = stage.getContext("2d");
    if (!sctx) return;

    const img = sctx.createImageData(width, height);
    const full = { x: 0, y: 0, w: width, h: height };

    for (const s of shapes) {
      const buf = safeDecode(s.mask, width, height);
      if (!buf) continue;
      // Composited one at a time so overlapping instances stay distinguishable
      // rather than blending into a single colour. putImageData REPLACES
      // pixels, so it goes through the staging canvas and drawImage blends.
      img.data.fill(0);
      paintRgba(img.data, buf, width, full, hexToRgb(s.color), s.selected ? ALPHA_SELECTED : ALPHA);
      sctx.putImageData(img, 0, 0);
      ctx.drawImage(stage, 0, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width, height, visible]);

  // ── Live stroke: repaints on every stamp, alone ───────────────────────
  useEffect(() => {
    const canvas = liveRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || width <= 0 || height <= 0) return;

    ctx.clearRect(0, 0, width, height);
    if (!visible || !liveBuffer) return;

    const img = ctx.createImageData(width, height);
    paintRgba(img.data, liveBuffer, width, { x: 0, y: 0, w: width, h: height }, hexToRgb(liveColor), ALPHA_LIVE);
    ctx.putImageData(img, 0, 0);
  }, [liveBuffer, liveColor, liveVersion, width, height, visible]);

  return (
    <>
      <canvas ref={baseRef} className="ann-masklayer" width={width} height={height} />
      <canvas ref={liveRef} className="ann-masklayer" width={width} height={height} />
    </>
  );
}

/**
 * Decode a stored mask, tolerating one that does not fit the image.
 *
 * A mask is tied to the pixel grid it was painted on. If the image was cropped
 * or replaced afterwards the sizes disagree, and decoding would place garbage
 * confidently over the wrong pixels. Returning null draws nothing, which is the
 * honest outcome — the API rejects such a mask on write, so this only fires for
 * rows predating that check or changed underneath.
 */
function safeDecode(mask: RleMask, width: number, height: number): Uint8Array | null {
  try {
    const [h, w] = mask.size;
    if (h !== height || w !== width) return null;
    return rleToMask(mask);
  } catch {
    return null;
  }
}

// Memoised: the editor re-renders on every pointer move while drawing, and
// without this the mask layer would reconcile on each one.
export default memo(MaskLayer);
