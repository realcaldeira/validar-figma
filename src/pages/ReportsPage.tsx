import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  IconArrowRight,
  IconFileBarChart,
  IconPlus,
  IconSearch,
  IconTrash,
} from '../components/Icons.tsx';
import { headlineScore } from '../engine/compare.ts';
import { CountUp } from '../components/CountUp.tsx';
import { RollingNumber } from '../components/RollingNumber.tsx';
import type { ReportSummary } from '../engine/types.ts';
import { localizeMessage } from '../i18n/messages.ts';
import { useI18n } from '../i18n/useI18n.ts';
import { Link } from '../router.tsx';
import { apiRequest } from '../utils/api.ts';
import { formatShortUrl } from '../utils/propertyLabels.ts';
import './report.css';

interface ReportListItem {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  figmaImage: string | null;
  screenImage: string | null;
  precision?: number | null;
  summary: ReportSummary | null;
  project?: string | null;
}

const PROJECT_KEY = 'figma-validator-reports-project';
const NO_PROJECT = '__none__';
const ALL_PROJECTS = '__all__';

function readProjectFilter(): string {
  try {
    return localStorage.getItem(PROJECT_KEY) || ALL_PROJECTS;
  } catch {
    return ALL_PROJECTS;
  }
}

type StatusFilter = 'all' | 'diffs' | 'match';

export default function ReportsPage() {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<ReportListItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [projectFilter, setProjectFilterState] = useState<string>(readProjectFilter);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const setProjectFilter = (value: string) => {
    setProjectFilterState(value);
    try {
      localStorage.setItem(PROJECT_KEY, value);
    } catch {
      /* sem storage: o filtro só não fica lembrado */
    }
  };

  // Projetos existentes, com quantos relatórios cada um tem.
  const projects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items ?? []) {
      const key = item.project || NO_PROJECT;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => (a === NO_PROJECT ? 1 : b === NO_PROJECT ? -1 : a.localeCompare(b)));
  }, [items]);

  // Só os relatórios do projeto escolhido entram nos números e na lista: cada projeto com seus próprios erros.
  const inProject = useMemo(() => {
    if (!items) return null;
    if (projectFilter === ALL_PROJECTS || !projects.some(([p]) => p === projectFilter)) return items;
    return items.filter((item) => (item.project || NO_PROJECT) === projectFilter);
  }, [items, projectFilter, projects]);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<ReportListItem[]>('/api/reports');
      setItems(data);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const data = await apiRequest<ReportListItem[]>('/api/reports');
        if (active) setItems(data);
      } catch {
        if (active) setItems([]);
      }
    };
    void run();
    const timer = window.setInterval(() => {
      if (!document.hidden) void run();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm(t.reports.confirmDelete)) return;
    setDeleteError(null);
    try {
      await apiRequest(`/api/reports/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setDeleteError((err as Error).message);
    }
  };

  const kpis = useMemo(() => {
    if (!inProject || !inProject.length) return null;
    let perfect = 0;
    const scores: number[] = [];
    for (const item of inProject) {
      const fail = item.summary?.fail ?? 0;
      const warn = item.summary?.warn ?? 0;
      if (item.summary && item.summary.checks > 0 && fail === 0 && warn === 0) perfect += 1;
      const score = item.summary ? headlineScore(item.summary) : null;
      if (typeof score === 'number') scores.push(score);
    }
    const average = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
    return { total: inProject.length, perfect, average };
  }, [inProject]);

  const filtered = useMemo(() => {
    if (!inProject) return null;
    const needle = query.trim().toLowerCase();
    return inProject.filter((item) => {
      const fail = item.summary?.fail ?? 0;
      const warn = item.summary?.warn ?? 0;
      if (statusFilter === 'diffs' && fail === 0 && warn === 0) return false;
      if (statusFilter === 'match' && (!item.summary || item.summary.checks === 0 || fail > 0 || warn > 0)) return false;
      if (!needle) return true;
      return item.name.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle);
    });
  }, [inProject, query, statusFilter]);

  const dateLocale = locale === 'pt' ? 'pt-BR' : 'en-US';
  const totalCount = items?.length ?? 0;
  const newButtonLabel = t.reports.newComparisonBtn.replace(/^\+\s*/, '');

  return (
    <>
      <div className="reports-header">
        <div>
          <div className="reports-title-row">
            <h1>{t.reports.title}</h1>
            {items !== null && (
              <span className="badge accent">
                <RollingNumber value={totalCount} /> {totalCount === 1 ? t.reports.countSingular : t.reports.countPlural}
              </span>
            )}
          </div>
          <p className="lead" style={{ marginBottom: 0 }}>
            {t.reports.subtitle}
          </p>
        </div>
        <Link to="/" className="btn">
          <IconPlus size={15} />
          <span>{newButtonLabel}</span>
        </Link>
      </div>

      {deleteError && (
        <div className="banner error" role="alert">
          <span>{localizeMessage(deleteError, locale)}</span>
          <button type="button" className="btn secondary small" onClick={() => setDeleteError(null)}>
            ✕
          </button>
        </div>
      )}

      {projects.length > 1 && (
        <div className="reports-projects" role="group" aria-label={t.reports.projectFilterLabel}>
          <span className="reports-projects-label">{t.reports.projectFilterLabel}</span>
          <div className="rd-segments">
            <button
              type="button"
              className={projectFilter === ALL_PROJECTS || !projects.some(([p]) => p === projectFilter) ? 'active' : ''}
              onClick={() => setProjectFilter(ALL_PROJECTS)}
            >
              {t.reports.projectAll} (<RollingNumber value={items?.length ?? 0} rollOnMount={false} fast />)
            </button>
            {projects.map(([p, count]) => (
              <button key={p} type="button" className={projectFilter === p ? 'active' : ''} onClick={() => setProjectFilter(p)}>
                {p === NO_PROJECT ? t.reports.projectNone : p} (<RollingNumber value={count} rollOnMount={false} fast />)
              </button>
            ))}
          </div>
        </div>
      )}

      {kpis && (
        <div className="kpi-strip">
          <div className="kpi-card">
            <span className="kpi-label">{t.reports.kpiTotal}</span>
            <span className="kpi-value">
              <RollingNumber value={kpis.total} />
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">{t.reports.kpiPerfect}</span>
            <span className="kpi-value good">
              <RollingNumber value={kpis.perfect} />
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">{t.reports.kpiAverage}</span>
            <span className="kpi-value">
              {kpis.average !== null ? (
                <RollingNumber value={kpis.average} decimals={Number.isInteger(kpis.average) ? 0 : 1} suffix="%" />
              ) : (
                '—'
              )}
            </span>
            {kpis.average !== null && (
              <div className={`score-meter ${kpis.average >= 95 ? 'pass' : kpis.average >= 75 ? 'warn' : 'fail'}`}>
                <div style={{ width: `${Math.max(2, Math.min(100, kpis.average))}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="reports-toolbar">
          <div className="rd-segments" role="group">
            {(
              [
                ['all', t.reports.filterAll],
                ['diffs', t.reports.filterDiffs],
                ['match', t.reports.filterMatch],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={statusFilter === val ? 'active' : ''}
                onClick={() => setStatusFilter(val)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="rd-search-wrap">
            <span className="rd-search-icon">
              <IconSearch size={15} />
            </span>
            <input
              className="rd-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.reports.searchPlaceholder}
            />
            {query && (
              <button type="button" className="rd-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {filtered === null ? (
        <p className="notice">{t.reports.loading}</p>
      ) : items?.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <IconFileBarChart size={24} />
          </div>
          <h2>{t.reports.emptyTitle}</h2>
          <p>{t.reports.empty}</p>
          <Link to="/" className="btn">
            <span>{t.reports.emptyCta}</span>
            <IconArrowRight size={15} className="icon-nudge-right" />
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="notice" style={{ margin: 0 }}>
            {t.reports.noMatches}
          </p>
        </div>
      ) : (
        <div className="reports-grid">
          {filtered.map((item, idx) => {
            const fail = item.summary?.fail ?? 0;
            const warn = item.summary?.warn ?? 0;
            const score = item.summary ? headlineScore(item.summary) : null;
            const statusClass = fail ? 'fail' : warn ? 'warn' : 'ok';
            const scoreTone =
              score === null
                ? fail
                  ? 'fail'
                  : warn
                    ? 'warn'
                    : 'pass'
                : score === 100
                  ? 'pass'
                  : score >= 75
                    ? 'warn'
                    : 'fail';

            return (
              <div
                key={item.id}
                className="report-card stagger-item"
                style={{ '--stagger': Math.min(idx, 8) } as CSSProperties}
              >
                <div>
                  <Link to={`/reports/${item.id}`} className="report-thumb">
                    <span className="report-thumb-sheen" aria-hidden="true" />
                    <span className="rc-corner tl" aria-hidden="true" />
                    <span className="rc-corner tr" aria-hidden="true" />
                    <span className="rc-corner bl" aria-hidden="true" />
                    <span className="rc-corner br" aria-hidden="true" />
                    {item.figmaImage || item.screenImage ? (
                      <img src={`/api/reports/${item.id}/thumb`} alt={item.name} loading="lazy" decoding="async" />
                    ) : (
                      <span>{t.reports.noFigmaImage}</span>
                    )}
                    {score !== null && (
                      <span className={`report-thumb-score ${scoreTone}`}>
                        <CountUp value={score} suffix="%" delay={Math.min(idx, 6) * 55} />
                      </span>
                    )}
                  </Link>
                  <div className="report-card-body">
                    <Link to={`/reports/${item.id}`} className="report-card-title">
                      {item.name}
                    </Link>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {item.project && <span className="badge accent">{item.project}</span>}
                      <span className={`badge ${statusClass}`}>
                        {fail ? (
                          <>
                            <CountUp value={fail} delay={Math.min(idx, 6) * 55} />{' '}
                            {fail === 1 ? t.reports.diffSingular : t.reports.diffPlural}
                          </>
                        ) : warn ? (
                          <>
                            <CountUp value={warn} delay={Math.min(idx, 6) * 55} />{' '}
                            {warn === 1 ? t.reports.warnSingular : t.reports.warnPlural}
                          </>
                        ) : (
                          t.reports.matchBadge
                        )}
                      </span>
                      {typeof item.precision === 'number' && (
                        <span className="badge">{t.reports.precisionTag.replace('{n}', String(item.precision))}</span>
                      )}
                    </div>
                    {score !== null && (
                      <div className={`score-meter ${scoreTone}`}>
                        <div style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
                      </div>
                    )}
                    <div className="report-card-meta">
                      <span>
                        {new Date(item.createdAt).toLocaleString(dateLocale)}
                        {!item.figmaImage && ` · ${t.reports.noFigmaImage}`}
                      </span>
                      {item.url && (
                        <span className="report-card-url" title={item.url}>
                          {formatShortUrl(item.url)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="report-card-footer">
                  <Link to={`/reports/${item.id}`} className="btn secondary small">
                    <span>{t.validate.mcpAgent.openReportBtn}</span>
                    <IconArrowRight size={13} className="icon-nudge-right" />
                  </Link>
                  <button
                    type="button"
                    className="btn ghost danger small"
                    onClick={() => void handleDelete(item.id)}
                  >
                    <IconTrash size={13} />
                    <span>{t.reports.deleteBtn}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
