import React from 'react';

const OrchestrateIcon: React.FC<{ size?: number; white?: boolean }> = ({ size = 24, white = false }) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id={`og-${size}`} x1="14" y1="12" x2="106" y2="110" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#4ADE80"/>
        <stop offset="0.5" stopColor="#1ED760"/>
        <stop offset="1" stopColor="#1DB954"/>
      </linearGradient>
    </defs>
    {/* Spokes */}
    <g stroke={white ? '#fff' : `url(#og-${size})`} strokeWidth="3" strokeLinecap="round">
      <line x1="60" y1="27" x2="60" y2="17"/>
      <line x1="88.58" y1="43.5" x2="97.24" y2="38.5"/>
      <line x1="88.58" y1="76.5" x2="97.24" y2="81.5"/>
      <line x1="60" y1="93" x2="60" y2="103"/>
      <line x1="31.42" y1="76.5" x2="22.76" y2="81.5"/>
      <line x1="31.42" y1="43.5" x2="22.76" y2="38.5"/>
    </g>
    {/* Outer nodes */}
    <circle cx="60" cy="13" r="4.8" fill={white ? '#fff' : `url(#og-${size})`}/>
    <circle cx="100.7" cy="36.5" r="4.8" fill={white ? '#fff' : `url(#og-${size})`}/>
    <circle cx="100.7" cy="83.5" r="4.8" fill={white ? '#fff' : `url(#og-${size})`}/>
    <circle cx="60" cy="107" r="4.8" fill={white ? '#fff' : `url(#og-${size})`}/>
    <circle cx="19.3" cy="83.5" r="4.8" fill={white ? '#fff' : `url(#og-${size})`}/>
    <circle cx="19.3" cy="36.5" r="4.8" fill={white ? '#fff' : `url(#og-${size})`}/>
    {/* Node highlights */}
    {!white && <>
      <circle cx="60" cy="13" r="1.7" fill="#fff" opacity="0.5"/>
      <circle cx="100.7" cy="36.5" r="1.7" fill="#fff" opacity="0.5"/>
      <circle cx="100.7" cy="83.5" r="1.7" fill="#fff" opacity="0.5"/>
      <circle cx="60" cy="107" r="1.7" fill="#fff" opacity="0.5"/>
      <circle cx="19.3" cy="83.5" r="1.7" fill="#fff" opacity="0.5"/>
      <circle cx="19.3" cy="36.5" r="1.7" fill="#fff" opacity="0.5"/>
    </>}
    {/* Gear ring */}
    <g fill={white ? '#fff' : `url(#og-${size})`}>
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
    <circle cx="60" cy="60" r="21" fill="none" stroke={white ? '#fff' : `url(#og-${size})`} strokeWidth="12"/>
    <path d="M60 46.5l11.69 6.75v13.5L60 73.5l-11.69-6.75v-13.5z" fill={white ? '#fff' : `url(#og-${size})`}/>
    {/* Inner lines */}
    {!white && (
      <g stroke="#fff" strokeWidth="0.8" opacity="0.32">
        <line x1="60" y1="60" x2="60" y2="46.5"/>
        <line x1="60" y1="60" x2="71.69" y2="53.25"/>
        <line x1="60" y1="60" x2="71.69" y2="66.75"/>
        <line x1="60" y1="60" x2="60" y2="73.5"/>
        <line x1="60" y1="60" x2="48.31" y2="66.75"/>
        <line x1="60" y1="60" x2="48.31" y2="53.25"/>
      </g>
    )}
    {!white && <path d="M60 53.5l5.63 3.25v6.5L60 66.5l-5.63-3.25v-6.5z" fill="none" stroke="#fff" strokeWidth="0.8" opacity="0.3"/>}
    {!white && <circle cx="60" cy="60" r="2" fill="#fff" opacity="0.55"/>}
  </svg>
);

export default OrchestrateIcon;
