import { useEffect, useState, type FormEvent } from 'react';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconCheckCircle,
  IconExternalLink,
  IconFigmaColor,
  IconGlobe,
  IconHelpCircle,
  IconKey,
  IconLock,
} from '../components/Icons.tsx';
import { parseFigmaUrl } from '../engine/figmaParser.ts';
import { localizeMessage } from '../i18n/messages.ts';
import { useI18n } from '../i18n/useI18n.ts';
import { navigate } from '../navigation.ts';
import { CountUp } from '../components/CountUp.tsx';
import { RollingNumber } from '../components/RollingNumber.tsx';
import { apiRequest } from '../utils/api.ts';

const TOKEN_STORAGE_KEY = 'figma-validator-token';
const LAST_STORAGE_KEY = 'figma-validator-quick';

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* navegador sem storage: segue sem lembrar */
  }
}

function readLast(): { figmaUrl: string; screenUrl: string; containers: boolean; project: string } {
  try {
    const parsed = JSON.parse(readStorage(LAST_STORAGE_KEY) || '{}') as {
      figmaUrl?: string;
      screenUrl?: string;
      containers?: boolean;
      project?: string;
    };
    return {
      figmaUrl: parsed.figmaUrl || '',
      screenUrl: parsed.screenUrl || '',
      containers: Boolean(parsed.containers),
      project: parsed.project || '',
    };
  } catch {
    return { figmaUrl: '', screenUrl: '', containers: false, project: '' };
  }
}

/** Validação de um passo, sem IA: link do Figma + endereço da tela → relatório. */
export default function QuickValidate({
  precision,
}: {
  precision: number;
}) {
  const { locale, t } = useI18n();
  const q = t.validate.quick;
  const [figmaUrl, setFigmaUrl] = useState(() => readLast().figmaUrl);
  const [screenUrl, setScreenUrl] = useState(() => readLast().screenUrl);
  const [containers, setContainers] = useState(() => readLast().containers);
  const [project, setProject] = useState(() => readLast().project);
  const [knownProjects, setKnownProjects] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    apiRequest<{ project?: string | null }[]>('/api/reports')
      .then((list) => {
        if (!active) return;
        setKnownProjects([...new Set(list.map((r) => r.project).filter((p): p is string => Boolean(p)))].sort());
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const [savedToken, setSavedToken] = useState(() => readStorage(TOKEN_STORAGE_KEY));
  const [tokenInput, setTokenInput] = useState('');
  const [editingToken, setEditingToken] = useState(() => !readStorage(TOKEN_STORAGE_KEY));
  const [showTokenHelp, setShowTokenHelp] = useState(false);
  const [busy, setBusy] = useState<'run' | 'login' | null>(null);
  const [progressStep, setProgressStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const figmaParsed = figmaUrl.trim() ? parseFigmaUrl(figmaUrl.trim()) : null;
  const screenValid = /^https?:\/\/\S+/i.test(screenUrl.trim());
  const bothReady = Boolean(figmaParsed && screenValid);
  const precisionExplain = q.precisionDescriptions.exact;

  useEffect(() => {
    if (busy !== 'run') return;
    const t1 = window.setTimeout(() => setProgressStep(1), 3500);
    const t2 = window.setTimeout(() => setProgressStep(2), 12000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [busy]);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!figmaUrl.trim() || !screenUrl.trim()) {
      setError(q.needBoth);
      return;
    }
    if (!figmaParsed) {
      setError(t.validate.figmaApi.invalidUrl);
      return;
    }
    const token = (editingToken ? tokenInput : savedToken).trim();
    if (!token) {
      setError(q.needToken);
      return;
    }
    if (editingToken) {
      writeStorage(TOKEN_STORAGE_KEY, token);
      setSavedToken(token);
      setTokenInput('');
      setEditingToken(false);
      setShowTokenHelp(false);
    }
    writeStorage(LAST_STORAGE_KEY, JSON.stringify({ figmaUrl: figmaUrl.trim(), screenUrl: screenUrl.trim(), containers, project: project.trim() }));
    setProgressStep(0);
    setBusy('run');
    try {
      const res = await apiRequest<{ id: string }>('/api/validate/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          figmaUrl: figmaUrl.trim(),
          url: screenUrl.trim(),
          token,
          precision,
          includeContainers: containers,
          project: project.trim() || undefined,
        }),
      });
      navigate(`/reports/${res.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openLogin = async () => {
    setError(null);
    setInfo(null);
    if (!screenUrl.trim()) {
      setError(q.needBoth);
      return;
    }
    setBusy('login');
    try {
      await apiRequest('/api/browser/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: screenUrl.trim() }),
      });
      setInfo(q.loginOpened);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const progressPct = progressStep === 0 ? 28 : progressStep === 1 ? 66 : 92;

  return (
    <form className="card quick-card" onSubmit={(e) => void run(e)}>
      <div className={`quick-window-bar${busy === 'run' ? ' is-running' : ''}`}>
        <div className="quick-window-left">
          <span className="quick-dots" aria-hidden="true">
            <span style={{ background: '#f24e1e' }} />
            <span style={{ background: '#ffcd29' }} />
            <span style={{ background: '#0acf83' }} />
          </span>
          <h2 className="quick-window-title">{q.title}</h2>
          <span className="quick-live-tag">
            <span className="quick-live-dot" aria-hidden="true" />
            {q.badge}
          </span>
        </div>
        <span className="quick-spec-tag">FIGMA ↔ SCREEN</span>
      </div>

      <div className="quick-body">
        <p className="quick-sub">{q.subtitle}</p>

        <div className="quick-fields">
          <span className={`quick-fields-bridge${bothReady ? ' ready' : ''}`} aria-hidden="true">
            ⇄
          </span>
          <label
            className={`quick-step-field${figmaParsed ? ' is-valid' : figmaUrl.trim() ? ' is-warn' : ''}`}
            htmlFor="quick-figma"
          >
            <span className="field-label">{q.figmaLabel}</span>
            <div className={`input-icon-wrap${figmaParsed ? ' has-valid' : ''}`}>
              <span className="input-icon">
                <IconFigmaColor size={16} />
              </span>
              <input
                id="quick-figma"
                className="input"
                type="url"
                value={figmaUrl}
                placeholder={t.validate.figmaApi.urlPlaceholder}
                onChange={(e) => setFigmaUrl(e.target.value)}
                autoComplete="off"
              />
              {figmaParsed && (
                <span className="input-valid-icon" aria-hidden="true">
                  <IconCheckCircle size={15} />
                </span>
              )}
            </div>
            <div className="field-tip-row">
              {figmaParsed ? (
                <span key={`${figmaParsed.fileKey}-${figmaParsed.nodeId}`} className="quick-hint ok">
                  <IconCheckCircle size={13} />
                  {t.validate.figmaApi.parsedBadge}: {figmaParsed.fileKey} · {figmaParsed.nodeId}
                </span>
              ) : figmaUrl.trim() ? (
                <span className="quick-hint warn">
                  <IconAlertTriangle size={13} />
                  {t.validate.figmaApi.invalidUrl}
                </span>
              ) : (
                <span className="quick-hint">{q.figmaTip}</span>
              )}
            </div>
          </label>

          <label className={`quick-step-field${screenValid ? ' is-valid' : ''}`} htmlFor="quick-screen">
            <span className="field-label">{q.screenLabel}</span>
            <div className={`input-icon-wrap${screenValid ? ' has-valid' : ''}`}>
              <span className="input-icon">
                <IconGlobe size={16} />
              </span>
              <input
                id="quick-screen"
                className="input"
                type="url"
                value={screenUrl}
                placeholder={q.screenPlaceholder}
                onChange={(e) => setScreenUrl(e.target.value)}
                autoComplete="off"
              />
              {screenValid && (
                <span className="input-valid-icon" aria-hidden="true">
                  <IconCheckCircle size={15} />
                </span>
              )}
            </div>
            <div className="field-tip-row">
              <span className="quick-hint">{q.screenTip}</span>
            </div>
          </label>
        </div>

        <label className={`quick-step-field quick-project${project.trim() ? ' is-valid' : ''}`} htmlFor="quick-project">
          <span className="field-label">{q.projectLabel}</span>
          <input
            id="quick-project"
            className="input"
            type="text"
            list="quick-project-list"
            value={project}
            placeholder={q.projectPlaceholder}
            onChange={(e) => setProject(e.target.value)}
            autoComplete="off"
            maxLength={60}
          />
          <datalist id="quick-project-list">
            {knownProjects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <div className="field-tip-row">
            <span className="quick-hint">{q.projectTip}</span>
          </div>
        </label>

        {editingToken ? (
          <div className="quick-token-edit">
            <label className="field-group" htmlFor="quick-token">
              <span className="field-label">
                <IconKey size={14} />
                {q.tokenLabel}
              </span>
              <div className="input-icon-wrap">
                <span className="input-icon">
                  <IconKey size={15} />
                </span>
                <input
                  id="quick-token"
                  className="input"
                  type="password"
                  value={tokenInput}
                  placeholder={t.validate.figmaApi.tokenPlaceholder}
                  onChange={(e) => setTokenInput(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="token-help-toggle"
                aria-expanded={showTokenHelp}
                onClick={() => setShowTokenHelp((v) => !v)}
              >
                <IconHelpCircle size={14} />
                {q.tokenHelpToggle}
              </button>
              {savedToken && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setEditingToken(false);
                    setTokenInput('');
                  }}
                >
                  {t.validate.offline.consoleCancelBtn}
                </button>
              )}
            </div>
            {showTokenHelp && (
              <div className="token-help-box">
                <ol className="token-help-steps">
                  {q.tokenHelpSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p style={{ margin: '10px 0 0', fontSize: 12.5 }}>
                  <a
                    href="https://www.figma.com/settings"
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600 }}
                  >
                    <span>{q.tokenSettingsLink}</span>
                    <IconExternalLink size={12} />
                  </a>
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="quick-token-box">
            <div className="quick-token-status">
              <IconCheckCircle size={16} />
              <strong>{q.tokenSaved}</strong>
              <span className="quick-token-hint">· {q.tokenSavedHint}</span>
            </div>
            <button type="button" className="link-btn" onClick={() => setEditingToken(true)}>
              {q.changeToken}
            </button>
          </div>
        )}

        <div className="quick-options-panel">
          <div className="quick-precision-row">
            <div className="quick-precision-label">
              <span>{q.precisionTitle}</span>
              <span className="badge accent">
                <CountUp value={precision} suffix="%" duration={640} />
              </span>
            </div>
          </div>

          <p className="quick-precision-explain">{precisionExplain}</p>

          <label className={`toggle-card${containers ? ' checked' : ''}`} htmlFor="quick-containers">
            <span className="toggle-card-copy">
              <strong>{q.containersTitle}</strong>
              <span>{q.containersDesc}</span>
            </span>
            <span className="toggle-switch">
              <input
                id="quick-containers"
                type="checkbox"
                checked={containers}
                onChange={(e) => setContainers(e.target.checked)}
              />
              <span className="toggle-track" aria-hidden="true" />
            </span>
          </label>
        </div>

        <div className="quick-actions">
          <button type="submit" className="btn large" disabled={busy !== null}>
            {busy === 'run' ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span>{q.running}</span>
              </>
            ) : (
              <>
                <span>{q.runBtn}</span>
                <IconArrowRight size={16} className="icon-nudge-right" />
              </>
            )}
          </button>

          <div className="quick-login-box">
            <div className="quick-login-copy">
              <IconLock size={14} style={{ marginTop: 2, flex: 'none' }} />
              <div>
                <strong>{q.loginHint}</strong>
                <span>{q.loginSub}</span>
              </div>
            </div>
            <button type="button" className="btn secondary small" disabled={busy !== null} onClick={() => void openLogin()}>
              {q.loginBtn}
            </button>
          </div>
        </div>

        {busy === 'run' && (
          <div className="quick-progress" role="status" aria-live="polite">
            <div className="quick-progress-head">
              <span>{q.running}</span>
              <RollingNumber value={progressPct} suffix="%" fast rollOnMount={false} />
            </div>
            <div className="progress-bar" style={{ marginBottom: 0 }}>
              <div style={{ width: `${progressPct}%` }} />
            </div>
            <div className="quick-progress-steps">
              {q.progressSteps.map((step, idx) => {
                const isDone = idx < progressStep;
                const isActive = idx === progressStep;
                return (
                  <div
                    key={step}
                    className={`quick-progress-step${isDone ? ' done' : isActive ? ' active' : ''}`}
                  >
                    {isDone ? (
                      <IconCheck size={14} />
                    ) : isActive ? (
                      <span className="spinner dark" aria-hidden="true" />
                    ) : (
                      <span style={{ width: 14, textAlign: 'center' }}>·</span>
                    )}
                    <span>{step}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <p key={error} className="notice error quick-feedback-pop" role="alert" style={{ marginTop: 14 }}>
            {localizeMessage(error, locale)}
          </p>
        )}
        {info && (
          <p className="notice ok quick-feedback-pop" style={{ marginTop: 14 }}>
            {info}
          </p>
        )}
      </div>
    </form>
  );
}
