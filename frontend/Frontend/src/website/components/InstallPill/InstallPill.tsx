import { useState } from 'react';
import './InstallPill.css';

// ─────────────────────────────────────────────────────────────────
// InstallPill — the marketing install command. Mirrors the Claude
// Code "Built for hackers" style: rounded pill with a button-like
// affordance on the left and the copy-able command on the right.
//
// The chevron next to the label is purely decorative for now —
// Phase F may add platform variants (pip / docker / homebrew) but
// the single-user pivot ships with just pip.
// ─────────────────────────────────────────────────────────────────

const INSTALL_COMMAND = 'pip install orchestraty';

interface InstallPillProps {
  /** Show the "Or see how it works ↓" link below the pill. */
  withFootnote?: boolean;
  /** Visual size — defaults to the larger Hero variant. */
  size?: 'lg' | 'md';
}

export default function InstallPill({ withFootnote = true, size = 'lg' }: InstallPillProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable on non-HTTPS hosts — fail quietly.
    }
  };

  return (
    <div className={`installpill installpill--${size}`}>
      <div className="installpill__shell">
        <button type="button" className="installpill__cta" aria-label="Install Orchestraty">
          <span>Install Orchestraty</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <div className="installpill__divider" aria-hidden="true" />
        <code className="installpill__cmd">{INSTALL_COMMAND}</code>
        <button
          type="button"
          className={`installpill__copy${copied ? ' installpill__copy--ok' : ''}`}
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy install command'}
        >
          {copied ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
      {withFootnote && (
        <a href="#how-it-works" className="installpill__footnote">
          Or see how it works
        </a>
      )}
    </div>
  );
}
