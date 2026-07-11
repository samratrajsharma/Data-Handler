import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
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

// Know Your Code — the coming-soon section
const KYC_CAPS: Item[] = [
  { icon: '◷', title: 'Living Timeline', desc: 'Scrub back to any point and see the exact shape your code was in.' },
  { icon: 'Δ', title: 'What-Changed Digest', desc: 'A plain-English summary of everything that moved since last time.' },
  { icon: '↗', title: 'Trend Tracking', desc: 'Watch complexity, dead code and coupling rise or fall over weeks.' },
  { icon: '✦', title: 'AI Narration', desc: 'Your own LLM turns raw diffs into a readable story. Optional, local.' },
];

const TERM: { t: string; c: string }[] = [
  { t: '$ knowit capture ./payments-service', c: 'cmd' },
  { t: '✓ scanned 1,284 files in 0.9s', c: 'ok' },
  { t: '', c: '' },
  { t: 'What changed since last session:', c: 'head' },
  { t: '  + added    api/refunds.py           (3 new functions)', c: 'add' },
  { t: '  ~ grew     services/ledger.py       complexity 12 → 19', c: 'warn' },
  { t: '  - removed  legacy/stripe_v1.py', c: 'del' },
  { t: '  ↑ coupling billing ↔ auth  rising', c: 'warn' },
  { t: '', c: '' },
  { t: '→ re-check services/ledger.py before you ship.', c: 'hint' },
];

const STATS: [string, string][] = [
  ['6', 'engines in one app'],
  ['0', 'bytes leave your machine'],
  ['1', 'command to install'],
  ['∞', 'versions kept, nothing lost'],
];

const ComingSoon: React.FC = () => {
  const [typed, setTyped] = useState(0);
  const [notified, setNotified] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const { hash } = useLocation();

  // Deep-link: scroll to a section if the URL has a hash (e.g. #know-your-code).
  useEffect(() => {
    if (!hash) return;
    const el = document.querySelector(hash);
    if (el) {
      const t = setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 90);
      return () => clearTimeout(t);
    }
  }, [hash]);

  // Scroll-reveal + start the terminal typing when it enters view.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.cs-reveal'));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          en.target.classList.add('cs-reveal--in');
          if (en.target === termRef.current && !startedRef.current) {
            startedRef.current = true;
            let i = 0;
            const id = window.setInterval(() => {
              i += 1;
              setTyped(i);
              if (i >= TERM.length) window.clearInterval(id);
            }, 360);
          }
        });
      },
      { threshold: 0.2 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Mouse-follow glow on every capability / engine card.
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
        {/* ── HERO — Orchestraty (the live product) ── */}
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

        {/* ── What it is — concise overview, links to /platform ── */}
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

        {/* ── Coming next — Know Your Code (section, not the page) ── */}
        <section className="cs-section cs-kyc cs-reveal" id="know-your-code">
          <div className="container">
            <div className="cs-kyc__head cs-center">
              <h2 className="cs-h2 cs-center">Coming next — Know Your <span className="cs-accent">Code</span></h2>
              <p className="cs-p cs-center">
                The next chapter. Where Orchestraty makes your <em>data</em> legible, Know Your Code
                makes your <em>codebase</em> legible — continuously, as you and your AI tools reshape it.
              </p>
            </div>
            <div className="cs-two">
              <div className="cs-two__text">
                <p className="cs-p">
                  It is not a one-time analyzer. Point it at a folder and it keeps a living map of
                  your project plus an append-only log of everything that changed — new files,
                  vanishing functions, complexity creeping up in that one module — then hands you a
                  plain-English digest of what moved since you last looked.
                </p>
                <p className="cs-p">
                  Bring your own LLM to narrate the diffs, track every repo on your machine from one
                  home, and keep it all 100% local — exactly like Orchestraty.
                </p>
              </div>
              <div className="cs-term cs-reveal" ref={termRef}>
                <div className="cs-term__bar">
                  <span className="cs-term__dotrow" aria-hidden="true"><i /><i /><i /></span>
                  knowit — payments-service
                </div>
                <pre className="cs-term__body">
                  {TERM.slice(0, typed).map((l, i) => (
                    <div key={i} className={'cs-term__line cs-term__line--' + l.c}>
                      {l.t || ' '}
                      {i === typed - 1 && typed < TERM.length ? <span className="cs-term__cursor" /> : null}
                    </div>
                  ))}
                  {typed >= TERM.length ? <div className="cs-term__line"><span className="cs-term__cursor" /></div> : null}
                </pre>
              </div>
            </div>
            <div className="cs-caps cs-caps--four cs-kyc__caps">
              {KYC_CAPS.map((c, i) => (
                <div className="cs-cap" key={i}>
                  <div className="cs-cap__icon" aria-hidden="true">{c.icon}</div>
                  <h3 className="cs-cap__title">{c.title}</h3>
                  <p className="cs-cap__desc">{c.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Notify ── */}
        <section className="cs-notify cs-reveal">
          <div className="container">
            <h2 className="cs-h2 cs-center">Be the first to run Know Your Code.</h2>
            <p className="cs-p cs-center cs-notify__sub">
              It is in active design. Drop your email to get pinged the day it ships — or dive into
              Orchestraty today.
            </p>
            {notified ? (
              <div className="cs-notify__done">✓ You are on the list. We will ping you the moment it is live.</div>
            ) : (
              <form className="cs-notify__form" onSubmit={(e) => { e.preventDefault(); setNotified(true); }}>
                <input type="email" required placeholder="you@example.com" className="cs-notify__input" aria-label="Email address" />
                <button type="submit" className="cs-btn cs-btn--green">Notify me</button>
              </form>
            )}
            <div className="cs-notify__alt">
              <Link to="/platform" className="cs-link">Explore Orchestraty →</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default ComingSoon;
