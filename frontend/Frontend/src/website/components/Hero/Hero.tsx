import React from 'react';
import { Link } from 'react-router-dom';
import './Hero.css';
import HeroWordmark from './HeroWordmark';
import InstallPill from '../InstallPill/InstallPill';

// Hero — a full-section green constellation (HeroWordmark) fills the whole
// section as one canvas and forms the brand wordmark "ORCHESTRATY" large in a
// reserved slot, woven into the surrounding web. Content sits on top.

const Hero: React.FC = () => {
  return (
    <section className="hero" id="home">
      <HeroWordmark />

      <div className="hero__container">
        <div className="hero__content">

          <div className="hero__mark" aria-hidden="true">
            <img src="/orchestraty-icon.svg" alt="" width="46" height="46" />
          </div>

          {/* Reserved space the canvas draws the big ORCHESTRATY wordmark into */}
          <div className="hero__wordslot" id="hero-wordslot" aria-hidden="true" />


          <div className="hero__actions">
            <InstallPill withFootnote={false} />
          </div>

          <Link to="/tour" className="hero__tour-cta">
            <span className="hero__tour-cta-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </span>
            <span className="hero__tour-cta-text">
              <span className="hero__tour-cta-title">Take the tour</span>
              <span className="hero__tour-cta-sub">2-minute walkthrough · no install required</span>
            </span>
            <span className="hero__tour-cta-arrow" aria-hidden="true">→</span>
          </Link>

          <div className="hero__altpills">
            <span className="hero__altpill">Open source</span>
            <span className="hero__altpill-dot" aria-hidden="true">·</span>
            <span className="hero__altpill">Runs locally</span>
            <span className="hero__altpill-dot" aria-hidden="true">·</span>
            <span className="hero__altpill">No accounts</span>
            <span className="hero__altpill-dot" aria-hidden="true">·</span>
            <span className="hero__altpill">No telemetry</span>
          </div>
        </div>
      </div>

      <div className="hero__fade" aria-hidden="true" />
    </section>
  );
};

export default Hero;
