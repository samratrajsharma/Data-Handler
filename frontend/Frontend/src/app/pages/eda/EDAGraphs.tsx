import { useState, useEffect, useRef } from "react";
import { datasetApi } from "../../../shared/api/datasets";
import { edaApi } from "../../../shared/api/eda";

type ChartType = "bar" | "histogram" | "scatter" | "line";
type RawVal = number | string | boolean | null;
type AxisKind = "categorical" | "numeric";

interface Props { datasetId: string }
interface ColumnType { name: string; is_numeric: boolean }

interface ChartSpec {
  key: ChartType; label: string; sub: string;
  xKind: AxisKind; yKind?: AxisKind;
  /** Help text shown directly under the column pickers. */
  requirement: string;
}

const CHART_TYPES: ChartSpec[] = [
  { key: "bar", label: "Bar", sub: "Top values of a categorical column",
    xKind: "categorical", requirement: "This chart requires a categorical (text) column." },
  { key: "histogram", label: "Histogram", sub: "Distribution of a numeric column",
    xKind: "numeric", requirement: "This chart requires a numeric column." },
  { key: "scatter", label: "Scatter", sub: "Two numeric columns — dots",
    xKind: "numeric", yKind: "numeric", requirement: "This chart requires two numeric columns." },
  { key: "line", label: "Line", sub: "Two numeric columns — trend",
    xKind: "numeric", yKind: "numeric", requirement: "This chart requires two numeric columns." },
];

const PLOT = { W: 820, H: 380, L: 52, R: 24, T: 26, B: 56 };
const PW = PLOT.W - PLOT.L - PLOT.R;
const PH = PLOT.H - PLOT.T - PLOT.B;

/** Hover state shared by every chart. svgX/svgY are in viewBox units. */
interface HoverInfo {
  svgX: number; svgY: number;
  /** Optional highlighted data point coords in viewBox units. */
  pointX?: number; pointY?: number;
  /** Tooltip lines (rendered as HTML overlay). */
  lines: string[];
}

function toNumber(v: RawVal): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + i * step);
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function pairs(xs: RawVal[], ys: RawVal[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const a = toNumber(xs[i]);
    const b = toNumber(ys[i]);
    if (a !== null && b !== null) out.push([a, b]);
  }
  return out;
}

/** Convert a React MouseEvent into the SVG's viewBox coordinate system. */
function getSvgPoint(svg: SVGSVGElement, e: React.MouseEvent): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { x: -1, y: -1 };
  return {
    x: ((e.clientX - rect.left) / rect.width) * PLOT.W,
    y: ((e.clientY - rect.top) / rect.height) * PLOT.H,
  };
}

/** Crosshair lines + highlight dot, drawn above the chart contents. */
function HoverLayer({ hover }: { hover: HoverInfo | null }) {
  if (!hover) return null;
  // Clamp inside plot area so the lines don't draw over axis labels.
  const x = Math.min(Math.max(hover.svgX, PLOT.L), PLOT.L + PW);
  const y = Math.min(Math.max(hover.svgY, PLOT.T), PLOT.T + PH);
  return (
    <g pointerEvents="none">
      <line x1={x} y1={PLOT.T} x2={x} y2={PLOT.T + PH}
        stroke="#1ED760" strokeWidth="1" strokeDasharray="3 3" opacity="0.55"/>
      <line x1={PLOT.L} y1={y} x2={PLOT.L + PW} y2={y}
        stroke="#1ED760" strokeWidth="1" strokeDasharray="3 3" opacity="0.55"/>
      {hover.pointX !== undefined && hover.pointY !== undefined && (
        <circle cx={hover.pointX} cy={hover.pointY} r="5.5"
          fill="#fff" stroke="#1ED760" strokeWidth="2.5"/>
      )}
    </g>
  );
}

/** HTML tooltip positioned over the chart container at the hover location.
 *  Uses the SVG's actual bounding rect (not the container's) so the padding
 *  around the SVG doesn't skew the tooltip placement. */
function HoverTooltip({ hover, svgRect, containerRect }: {
  hover: HoverInfo | null;
  svgRect: DOMRect | null;
  containerRect: DOMRect | null;
}) {
  if (!hover || !svgRect || !containerRect) return null;
  // Convert SVG viewBox coords → SVG pixel coords → container-relative coords.
  const svgLeft = (hover.svgX / PLOT.W) * svgRect.width;
  const svgTop = (hover.svgY / PLOT.H) * svgRect.height;
  const containerX = svgRect.left - containerRect.left + svgLeft;
  const containerY = svgRect.top - containerRect.top + svgTop;
  // Flip the tooltip to the cursor's left if we'd run off the right edge.
  const flipLeft = containerX + 200 > containerRect.width;
  return (
    <div style={{
      position: "absolute",
      left: containerX + (flipLeft ? -10 : 14),
      top: containerY + 14,
      transform: flipLeft ? "translateX(-100%)" : undefined,
      pointerEvents: "none",
      background: "#fff",
      border: "1px solid var(--dash-border)",
      borderRadius: 8,
      padding: "6px 10px",
      fontSize: 12.5,
      lineHeight: 1.45,
      color: "var(--dash-text)",
      boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
      zIndex: 10,
      whiteSpace: "nowrap",
    }}>
      {hover.lines.map((l, i) => (
        <div key={i} style={{
          fontWeight: i === 0 ? 700 : 500,
          color: i === 0 ? "var(--dash-text)" : "var(--dash-text-secondary)",
        }}>{l}</div>
      ))}
    </div>
  );
}

// ── Bar chart ──────────────────────────────────────────────────────────
function BarChart({ values, label, hover, onHover, svgRef }: {
  values: RawVal[]; label: string;
  hover: HoverInfo | null;
  onHover: (h: HoverInfo | null) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const counts: Record<string, number> = {};
  values.forEach((v) => {
    if (v === null || v === undefined) return;
    const k = String(v);
    counts[k] = (counts[k] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (entries.length === 0) return <div className="g-empty">No values to plot.</div>;
  const max = Math.max(...entries.map((e) => e[1]));
  const bw = PW / entries.length;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getSvgPoint(e.currentTarget, e);
    if (pt.x < PLOT.L || pt.x > PLOT.L + PW || pt.y < PLOT.T || pt.y > PLOT.T + PH) {
      onHover(null); return;
    }
    const idx = Math.floor((pt.x - PLOT.L) / bw);
    if (idx < 0 || idx >= entries.length) { onHover(null); return; }
    const [key, count] = entries[idx];
    onHover({
      svgX: pt.x, svgY: pt.y,
      pointX: PLOT.L + idx * bw + bw / 2,
      pointY: PLOT.T + PH - (count / max) * PH,
      lines: [String(key), `${count.toLocaleString()} row${count === 1 ? "" : "s"}`],
    });
  };

  return (
    <svg ref={svgRef} viewBox={`0 0 ${PLOT.W} ${PLOT.H}`}
      style={{ width: "100%", height: "auto", display: "block", maxHeight: 460 }}
      onMouseMove={handleMove} onMouseLeave={() => onHover(null)}
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="barGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1ED760"/>
          <stop offset="1" stopColor="#1DB954"/>
        </linearGradient>
      </defs>
      <line x1={PLOT.L} y1={PLOT.T + PH} x2={PLOT.L + PW} y2={PLOT.T + PH} stroke="#2a2a2a"/>
      <line x1={PLOT.L} y1={PLOT.T} x2={PLOT.L} y2={PLOT.T + PH} stroke="#2a2a2a"/>
      {niceTicks(0, max, 4).map((t, i) => {
        const y = PLOT.T + PH - (t / max) * PH;
        return (
          <g key={i}>
            <line x1={PLOT.L} y1={y} x2={PLOT.L + PW} y2={y} stroke="#4ADE80"/>
            <text x={PLOT.L - 6} y={y + 4} fontSize="10.5" fill="#6f6f6f" textAnchor="end">{Math.round(t)}</text>
          </g>
        );
      })}
      {entries.map(([k, c], i) => {
        const h = (c / max) * PH;
        const x = PLOT.L + i * bw + bw * 0.15;
        const w = bw * 0.7;
        const y = PLOT.T + PH - h;
        return (
          <g key={k}>
            <rect x={x} y={y} width={w} height={h} rx="3" fill="url(#barGrad)"/>
            <text x={x + w / 2} y={PLOT.T + PH + 14}
              fontSize="10.5" fill="#a7a7a7" textAnchor="middle">
              {k.length > 10 ? k.slice(0, 9) + "…" : k}
            </text>
            <text x={x + w / 2} y={y - 4}
              fontSize="10" fill="#4b4b58" textAnchor="middle" fontWeight={600}>{c}</text>
          </g>
        );
      })}
      <text x={PLOT.L + PW / 2} y={PLOT.H - 8} fontSize="11" fill="#a7a7a7" textAnchor="middle">{label}</text>
      <HoverLayer hover={hover}/>
    </svg>
  );
}

// ── Histogram ──────────────────────────────────────────────────────────
function Histogram({ values, label, hover, onHover, svgRef }: {
  values: RawVal[]; label: string;
  hover: HoverInfo | null;
  onHover: (h: HoverInfo | null) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const nums = values.map(toNumber).filter((v): v is number => v !== null);
  if (nums.length === 0) return <div className="g-empty">No numeric values found in this column.</div>;
  const min = Math.min(...nums), max = Math.max(...nums);
  const bins = 20;
  const range = max - min || 1;
  const counts = new Array(bins).fill(0);
  nums.forEach((v) => {
    const idx = Math.min(bins - 1, Math.floor(((v - min) / range) * bins));
    counts[idx]++;
  });
  const cmax = Math.max(...counts);
  const bw = PW / bins;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getSvgPoint(e.currentTarget, e);
    if (pt.x < PLOT.L || pt.x > PLOT.L + PW || pt.y < PLOT.T || pt.y > PLOT.T + PH) {
      onHover(null); return;
    }
    const idx = Math.floor((pt.x - PLOT.L) / bw);
    if (idx < 0 || idx >= bins) { onHover(null); return; }
    const binStart = min + (idx / bins) * range;
    const binEnd = min + ((idx + 1) / bins) * range;
    const c = counts[idx];
    onHover({
      svgX: pt.x, svgY: pt.y,
      pointX: PLOT.L + idx * bw + bw / 2,
      pointY: PLOT.T + PH - (cmax === 0 ? 0 : (c / cmax) * PH),
      lines: [`${fmtNum(binStart)} – ${fmtNum(binEnd)}`, `${c.toLocaleString()} row${c === 1 ? "" : "s"}`],
    });
  };

  return (
    <svg ref={svgRef} viewBox={`0 0 ${PLOT.W} ${PLOT.H}`}
      style={{ width: "100%", height: "auto", display: "block", maxHeight: 460 }}
      onMouseMove={handleMove} onMouseLeave={() => onHover(null)}
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="histGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#4ade80"/>
          <stop offset="1" stopColor="#1ED760"/>
        </linearGradient>
      </defs>
      <line x1={PLOT.L} y1={PLOT.T + PH} x2={PLOT.L + PW} y2={PLOT.T + PH} stroke="#2a2a2a"/>
      <line x1={PLOT.L} y1={PLOT.T} x2={PLOT.L} y2={PLOT.T + PH} stroke="#2a2a2a"/>
      {niceTicks(0, cmax, 4).map((t, i) => {
        const y = PLOT.T + PH - (t / cmax) * PH;
        return (
          <g key={i}>
            <line x1={PLOT.L} y1={y} x2={PLOT.L + PW} y2={y} stroke="#4ADE80"/>
            <text x={PLOT.L - 6} y={y + 4} fontSize="10.5" fill="#6f6f6f" textAnchor="end">{Math.round(t)}</text>
          </g>
        );
      })}
      {counts.map((c, i) => {
        const h = cmax === 0 ? 0 : (c / cmax) * PH;
        const x = PLOT.L + i * bw;
        const y = PLOT.T + PH - h;
        return <rect key={i} x={x + 1} y={y} width={bw - 2} height={h} fill="url(#histGrad)" rx="2"/>;
      })}
      {[0, 5, 10, 15, 19].map((i) => {
        const v = min + ((i + 0.5) / bins) * range;
        return (
          <text key={i} x={PLOT.L + (i + 0.5) * bw} y={PLOT.T + PH + 14}
            fontSize="10.5" fill="#a7a7a7" textAnchor="middle">{fmtNum(v)}</text>
        );
      })}
      <text x={PLOT.L + PW / 2} y={PLOT.H - 8} fontSize="11" fill="#a7a7a7" textAnchor="middle">{label}</text>
      <HoverLayer hover={hover}/>
    </svg>
  );
}

function ChartAxes({ xMin, xMax, yMin, yMax, xl, yl }: {
  xMin: number; xMax: number; yMin: number; yMax: number; xl: string; yl: string;
}) {
  return (
    <>
      <line x1={PLOT.L} y1={PLOT.T + PH} x2={PLOT.L + PW} y2={PLOT.T + PH} stroke="#2a2a2a"/>
      <line x1={PLOT.L} y1={PLOT.T} x2={PLOT.L} y2={PLOT.T + PH} stroke="#2a2a2a"/>
      {niceTicks(yMin, yMax, 5).map((t, i) => {
        const y = PLOT.T + PH - ((t - yMin) / (yMax - yMin || 1)) * PH;
        return (
          <g key={"y" + i}>
            <line x1={PLOT.L} y1={y} x2={PLOT.L + PW} y2={y} stroke="#4ADE80"/>
            <text x={PLOT.L - 6} y={y + 4} fontSize="10.5" fill="#6f6f6f" textAnchor="end">{fmtNum(t)}</text>
          </g>
        );
      })}
      {niceTicks(xMin, xMax, 5).map((t, i) => {
        const x = PLOT.L + ((t - xMin) / (xMax - xMin || 1)) * PW;
        return (
          <text key={"x" + i} x={x} y={PLOT.T + PH + 14} fontSize="10.5" fill="#6f6f6f" textAnchor="middle">{fmtNum(t)}</text>
        );
      })}
      <text x={PLOT.L + PW / 2} y={PLOT.H - 8} fontSize="11" fill="#a7a7a7" textAnchor="middle">{xl}</text>
      <text x={14} y={PLOT.T + PH / 2} fontSize="11" fill="#a7a7a7" textAnchor="middle"
        transform={`rotate(-90, 14, ${PLOT.T + PH / 2})`}>{yl}</text>
    </>
  );
}

// ── Scatter ────────────────────────────────────────────────────────────
function Scatter({ xs, ys, xl, yl, hover, onHover, svgRef }: {
  xs: RawVal[]; ys: RawVal[]; xl: string; yl: string;
  hover: HoverInfo | null;
  onHover: (h: HoverInfo | null) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const pts = pairs(xs, ys);
  if (pts.length === 0) return <div className="g-empty">Need numeric values in both columns.</div>;
  const xMin = Math.min(...pts.map(p => p[0]));
  const xMax = Math.max(...pts.map(p => p[0]));
  const yMin = Math.min(...pts.map(p => p[1]));
  const yMax = Math.max(...pts.map(p => p[1]));
  const sx = (v: number) => PLOT.L + ((v - xMin) / (xMax - xMin || 1)) * PW;
  const sy = (v: number) => PLOT.T + PH - ((v - yMin) / (yMax - yMin || 1)) * PH;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getSvgPoint(e.currentTarget, e);
    if (pt.x < PLOT.L || pt.x > PLOT.L + PW || pt.y < PLOT.T || pt.y > PLOT.T + PH) {
      onHover(null); return;
    }
    // Find nearest data point by squared distance in viewBox space.
    let bestIdx = -1, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = sx(pts[i][0]) - pt.x;
      const dy = sy(pts[i][1]) - pt.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; bestIdx = i; }
    }
    if (bestIdx < 0 || bestD > 40 * 40) { // ~40px halo
      onHover({ svgX: pt.x, svgY: pt.y, lines: [`${xl}: ${fmtNum((pt.x - PLOT.L) / PW * (xMax - xMin) + xMin)}`, `${yl}: ${fmtNum(yMax - (pt.y - PLOT.T) / PH * (yMax - yMin))}`] });
      return;
    }
    const [px, py] = pts[bestIdx];
    onHover({
      svgX: pt.x, svgY: pt.y,
      pointX: sx(px), pointY: sy(py),
      lines: [`${xl}: ${fmtNum(px)}`, `${yl}: ${fmtNum(py)}`],
    });
  };

  return (
    <svg ref={svgRef} viewBox={`0 0 ${PLOT.W} ${PLOT.H}`}
      style={{ width: "100%", height: "auto", display: "block", maxHeight: 460 }}
      onMouseMove={handleMove} onMouseLeave={() => onHover(null)}
      xmlns="http://www.w3.org/2000/svg">
      <ChartAxes xMin={xMin} xMax={xMax} yMin={yMin} yMax={yMax} xl={xl} yl={yl}/>
      {pts.map((p, i) => (
        <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r="3" fill="#1ED760" opacity="0.75"/>
      ))}
      <HoverLayer hover={hover}/>
    </svg>
  );
}

// ── Line ───────────────────────────────────────────────────────────────
function LineChart({ xs, ys, xl, yl, hover, onHover, svgRef }: {
  xs: RawVal[]; ys: RawVal[]; xl: string; yl: string;
  hover: HoverInfo | null;
  onHover: (h: HoverInfo | null) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const pts = pairs(xs, ys).sort((a, b) => a[0] - b[0]);
  if (pts.length === 0) return <div className="g-empty">Need numeric values in both columns.</div>;
  const xMin = pts[0][0], xMax = pts[pts.length - 1][0];
  const yMin = Math.min(...pts.map(p => p[1]));
  const yMax = Math.max(...pts.map(p => p[1]));
  const sx = (v: number) => PLOT.L + ((v - xMin) / (xMax - xMin || 1)) * PW;
  const sy = (v: number) => PLOT.T + PH - ((v - yMin) / (yMax - yMin || 1)) * PH;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p[0])} ${sy(p[1])}`).join(" ");

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getSvgPoint(e.currentTarget, e);
    if (pt.x < PLOT.L || pt.x > PLOT.L + PW || pt.y < PLOT.T || pt.y > PLOT.T + PH) {
      onHover(null); return;
    }
    // Find the point with x closest to the cursor's x (line charts are
    // typically read along the time axis).
    let bestIdx = 0;
    let bestDX = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = Math.abs(sx(pts[i][0]) - pt.x);
      if (dx < bestDX) { bestDX = dx; bestIdx = i; }
    }
    const [px, py] = pts[bestIdx];
    onHover({
      svgX: pt.x, svgY: pt.y,
      pointX: sx(px), pointY: sy(py),
      lines: [`${xl}: ${fmtNum(px)}`, `${yl}: ${fmtNum(py)}`],
    });
  };

  return (
    <svg ref={svgRef} viewBox={`0 0 ${PLOT.W} ${PLOT.H}`}
      style={{ width: "100%", height: "auto", display: "block", maxHeight: 460 }}
      onMouseMove={handleMove} onMouseLeave={() => onHover(null)}
      xmlns="http://www.w3.org/2000/svg">
      <ChartAxes xMin={xMin} xMax={xMax} yMin={yMin} yMax={yMax} xl={xl} yl={yl}/>
      <path d={d} stroke="#1ED760" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      {pts.map((p, i) => (
        <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r="2.5" fill="#1DB954"/>
      ))}
      <HoverLayer hover={hover}/>
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────
export default function EDAGraphs({ datasetId }: Props) {
  const [columnTypes, setColumnTypes] = useState<ColumnType[]>([]);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [xCol, setXCol] = useState("");
  const [yCol, setYCol] = useState("");
  const [data, setData] = useState<Record<string, RawVal[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);
  const [svgRect, setSvgRect] = useState<DOMRect | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!datasetId) { setColumnTypes([]); return; }
    datasetApi.getColumnTypes(datasetId)
      .then((r) => setColumnTypes(r.data.columns || []))
      .catch(() => {
        // Fall back to a names-only list so the picker still works.
        datasetApi.getColumns(datasetId)
          .then((r) => setColumnTypes((r.data.columns || []).map((n) => ({ name: n, is_numeric: false }))))
          .catch(() => setColumnTypes([]));
      });
  }, [datasetId]);

  const spec = CHART_TYPES.find((t) => t.key === chartType)!;
  const needsY = !!spec.yKind;

  const matchesKind = (col: ColumnType, kind: AxisKind): boolean =>
    kind === "numeric" ? col.is_numeric : !col.is_numeric;
  const xCandidates = columnTypes.filter((c) => matchesKind(c, spec.xKind));
  const yCandidates = spec.yKind ? columnTypes.filter((c) => matchesKind(c, spec.yKind!)) : [];

  // Reset column selections if they no longer match the current chart's type.
  useEffect(() => {
    if (xCol && !xCandidates.some((c) => c.name === xCol)) setXCol("");
    if (yCol && needsY && !yCandidates.some((c) => c.name === yCol)) setYCol("");
  }, [chartType, columnTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear the hover state whenever the chart configuration changes so a
  // stale tooltip from the previous chart doesn't linger.
  useEffect(() => { setHover(null); }, [chartType, xCol, yCol, datasetId]);

  // Keep containerRect + svgRect in sync with the rendered sizes so the
  // tooltip placement stays accurate even as the layout changes.
  useEffect(() => {
    const update = () => {
      if (containerRef.current) setContainerRect(containerRef.current.getBoundingClientRect());
      if (svgRef.current) setSvgRect(svgRef.current.getBoundingClientRect());
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [chartType, xCol, yCol, data]);

  useEffect(() => {
    if (!datasetId || !xCol) { setData({}); return; }
    if (needsY && !yCol) { setData({}); return; }
    const cols = needsY ? [xCol, yCol] : [xCol];
    setLoading(true); setError("");
    edaApi.getColumnsData(datasetId, cols, 1000)
      .then((r) => setData(r.data.data))
      .catch((e) => {
        const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
        setError(typeof detail === "string" ? detail : "Could not load column data.");
      })
      .finally(() => setLoading(false));
  }, [datasetId, xCol, yCol, needsY]);

  const xValues = data[xCol] || [];
  const yValues = needsY ? (data[yCol] || []) : [];

  const meta = spec;
  const noColumns = columnTypes.length === 0;
  const noXCandidates = !noColumns && xCandidates.length === 0;
  const noYCandidates = !noColumns && needsY && yCandidates.length === 0;
  const xSelected = !!xCol;
  const ySelected = !needsY || !!yCol;
  const ready = xSelected && ySelected && !loading && !error;

  const handleDownload = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    // Inline computed colour values that come from CSS variables — when
    // we rasterise the SVG inside an Image, CSS vars don't resolve, so
    // we serialise with explicit colours via cloneNode + walk.
    const cloned = svg.cloneNode(true) as SVGSVGElement;
    cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    cloned.setAttribute("width", String(PLOT.W));
    cloned.setAttribute("height", String(PLOT.H));
    const svgData = new XMLSerializer().serializeToString(cloned);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const scale = 2; // retina-quality
      const canvas = document.createElement("canvas");
      canvas.width = PLOT.W * scale;
      canvas.height = PLOT.H * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); return; }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) { URL.revokeObjectURL(url); return; }
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dlUrl;
        const colSuffix = needsY ? `${xCol}_vs_${yCol}` : xCol;
        a.download = `chart_${chartType}_${colSuffix || "untitled"}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(dlUrl);
        URL.revokeObjectURL(url);
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert("Could not generate PNG — try saving a screenshot."); };
    img.src = url;
  };

  let chart: React.ReactNode = null;
  if (loading) chart = <div className="g-empty">Loading…</div>;
  else if (error) chart = <div className="g-empty" style={{color: "#dc2626"}}>{error}</div>;
  else if (!xSelected) chart = <div className="g-empty">Pick a column to start.</div>;
  else if (needsY && !ySelected) chart = <div className="g-empty">Pick a second column for the {chartType}.</div>;
  else if (xValues.length === 0) chart = <div className="g-empty">No data available.</div>;
  else if (chartType === "bar") chart = <BarChart values={xValues} label={xCol} hover={hover} onHover={setHover} svgRef={svgRef}/>;
  else if (chartType === "histogram") chart = <Histogram values={xValues} label={xCol} hover={hover} onHover={setHover} svgRef={svgRef}/>;
  else if (chartType === "scatter") chart = <Scatter xs={xValues} ys={yValues} xl={xCol} yl={yCol} hover={hover} onHover={setHover} svgRef={svgRef}/>;
  else if (chartType === "line") chart = <LineChart xs={xValues} ys={yValues} xl={xCol} yl={yCol} hover={hover} onHover={setHover} svgRef={svgRef}/>;

  return (
    <div>
      {/* Header: chart-type picker + download button */}
      <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center"}}>
        <div style={{display: "flex", gap: 8, flexWrap: "wrap", flex: 1}}>
          {CHART_TYPES.map((t) => (
            <button key={t.key}
              onClick={() => setChartType(t.key)}
              style={{
                padding: "9px 16px", borderRadius: 100,
                border: `1px solid ${chartType === t.key ? "var(--brand-indigo)" : "var(--dash-border)"}`,
                background: chartType === t.key ? "var(--dash-primary-dim)" : "#fff",
                color: chartType === t.key ? "var(--dash-primary)" : "var(--dash-text-secondary)",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit",
              }}>
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleDownload}
          disabled={!ready || xValues.length === 0}
          className="btn btn--sm btn--secondary"
          title="Download the current chart as a PNG image"
          style={{flexShrink: 0}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: 4, verticalAlign: -2}}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          Download PNG
        </button>
      </div>
      <p style={{fontSize: 12.5, color: "var(--dash-text-muted)", marginBottom: 14}}>
        {meta.sub}
      </p>

      {/* Column pickers */}
      <div style={{display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6}}>
        <div style={{flex: 1, minWidth: 200}}>
          <label style={{fontSize: 11.5, fontWeight: 700, color: "var(--dash-text-muted)",
            textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4}}>
            {needsY ? "X column" : "Column"}{spec.xKind === "numeric" ? " · numeric" : " · categorical"}
          </label>
          <select value={xCol} onChange={(e) => setXCol(e.target.value)} disabled={noColumns || noXCandidates}
            style={{width: "100%", padding: "9px 12px", border: "1px solid var(--dash-border)",
              borderRadius: 10, fontSize: 14, fontFamily: "inherit"}}>
            <option value="">
              {noColumns ? "Select a dataset above" :
                noXCandidates ? `No ${spec.xKind} columns in this dataset` :
                "— pick a column —"}
            </option>
            {xCandidates.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        {needsY && (
          <div style={{flex: 1, minWidth: 200}}>
            <label style={{fontSize: 11.5, fontWeight: 700, color: "var(--dash-text-muted)",
              textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4}}>
              Y column · numeric
            </label>
            <select value={yCol} onChange={(e) => setYCol(e.target.value)} disabled={noColumns || noYCandidates}
              style={{width: "100%", padding: "9px 12px", border: "1px solid var(--dash-border)",
                borderRadius: 10, fontSize: 14, fontFamily: "inherit"}}>
              <option value="">
                {noYCandidates ? "No numeric columns available" : "— pick a column —"}
              </option>
              {yCandidates.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Per-chart requirement hint */}
      <p style={{fontSize: 11.5, color: "var(--dash-text-muted)", marginTop: 0, marginBottom: 14,
        fontStyle: "italic"}}>
        {spec.requirement}
        {(noXCandidates || noYCandidates) && " — try a different chart type, or run structuring to convert categorical columns."}
      </p>

      {/* Chart frame */}
      <div ref={containerRef} className="g-frame" style={{
        background: "#fff", border: "1px solid var(--dash-border)", borderRadius: 14,
        padding: 16, minHeight: 360, position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {chart}
        <HoverTooltip hover={hover} svgRect={svgRect} containerRect={containerRect}/>
      </div>
      <style>{`.g-empty { color: var(--dash-text-muted); font-size: 13.5px; padding: 30px; text-align: center; }`}</style>

      {ready && xValues.length > 0 && (
        <p style={{fontSize: 11.5, color: "var(--dash-text-muted)", marginTop: 8, textAlign: "right"}}>
          Showing the first {xValues.length.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}
