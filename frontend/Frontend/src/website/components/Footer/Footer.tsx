import React from 'react';
import './Footer.css';
import OrchestrateIcon from '../../../shared/Logo/AntigravityLogo';
import { DOCS_URL, API_REFERENCE_URL, GITHUB_URL, CHANGELOG_URL } from '../../site-links';

const footerLinks = [
  { heading: 'Platform', links: [
    {label: 'Data Pipelines', href: '/#data-pipelines'},
    {label: 'AI Labeling', href: '/#ai-labeling'},
    {label: 'Image Intelligence', href: '/#image-intelligence'},
    {label: 'Workflows', href: '/#how-it-works'},
    {label: 'LLM Config', href: '/#integrations'},
  ]},
  { heading: 'Resources', links: [
    {label: 'Documentation', href: DOCS_URL},
    {label: 'API Reference', href: API_REFERENCE_URL},
    {label: 'GitHub', href: GITHUB_URL},
    {label: 'Changelog', href: CHANGELOG_URL},
  ]},
  { heading: 'Project', links: [
    {label: 'GitHub', href: GITHUB_URL},
    {label: 'Roadmap', href: '/docs/roadmap'},
    {label: 'Contributing', href: '/docs/contributing'},
    {label: 'MIT License', href: GITHUB_URL + '/blob/main/LICENSE'},
  ]},
];

const Footer: React.FC = () => {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__top">
          <div className="footer__brand">
            <a href="/" className="footer__logo">
              <OrchestrateIcon size={28} />
              <span className="footer__logo-name">Orchestraty</span>
            </a>
            <p className="footer__tagline">Open-source, local-first data operating system.</p>
            <div className="footer__social">
              {[{label: 'GH', href: GITHUB_URL}, {label: 'X', href: '#'}, {label: 'in', href: '#'}].map((s, i) => {
                const ext = s.href.startsWith('http');
                return <a key={i} href={s.href} target={ext ? '_blank' : undefined} rel={ext ? 'noopener noreferrer' : undefined} className="footer__social-link" aria-label={s.label}><span>{s.label}</span></a>;
              })}
            </div>
          </div>
          <div className="footer__links">
            {footerLinks.map((group) => (
              <div key={group.heading} className="footer__link-group">
                <h4 className="footer__link-heading">{group.heading}</h4>
                <ul className="footer__link-list">
                  {group.links.map((link) => (
                    <li key={link.label}><a href={link.href} target={link.href.startsWith('http') ? '_blank' : undefined} rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined} className="footer__link">{link.label}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="footer__bottom">
          <p className="footer__copy">© {new Date().getFullYear()} Orchestraty · Built in the open.</p>
          <div className="footer__bottom-links">
            <a href={GITHUB_URL + '/blob/main/LICENSE'} target="_blank" rel="noopener noreferrer" className="footer__bottom-link">MIT License</a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="footer__bottom-link">Source</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
