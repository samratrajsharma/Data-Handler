import React, { useEffect, useState } from 'react';
import './Updates.css';

interface Update {
  tag: string;
  status: 'shipped' | 'now' | 'next';
  title: string;
  desc: string;
  timeline: string[];
  next: string;
}

const UPDATES: Update[] = [
  {
    tag: 'Phase 1',
    status: 'shipped',
    title: 'Ingestion + Structuring',
    desc: 'Versioned datasets with quality scoring, EDA and full lineage — the trustworthy foundation everything else builds on.',
    timeline: [
      'Started from one question: can a messy CSV become a dataset you actually trust?',
      'Built the ingestion layer — formats, encodings, delimiters and types inferred automatically.',
      'Added the structuring engine: normalize, repair and coerce every column into a clean shape.',
      'Wrapped it in immutable versioning + lineage so any dataset can be reproduced exactly.',
      'Shipped automated quality scoring on top, so cleanliness is a number you can see.',
    ],
    next: 'Once data was trustworthy, the obvious next job was understanding it — which became Phase 2.',
  },
  {
    tag: 'Phase 2',
    status: 'shipped',
    title: 'EDA + Rule Labeling',
    desc: 'Statistical profiling, distribution plots, downloadable reports, compound rule editor with AND / OR / ranges.',
    timeline: [
      'Layered statistical profiling over structured datasets — distributions, correlations, outliers.',
      'Made EDA reports downloadable, so the analysis travels with the data.',
      'Designed a compound rule editor: AND / OR, ranges, between, in-set.',
      'Turned rules into first-class labelers — thousands of rows tagged from patterns you already know.',
    ],
    next: 'Rules nail the known cases; the fuzzy ones needed a model. That set up Phase 3.',
  },
  {
    tag: 'Phase 3',
    status: 'now',
    title: 'AI Labeling, Vision & Local-First',
    desc: 'Multi-provider LLM labels, similarity propagation, synthetic data, and CLIP image search — plus the single-user pivot: pip-installable, runs entirely on your machine, no accounts.',
    timeline: [
      'Added a provider-agnostic LLM layer — OpenAI, Anthropic, Groq, Ollama, anything OpenAI-compatible.',
      'Built similarity propagation: spread a handful of known labels across embedding space.',
      'Brought in CLIP for vision — image embeddings, clustering and text-to-image search.',
      'Made the big pivot: pip-installable, runs entirely on your machine, no accounts, no cloud.',
      'Now hardening — confidence-weighted aggregation and review gates across every label source.',
    ],
    next: 'Next the canvas opens up: pixel-level image annotation and free-text structuring in Phase 3.5.',
  },
  {
    tag: 'Phase 3.5',
    status: 'next',
    title: 'Image & Free-Text Labelling',
    desc: 'Roboflow-level image annotation — boxes, polygons, classes — and free-form text labelling that structures whole paragraphs, not just spreadsheet cells.',
    timeline: [
      'Goal: Roboflow-level image annotation — boxes, polygons, classes — but fully local.',
      'Add free-form text labelling that structures whole paragraphs, not just spreadsheet cells.',
      'Wire every annotation back into the same versioned, reproducible dataset model.',
      'Keep it offline and accountless, exactly like every phase before it.',
    ],
    next: 'After this: deeper workflows and more export targets — still local-first, still yours.',
  },
];

const statusLabel = (s: Update['status']) =>
  s === 'shipped' ? '● Shipped' : s === 'now' ? '◐ In progress' : '○ Next';

const Updates: React.FC = () => {
  const [active, setActive] = useState<number | null>(null);
  const a = active !== null ? UPDATES[active] : null;

  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActive(null); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [active]);

  return (
    <section className="updates section" id="updates">
      <div className="container">
        <div className="updates__header">
          <span className="updates__eyebrow">Roadmap</span>
          <h2 className="updates__title">Built in the open, shipped in phases</h2>
          <p className="updates__subtitle">
            Every phase is a usable cut. Nothing here is vapor — Phases 1-3 are live in
            the current install (single-user, local-first), and Phase 3.5 is next.
            Click any phase to see how it came together.
          </p>
        </div>
        <div className="updates__grid">
          {UPDATES.map((u, i) => (
            <div
              key={i}
              className={`updates__card updates__card--${u.status}`}
              role="button"
              tabIndex={0}
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(i); }
              }}
            >
              <div className="updates__card-top">
                <span className="updates__tag">{u.tag}</span>
                <span className={`updates__status updates__status--${u.status}`}>
                  {statusLabel(u.status)}
                </span>
              </div>
              <h3 className="updates__card-title">{u.title}</h3>
              <p className="updates__card-desc">{u.desc}</p>
              <span className="updates__card-more">View build timeline →</span>
            </div>
          ))}
        </div>
      </div>

      {a && (
        <div className="phase-modal" role="dialog" aria-modal="true" onClick={() => setActive(null)}>
          <div className="phase-modal__card" onClick={(e) => e.stopPropagation()}>
            <button className="phase-modal__close" onClick={() => setActive(null)} aria-label="Close">✕</button>
            <div className="phase-modal__head">
              <span className="updates__tag">{a.tag}</span>
              <span className={`updates__status updates__status--${a.status}`}>{statusLabel(a.status)}</span>
            </div>
            <h3 className="phase-modal__title">{a.title}</h3>
            <p className="phase-modal__lead">How it came together</p>
            <ol className="phase-tl">
              {a.timeline.map((t, k) => (
                <li className="phase-tl__item" key={k}>
                  <span className="phase-tl__node" aria-hidden="true" />
                  <span className="phase-tl__text">{t}</span>
                </li>
              ))}
            </ol>
            <div className="phase-modal__next">
              <span className="phase-modal__next-label">What&apos;s next</span>
              <p>{a.next}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default Updates;
