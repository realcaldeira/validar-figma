import { useState, type CSSProperties } from 'react';
import { IconArrowRight, IconCheck, IconFigmaColor, IconXCircle } from '../components/Icons.tsx';
import { Reveal } from '../components/Reveal.tsx';
import { RollingNumber } from '../components/RollingNumber.tsx';
import { useI18n } from '../i18n/useI18n.ts';
import { Link } from '../router.tsx';
import { capabilitiesContent } from './capabilities.ts';
import './capabilities.css';

function List({ items, tone }: { items: string[]; tone: 'yes' | 'no' }) {
  return (
    <ul className={`cap-list ${tone}`}>
      {items.map((item) => (
        <li key={item}>
          <span className="cap-mark" aria-hidden="true">
            {tone === 'yes' ? <IconCheck size={13} /> : <IconXCircle size={13} />}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const MODE_TONES: Record<string, 'blue' | 'green' | 'coral' | 'purple'> = {
  quick: 'blue',
  offline: 'green',
  api: 'coral',
  mcp: 'purple',
};

export default function CapabilitiesPage() {
  const { locale, t } = useI18n();
  const c = capabilitiesContent[locale];
  const [focusTone, setFocusTone] = useState<'all' | 'yes' | 'no'>('all');

  const doesCount = c.modes.reduce((n, m) => n + m.does.length, 0);
  const doesNotCount = c.modes.reduce((n, m) => n + m.doesNot.length, 0);
  const totalItems = doesCount + doesNotCount;

  const groupClass = (group: 'yes' | 'no') => {
    if (focusTone === 'all') return '';
    return focusTone === group ? ' is-focused' : ' is-dimmed';
  };

  return (
    <div className="cap-page">
      <header className="cap-hero">
        <div className="cap-hero-top">
          <div>
            <div className="cap-eyebrow">
              <IconFigmaColor size={14} />
              <span>{t.nav.capabilities}</span>
            </div>
            <h1>{c.title}</h1>
            <p className="lead">{c.lead}</p>
          </div>
          <Link to="/" className="btn">
            <span>{t.nav.validate}</span>
            <IconArrowRight size={15} className="icon-nudge-right" />
          </Link>
        </div>

        <div className="cap-filter-bar" role="group" aria-label={c.title}>
          {(
            [
              ['all', t.reportDetail.categories.all, totalItems],
              ['yes', c.doesLabel, doesCount],
              ['no', c.doesNotLabel, doesNotCount],
            ] as const
          ).map(([val, label, count]) => (
            <button
              key={val}
              type="button"
              className={`cap-filter-btn tone-${val}${focusTone === val ? ' active' : ''}`}
              onClick={() => setFocusTone(val)}
            >
              <span>{label}</span>
              <span className="cap-filter-count">
                <RollingNumber value={count} />
              </span>
            </button>
          ))}
        </div>
      </header>

      <div className="cap-grid">
        {c.modes.map((mode, idx) => {
          const tone = MODE_TONES[mode.id] ?? 'blue';
          return (
            <section
              key={mode.id}
              className={`cap-card tone-${tone} stagger-item${mode.recommended ? ' recommended' : ''}`}
              style={{ '--stagger': idx } as CSSProperties}
              aria-labelledby={`cap-${mode.id}`}
            >
              {mode.recommended && (
                <>
                  <span className="cap-corner tl" aria-hidden="true" />
                  <span className="cap-corner tr" aria-hidden="true" />
                  <span className="cap-corner bl" aria-hidden="true" />
                  <span className="cap-corner br" aria-hidden="true" />
                </>
              )}
              <div className="cap-card-head">
                <div className="cap-card-title-wrap">
                  <span className="cap-card-index">0{idx + 1}</span>
                  <h2 id={`cap-${mode.id}`}>{mode.title}</h2>
                </div>
                <div className="cap-badges">
                  {mode.recommended && <span className="badge accent">{c.recommended}</span>}
                  <span className="badge">{mode.badge}</span>
                </div>
              </div>
              <p className="cap-needs">
                <strong>{c.needsLabel}:</strong> {mode.needs}
              </p>
              <div className={`cap-group${groupClass('yes')}`}>
                <h3 className="cap-sub yes">{c.doesLabel}</h3>
                <List items={mode.does} tone="yes" />
              </div>
              <div className={`cap-group${groupClass('no')}`}>
                <h3 className="cap-sub no">{c.doesNotLabel}</h3>
                <List items={mode.doesNot} tone="no" />
              </div>
            </section>
          );
        })}
      </div>

      <Reveal delay={60}>
        <section className="cap-all" aria-labelledby="cap-all">
          <div className="cap-all-head">
            <h2 id="cap-all">{c.allTitle}</h2>
            <p>{c.allLead}</p>
          </div>
          <div className="cap-all-cols">
            <div className={`cap-all-panel yes${groupClass('yes')}`}>
              <h3 className="cap-sub yes">{c.doesLabel}</h3>
              <List items={c.allDoes} tone="yes" />
            </div>
            <div className={`cap-all-panel no${groupClass('no')}`}>
              <h3 className="cap-sub no">{c.doesNotLabel}</h3>
              <List items={c.allDoesNot} tone="no" />
            </div>
          </div>
        </section>
      </Reveal>

      <Reveal delay={100}>
        <section className="cap-read" aria-labelledby="cap-read">
          <h2 id="cap-read">{c.readTitle}</h2>
          <div className="cap-read-row">
            {c.read.map((r) => (
              <div key={r.label} className={`cap-read-item ${r.tone}`}>
                <span className={`badge ${r.tone === 'pass' ? 'ok' : r.tone}`}>{r.label}</span>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal delay={140}>
        <section className="cap-all cap-acc" aria-labelledby="cap-acc">
          <div className="cap-all-head">
            <h2 id="cap-acc">{c.accuracyTitle}</h2>
            <p>{c.accuracyLead}</p>
          </div>
          <div className="cap-acc-scroll">
            <table className="cap-acc-table">
              <thead>
                <tr>
                  {c.accuracyHead.map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.accuracy.map((row) => (
                  <tr key={row.analysis}>
                    <td className="cap-acc-name">{row.analysis}</td>
                    <td>
                      <span className={`badge ${row.tone === 'pass' ? 'ok' : row.tone}`}>{row.result}</span>
                    </td>
                    <td className="cap-acc-src">{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cap-acc-note">{c.accuracyNote}</p>
        </section>
      </Reveal>
    </div>
  );
}
