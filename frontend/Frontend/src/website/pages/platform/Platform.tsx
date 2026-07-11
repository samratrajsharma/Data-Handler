import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Navbar from '../../components/Navbar/Navbar';
import Footer from '../../components/Footer/Footer';
import InstallPill from '../../components/InstallPill/InstallPill';
import './Platform.css';

interface Cap {
  id: string;
  num: string;
  eyebrow: string;
  title: string;
  tagline: string;
  paras: string[];
  features: string[];
  stack: string;
}

const CAPS: Cap[] = [
  {
    id: 'data-pipelines',
    num: '01',
    eyebrow: 'Foundation',
    title: 'Data Pipelines',
    tagline: 'Version-control your datasets the way you version your code.',
    paras: [
      'Point Orchestraty at anything — a gnarly 2GB CSV, a folder of half-broken JSON, a Parquet dump a teammate swears is "clean" — and it handles the unglamorous part for you: delimiters, encodings, column types, mixed nulls, stray BOM bytes, the works. What lands on the other side is a typed, profiled, trustworthy dataset instead of a guessing game.',
      'Every ingest is written as an immutable, hash-stamped version with full lineage, so "which exact rows did this model train on?" stops being a mystery you reconstruct from memory. Automated quality scoring and statistical EDA tell you how trustworthy the data is before you burn a single GPU-hour on it — and re-running the same pipeline tomorrow on a fresh export gives you the same shape, the same hash, the same checks. Reproducible by construction.',
    ],
    features: [
      'Zero-config ingestion — CSV, JSON, Parquet, whole folders',
      'Automatic schema, type & null inference',
      'Encoding & delimiter detection',
      'Immutable versioning with full lineage',
      'Automated data-quality scoring',
      'Statistical profiling (EDA) on every version',
      'Embeddings + density clustering to surface structure',
      'Deterministic, reproducible runs',
    ],
    stack: 'FastAPI · pandas · PostgreSQL · versioned object store',
  },
  {
    id: 'ai-labeling',
    num: '02',
    eyebrow: 'Labeling',
    title: 'AI Labeling',
    tagline: 'Turn 200 examples into 14,000 labeled rows.',
    paras: [
      'Three labeling engines that stack instead of compete. Rules nail the patterns you already know — compound AND / OR, ranges, between, in-set. LLMs take the fuzzy judgment calls, and you bring the model: OpenAI, Anthropic, Groq, or a fully-offline Ollama humming on your own GPU. Similarity propagation grabs a handful of human-verified labels and spreads them across embedding space to thousands of look-alike rows.',
      'A confidence-weighted aggregator reconciles all three sources into one decision per row, a review gate lets you sample-check before anything ships, and per-row provenance means you can always answer "why is this labeled that?" — down to which engine, which rule, which prompt fired. It is the difference between a label and an auditable label.',
    ],
    features: [
      'Compound rule editor — AND / OR, ranges, in-set',
      'Bring-your-own-LLM — any OpenAI-compatible provider',
      'Per-provider custom instructions',
      'Embedding-based label propagation',
      'Synthetic data generation',
      'Confidence-weighted aggregation',
      'Per-row provenance & audit trail',
      'Human-in-the-loop review gates',
    ],
    stack: 'litellm · embeddings · Qdrant · your keys, your rules',
  },
  {
    id: 'image-intelligence',
    num: '03',
    eyebrow: 'Vision',
    title: 'Image Intelligence',
    tagline: 'Ask a folder of images questions in plain English.',
    paras: [
      'Drop in images — one at a time or ten thousand at once — and Orchestraty extracts EXIF + metadata, generates CLIP embeddings that put text and pixels in the same vector space, clusters visually similar groups with HDBSCAN, and indexes the whole set in Qdrant.',
      'Then you just type what you are after — "outdoor product shots on grass", "blurry receipts", "anything that looks like this one" — and get a ranked list back in milliseconds. No labels, no training run, no tagging marathon. It is genuine semantic search over your own images, and thanks to int8-quantized inference it runs comfortably on CPU, no datacenter required.',
    ],
    features: [
      'EXIF + metadata + thumbnail pipeline',
      'CLIP text + image embeddings (one shared space)',
      'HDBSCAN visual clustering',
      '"Find similar" from any example image',
      'Text-to-image semantic search',
      'Qdrant-backed vector index',
      'int8-quantized — CPU-friendly',
      'Folder & batch upload',
    ],
    stack: 'CLIP · HDBSCAN · Qdrant · MinIO · Celery',
  },
  {
    id: 'workflow-engine',
    num: '04',
    eyebrow: 'Orchestration',
    title: 'Workflow Engine',
    tagline: 'Compose the pipeline once. Run it forever.',
    paras: [
      'Every capability above is a step you can chain. Wire ingest → structure → profile → label → review → export into a single repeatable, parameterized workflow, then fire it on demand or on a schedule. Change one input and the whole chain re-runs the same way it did last week.',
      'Heavy lifting runs in the background on a Celery worker pool so the interface never blocks, steps are idempotent and resumable, and every run is logged with its inputs, outputs, and timings. What you get is an auditable pipeline with a history — not a graveyard of one-off scripts named final_v3_REAL.py.',
    ],
    features: [
      'Multi-step pipeline composition',
      'Parameterized, reusable runs',
      'Background execution (Celery)',
      'Scheduling & triggers',
      'Idempotent, resumable steps',
      'Full run history + audit trail',
      'Automatic retry on failure',
      'Local-first — no external scheduler',
    ],
    stack: 'Celery · Redis · FastAPI · 100% on your box',
  },
];

const PlatformPage: React.FC = () => {
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const el = document.querySelector(hash);
      if (el) {
        const t = setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
        return () => clearTimeout(t);
      }
    }
    window.scrollTo(0, 0);
  }, [hash]);

  return (
    <div className="app">
      <Navbar />
      <main className="platform">
        <header className="platform__hero">
          <div className="container">
            <span className="platform__eyebrow">The Platform</span>
            <h1 className="platform__title">
              One binary. <span className="platform__title-accent">Six engines.</span> Zero lock-in.
            </h1>
            <p className="platform__lead">
              Orchestraty folds the entire data-to-model pipeline — ingestion, structuring,
              profiling, labeling, vision, and orchestration — into a single tool that runs on
              your laptop. No cloud invoice, no per-seat tax, no data ever leaving your machine.
              Here is what is actually under the hood.
            </p>
            <nav className="platform__jump" aria-label="Jump to capability">
              {CAPS.map((c) => (
                <a key={c.id} href={'#' + c.id} className="platform__jump-link">{c.title}</a>
              ))}
            </nav>
          </div>
        </header>

        {CAPS.map((c) => (
          <section className="pcap" id={c.id} key={c.id}>
            <div className="container">
              <div className="pcap__head">
                <span className="pcap__num">{c.num}</span>
                <span className="pcap__eyebrow">{c.eyebrow}</span>
              </div>
              <h2 className="pcap__title">{c.title}</h2>
              <p className="pcap__tagline">{c.tagline}</p>
              <div className="pcap__body">
                <div className="pcap__prose">
                  {c.paras.map((p, k) => <p key={k}>{p}</p>)}
                  <div className="pcap__stack">
                    <span className="pcap__stack-label">Under the hood</span>
                    {c.stack}
                  </div>
                </div>
                <ul className="pcap__features">
                  {c.features.map((f, k) => (
                    <li key={k} className="pcap__feature">
                      <span className="pcap__dot" aria-hidden="true" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ))}

        <section className="platform__cta">
          <div className="container">
            <h2 className="platform__cta-title">All of it. On your machine. For free.</h2>
            <p className="platform__cta-sub">
              One pip install puts every engine on this page on your laptop — open source, local-first, no accounts.
            </p>
            <div className="platform__cta-actions">
              <InstallPill withFootnote={false} />
              <Link to="/tour" className="platform__cta-tour">Take the 2-minute tour →</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default PlatformPage;
