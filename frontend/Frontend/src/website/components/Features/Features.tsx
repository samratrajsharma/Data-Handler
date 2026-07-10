import React from 'react';
import './Features.css';

interface Feat {
  index: string;
  accent: string;
  tag: string;
  title: string;
  description: string;
}

// ── Orchestraty — the six engines of the data OS, shown directly ──
const engines: Feat[] = [
  {
    index: '01',
    accent: '#1DB954',
    tag: 'Data Intelligence',
    title: 'Auto Structuring & EDA',
    description:
      'Quality scoring, statistical profiling, and EDA — plus embeddings and density clustering that surface structure you did not know was there.',
  },
  {
    index: '02',
    accent: '#1DB954',
    tag: 'AI Labeling',
    title: 'Multi-Source Labeling',
    description:
      'Rule-based engines, LLM predictions, similarity propagation, synthetic data, and confidence-weighted aggregation.',
  },
  {
    index: '03',
    accent: '#1ED760',
    tag: 'Vision AI',
    title: 'Image Pipeline & CLIP',
    description:
      'Auto-extract metadata, generate CLIP embeddings, cluster visually similar images, and run text-to-image semantic search.',
  },
  {
    index: '04',
    accent: '#4ade80',
    tag: 'Orchestration',
    title: 'Workflow Engine',
    description:
      'Chain structuring, EDA, labeling, quality, and export into multi-step pipelines — from templates or fully custom.',
  },
  {
    index: '05',
    accent: '#1ED760',
    tag: 'Multi-LLM',
    title: 'Any Provider, One API',
    description:
      'Connect OpenAI, Anthropic, Groq, Ollama, or any OpenAI-compatible endpoint. Switch models per task, test connections live.',
  },
  {
    index: '06',
    accent: '#1DB954',
    tag: 'Local-first',
    title: 'Your Data, Your Machine',
    description:
      'Everything runs on your computer. No cloud, no accounts, no telemetry. Your datasets and API keys never leave your machine.',
  },
];

const Features: React.FC = () => {
  return (
    <section className="features section" id="features">
      <div className="container">
        <div className="features__header">
          <span className="features__eyebrow">Platform</span>
          <h2 className="features__title">Your entire data pipeline, under one roof</h2>
          <p className="features__subtitle">
            Structuring, EDA, labeling, vision, workflows, and export — six engines in one app, all running on your machine.
          </p>
        </div>

        <div className="features__grid">
          {engines.map((f) => (
            <article
              key={f.index}
              className="eng-card"
              style={{ ['--eng-accent' as string]: f.accent }}
            >
              <div className="eng-card__top">
                <span className="eng-card__tag">{f.tag}</span>
                <span className="eng-card__index">{f.index}</span>
              </div>
              <h3 className="eng-card__title">{f.title}</h3>
              <p className="eng-card__desc">{f.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
