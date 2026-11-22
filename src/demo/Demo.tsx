import { useMemo } from 'react';
import './demo.css';

const rows = [
  { release: 'Checkout Flow', owner: 'Alex Rivera', status: 'Ready', tone: 'ready', channel: 'Web', version: 'v4.2.0', target: 'May 14, 2026', color: '#4f46e5' },
  { release: 'Mobile Sync', owner: 'Maya Lin', status: 'Ready', tone: 'ready', channel: 'iOS', version: 'v3.8.1', target: 'May 16, 2026', color: '#0891b2' },
  { release: 'Billing Portal', owner: 'Samira Patel', status: 'Review', tone: 'review', channel: 'Web', version: 'v2.5.0', target: 'May 19, 2026', color: '#7c3aed' },
  { release: 'Search Index', owner: 'Noah Kim', status: 'Ready', tone: 'ready', channel: 'API', version: 'v1.12.4', target: 'May 22, 2026', color: '#d97706' },
  { release: 'Design Tokens', owner: 'Clara Silva', status: 'Ready', tone: 'ready', channel: 'Core', version: 'v5.0.0', target: 'May 25, 2026', color: '#059669' },
] as const;

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('');

export default function Demo() {
  const isMismatch = useMemo(() => new URLSearchParams(window.location.search).get('mismatch') === '1', []);
  // Controle positivo do "elemento a mais": ?extra=1 põe botões que não existem no Figma.
  const hasExtra = useMemo(() => new URLSearchParams(window.location.search).get('extra') === '1', []);

  return (
    <div className={`demo-page${isMismatch ? ' demo-mismatch' : ''}`}>
      <section className="demo-card" aria-labelledby="demo-title">
        <header className="demo-header">
          <div className="demo-heading">
            <h2 className="demo-title" id="demo-title">
              Upcoming Releases
            </h2>
            <p className="demo-subtitle" id="demo-subtitle">
              Track milestones, owners, and release readiness across product teams.
            </p>
          </div>
          <button type="button" className="demo-cta" id="demo-cta">
            New Release
          </button>
        </header>
        <div className="demo-body">
          {hasExtra ? (
            <div className="demo-toolbar">
              <input className="demo-search" placeholder="Filter releases..." aria-label="Filter releases" />
              <button type="button" className="demo-extra-btn">
                Export JSON
              </button>
              <button type="button" className="demo-extra-btn" role="combobox" aria-expanded="false">
                Only delayed
              </button>
            </div>
          ) : (
            <input className="demo-search" placeholder="Filter releases..." aria-label="Filter releases" />
          )}
          <div className="demo-table-frame" data-testid="demo-table">
            <table className="demo-table">
              <colgroup>
                <col style={{ width: '240px' }} />
                <col style={{ width: '230px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '120px' }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Release</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Channel</th>
                  <th>Version</th>
                  <th>Target Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.release}>
                    <td>
                      <span className="demo-release-name">{row.release}</span>
                    </td>
                    <td>
                      <span className="demo-owner">
                        <span className="demo-avatar" style={{ background: row.color }} aria-hidden>
                          {initials(row.owner)}
                        </span>
                        {row.owner}
                      </span>
                    </td>
                    <td>
                      <span className={`demo-chip${row.tone === 'review' ? ' is-review' : ''}`}>{row.status}</span>
                    </td>
                    <td>{row.channel}</td>
                    <td>
                      <span className="demo-ver">{row.version}</span>
                    </td>
                    <td>{row.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="demo-pagination" aria-label="Pagination">
            <span>Showing 1 - 5 of 5</span>
          </nav>
        </div>
      </section>
    </div>
  );
}
