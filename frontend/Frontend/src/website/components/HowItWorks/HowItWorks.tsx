import React from 'react';
import './HowItWorks.css';

// ─────────────────────────────────────────────────────────────────
// "How it Works" — visual six-step pipeline. Each step has a real
// icon so visitors can grok the flow without reading. A flowing
// dot animates across the connecting line to underline the data
// movement story.
// ─────────────────────────────────────────────────────────────────
type Step = {
  n: string;
  title: string;
  description: string;
  tint: string;
  icon: React.ReactNode;
};

const I = (path: React.ReactNode) => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

const steps: Step[] = [
  {
    n: '01',
    title: 'Ingest',
    description: 'Point it at tables or image folders — formats, encodings and schema are inferred for you.',
    tint: '#1DB954',
    icon: I(
      <>
        <path d="M16 6v14" />
        <path d="M10 12l6-6 6 6" />
        <path d="M6 22h20" />
      </>
    ),
  },
  {
    n: '02',
    title: 'Structure',
    description: 'Normalize, repair and type everything into a clean, trustworthy shape.',
    tint: '#1DB954',
    icon: I(
      <>
        <rect x="5" y="6" width="22" height="4" rx="1" />
        <rect x="5" y="14" width="22" height="4" rx="1" />
        <rect x="5" y="22" width="22" height="4" rx="1" />
        <circle cx="9" cy="8" r="0.8" fill="currentColor" />
        <circle cx="9" cy="16" r="0.8" fill="currentColor" />
        <circle cx="9" cy="24" r="0.8" fill="currentColor" />
      </>
    ),
  },
  {
    n: '03',
    title: 'EDA',
    description: 'Quality scores, distribution profiles, embeddings and clusters — know your data cold.',
    tint: '#1ED760',
    icon: I(
      <>
        <path d="M5 26V14" />
        <path d="M12 26V8" />
        <path d="M19 26V18" />
        <path d="M26 26V11" />
        <path d="M3 28h26" />
      </>
    ),
  },
  {
    n: '04',
    title: 'Label',
    description: 'Rules, your own LLM, and embedding propagation label thousands of rows together.',
    tint: '#f59e0b',
    icon: I(
      <>
        <path d="M14 6h10a2 2 0 0 1 2 2v10a2 2 0 0 1-.6 1.4l-9 9a2 2 0 0 1-2.8 0L4.6 19.4a2 2 0 0 1 0-2.8l8-9A2 2 0 0 1 14 6z" />
        <circle cx="20" cy="12" r="1.5" fill="currentColor" />
      </>
    ),
  },
  {
    n: '05',
    title: 'Review',
    description: 'Quality gates and confidence-weighted aggregation, with a full audit trail.',
    tint: '#1ED760',
    icon: I(
      <>
        <path d="M2 16s5-9 14-9 14 9 14 9-5 9-14 9S2 16 2 16z" />
        <circle cx="16" cy="16" r="4" />
        <path d="M13.5 16.5l2 2 4-4.5" />
      </>
    ),
  },
  {
    n: '06',
    title: 'Export',
    description: 'Export to JSON, COCO or any format — training-ready and versioned.',
    tint: '#ef4444',
    icon: I(
      <>
        <path d="M16 20V6" />
        <path d="M10 14l6 6 6-6" />
        <path d="M6 24v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2" />
      </>
    ),
  },
];

const HowItWorks: React.FC = () => {
  return (
    <section className="howitworks section" id="how-it-works">
      <div className="container">
        <div className="hiw__header">
          <span className="hiw__eyebrow">How it works</span>
          <h2 className="hiw__title">From raw data to production in six steps</h2>
          <p className="hiw__subtitle">
            Every Orchestraty pipeline runs the same six-step flow. Use them all, or just the ones you need.
          </p>
        </div>

        {/* ── Animated flow track sits behind the steps ── */}
        <div className="hiw__track-wrap">
          <div className="hiw__track" aria-hidden="true">
            <span className="hiw__track-pulse" />
            <span className="hiw__track-pulse hiw__track-pulse--delay-1" />
            <span className="hiw__track-pulse hiw__track-pulse--delay-2" />
          </div>

          <ol className="hiw__steps" aria-label="Six pipeline steps">
            {steps.map((s) => (
              <li className="hiw-step" key={s.n} style={{ ['--step-tint' as string]: s.tint }}>
                <div className="hiw-step__icon-wrap">
                  <div className="hiw-step__icon">{s.icon}</div>
                  <span className="hiw-step__badge">{s.n}</span>
                </div>
                <h3 className="hiw-step__title">{s.title}</h3>
                <p className="hiw-step__desc">{s.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
