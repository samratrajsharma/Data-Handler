import React from 'react';
import './Replace.css';

// Solo-dev comparison: one local tool instead of a stitched-together stack.
const ROWS: { old: string; neu: string }[] = [
  { old: 'Label Studio + a per-seat bill', neu: 'Rule + LLM + propagation labeling, free' },
  { old: 'DVC / lakeFS for versioning', neu: 'Immutable, versioned datasets built in' },
  { old: 'A fresh notebook every time for EDA', neu: 'Profiling, quality scores & clustering in a click' },
  { old: 'A hosted vector DB to pay for', neu: 'Local Qdrant + CLIP search, no account' },
  { old: 'One metered cloud LLM', neu: 'Any provider — or local Ollama, your keys' },
  { old: 'Cloud infra + an ops setup', neu: 'One command, on your own machine' },
];

const Replace: React.FC = () => {
  return (
    <section className="replace section" id="replace">
      <div className="container">
        <div className="replace__header">
          <span className="replace__eyebrow">For solo builders</span>
          <h2 className="replace__title">One tool instead of a stack of them</h2>
          <p className="replace__subtitle">
            What a team usually stitches together — a labeling SaaS, a versioning tool, a notebook, a
            vector DB, a cloud bill — Orchestraty does on your laptop, for free.
          </p>
        </div>

        <div className="replace__grid">
          {ROWS.map((r, i) => (
            <div key={i} className="replace__row">
              <div className="replace__old">
                <span className="replace__x" aria-hidden="true">✕</span>
                <span>{r.old}</span>
              </div>
              <span className="replace__arrow" aria-hidden="true">→</span>
              <div className="replace__new">
                <span className="replace__check" aria-hidden="true">✓</span>
                <span>{r.neu}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Replace;
