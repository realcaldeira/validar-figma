import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconCheck,
  IconCheckCircle,
  IconCopy,
  IconExternalLink,
  IconInfo,
  IconTrash,
  IconXCircle,
} from '../components/Icons.tsx';
import { generateCases } from '../benchmark/mutations.ts';
import type { AgentScore, BenchmarkState, RateMetric, Scoreboard } from '../benchmark/types.ts';
import { DEMO_FIGMA_URL, demoSpec } from '../demo/spec.ts';
import type { FigmaSpec } from '../engine/types.ts';
import { localizeMessage } from '../i18n/messages.ts';
import { useI18n } from '../i18n/useI18n.ts';
import { Reveal } from '../components/Reveal.tsx';
import { CountUp } from '../components/CountUp.tsx';
import { RollingNumber } from '../components/RollingNumber.tsx';
import { apiRequest } from '../utils/api.ts';
import './report.css';

function openHiddenFrame(src: string, width: number, height = 1000): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.className = 'hidden-frame';
    f.style.width = `${width}px`;
    f.style.height = `${height}px`;
    const timer = window.setTimeout(() => {
      f.remove();
      reject(new Error(`Failed to open ${src}`));
    }, 15000);
    f.onload = () => {
      window.clearTimeout(timer);
      resolve(f);
    };
    f.onerror = () => {
      window.clearTimeout(timer);
      f.remove();
      reject(new Error(`Failed to open ${src}`));
    };
    f.src = src;
    document.body.appendChild(f);
  });
}

function injectFrameScript(f: HTMLIFrameElement, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = f.contentDocument!;
    const s = doc.createElement('script');
    s.src = `${location.origin}${src}?${Date.now()}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    doc.head.appendChild(s);
  });
}

async function waitForSelector(f: HTMLIFrameElement, selector: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (f.contentDocument?.querySelector(selector)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

type BenchWin = Window & {
  __figmaCapture?: (opts: object) => Promise<{ html: string; elements: number }>;
  __figmaValidator?: (spec: FigmaSpec) => Promise<unknown>;
};

const pct = (m: RateMetric | null | undefined) => (m && m.rate != null ? `${Math.round(m.rate * 100)}%` : '—');
const rateClass = (m: RateMetric | null | undefined) =>
  !m || m.rate == null ? '' : m.rate >= 0.9 ? 'good' : m.rate >= 0.6 ? 'mid' : 'bad';
const frac = (m: RateMetric) => (m.total ? ` (${m.hits}/${m.total})` : '');

export default function BenchmarkPage() {
  const { locale, t } = useI18n();
  const [state, setState] = useState<BenchmarkState | null>(null);
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [opts, setOpts] = useState({ cases: 12, controls: 3, maxPerCase: 2, outsideSpec: 30, seed: 7 });
  const [agent, setAgent] = useState('claude');
  const [detailAgent, setDetailAgent] = useState('engine');
  const [customUrl, setCustomUrl] = useState('http://localhost:3000');
  const [copiedPromptKey, setCopiedPromptKey] = useState<'capture' | 'agent' | null>(null);
  const busyRef = useRef<string | null>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const origin = location.origin;

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        apiRequest<BenchmarkState>('/api/benchmark/state'),
        apiRequest<Scoreboard>('/api/benchmark/scoreboard'),
      ]);
      setState(s);
      setScoreboard(p);
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (!busyRef.current && !document.hidden) void refresh();
    }, 4000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function runTask(name: string, fn: () => Promise<string>) {
    setBusy(name);
    setMessage(null);
    setProgress(0);
    try {
      setMessage({ type: 'ok', text: await fn() });
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message });
    } finally {
      document.querySelectorAll('iframe.hidden-frame').forEach((f) => f.remove());
      setBusy(null);
      await refresh();
    }
  }

  const captureDemo = () =>
    runTask('capture', async () => {
      const f = await openHiddenFrame('/demo/sample-screen', demoSpec.viewport!.width, demoSpec.viewport!.height);
      await waitForSelector(f, '#demo-title');
      await injectFrameScript(f, '/capture.js');
      const data = await (f.contentWindow as BenchWin).__figmaCapture!({});
      await apiRequest('/api/benchmark/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, name: 'Demo - Upcoming Releases', figmaUrl: DEMO_FIGMA_URL, spec: demoSpec }),
      });
      return t.benchmark.statusCaptured.replace('{count}', String(data.elements));
    });

  const generate = () =>
    runTask('generate', async () => {
      const spec = await apiRequest<FigmaSpec>('/api/benchmark/spec');
      const baseRes = await fetch('/benchmark-base.html');
      if (!baseRes.ok) throw new Error('No capture yet');
      const baseHtml = await baseRes.text();
      const f = await openHiddenFrame('/benchmark-base.html', spec.viewport?.width ?? 1440, spec.viewport?.height ?? 1000);
      await f.contentWindow!.document.fonts?.ready;
      const cases = generateCases(f.contentDocument!, baseHtml, spec, {
        cases: Math.max(1, opts.cases),
        controls: Math.max(0, Math.min(opts.cases, opts.controls)),
        maxPerCase: Math.max(1, opts.maxPerCase),
        outsideSpec: Math.max(0, Math.min(100, opts.outsideSpec)) / 100,
        seed: opts.seed,
      });
      await apiRequest('/api/benchmark/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: opts.seed, cases }),
      });
      const mutCount = cases.reduce((sum, c) => sum + c.mutations.length, 0);
      return t.benchmark.statusGenerated
        .replace('{cases}', String(cases.length))
        .replace('{mutations}', String(mutCount))
        .replace('{controls}', String(cases.filter((c) => c.control).length));
    });

  const runEngine = () =>
    runTask('engine', async () => {
      const spec = await apiRequest<FigmaSpec>('/api/benchmark/spec');
      const ids = (state?.cases ?? []).map((c) => c.id);
      for (let i = 0; i < ids.length; i++) {
        const f = await openHiddenFrame(
          `/benchmark-cases/${ids[i]}.html`,
          spec.viewport?.width ?? 1440,
          spec.viewport?.height ?? 1000,
        );
        await f.contentWindow!.document.fonts?.ready;
        await injectFrameScript(f, '/validator.js');
        const report = await (f.contentWindow as BenchWin).__figmaValidator!(spec);
        await apiRequest('/api/benchmark/result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent: 'engine', caseId: ids[i], report }),
        });
        f.remove();
        setProgress((i + 1) / ids.length);
      }
      return t.benchmark.statusEngineDone.replace('{cases}', String(Math.max(0, ids.length - 1)));
    });

  const deleteAgentResults = (name: string) =>
    runTask('delete', async () => {
      await apiRequest(`/api/benchmark/results/${encodeURIComponent(name)}`, { method: 'DELETE' });
      return t.benchmark.statusDeleted.replace('{agent}', name);
    });

  const resetAll = () =>
    runTask('reset', async () => {
      if (!confirm(t.benchmark.confirmReset)) return t.benchmark.statusCancelled;
      await apiRequest('/api/benchmark/reset', { method: 'POST', body: '{}' });
      return t.benchmark.statusReset;
    });

  const cap = state?.capture;
  const frameWidth = cap?.viewport?.width ?? 1440;

  const resolvedAgent = agent.trim() || 'custom-agent';

  const agentPrompt = useMemo(
    () =>
      locale === 'pt'
        ? `Execute o modo benchmark do Validar Figma.
Agente: ${resolvedAgent}
Servidor: ${origin}
Figma: ${cap?.figmaUrl ?? '<URL do frame do Figma>'}

1. Leia o frame via MCP do Figma e escreva SUA PRÓPRIA FigmaSpec (NÃO leia ${origin}/api/benchmark/spec nem ${origin}/api/benchmark/scoreboard).
2. Liste os casos: GET ${origin}/api/benchmark/state ("base" é a tela original sem mutações).
3. Para cada caso que "${resolvedAgent}" ainda não enviou (começando por "base"): abra a URL do caso no navegador com ${frameWidth}px de largura, carregue ${origin}/validator.js, rode await window.__figmaValidator(spec) e envie POST ${origin}/api/benchmark/result com { "agent": "${resolvedAgent}", "caseId": "<id>", "report": <resultado> }.
4. Informe quantos casos foram enviados.`
        : `Run Figma Validator benchmark mode.
Agent: ${resolvedAgent}
Server: ${origin}
Figma: ${cap?.figmaUrl ?? '<Figma frame URL>'}

1. Read the frame via Figma MCP and write YOUR OWN FigmaSpec (do NOT read ${origin}/api/benchmark/spec or ${origin}/api/benchmark/scoreboard).
2. Fetch the cases: GET ${origin}/api/benchmark/state ("base" is the unmutated baseline screen).
3. For each case "${resolvedAgent}" has not submitted yet (starting with "base"): open the case URL in the browser at ${frameWidth}px width, load ${origin}/validator.js, run await window.__figmaValidator(spec), and POST ${origin}/api/benchmark/result with { "agent": "${resolvedAgent}", "caseId": "<id>", "report": <result> }.
4. Report how many cases were submitted.`,
    [resolvedAgent, origin, cap?.figmaUrl, frameWidth, locale],
  );

  const capturePrompt =
    locale === 'pt'
      ? `Capture uma tela para o teste de assertividade do Validar Figma.
URL da tela: ${customUrl}
Figma: <URL do frame do Figma>
Servidor: ${origin}

1. Leia o frame via MCP do Figma e prepare o FigmaSpec JSON.
2. Abra a tela no navegador na largura do frame do Figma, carregue ${origin}/capture.js e execute:
   await window.__figmaCapture({ server: '${origin}', name: '<nome da tela>', figmaUrl: '<link>', spec });`
      : `Capture a screen for the Figma Validator assertiveness benchmark.
Screen URL: ${customUrl}
Figma: <Figma frame URL>
Server: ${origin}

1. Read the frame via Figma MCP and prepare the FigmaSpec JSON.
2. Open the screen in the browser at the Figma frame width, load ${origin}/capture.js, and execute:
   await window.__figmaCapture({ server: '${origin}', name: '<screen name>', figmaUrl: '<link>', spec });`;

  const copyPrompt = (key: 'capture' | 'agent', text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedPromptKey(key);
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = window.setTimeout(() => setCopiedPromptKey((cur) => (cur === key ? null : cur)), 2000);
        setMessage({ type: 'ok', text: t.validate.mcpAgent.copied });
      })
      .catch((err: Error) => {
        setMessage({ type: 'error', text: err.message || 'Clipboard unavailable' });
      });

  const agents = scoreboard?.agents ?? [];
  const detail: AgentScore | undefined = agents.find((a) => a.agent === detailAgent) ?? agents[0];
  const types = [...new Set(agents.flatMap((a) => Object.keys(a.byType)))].sort();

  const hasCapture = Boolean(cap?.hasSpec);
  const hasCases = Boolean(state?.cases.length);
  const hasEngine = Boolean(state?.results.engine?.length);
  const hasAiAgent = agents.some((a) => a.agent !== 'engine');
  const hasScoreboard = agents.length > 0;

  const stepperDone = [hasCapture, hasCases, hasEngine, hasAiAgent, hasScoreboard];

  return (
    <>
      <h1>{t.benchmark.title}</h1>
      <p className="lead">{t.benchmark.subtitle}</p>

      <div className="bench-explainer">
        <IconInfo size={18} style={{ color: 'var(--accent)', flex: 'none', marginTop: 2 }} />
        <div>
          <strong>{t.benchmark.explainerTitle}</strong>
          <p>{t.benchmark.explainerBody}</p>
        </div>
      </div>

      <div className="bench-stepper">
        {t.benchmark.stepper.map((label, idx) => {
          const isDone = stepperDone[idx];
          const isOptional = idx === 3 && !isDone;
          const isRunning =
            (busy === 'capture' && idx === 0) ||
            (busy === 'generate' && idx === 1) ||
            (busy === 'engine' && idx === 2);
          return (
            <button
              key={label}
              type="button"
              className={`bench-step-pill${isRunning ? ' running' : isDone ? ' done' : isOptional ? ' optional' : ''}`}
              onClick={() => document.getElementById(`bench-step-${idx + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {isRunning ? <span className="spinner dark" aria-hidden="true" /> : isDone ? <IconCheck size={14} /> : <span>{idx + 1}.</span>}
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {message && <div className={`banner ${message.type}`}>{localizeMessage(message.text, locale)}</div>}
      {busy && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 12, fontWeight: 700, color: 'var(--accent-hover)', marginBottom: 4 }}>
            <RollingNumber value={Math.round(Math.max(5, progress * 100))} suffix="%" fast rollOnMount={false} />
          </div>
          <div className="progress-bar" aria-label="progress">
            <div style={{ width: `${Math.max(5, progress * 100)}%` }} />
          </div>
        </div>
      )}

      <Reveal>
        <section id="bench-step-1" className={`card${hasCapture ? ' step-done' : ''}`}>
        <div className="step-heading">
          <h2 className="step-heading-main" style={{ margin: 0 }}>
            <span className="num">1</span> {t.benchmark.step1Title}
          </h2>
          <span className={`badge ${hasCapture ? 'ok' : ''}`}>
            {hasCapture ? t.benchmark.stepDone : t.benchmark.stepPending}
          </span>
        </div>
        {cap ? (
          <p style={{ marginTop: 0 }}>
            {t.benchmark.currentCopy}: <strong>{cap.name}</strong> — <CountUp value={cap.elements} /> {t.benchmark.elementsCount},{' '}
            {cap.hasSpec ? (
              <span className="good">{t.benchmark.withSpec}</span>
            ) : (
              <span className="bad">{t.benchmark.withoutSpec}</span>
            )}
            .{' '}
            <a href="/benchmark-base.html" target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>{t.benchmark.viewCopy}</span>
              <IconExternalLink size={12} />
            </a>
            <br />
            <span className="notice">
              {t.benchmark.sourceLabel}: {cap.url}
            </span>
          </p>
        ) : (
          <p className="notice">{t.benchmark.noCapture}</p>
        )}
        <div className="form-row">
          <button type="button" className="btn" onClick={() => void captureDemo()} disabled={Boolean(busy)}>
            {t.benchmark.captureDemoBtn}
          </button>
        </div>
        <details className="spec-details">
          <summary>{t.benchmark.captureCustomSummary}</summary>
          <div className="form-row">
            <label style={{ flex: 1 }}>
              {t.benchmark.screenUrlLabel}
              <input className="input" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} />
            </label>
          </div>
          <textarea className="code-box" readOnly value={capturePrompt} />
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className={`btn secondary small${copiedPromptKey === 'capture' ? ' copied' : ''}`}
              onClick={() => void copyPrompt('capture', capturePrompt)}
            >
              {copiedPromptKey === 'capture' ? <IconCheck size={13} /> : <IconCopy size={13} />}
              <span>{copiedPromptKey === 'capture' ? t.validate.mcpAgent.copied : t.benchmark.copyPromptBtn}</span>
            </button>
          </div>
        </details>
        </section>
      </Reveal>

      <Reveal delay={40}>
        <section id="bench-step-2" className={`card${hasCases ? ' step-done' : ''}`}>
        <div className="step-heading">
          <h2 className="step-heading-main" style={{ margin: 0 }}>
            <span className="num">2</span> {t.benchmark.step2Title}
          </h2>
          <span className={`badge ${hasCases ? 'ok' : ''}`}>
            {hasCases ? t.benchmark.stepDone : t.benchmark.stepPending}
          </span>
        </div>
        <div className="form-row">
          {(
            [
              ['cases', t.benchmark.casesLabel, 1, 100],
              ['controls', t.benchmark.controlsLabel, 0, 100],
              ['maxPerCase', t.benchmark.maxPerCaseLabel, 1, 10],
              ['outsideSpec', t.benchmark.outsideSpecLabel, 0, 100],
              ['seed', t.benchmark.seedLabel, 0, 999999],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                className="input compact"
                type="number"
                min={min}
                max={max}
                value={opts[key]}
                onChange={(e) => setOpts({ ...opts, [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <button type="button" className="btn" onClick={() => void generate()} disabled={Boolean(busy) || !cap?.hasSpec}>
            {t.benchmark.generateBtn}
          </button>
        </div>
        <p className="notice">
          {t.benchmark.step2Help}{' '}
          {state?.cases.length
            ? `${t.benchmark.currentCasesLabel}: ${Math.max(0, state.cases.length - 1)} + base.`
            : ''}
        </p>
        </section>
      </Reveal>

      <Reveal delay={40}>
        <section id="bench-step-3" className={`card${hasEngine ? ' step-done' : ''}`}>
        <div className="step-heading">
          <h2 className="step-heading-main" style={{ margin: 0 }}>
            <span className="num">3</span> {t.benchmark.step3Title}
          </h2>
          <span className={`badge ${hasEngine ? 'ok' : ''}`}>
            {hasEngine ? t.benchmark.stepDone : t.benchmark.stepPending}
          </span>
        </div>
        <p className="notice" style={{ marginTop: 0, marginBottom: 12 }}>
          {t.benchmark.step3Desc}
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => void runEngine()}
          disabled={Boolean(busy) || !state?.cases.length}
        >
          {t.benchmark.runEngineBtn}
        </button>
        </section>
      </Reveal>

      <Reveal delay={40}>
        <section id="bench-step-4" className={`card${hasAiAgent ? ' step-done' : ''}`}>
        <div className="step-heading">
          <h2 className="step-heading-main" style={{ margin: 0 }}>
            <span className="num">4</span> {t.benchmark.step4Title}
          </h2>
          <span className="badge accent">{t.benchmark.stepOptional}</span>
        </div>
        <p className="notice" style={{ marginTop: 0 }}>
          {t.benchmark.step4Desc}
        </p>
        <div className="form-row">
          <label>
            {t.benchmark.agentLabel}
            <select
              className="select"
              style={{ width: 170 }}
              value={['claude', 'codex', 'gemini'].includes(agent) ? agent : 'other'}
              onChange={(e) => setAgent(e.target.value === 'other' ? 'other-agent' : e.target.value)}
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="gemini">Gemini</option>
              <option value="other">{t.benchmark.otherOption}</option>
            </select>
          </label>
          {!['claude', 'codex', 'gemini'].includes(agent) && (
            <label>
              {t.benchmark.agentNameLabel}
              <input
                className="input compact"
                value={agent}
                onChange={(e) => setAgent(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              />
            </label>
          )}
        </div>
        <textarea className="code-box" readOnly value={agentPrompt} />
        <div className="form-row" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={`btn secondary small${copiedPromptKey === 'agent' ? ' copied' : ''}`}
            onClick={() => void copyPrompt('agent', agentPrompt)}
          >
            {copiedPromptKey === 'agent' ? <IconCheck size={13} /> : <IconCopy size={13} />}
            <span>{copiedPromptKey === 'agent' ? t.validate.mcpAgent.copied : t.benchmark.copyPromptBtn}</span>
          </button>
          {state?.results[agent] && (
            <span className="notice" style={{ margin: 0 }}>
              {agent}: {state.results[agent].length}/{state.cases.length} {t.benchmark.pagesSent}
            </span>
          )}
        </div>
        </section>
      </Reveal>

      <Reveal delay={40}>
        <section id="bench-step-5" className={`card${hasScoreboard ? ' step-done' : ''}`}>
        <div className="step-heading">
          <h2 className="step-heading-main" style={{ margin: 0 }}>
            <span className="num">5</span> {t.benchmark.step5Title}
          </h2>
          <span className={`badge ${hasScoreboard ? 'ok' : ''}`}>
            {hasScoreboard ? t.benchmark.stepDone : t.benchmark.stepPending}
          </span>
        </div>
        {!agents.length ? (
          <p className="notice">{t.benchmark.noResults}</p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t.benchmark.cols.runner}</th>
                    <th>{t.benchmark.cols.cases}</th>
                    <th>{t.benchmark.cols.found}</th>
                    <th>{t.benchmark.cols.insideSpec}</th>
                    <th>{t.benchmark.cols.outsideSpec}</th>
                    <th>{t.benchmark.cols.falseAlarms}</th>
                    <th>{t.benchmark.cols.cleanControls}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.agent}>
                      <td>
                        <strong>{a.agent}</strong>
                      </td>
                      <td>
                        <CountUp value={a.casesExecuted} />/<CountUp value={a.casesTotal} />
                      </td>
                      <td>
                        <span className={`metric-pill ${rateClass(a.detection)}`}>
                          {a.detection.rate != null ? <CountUp value={Math.round(a.detection.rate * 100)} suffix="%" /> : '—'}
                        </span>{' '}
                        <span className="notice" style={{ margin: 0 }}>{frac(a.detection)}</span>
                      </td>
                      <td>
                        <span className={`metric-pill ${rateClass(a.insideSpec)}`}>
                          {a.insideSpec.rate != null ? <CountUp value={Math.round(a.insideSpec.rate * 100)} suffix="%" /> : '—'}
                        </span>{' '}
                        <span className="notice" style={{ margin: 0 }}>{frac(a.insideSpec)}</span>
                      </td>
                      <td>
                        {a.outsideSpec.rate != null ? <CountUp value={Math.round(a.outsideSpec.rate * 100)} suffix="%" /> : '—'}
                        {frac(a.outsideSpec)}
                      </td>
                      <td>
                        <span className={`metric-pill ${a.falsePositives ? 'bad' : 'good'}`}>
                          <CountUp value={a.falsePositives} />
                        </span>{' '}
                        {a.casesWithFalsePositive ? `(${a.casesWithFalsePositive} ${t.benchmark.inCases})` : ''}
                      </td>
                      <td>
                        <CountUp value={a.controls.clean} />/<CountUp value={a.controls.executed} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn ghost danger small"
                          onClick={() => void deleteAgentResults(a.agent)}
                          disabled={Boolean(busy)}
                        >
                          <IconTrash size={13} />
                          <span>{t.benchmark.deleteBtn}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {scoreboard?.agreement && (
              <p className="notice" style={{ color: 'var(--ink)' }}>
                {t.benchmark.agreementLine
                  .replace('{pct}', pct(scoreboard.agreement))
                  .replace('{hits}', String(scoreboard.agreement.hits))
                  .replace('{total}', String(scoreboard.agreement.total))}
              </p>
            )}

            <p className="notice">{t.benchmark.legendLine}</p>

            <h3>{t.benchmark.byTypeTitle}</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t.benchmark.typeCol}</th>
                    {agents.map((a) => (
                      <th key={a.agent}>{a.agent}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {types.map((type) => (
                    <tr key={type}>
                      <td>{type}</td>
                      {agents.map((a) => (
                        <td key={a.agent} className={rateClass(a.byType[type])}>
                          {a.byType[type]?.rate != null ? <CountUp value={Math.round(a.byType[type].rate * 100)} suffix="%" /> : '—'}
                          {a.byType[type] ? frac(a.byType[type]) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>{t.benchmark.caseByCaseTitle}</h3>
            <div className="form-row">
              <label>
                {t.benchmark.viewLabel}
                <select
                  className="select compact"
                  style={{ width: 160 }}
                  value={detail?.agent}
                  onChange={(e) => setDetailAgent(e.target.value)}
                >
                  {agents.map((a) => (
                    <option key={a.agent}>{a.agent}</option>
                  ))}
                </select>
              </label>
            </div>
            {detail?.cases.map((c) => (
              <div className="case-item" key={c.id}>
                <a href={`/benchmark-cases/${c.id}.html`} target="_blank" rel="noreferrer">
                  {c.id}
                </a>
                {c.control && (
                  <span className="badge" style={{ marginLeft: 8 }}>
                    {t.benchmark.controlTag}
                  </span>
                )}
                {!c.executed && (
                  <span className="badge" style={{ marginLeft: 8 }}>
                    {t.benchmark.notRunTag}
                  </span>
                )}
                {c.mutations.map((m) => (
                  <div className="case-mutation" key={m.id}>
                    {c.executed ? (
                      m.detected ? (
                        <IconCheckCircle size={14} className="good" />
                      ) : (
                        <IconXCircle size={14} className="bad" />
                      )
                    ) : (
                      <span>·</span>
                    )}
                    <span>{localizeMessage(m.description, locale)}</span>
                    <span className="badge">{m.insideSpec ? t.benchmark.insideTag : t.benchmark.outsideTag}</span>
                  </div>
                ))}
                {c.falsePositives.map((f, i) => (
                  <div className="case-mutation bad" key={i}>
                    ! {t.benchmark.falseAlarmLabel}: {f.region} · {f.property} ({localizeMessage(f.expected, locale)} /{' '}
                    {localizeMessage(f.actual, locale)})
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
        </section>
      </Reveal>

      <div className="card" style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 18px' }}>
        <button type="button" className="btn danger small" onClick={() => void resetAll()} disabled={Boolean(busy)}>
          <IconTrash size={14} />
          <span>{t.benchmark.resetAllBtn}</span>
        </button>
      </div>
    </>
  );
}
