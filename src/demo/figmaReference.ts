const DEMO_ROWS = [
  { release: 'Checkout Flow', owner: 'Alex Rivera', init: 'AR', status: 'Ready', tone: 'ready', channel: 'Web', version: 'v4.2.0', target: 'May 14, 2026', color: '#4f46e5' },
  { release: 'Mobile Sync', owner: 'Maya Lin', init: 'ML', status: 'Ready', tone: 'ready', channel: 'iOS', version: 'v3.8.1', target: 'May 16, 2026', color: '#0891b2' },
  { release: 'Billing Portal', owner: 'Samira Patel', init: 'SP', status: 'Review', tone: 'review', channel: 'Web', version: 'v2.5.0', target: 'May 19, 2026', color: '#7c3aed' },
  { release: 'Search Index', owner: 'Noah Kim', init: 'NK', status: 'Ready', tone: 'ready', channel: 'API', version: 'v1.12.4', target: 'May 22, 2026', color: '#d97706' },
  { release: 'Design Tokens', owner: 'Clara Silva', init: 'CS', status: 'Ready', tone: 'ready', channel: 'Core', version: 'v5.0.0', target: 'May 25, 2026', color: '#059669' },
];

export const DEMO_FIGMA_FRAME = { width: 1280, height: 680 };

const rowsSvg = DEMO_ROWS.map((row, idx) => {
  const y = 248 + idx * 48;
  const chipBg = row.tone === 'review' ? '#FEF3C7' : '#DCFCE7';
  const chipText = row.tone === 'review' ? '#B45309' : '#15803D';
  const chipW = row.tone === 'review' ? 66 : 60;
  return `
    <line x1="110" y1="${y}" x2="1170" y2="${y}" stroke="#E2E8F0" stroke-width="1"/>
    <text x="126" y="${y + 29}" font-family="DM Sans, system-ui, sans-serif" font-size="14" font-weight="600" fill="#0F172A">${row.release}</text>
    <circle cx="380" cy="${y + 24}" r="14" fill="${row.color}"/>
    <text x="380" y="${y + 28}" text-anchor="middle" font-family="DM Sans, system-ui, sans-serif" font-size="11" font-weight="600" fill="#FFFFFF">${row.init}</text>
    <text x="404" y="${y + 29}" font-family="DM Sans, system-ui, sans-serif" font-size="14" fill="#111827">${row.owner}</text>
    <rect x="596" y="${y + 12}" width="${chipW}" height="24" rx="12" fill="${chipBg}"/>
    <text x="606" y="${y + 28}" font-family="DM Sans, system-ui, sans-serif" font-size="13" font-weight="600" fill="${chipText}">${row.status}</text>
    <text x="746" y="${y + 29}" font-family="DM Sans, system-ui, sans-serif" font-size="14" fill="#111827">${row.channel}</text>
    <rect x="886" y="${y + 13}" width="64" height="22" rx="6" fill="#F1F5F9"/>
    <text x="894" y="${y + 28}" font-family="JetBrains Mono, monospace" font-size="12" font-weight="500" fill="#475569">${row.version}</text>
    <text x="1006" y="${y + 29}" font-family="DM Sans, system-ui, sans-serif" font-size="14" fill="#111827">${row.target}</text>
  `;
}).join('');

const DEMO_FIGMA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="680" viewBox="0 0 1280 680">
  <rect width="1280" height="680" fill="#F4F6FB"/>
  <rect x="80.5" y="40.5" width="1119" height="539" rx="18" fill="#FFFFFF" stroke="#DDE3EE" stroke-width="1"/>
  <text x="109" y="92" font-family="Space Grotesk, system-ui, sans-serif" font-size="24" font-weight="700" fill="#111827">Upcoming Releases</text>
  <text x="109" y="119" font-family="DM Sans, system-ui, sans-serif" font-size="14" font-weight="400" fill="#5B6475">Track milestones, owners, and release readiness across product teams.</text>
  <rect x="1039" y="78" width="132" height="38" rx="10" fill="#4F46E5"/>
  <text x="1105" y="102" text-anchor="middle" font-family="DM Sans, system-ui, sans-serif" font-size="14" font-weight="600" fill="#FFFFFF">New Release</text>
  <rect x="109.5" y="149.5" width="359" height="37" rx="10" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>
  <circle cx="128" cy="168" r="5" fill="none" stroke="#64748B" stroke-width="1.8"/>
  <line x1="132" y1="172" x2="135" y2="175" stroke="#64748B" stroke-width="1.8" stroke-linecap="round"/>
  <text x="147" y="173" font-family="DM Sans, system-ui, sans-serif" font-size="14" fill="#64748B">Filter releases...</text>
  <rect x="109.5" y="203.5" width="1061" height="285" rx="12" fill="#FFFFFF" stroke="#DDE3EE" stroke-width="1"/>
  <rect x="110" y="204" width="1060" height="44" rx="11" fill="#EEF2FF"/>
  <rect x="110" y="236" width="1060" height="12" fill="#EEF2FF"/>
  <text x="126" y="231" font-family="DM Sans, system-ui, sans-serif" font-size="13" font-weight="600" fill="#334155">Release</text>
  <text x="366" y="231" font-family="DM Sans, system-ui, sans-serif" font-size="13" font-weight="600" fill="#334155">Owner</text>
  <text x="596" y="231" font-family="DM Sans, system-ui, sans-serif" font-size="13" font-weight="600" fill="#334155">Status</text>
  <text x="746" y="231" font-family="DM Sans, system-ui, sans-serif" font-size="13" font-weight="600" fill="#334155">Channel</text>
  <text x="886" y="231" font-family="DM Sans, system-ui, sans-serif" font-size="13" font-weight="600" fill="#334155">Version</text>
  <text x="1006" y="231" font-family="DM Sans, system-ui, sans-serif" font-size="13" font-weight="600" fill="#334155">Target Date</text>
  ${rowsSvg}
  <text x="1171" y="519" text-anchor="end" font-family="DM Sans, system-ui, sans-serif" font-size="13" font-weight="600" fill="#475569">Showing 1 - 5 of 5</text>
</svg>`;

export const DEMO_FIGMA_SVG_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DEMO_FIGMA_SVG)}`;
