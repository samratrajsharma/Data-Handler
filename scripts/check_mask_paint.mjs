/**
 * Unit tests for the mask painting primitives.
 *
 * Pure buffer maths, so they run in Node with no browser, no canvas and no npm
 * install — Node 22.6+ strips the TypeScript types on the fly, which means these
 * exercise the real source file rather than a compiled copy that could drift.
 *
 * Run:  node --experimental-strip-types scripts/check_mask_paint.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = await import(join(root, "frontend/Frontend/src/app/pages/annotate/maskPaint.ts"));
const { stampCircle, stampLine, bufferBounds, bufferIsEmpty, unionRect, isEmptyRect, EMPTY_RECT, hexToRgb, paintRgba } = M;
let fails = 0;
const t = (name, fn) => { try { fn(); console.log(`  PASS  ${name}`); } catch (e) { fails++; console.log(`  FAIL  ${name}: ${e.message}`); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const count = (b) => b.reduce((s, v) => s + (v ? 1 : 0), 0);

t("stampCircle paints a disc of roughly pi*r^2", () => {
  const W = 100, H = 100, buf = new Uint8Array(W * H);
  stampCircle(buf, W, H, 50, 50, 10, 1);
  const n = count(buf), exp = Math.PI * 100;
  if (Math.abs(n - exp) / exp > 0.12) throw new Error(`area ${n} vs ~${exp.toFixed(0)}`);
});
t("stampCircle dirty rect bounds the disc", () => {
  const W = 100, H = 100, buf = new Uint8Array(W * H);
  const r = stampCircle(buf, W, H, 50, 50, 10, 1);
  const b = bufferBounds(buf, W, H);
  if (b.x < r.x || b.y < r.y || b.x + b.w > r.x + r.w || b.y + b.h > r.y + r.h)
    throw new Error(`bounds ${JSON.stringify(b)} escape dirty ${JSON.stringify(r)}`);
});
t("stampCircle clips at the image edge (no wrap)", () => {
  const W = 50, H = 50, buf = new Uint8Array(W * H);
  stampCircle(buf, W, H, 0, 0, 8, 1);
  for (let y = 0; y < H; y++) if (buf[y * W + (W - 1)]) throw new Error(`wrapped onto right edge at row ${y}`);
});
t("stampCircle fully off-image is a no-op", () => {
  const W = 30, H = 30, buf = new Uint8Array(W * H);
  const r = stampCircle(buf, W, H, -100, -100, 5, 1);
  if (!isEmptyRect(r)) throw new Error("expected empty rect");
  if (count(buf) !== 0) throw new Error("painted off-image");
});
t("eraser is the brush with value 0", () => {
  const W = 60, H = 60, buf = new Uint8Array(W * H).fill(1);
  stampCircle(buf, W, H, 30, 30, 10, 0);
  if (buf[30 * W + 30] !== 0) throw new Error("centre not erased");
  if (buf[0] !== 1) throw new Error("erased outside the disc");
});
t("stampLine leaves no gaps on a fast drag", () => {
  const W = 200, H = 60, buf = new Uint8Array(W * H);
  stampLine(buf, W, H, 10, 30, 190, 30, 3, 1);
  for (let x = 12; x <= 188; x++) if (!buf[30 * W + x]) throw new Error(`gap at x=${x}`);
});
t("stampLine handles zero-length (a click, not a drag)", () => {
  const W = 40, H = 40, buf = new Uint8Array(W * H);
  stampLine(buf, W, H, 20, 20, 20, 20, 4, 1);
  if (count(buf) === 0) throw new Error("a click painted nothing");
});
t("bufferBounds is tight", () => {
  const W = 50, H = 50, buf = new Uint8Array(W * H);
  for (let y = 10; y < 20; y++) for (let x = 5; x < 30; x++) buf[y * W + x] = 1;
  eq(bufferBounds(buf, W, H), { x: 5, y: 10, w: 25, h: 10 }, "bounds");
});
t("bufferBounds/isEmpty on an untouched buffer", () => {
  const buf = new Uint8Array(25);
  eq(bufferBounds(buf, 5, 5), EMPTY_RECT, "bounds");
  if (!bufferIsEmpty(buf)) throw new Error("should be empty");
});
t("bufferIsEmpty false once painted", () => {
  const buf = new Uint8Array(25); buf[7] = 1;
  if (bufferIsEmpty(buf)) throw new Error("should not be empty");
});
t("unionRect ignores empty operands", () => {
  eq(unionRect(EMPTY_RECT, { x: 2, y: 3, w: 4, h: 5 }), { x: 2, y: 3, w: 4, h: 5 }, "a empty");
  eq(unionRect({ x: 2, y: 3, w: 4, h: 5 }, EMPTY_RECT), { x: 2, y: 3, w: 4, h: 5 }, "b empty");
  eq(unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 5, w: 1, h: 1 }), { x: 0, y: 0, w: 6, h: 6 }, "union");
});
t("hexToRgb parses and falls back", () => {
  eq(hexToRgb("#f97316"), [249, 115, 22], "orange");
  eq(hexToRgb("nonsense"), [148, 163, 184], "fallback");
});
t("paintRgba only touches the given rect", () => {
  const W = 10, H = 10, buf = new Uint8Array(W * H), rgba = new Uint8ClampedArray(W * H * 4).fill(99);
  buf[5 * W + 5] = 1;
  paintRgba(rgba, buf, W, { x: 4, y: 4, w: 3, h: 3 }, [1, 2, 3], 0.5);
  const inside = (5 * W + 5) * 4;
  eq([rgba[inside], rgba[inside + 1], rgba[inside + 2], rgba[inside + 3]], [1, 2, 3, 128], "painted px");
  if (rgba[0] !== 99) throw new Error("touched outside the rect");
});
console.log(fails === 0 ? "\nALL PAINT TESTS PASS" : `\n*** ${fails} FAILED ***`);
process.exit(fails ? 1 : 0);
