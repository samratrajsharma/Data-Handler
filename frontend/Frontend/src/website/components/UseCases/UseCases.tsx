import React from 'react';
import './UseCases.css';

// Two concentric layers of outlined arc-banners (green border, transparent
// fill) with curved titles, revolving clockwise. The inner layer is offset by
// 60° so each inner pill is centred on a gap of the outer layer.
const C = 300;
const xy = (a: number, r: number): [number, number] => {
  const t = (a * Math.PI) / 180;
  return [C + r * Math.cos(t), C + r * Math.sin(t)];
};
const P = (a: number, r: number): string => {
  const [x, y] = xy(a, r);
  return `${x.toFixed(1)},${y.toFixed(1)}`;
};
const bandD = (a1: number, a2: number, ro: number, ri: number, rc: number): string =>
  `M${P(a1, ro)} A${ro},${ro} 0 0 1 ${P(a2, ro)} L${P(a2 + 7, rc)} L${P(a2, ri)} A${ri},${ri} 0 0 0 ${P(a1, ri)} Z`;
const midD = (a1: number, a2: number, rc: number): string =>
  `M${P(a1, rc)} A${rc},${rc} 0 0 1 ${P(a2, rc)}`;

type Layer = 'outer' | 'inner';
const LAYERS: Record<Layer, { ro: number; ri: number; rc: number; cls: string }> = {
  outer: { ro: 269, ri: 235, rc: 252, cls: 'uc-arc-text' },
  inner: { ro: 198, ri: 166, rc: 182, cls: 'uc-arc-text uc-arc-text--in' },
};

interface UseCase { a1: number; a2: number; title: string; layer: Layer; }
const CASES: UseCase[] = [
  { a1: 280, a2: 376, title: 'Training dataset curation', layer: 'outer' },
  { a1: 40, a2: 136, title: 'ML data quality automation', layer: 'outer' },
  { a1: 160, a2: 256, title: 'Vision pipelines', layer: 'outer' },
  { a1: -20, a2: 76, title: 'Synthetic data generation', layer: 'inner' },
  { a1: 100, a2: 196, title: 'Embedding & semantic search', layer: 'inner' },
  { a1: 220, a2: 316, title: 'Workflow orchestration', layer: 'inner' },
];

const RING_O = 294;
const RING_DOTS = [0, 60, 120, 180, 240, 300];

const UseCases: React.FC = () => {
  return (
    <section className="usecases section" id="use-cases">
      <div className="container">
        <div className="usecases__orbit">
          <svg className="uc-svg" viewBox="0 0 600 600" aria-hidden="true">
            <defs>
              <linearGradient id="uc-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#1DB954" />
                <stop offset="1" stopColor="#5BE88C" />
              </linearGradient>
              {CASES.map((c, i) => <path key={i} id={`uc-mid-${i}`} d={midD(c.a1, c.a2, LAYERS[c.layer].rc)} />)}
            </defs>

            {/* decorative rings */}
            <g className="uc-ring uc-ring--outer">
              <circle className="uc-ringline" cx={C} cy={C} r={RING_O} />
              {RING_DOTS.map((a, i) => { const [x, y] = xy(a, RING_O); return <circle key={i} className="uc-ring-dot" cx={x} cy={y} r="3.2" />; })}
            </g>
            <g className="uc-ring uc-ring--mid">
              <circle className="uc-ringline uc-ringline--faint" cx={C} cy={C} r="216" />
            </g>

            {/* two revolving layers (locked together) */}
            <g className="uc-spin">
              <g className="uc-bands">
                {CASES.map((c, i) => { const L = LAYERS[c.layer]; return <path key={i} className="uc-band" d={bandD(c.a1, c.a2, L.ro, L.ri, L.rc)} />; })}
              </g>
              {CASES.map((c, i) => (
                <text key={i} className={LAYERS[c.layer].cls}>
                  <textPath href={`#uc-mid-${i}`} startOffset="50%" textAnchor="middle">{c.title}</textPath>
                </text>
              ))}
            </g>
          </svg>

          <div className="usecases__center">
            <span className="usecases__eyebrow">Use Cases</span>
            <h2 className="usecases__title">Where Orchestraty earns its keep</h2>
            <p className="usecases__subtitle">Real problems it solves, end to end.</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default UseCases;
