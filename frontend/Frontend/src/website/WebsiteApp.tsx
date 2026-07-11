import React, { useLayoutEffect } from 'react';
import './WebsiteApp.css';
import Navbar from './components/Navbar/Navbar';
import Hero from './components/Hero/Hero';
import Stack from './components/Stack/Stack';
import Features from './components/Features/Features';
import HowItWorks from './components/HowItWorks/HowItWorks';
import DeepDive from './components/DeepDive/DeepDive';
import Replace from './components/Replace/Replace';
import UseCases from './components/UseCases/UseCases';
import Integrations from './components/Integrations/Integrations';
import FAQ from './components/FAQ/FAQ';
import Updates from './components/Updates/Updates';
import FinalCTA from './components/FinalCTA/FinalCTA';
import Footer from './components/Footer/Footer';

// Phase F — scroll-revealing landing.
// Order: hook → trust → quick value → mechanics → deep value → context →
// proof → roadmap → conversion.
const WebsiteApp: React.FC = () => {
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Restrained reveal — a single gentle fade + small rise as each block enters,
    // then it settles and stays put. No scale, blur, parallax, or scroll-scrubbing.
    // (Set ENABLED to false to turn all scroll motion off.)
    const ENABLED = true;
    if (!ENABLED) return;

    const UNITS = '.hero__content, .stack__eyebrow, .stack__strip, .features__header, .features__pill, .hiw__header, .hiw-step, .deepdive__header, .deepdive__block, .usecases__header, .uc-pillar, .integrations__header, .int-group, .integrations__footnote, .faq__header, .faq__item, .updates__header, .updates__card, .finalcta__panel';
    const EASE = 'cubic-bezier(.22,.61,.36,1)';
    const els = Array.from(document.querySelectorAll<HTMLElement>(UNITS));
    const byParent = new Map<Element, HTMLElement[]>();
    els.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(14px)';
      el.style.transition = `opacity 0.6s ${EASE}, transform 0.6s ${EASE}`;
      const p = el.parentElement;
      if (!p) return;
      const a = byParent.get(p) || [];
      a.push(el);
      byParent.set(p, a);
    });
    byParent.forEach((arr) => arr.forEach((el, i) => { if (i) el.style.transitionDelay = `${Math.min(i * 0.05, 0.25)}s`; }));

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target as HTMLElement;
        el.style.opacity = '1';
        el.style.transform = 'none';
        io.unobserve(el);
        // Clear inline styles once settled so hover/transitions behave normally.
        window.setTimeout(() => {
          el.style.transition = '';
          el.style.transform = '';
          el.style.opacity = '';
          el.style.transitionDelay = '';
        }, 760);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -10% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="app">
      <Navbar />
      <main>
        <Hero />
        <Stack />
        <Features />
        <HowItWorks />
        <DeepDive />
        <Replace />
        <UseCases />
        <Integrations />
        <FAQ />
        <Updates />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
};

export default WebsiteApp;
