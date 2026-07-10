import React from 'react';
import InstallPill from '../InstallPill/InstallPill';
import './Pricing.css';

// ─────────────────────────────────────────────────────────────────
// Pricing → "Open source" page.
//
// Phase F pivot: Orchestraty is free forever, open source, and runs
// on the user's own machine. There are no paid tiers, no accounts,
// no enterprise add-ons. The page exists to communicate that and
// give people a way to support the project.
//
// The donation channels are TBD — for now the buttons are visual
// placeholders that link to the install pill. Real donation links
// can be wired in once the provider (GitHub Sponsors / Buy Me a
// Coffee / Open Collective) is picked.
// ─────────────────────────────────────────────────────────────────

const includedFeatures = [
  'Every feature, no limits',
  'All LLM providers (OpenAI, Anthropic, Groq, Ollama, …)',
  'Bring your own API keys',
  'Image pipeline + CLIP embeddings',
  'Workflow engine + multi-step pipelines',
  'Rule + AI + propagation + synthetic labeling',
  'Runs entirely on your machine',
  'No accounts, no telemetry, no lock-in',
];

const Pricing: React.FC = () => {
  return (
    <section className="pricing section" id="pricing">
      <div className="container">
        <div className="pricing__header">
          <span className="pricing__eyebrow">Open source</span>
          <h2 className="pricing__title">Free forever. Yours forever.</h2>
          <p className="pricing__subtitle">
            Orchestraty runs locally and ships with every feature unlocked.
            No tiers, no seats, no enterprise upsell.
          </p>
        </div>

        <div className="pricing__main">
          <div className="pricing__card pricing__card--popular">
            <div className="pricing__popular-badge">The only plan</div>
            <div className="pricing__card-header">
              <h3 className="pricing__plan-name">Orchestraty</h3>
              <div className="pricing__price">
                <span className="pricing__amount">$0</span>
                <span className="pricing__period">forever</span>
              </div>
              <div className="pricing__billing-note">Open source · MIT licensed</div>
              <p className="pricing__plan-desc">
                Pip install and go. Bring your own LLM keys. Your data stays on your computer.
              </p>
            </div>

            <div className="pricing__install">
              <InstallPill withFootnote={false} size="md" />
            </div>

            <ul className="pricing__features">
              {includedFeatures.map((f, i) => (
                <li key={i} className="pricing__feature">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l3.5 3.5 6.5-7" stroke="#1DB954" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pricing__support">
          <h3 className="pricing__support-title">Support development</h3>
          <p className="pricing__support-desc">
            Orchestraty is built and maintained in the open. If it saves you time, consider
            chipping in — it keeps the lights on and the roadmap moving.
          </p>
          <div className="pricing__support-actions">
            <a href="#get-started" className="pricing__support-btn pricing__support-btn--primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              Donation channels coming soon
            </a>
            <a href="#get-started" className="pricing__support-btn pricing__support-btn--ghost">
              Or just install and try it →
            </a>
          </div>
          <p className="pricing__support-fine">
            We're picking a donation provider. In the meantime, the best support is
            installing Orchestraty and telling us what's broken.
          </p>
        </div>
      </div>
    </section>
  );
};

export default Pricing;
