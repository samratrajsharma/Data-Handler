import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Navbar.css';
import OrchestrateIcon from '../../../shared/Logo/AntigravityLogo';
import { DOCS_URL, GITHUB_URL } from '../../site-links';

interface DropdownItem { label: string; description?: string; href: string; }
interface NavItem { label: string; href?: string; dropdown?: DropdownItem[]; }

const navItems: NavItem[] = [
  {
    label: 'Platform',
    dropdown: [
      { label: 'Data Pipelines', description: 'Ingest, clean, structure and profile datasets', href: '/platform#data-pipelines' },
      { label: 'AI Labeling', description: 'LLM-powered predictions, propagation & aggregation', href: '/platform#ai-labeling' },
      { label: 'Image Intelligence', description: 'CLIP embeddings, clustering & semantic search', href: '/platform#image-intelligence' },
      { label: 'Workflow Engine', description: 'Multi-step orchestration pipelines', href: '/platform#workflow-engine' },
    ],
  },
  { label: 'Open source', href: '/pricing' },
  {
    label: 'Resources',
    dropdown: [
      { label: 'Documentation', description: 'API reference & integration guides', href: DOCS_URL },
      { label: 'GitHub', description: 'Open source repository', href: GITHUB_URL },
    ],
  },
];

/** Render a dropdown/nav target as a router Link for internal routes, or a
 *  plain anchor for hash links and external URLs. */
function NavTarget({ to, className, children, onClick }: {
  to: string; className?: string; children: React.ReactNode; onClick?: () => void;
}) {
  if (to.includes('#')) {
    const path = to.slice(0, to.indexOf('#'));
    if (path.length > 1 && path.startsWith('/')) {
      return <Link to={to} className={className} onClick={onClick}>{children}</Link>;
    }
    return <a href={to} className={className} onClick={onClick}>{children}</a>;
  }
  if (to.startsWith('/')) {
    return <Link to={to} className={className} onClick={onClick}>{children}</Link>;
  }
  const ext = to.startsWith('http');
  return <a href={to} className={className} onClick={onClick} target={ext ? '_blank' : undefined} rel={ext ? 'noopener noreferrer' : undefined}>{children}</a>;
}

const Navbar: React.FC = () => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [kycHover, setKycHover] = useState(false);
  const { pathname } = useLocation();
  const onKyc = pathname === '/knowyourcode';
  // Hover-intent: small delay before closing so the cursor can travel into
  // the dropdown without it vanishing.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', h);
    return () => window.removeEventListener('scroll', h);
  }, []);

  const openDropdown = (label: string) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setActiveDropdown(label);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setActiveDropdown(null), 140);
  };

  return (
    <nav className={`navbar ${scrolled ? 'navbar--scrolled' : ''}`}>
      <div className="navbar__inner">
        <Link to="/" className="navbar__logo">
          <OrchestrateIcon size={28} />
          <span className="navbar__logo-text">Orchestraty</span>
        </Link>

        <ul className="navbar__links">
          {navItems.map((item) => (
            <li key={item.label} className="navbar__item"
              onMouseEnter={() => item.dropdown && openDropdown(item.label)}
              onMouseLeave={() => item.dropdown && scheduleClose()}>
              {item.dropdown ? (
                <button type="button" className="navbar__link navbar__link--button"
                  onClick={() => setActiveDropdown(activeDropdown === item.label ? null : item.label)}>
                  {item.label}
                  <svg className={`navbar__chevron ${activeDropdown === item.label ? 'navbar__chevron--open' : ''}`} width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ) : (
                <a href={item.href || '#'} className="navbar__link">{item.label}</a>
              )}
              {item.dropdown && activeDropdown === item.label && (
                <div className="navbar__dropdown">
                  {item.dropdown.map((d) => (
                    <NavTarget key={d.label} to={d.href} className="navbar__dropdown-item"
                      onClick={() => setActiveDropdown(null)}>
                      <span className="navbar__dropdown-label">{d.label}</span>
                      {d.description && <span className="navbar__dropdown-desc">{d.description}</span>}
                    </NavTarget>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="navbar__cta">
          <Link to={DOCS_URL} className="navbar__cta-link">Docs</Link>

          {/* Context CTA — Launch KYC elsewhere, Return to Orchestraty on the KYC page. */}
          {onKyc ? (
            <Link to="/" className="navbar__kyc-btn navbar__kyc-btn--return">
              <span className="navbar__kyc-spark" aria-hidden="true">←</span>
              Return to Orchestraty
            </Link>
          ) : (
            <div
              className="navbar__kyc"
              onMouseEnter={() => setKycHover(true)}
              onMouseLeave={() => setKycHover(false)}
            >
              <Link to="/knowyourcode" className="navbar__kyc-btn">
                <span className="navbar__kyc-spark" aria-hidden="true">◆</span>
                Launch Know Your Code
              </Link>
              {kycHover && (
                <div className="navbar__kyc-pop" role="tooltip">
                  <span className="navbar__kyc-pop-eyebrow">Know Your Code · new</span>
                  <p className="navbar__kyc-pop-desc">
                    Point it at any repository and it maps the architecture, tracks every
                    change over time, and answers questions about your code — powered by your
                    own LLM, fully local.
                  </p>
                  <span className="navbar__kyc-pop-cta">Open it and try the whole thing →</span>
                </div>
              )}
            </div>
          )}

          <a href="#get-started" className="navbar__download-btn">
            Install
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1.5v8M3.5 6L7 9.5 10.5 6M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>

        <button className="navbar__hamburger" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Menu">
          <span className="navbar__hamburger-line"></span>
          <span className="navbar__hamburger-line"></span>
          <span className="navbar__hamburger-line"></span>
        </button>
      </div>

      {mobileOpen && (
        <div className="navbar__mobile">
          {navItems.map((item) => (
            <div key={item.label}>
              {item.href ? (
                <a href={item.href} className="navbar__mobile-link" onClick={() => setMobileOpen(false)}>{item.label}</a>
              ) : (
                <span className="navbar__mobile-link">{item.label}</span>
              )}
              {item.dropdown?.map((d) => (
                <NavTarget key={d.label} to={d.href} className="navbar__mobile-sublink"
                  onClick={() => setMobileOpen(false)}>{d.label}</NavTarget>
              ))}
            </div>
          ))}
          {onKyc ? (
            <Link to="/" className="navbar__mobile-link" onClick={() => setMobileOpen(false)}>← Return to Orchestraty</Link>
          ) : (
            <Link to="/knowyourcode" className="navbar__mobile-link" onClick={() => setMobileOpen(false)}>Launch Know Your Code</Link>
          )}
          <Link to={DOCS_URL} className="navbar__mobile-link" onClick={() => setMobileOpen(false)}>Docs</Link>
          <a href="#get-started" className="navbar__download-btn navbar__mobile-download" onClick={() => setMobileOpen(false)}>Install</a>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
