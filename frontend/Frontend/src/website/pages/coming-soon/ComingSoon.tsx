import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../../components/Navbar/Navbar';
import Footer from '../../components/Footer/Footer';
import ParticleCanvas from '../../components/ParticleCanvas/ParticleCanvas';
import './ComingSoon.css';

interface Item { icon: string; title: string; desc: string; }

// Orchestraty — concise overview (deep detail lives on /platform)
const ENGINES: Item[] = [
  { icon: '◷', title: 'Data Pipelines', desc: 'Ingest, structure, version and quality-score any dataset.' },
  { icon: 'Δ', title: 'AI Labeling', desc: 'Rules + your own LLM + propagation label thousands of rows.' },
  { icon: '◎', title: 'Image Intelligence', desc: 'CLIP embeddings, clustering and text-to-image search.' },
  { icon: '⇄', title: 'Workflow Engine', desc: 'Chain it all into repeatable, scheduled pipelines.' },
  { icon: '✦', title: 'Multi-LLM', desc: 'OpenAI, Anthropic, Groq, Ollama — one API, switch per task.' },
  { icon: '⬢', title: 'Local-First', desc: 'Runs entirely on your machine. No cloud, no accounts.' },
];

const STATS: [string, string][] = [
  ['6', 'engines in one app'],
  ['0', 'bytes leave your machine'],
  ['1', 'command to install'],
  ['∞', 'versions kept, nothing lost'],
];

const ComingSoon: React.FC = () => {
  // Scroll-reveal.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.cs-reveal'));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) en.target.classList.add('cs-reveal--in');
        });
      },
      { threshold: 0.2 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Mouse-follow glow on every engine card.
  useEffect(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.cs-cap'));
    const handlers: Array<[HTMLElement, (e: MouseEvent) => void]> = [];
    cards.forEach((card) => {
      const h = (e: MouseEvent) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
        card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
      };
      card.addEventListener('mousemove', h);
      handlers.push([card, h]);
    });
    return () => handlers.forEach(([c, h]) => c.removeEventListener('mousemove', h));
  }, []);

  return (
    <div className="app cs">
      <Navbar />
      <main>
        {/* ── HERO ── */}
        <section className="cs-hero">
          <ParticleCanvas />
          <div className="cs-hero__grid" aria-hidden="true" />
          <div className="container cs-hero__inner">
            <span className="cs-badge"><span className="cs-badge__dot" aria-hidden="true" /> Live now · open source · local-first</span>
            <h1 className="cs-hero__title">Your whole data pipeline,<br /><span className="cs-accent">in one local app.</span></h1>
            <p className="cs-hero__lead">
              Orchestraty is the local-first data operating system — structure messy data, profile
              and score its quality, label thousands of rows with your own LLM, search images with
              CLIP, and orchestrate it all into repeatable pipelines. No cloud, no accounts, no
              labeling bill.
            </p>
            <div className="cs-hero__chips">
              <span className="cs-chip">6 engines</span>
              <span className="cs-chip">Bring-your-own-LLM</span>
              <span className="cs-chip">CLIP vision</span>
              <span className="cs-chip">Open source</span>
            </div>
            <div className="cs-orch__cta cs-hero__cta">
              <Link to="/platform" className="cs-btn cs-btn--green">Explore the platform →</Link>
              <Link to="/tour" className="cs-btn cs-btn--ghost">Take the 2-min tour</Link>
            </div>
          </div>
        </section>

        {/* ── What it is ── */}
        <section className="cs-section cs-reveal">
          <div className="container">
            <span className="cs-eyebrow cs-center">What it is</span>
            <h2 className="cs-h2 cs-center">Six engines, one binary.</h2>
            <p className="cs-p cs-center">
              Everything you need to take raw data to a model-ready dataset lives in a single app
              that runs on your laptop. Here is the short version — the
              {' '}<Link to="/platform" className="cs-link">full platform breakdown</Link>{' '}
              goes deeper on each.
            </p>
            <div className="cs-caps cs-caps--four">
              {ENGINES.map((c, i) => (
                <div className="cs-cap" key={i}>
                  <div className="cs-cap__icon" aria-hidden="true">{c.icon}</div>
                  <h3 className="cs-cap__title">{c.title}</h3>
                  <p className="cs-cap__desc">{c.desc}</p>
                </div>
              ))}
            </div>
            <div className="cs-center cs-more">
              <Link to="/platform" className="cs-link">See the full platform →</Link>
            </div>
          </div>
        </section>

        {/* ── Stats ── */}
        <section className="cs-section cs-reveal cs-statsec">
          <div className="container">
            <div className="cs-orch__stats cs-orch__stats--row">
              {STATS.map(([n, l], i) => (
                <div className="cs-stat" key={i}>
                  <span className="cs-stat__n">{n}</span>
                  <span className="cs-stat__l">{l}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default ComingSoon;
