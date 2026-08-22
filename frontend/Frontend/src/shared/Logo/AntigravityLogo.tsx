import React from 'react';

/**
 * Monochrome brand mark. Renders in `currentColor`, so it automatically
 * matches the active theme (black on light, white on dark) wherever it is
 * placed. The `white` prop is kept for backwards-compatibility.
 */
const OrchestrateIcon: React.FC<{ size?: number; white?: boolean }> = ({ size = 24, white = false }) => {
  const c = white ? '#fff' : 'currentColor';
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Spokes */}
      <g stroke={c} strokeWidth="3" strokeLinecap="round">
        <line x1="60" y1="27" x2="60" y2="17"/>
        <line x1="88.58" y1="43.5" x2="97.24" y2="38.5"/>
        <line x1="88.58" y1="76.5" x2="97.24" y2="81.5"/>
        <line x1="60" y1="93" x2="60" y2="103"/>
        <line x1="31.42" y1="76.5" x2="22.76" y2="81.5"/>
        <line x1="31.42" y1="43.5" x2="22.76" y2="38.5"/>
      </g>
      {/* Outer nodes */}
      <g fill={c}>
        <circle cx="60" cy="13" r="4.8"/>
        <circle cx="100.7" cy="36.5" r="4.8"/>
        <circle cx="100.7" cy="83.5" r="4.8"/>
        <circle cx="60" cy="107" r="4.8"/>
        <circle cx="19.3" cy="83.5" r="4.8"/>
        <circle cx="19.3" cy="36.5" r="4.8"/>
      </g>
      {/* Gear ring */}
      <g fill={c}>
        <path d="M58.4 27h3.2a2.4 2.4 0 012.4 2.4v4.2a2.4 2.4 0 01-2.4 2.4h-3.2a2.4 2.4 0 01-2.4-2.4v-4.2a2.4 2.4 0 012.4-2.4z"/>
        <path d="M75.11 30.62l2.78 1.6a2.4 2.4 0 01.87 3.28l-2.1 3.64a2.4 2.4 0 01-3.27.88l-2.78-1.6a2.4 2.4 0 01-.87-3.28l2.1-3.64a2.4 2.4 0 013.27-.88z"/>
        <path d="M87.78 42.11l1.6 2.78a2.4 2.4 0 01-.88 3.27l-3.64 2.1a2.4 2.4 0 01-3.28-.87l-1.6-2.78a2.4 2.4 0 01.88-3.27l3.64-2.1a2.4 2.4 0 013.28.87z"/>
        <path d="M93 58.4v3.2a2.4 2.4 0 01-2.4 2.4h-4.2a2.4 2.4 0 01-2.4-2.4v-3.2a2.4 2.4 0 012.4-2.4h4.2a2.4 2.4 0 012.4 2.4z"/>
        <path d="M89.38 75.11l-1.6 2.78a2.4 2.4 0 01-3.28.87l-3.64-2.1a2.4 2.4 0 01-.88-3.27l1.6-2.78a2.4 2.4 0 013.28-.87l3.64 2.1a2.4 2.4 0 01.88 3.27z"/>
        <path d="M77.89 87.78l-2.78 1.6a2.4 2.4 0 01-3.27-.88l-2.1-3.64a2.4 2.4 0 01.87-3.28l2.78-1.6a2.4 2.4 0 013.27.88l2.1 3.64a2.4 2.4 0 01-.87 3.28z"/>
        <path d="M61.6 93h-3.2a2.4 2.4 0 01-2.4-2.4v-4.2a2.4 2.4 0 012.4-2.4h3.2a2.4 2.4 0 012.4 2.4v4.2a2.4 2.4 0 01-2.4 2.4z"/>
        <path d="M44.89 89.38l-2.78-1.6a2.4 2.4 0 01-.87-3.28l2.1-3.64a2.4 2.4 0 013.27-.88l2.78 1.6a2.4 2.4 0 01.87 3.28l-2.1 3.64a2.4 2.4 0 01-3.27.88z"/>
        <path d="M32.22 77.89l-1.6-2.78a2.4 2.4 0 01.88-3.27l3.64-2.1a2.4 2.4 0 013.28.87l1.6 2.78a2.4 2.4 0 01-.88 3.27l-3.64 2.1a2.4 2.4 0 01-3.28-.87z"/>
        <path d="M27 61.6v-3.2a2.4 2.4 0 012.4-2.4h4.2a2.4 2.4 0 012.4 2.4v3.2a2.4 2.4 0 01-2.4 2.4h-4.2a2.4 2.4 0 01-2.4-2.4z"/>
        <path d="M30.62 44.89l1.6-2.78a2.4 2.4 0 013.28-.87l3.64 2.1a2.4 2.4 0 01.88 3.27l-1.6 2.78a2.4 2.4 0 01-3.28.87l-3.64-2.1a2.4 2.4 0 01-.88-3.27z"/>
        <path d="M42.11 32.22l2.78-1.6a2.4 2.4 0 013.27.88l2.1 3.64a2.4 2.4 0 01-.87 3.28l-2.78 1.6a2.4 2.4 0 01-3.27-.88l-2.1-3.64a2.4 2.4 0 01.87-3.28z"/>
      </g>
      {/* Core ring + hexagon */}
      <circle cx="60" cy="60" r="21" fill="none" stroke={c} strokeWidth="12"/>
      <path d="M60 46.5l11.69 6.75v13.5L60 73.5l-11.69-6.75v-13.5z" fill={c}/>
    </svg>
  );
};

export default OrchestrateIcon;
