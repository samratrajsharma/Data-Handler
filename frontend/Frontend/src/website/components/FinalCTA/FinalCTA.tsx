import React from 'react';
import InstallPill from '../InstallPill/InstallPill';
import './FinalCTA.css';

// ─────────────────────────────────────────────────────────────────
// Final CTA banner — closing nudge above the footer.
// Phase F: collapsed to a single install command instead of
// the old register / sign in buttons.
// ─────────────────────────────────────────────────────────────────
const FinalCTA: React.FC = () => {
  return (
    <section className="finalcta section" id="get-started">
      <div className="container">
        <div className="finalcta__panel">
          <div className="finalcta__glow" aria-hidden="true" />
          <div className="finalcta__content">
            <span className="finalcta__eyebrow">Get started</span>
            <h2 className="finalcta__title">
              One install away from production-ready data.
            </h2>
            <p className="finalcta__subtitle">
              Runs entirely on your machine. Bring your own LLM keys. No accounts, no lock-in.
            </p>
            <div className="finalcta__actions">
              <InstallPill withFootnote={false} size="md" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FinalCTA;
