import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconColumns,
  IconExternalLink,
  IconEye,
  IconFigmaColor,
  IconGlobe,
  IconLock,
  IconSplit,
  IconXCircle,
} from '../components/Icons.tsx';
import { ScoreRing } from '../components/ScoreRing.tsx';
import { CountUp } from '../components/CountUp.tsx';
import { Reveal } from '../components/Reveal.tsx';
import { RollingNumber } from '../components/RollingNumber.tsx';
import { computeMatchScore, DEFAULT_PRECISION, tolerancesFromPrecision } from '../engine/compare.ts';
import { useI18n } from '../i18n/useI18n.ts';
import { Link } from '../router.tsx';
import './report.css';
import './guide.css';

interface SimCheck {
  n: number;
  title: string;
  figmaVal: string;
  screenVal: string;
  pass: boolean;
  isColor?: boolean;
}

export default function GuidePage() {
  const { t } = useI18n();
  const g = t.guide;

  const [selectedMode, setSelectedMode] = useState(0);
  const simPrecision = DEFAULT_PRECISION;
  const [simView, setSimView] = useState<'split' | 'side'>('split');
  const [simSplit, setSimSplit] = useState(50);
  const [selectedMarker, setSelectedMarker] = useState<number | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<number | null>(null);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [hasDraggedSplit, setHasDraggedSplit] = useState(false);
  const [activeSection, setActiveSection] = useState('guide-modes');
  const [activeStep, setActiveStep] = useState(0);
  const [openGlossary, setOpenGlossary] = useState<number | null>(2);
  const [hitShortcut, setHitShortcut] = useState<number | null>(null);

  const splitBoxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const shortcutTimerRef = useRef<number | undefined>(undefined);

  const tol = useMemo(() => tolerancesFromPrecision(simPrecision), [simPrecision]);

  const simChecks = useMemo<SimCheck[]>(() => {
    const titlePass = 1 <= tol.fontSize;
    const paddingPass = 2 <= tol.spacing;
    const colorPass = 4.8 <= tol.color;
    const radiusPass = 0 <= tol.radius;

    return [
      { n: 1, title: g.playground.checks[0], figmaVal: '24px', screenVal: '23px', pass: titlePass },
      { n: 2, title: g.playground.checks[1], figmaVal: '24px', screenVal: '22px', pass: paddingPass },
      {
        n: 3,
        title: g.playground.checks[2],
        figmaVal: '#0D99FF',
        screenVal: '#1B82E6',
        pass: colorPass,
        isColor: true,
      },
      { n: 4, title: g.playground.checks[3], figmaVal: '12px', screenVal: '12px', pass: radiusPass },
    ];
  }, [g.playground.checks, tol.color, tol.fontSize, tol.radius, tol.spacing]);

  const simPassCount = simChecks.filter((c) => c.pass).length;
  const simFailCount = simChecks.length - simPassCount;
  const simScore = computeMatchScore(simPassCount, simFailCount, 0) ?? 100;
  const simTone: 'pass' | 'warn' | 'fail' =
    simFailCount === 0 ? 'pass' : simScore >= 75 ? 'warn' : 'fail';

  const triggerShortcutHit = useCallback((idx: number) => {
    setHitShortcut(idx);
    window.clearTimeout(shortcutTimerRef.current);
    shortcutTimerRef.current = window.setTimeout(() => setHitShortcut(null), 1600);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      let idx: number | null = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'j' || e.key === 'k') idx = 0;
      else if (e.key === 'Escape') idx = 1;
      if (idx === null) return;
      triggerShortcutHit(idx);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(shortcutTimerRef.current);
    };
  }, [triggerShortcutHit]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const ids = ['guide-modes', 'guide-playground', 'guide-steps', 'guide-chrome', 'guide-glossary', 'guide-shortcuts'];
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
    if (!els.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: '-25% 0px -55% 0px', threshold: 0.05 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const jumpToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const updateSplit = (clientX: number) => {
    const rect = splitBoxRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    setSimSplit(Math.round(Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100))));
  };

  const onSplitDown = (e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    setDraggingSplit(true);
    setHasDraggedSplit(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateSplit(e.clientX);
  };

  const onSplitMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updateSplit(e.clientX);
  };

  const onSplitUp = () => {
    draggingRef.current = false;
    setDraggingSplit(false);
  };

  const modeMeta: { index: string; tone: 'blue' | 'green' | 'coral' | 'purple' }[] = [
    { index: '01', tone: 'blue' },
    { index: '02', tone: 'green' },
    { index: '03', tone: 'coral' },
    { index: '04', tone: 'purple' },
  ];

  const activeMode = g.modes[selectedMode] ?? g.modes[0];
  const activeModeDetail = g.modeDetails[selectedMode] ?? g.modeDetails[0];
  const activeStepItem = g.steps[activeStep] ?? g.steps[0];
  const activeStepDetail = g.stepDetails[activeStep] ?? g.stepDetails[0];
  const glossaryTones = ['green', 'blue', 'coral', 'purple'] as const;

  const activeMarker = hoveredMarker ?? selectedMarker;

  const renderMockMarkers = () => (
    <>
      <button
        type="button"
        className={`pg-marker ${simChecks[0].pass ? 'pass' : 'fail'}${selectedMarker === 1 ? ' selected' : ''}${hoveredMarker === 1 ? ' hovered' : ''}`}
        style={{ top: -11, left: 14 }}
        onMouseEnter={() => setHoveredMarker(1)}
        onMouseLeave={() => setHoveredMarker(null)}
        onClick={() => setSelectedMarker((cur) => (cur === 1 ? null : 1))}
        aria-label={simChecks[0].title}
      >
        1
      </button>
      <button
        type="button"
        className={`pg-marker ${simChecks[1].pass ? 'pass' : 'fail'}${selectedMarker === 2 ? ' selected' : ''}${hoveredMarker === 2 ? ' hovered' : ''}`}
        style={{ top: -11, right: 12 }}
        onMouseEnter={() => setHoveredMarker(2)}
        onMouseLeave={() => setHoveredMarker(null)}
        onClick={() => setSelectedMarker((cur) => (cur === 2 ? null : 2))}
        aria-label={simChecks[1].title}
      >
        2
      </button>
      <button
        type="button"
        className={`pg-marker ${simChecks[2].pass ? 'pass' : 'fail'}${selectedMarker === 3 ? ' selected' : ''}${hoveredMarker === 3 ? ' hovered' : ''}`}
        style={{ bottom: 16, left: 138 }}
        onMouseEnter={() => setHoveredMarker(3)}
        onMouseLeave={() => setHoveredMarker(null)}
        onClick={() => setSelectedMarker((cur) => (cur === 3 ? null : 3))}
        aria-label={simChecks[2].title}
      >
        3
      </button>
      <button
        type="button"
        className={`pg-marker ${simChecks[3].pass ? 'pass' : 'fail'}${selectedMarker === 4 ? ' selected' : ''}${hoveredMarker === 4 ? ' hovered' : ''}`}
        style={{ bottom: -11, left: 14, borderRadius: 7 }}
        onMouseEnter={() => setHoveredMarker(4)}
        onMouseLeave={() => setHoveredMarker(null)}
        onClick={() => setSelectedMarker((cur) => (cur === 4 ? null : 4))}
        aria-label={simChecks[3].title}
      >
        4
      </button>
    </>
  );

  const renderMockCard = (variant: 'figma' | 'screen') => (
    <div className={`pg-mock-card ${variant}${activeMarker === 2 || activeMarker === 4 ? ' pg-el-highlight' : ''}`}>
      <h3
        className={`pg-mock-title${activeMarker === 1 ? ' pg-el-highlight' : ''}`}
        style={{ fontSize: variant === 'figma' ? 20 : 19 }}
      >
        {g.playground.sampleTitle}
      </h3>
      <div className="pg-mock-lines">
        <div className="pg-mock-line" style={{ width: '92%' }} />
        <div className="pg-mock-line" style={{ width: '68%' }} />
      </div>
      <span
        className={`pg-mock-btn${activeMarker === 3 ? ' pg-el-highlight' : ''}`}
        style={{ background: variant === 'figma' ? '#0D99FF' : '#1B82E6' }}
      >
        {g.playground.sampleBtn}
      </span>
    </div>
  );

  return (
    <>
      <header className="guide-banner">
        <div className="guide-banner-top">
          <div>
            <div className="guide-eyebrow">
              <IconFigmaColor size={14} />
              <span>{g.eyebrow}</span>
            </div>
            <h1>{g.title}</h1>
            <p className="lead">{g.subtitle}</p>
          </div>
          <div className="guide-banner-ctas">
            <Link to="/" className="btn">
              <span>{g.startCta}</span>
              <IconArrowRight size={15} className="icon-nudge-right" />
            </Link>
            <a href="/demo/sample-screen" target="_blank" rel="noreferrer" className="btn guide-banner-demo">
              <span>{t.nav.demoLink}</span>
              <IconExternalLink size={13} />
            </a>
          </div>
        </div>

        <nav className="guide-jump-nav" aria-label="Guide sections">
          {(
            [
              ['guide-modes', g.jumpNav.modes],
              ['guide-playground', g.jumpNav.playground],
              ['guide-steps', g.jumpNav.steps],
              ['guide-chrome', g.jumpNav.chromeNav],
              ['guide-glossary', g.jumpNav.glossary],
              ['guide-shortcuts', g.jumpNav.shortcuts],
            ] as const
          ).map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className={activeSection === id ? 'active' : ''}
              onClick={(e) => jumpToSection(e, id)}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <Reveal>
        <section id="guide-modes" className="guide-section">
        <div className="guide-section-head">
          <div>
            <h2>{g.modesTitle}</h2>
            <p>{g.modeFinderTitle}</p>
          </div>
        </div>

        <div className="guide-situations" role="group" aria-label={g.modeFinderTitle}>
          {g.modeSituations.map((label, idx) => (
            <button
              key={label}
              type="button"
              className={`guide-situation-pill${selectedMode === idx ? ' active' : ''}`}
              onClick={() => setSelectedMode(idx)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="guide-mode-tabs" role="tablist">
          {g.modes.map((m, i) => {
            const meta = modeMeta[i] ?? { index: `0${i + 1}`, tone: 'blue' as const };
            const active = selectedMode === i;
            return (
              <button
                key={m.title}
                type="button"
                role="tab"
                aria-selected={active}
                className={`guide-mode-tab tone-${meta.tone}${active ? ' active' : ''}`}
                onClick={() => setSelectedMode(i)}
              >
                <div className="guide-mode-tab-top">
                  <span className="guide-mode-idx">
                    <span className={`guide-mode-dot ${meta.tone}`} aria-hidden="true" />
                    <span>{meta.index}</span>
                  </span>
                  <span className={`badge${active ? ' accent' : ''}`}>{m.badge}</span>
                </div>
                <strong>{m.title}</strong>
                <span className="guide-mode-short">{m.desc}</span>
              </button>
            );
          })}
        </div>

        <div className="guide-mode-detail" key={selectedMode}>
          <div className="guide-mode-needs">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span className="guide-detail-label">{g.modeNeedsLabel}</span>
              <span className="badge purple">{activeModeDetail.effort}</span>
            </div>
            <div className="guide-needs-chips">
              {activeModeDetail.needs.map((need) => (
                <span key={need} className="guide-need-chip">
                  {need}
                </span>
              ))}
            </div>
            <p className="notice" style={{ margin: 0 }}>
              {activeMode.desc}
            </p>
          </div>

          <div className="guide-mode-highlights">
            <span className="guide-detail-label">{g.modeDoesLabel}</span>
            <ul className="clean-list" style={{ marginTop: 0 }}>
              {activeModeDetail.highlights.map((item) => (
                <li key={item}>
                  <IconCheckCircle size={16} className="good" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="guide-mode-detail-foot">
              <Link to="/" className="btn small">
                <span>{activeModeDetail.cta}</span>
                <IconArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
        </section>
      </Reveal>

      <Reveal delay={40}>
        <section id="guide-playground" className="guide-section">
        <div className="guide-section-head">
          <div>
            <h2>{g.playground.title}</h2>
            <p>{g.playground.subtitle}</p>
          </div>
        </div>

        <div className="guide-playground">
          <div className="pg-stage-col">
            <div className="pg-stage-bar">
              <div className="rd-segments" role="group">
                <button
                  type="button"
                  className={simView === 'split' ? 'active' : ''}
                  onClick={() => setSimView('split')}
                >
                  <IconSplit size={13} />
                  <span>{g.playground.splitTab}</span>
                </button>
                <button
                  type="button"
                  className={simView === 'side' ? 'active' : ''}
                  onClick={() => setSimView('side')}
                >
                  <IconColumns size={13} />
                  <span>{g.playground.sideTab}</span>
                </button>
              </div>
              <span className="notice" style={{ margin: 0 }}>
                {g.playground.clickMarkerHint}
              </span>
            </div>

            <div className="pg-canvas">
              {simView === 'split' ? (
                <div ref={splitBoxRef} className="pg-frame-wrap">
                  <div className="pg-split-layer" style={{ clipPath: `inset(0 ${100 - simSplit}% 0 0)` }}>
                    {renderMockCard('figma')}
                  </div>
                  <div className="pg-overlay-layer" style={{ clipPath: `inset(0 0 0 ${simSplit}%)` }}>
                    {renderMockCard('screen')}
                  </div>
                  {renderMockMarkers()}
                  <div
                    className={`pg-split-handle${draggingSplit ? ' dragging' : ''}${!hasDraggedSplit ? ' hint' : ''}`}
                    style={{ left: `${simSplit}%` }}
                    onPointerDown={onSplitDown}
                    onPointerMove={onSplitMove}
                    onPointerUp={onSplitUp}
                    onPointerCancel={onSplitUp}
                  >
                    <div className="pg-split-line" />
                    <div className="pg-split-knob">↔</div>
                    <span className="pg-split-badge">
                      <RollingNumber value={simSplit} suffix="%" fast rollOnMount={false} />
                    </span>
                  </div>
                </div>
              ) : (
                <div className="pg-side-grid">
                  <div className="pg-side-card">
                    <span className="pg-side-tag">{g.playground.figmaTag}</span>
                    <div className="pg-frame-wrap" style={{ maxWidth: 'none' }}>
                      {renderMockCard('figma')}
                      {renderMockMarkers()}
                    </div>
                  </div>
                  <div className="pg-side-card">
                    <span className="pg-side-tag">{g.playground.screenTag}</span>
                    <div className="pg-frame-wrap" style={{ maxWidth: 'none', borderColor: 'var(--figma-green)' }}>
                      {renderMockCard('screen')}
                      {renderMockMarkers()}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {simView === 'split' && (
              <div className="pg-slider-row">
                <span>
                  {g.playground.figmaTag} (<RollingNumber value={simSplit} suffix="%" fast rollOnMount={false} />)
                </span>
                <input
                  type="range"
                  min={5}
                  max={95}
                  value={simSplit}
                  aria-label={g.playground.splitLabel}
                  onChange={(e) => setSimSplit(Number(e.target.value))}
                />
                <span>{g.playground.screenTag}</span>
              </div>
            )}
          </div>

          <div className="pg-inspector">
            <div className="pg-score-head">
              <ScoreRing score={simScore} tone={simTone} size={68} strokeWidth={6} />
              <div className="pg-score-controls">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14 }}>{t.validate.quick.precisionTitle}</strong>
                  <span className="badge accent">
                    <CountUp value={simPrecision} suffix="%" />
                  </span>
                </div>
              </div>
            </div>

            <div className="pg-slider-row">
              <span style={{ fontSize: 12 }}>
                {g.playground.toleranceNote
                  .replace('{size}', String(tol.fontSize))
                  .replace('{spacing}', String(tol.spacing))
                  .replace('{color}', String(tol.color))}
              </span>
            </div>

            <div className="pg-checks">
              {simChecks.map((chk) => (
                <button
                  key={chk.n}
                  type="button"
                  className={`pg-check-row${selectedMarker === chk.n ? ' selected' : ''}${hoveredMarker === chk.n ? ' hovered' : ''}`}
                  onMouseEnter={() => setHoveredMarker(chk.n)}
                  onMouseLeave={() => setHoveredMarker(null)}
                  onClick={() => setSelectedMarker((cur) => (cur === chk.n ? null : chk.n))}
                >
                  <span className="pg-check-left">
                    <span className={`pg-check-num ${chk.pass ? 'pass' : 'fail'}`}>{chk.n}</span>
                    <span className="pg-check-text">
                      <strong>{chk.title}</strong>
                      <span className="pg-check-vals">
                        {chk.isColor && (
                          <span className="color-swatch" aria-hidden="true">
                            <span style={{ background: chk.figmaVal }} />
                          </span>
                        )}
                        <span>{chk.figmaVal}</span>
                        <span>→</span>
                        {chk.isColor && (
                          <span className="color-swatch" aria-hidden="true">
                            <span style={{ background: chk.screenVal }} />
                          </span>
                        )}
                        <span>{chk.screenVal}</span>
                      </span>
                    </span>
                  </span>
                  <span className={`badge ${chk.pass ? 'ok' : 'fail'}`}>
                    {chk.pass ? <IconCheckCircle size={12} /> : <IconXCircle size={12} />}
                    <span>{chk.pass ? g.playground.passLabel : g.playground.failLabel}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        </section>
      </Reveal>

      <Reveal delay={50}>
        <section id="guide-steps" className="guide-section">
        <div className="guide-section-head">
          <h2>{g.stepsTitle}</h2>
        </div>

        <div className="guide-pipe-progress" aria-hidden="true">
          <div style={{ width: `${((activeStep + 1) / g.steps.length) * 100}%` }} />
        </div>

        <div className="guide-pipeline-tabs" role="tablist">
          {g.steps.map((step, i) => (
            <button
              key={step.title}
              type="button"
              role="tab"
              aria-selected={activeStep === i}
              className={`guide-pipe-tab${activeStep === i ? ' active' : ''}`}
              onClick={() => setActiveStep(i)}
            >
              <div className="guide-pipe-head">
                <span className="guide-pipe-num">{i + 1}</span>
                <span className="guide-pipe-who">{step.who}</span>
              </div>
              <strong>{step.title}</strong>
            </button>
          ))}
        </div>

        <div className="guide-pipe-detail" key={activeStep}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>
              {activeStep + 1}. {activeStepItem.title}
            </h3>
            <span className="badge purple">{activeStepItem.who}</span>
          </div>
          <p className="notice" style={{ fontSize: 14, marginTop: 6 }}>
            {activeStepItem.text}
          </p>

          <div className="guide-pipe-io">
            <div className="guide-pipe-box">
              <strong>{g.stepLabels.input}</strong>
              <p>{activeStepDetail.input}</p>
            </div>
            <div className="guide-pipe-box">
              <strong>{g.stepLabels.action}</strong>
              <p>{activeStepDetail.action}</p>
            </div>
            <div className="guide-pipe-box">
              <strong>{g.stepLabels.output}</strong>
              <p>{activeStepDetail.output}</p>
            </div>
          </div>

          <div className="guide-pipe-nav">
            <button
              type="button"
              className="btn secondary small"
              disabled={activeStep === 0}
              onClick={() => setActiveStep((s) => Math.max(0, s - 1))}
            >
              <IconArrowLeft size={13} className="icon-nudge-left" />
              <span>{g.pipelinePrev}</span>
            </button>
            <button
              type="button"
              className="btn secondary small"
              disabled={activeStep === g.steps.length - 1}
              onClick={() => setActiveStep((s) => Math.min(g.steps.length - 1, s + 1))}
            >
              <span>{g.pipelineNext}</span>
              <IconArrowRight size={13} className="icon-nudge-right" />
            </button>
          </div>
        </div>
        </section>
      </Reveal>

      <Reveal delay={45}>
        <section id="guide-chrome" className="guide-section">
          <div className="guide-section-head">
            <div>
              <span className="guide-chrome-eyebrow">{g.chromeDoc.eyebrow}</span>
              <h2>{g.chromeDoc.title}</h2>
              <p className="guide-chrome-sub">{g.chromeDoc.subtitle}</p>
            </div>
          </div>

          <div className="guide-chrome-zero">
            <IconCheckCircle size={17} />
            <span>{g.chromeDoc.zeroAuthHighlight}</span>
          </div>

          <h3 className="guide-chrome-steps-title">{g.chromeDoc.stepsTitle}</h3>
          <div className="guide-chrome-steps">
            {g.chromeDoc.steps.map((step) => (
              <article key={step.title} className="guide-chrome-step">
                <div className="guide-chrome-step-head">
                  <strong>{step.title}</strong>
                  <span className="guide-chrome-step-badge">{step.badge}</span>
                </div>
                <p>{step.desc}</p>
                <div className="guide-chrome-step-detail">{step.detail}</div>
              </article>
            ))}
          </div>

          <div className="guide-chrome-duo">
            <article className="guide-chrome-card">
              <div className="guide-chrome-card-head">
                <IconLock size={16} />
                <span>{g.chromeDoc.ssoTitle}</span>
              </div>
              <p className="guide-chrome-card-intro">{g.chromeDoc.ssoIntro}</p>
              <ul className="guide-chrome-list">
                {g.chromeDoc.ssoBullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="guide-chrome-promise">{g.chromeDoc.ssoPromise}</div>
            </article>

            <article className="guide-chrome-card">
              <div className="guide-chrome-card-head">
                <IconGlobe size={16} />
                <span>{g.chromeDoc.securityTitle}</span>
              </div>
              <ul className="guide-chrome-list">
                {g.chromeDoc.requirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="guide-chrome-lock-note">{g.chromeDoc.securityRule}</div>
            </article>
          </div>

          <div className="guide-chrome-matrix">
            <h3 className="guide-chrome-steps-title">{g.chromeDoc.modeMatrixTitle}</h3>
            <div className="guide-chrome-table-wrap">
              <table className="guide-chrome-table">
                <thead>
                  <tr>
                    {g.chromeDoc.modeMatrixHead.map((col) => (
                      <th key={col} scope="col">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.chromeDoc.modeMatrix.map((row) => (
                    <tr key={row.mode}>
                      <th scope="row">{row.mode}</th>
                      <td>{row.runner}</td>
                      <td>{row.login}</td>
                      <td>{row.urls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </Reveal>

      <Reveal delay={50}>
        <section id="guide-glossary" className="guide-section">
        <div className="guide-section-head">
          <h2>{g.glossaryTitle}</h2>
        </div>

        <div className="glossary-grid">
          {g.glossary.map((item, idx) => {
            const isOpen = openGlossary === idx;
            const tone = glossaryTones[idx % glossaryTones.length];
            return (
              <button
                key={item.term}
                type="button"
                aria-expanded={isOpen}
                className={`glossary-card interactive${isOpen ? ' open' : ''}`}
                onClick={() => setOpenGlossary((cur) => (cur === idx ? null : idx))}
              >
                <div className="glossary-card-head">
                  <span className={`badge ${tone === 'green' ? 'ok' : tone === 'blue' ? 'accent' : tone === 'coral' ? 'fail' : 'purple'}`}>
                    {item.term}
                  </span>
                  <IconChevronDown
                    size={15}
                    style={{
                      color: 'var(--muted)',
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.16s ease',
                    }}
                  />
                </div>
                <p>{item.desc}</p>
                <span className="notice" style={{ margin: 0, color: 'var(--accent-hover)', fontWeight: 600 }}>
                  {isOpen ? g.glossaryToggleHide : g.glossaryToggleShow}
                </span>

                {isOpen && (
                  <div className="glossary-example">
                    <div>{g.glossaryExamples[idx]}</div>
                    {idx === 2 && (
                      <div className="delta-compare">
                        <div className="delta-sample good">
                          <span className="color-swatch">
                            <span style={{ background: '#0D99FF' }} />
                          </span>
                          <span className="color-swatch">
                            <span style={{ background: '#0E99FE' }} />
                          </span>
                          <span>{g.deltaESubtle}</span>
                        </div>
                        <div className="delta-sample bad">
                          <span className="color-swatch">
                            <span style={{ background: '#0D99FF' }} />
                          </span>
                          <span className="color-swatch">
                            <span style={{ background: '#A259FF' }} />
                          </span>
                          <span>{g.deltaEVisible}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        </section>
      </Reveal>

      <Reveal delay={50}>
        <div className="grid-2">
          <div className="card">
            <h2>{g.measuredTitle}</h2>
            <ul className="clean-list">
              {g.measuredItems.map((item) => (
                <li key={item}>
                  <IconCheckCircle size={16} className="good" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h2>{g.notMeasuredTitle}</h2>
            <ul className="clean-list">
              {g.notMeasuredItems.map((item) => (
                <li key={item}>
                  <IconEye size={16} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>

      <Reveal delay={60}>
        <section id="guide-shortcuts" className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>{g.shortcutsTitle}</h2>
            <span className="badge accent">{g.shortcutsTryHint}</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <tbody>
                {g.shortcuts.map((s, idx) => (
                  <tr
                    key={s.keys}
                    className={`shortcut-row${hitShortcut === idx ? ' hit' : ''}`}
                    onClick={() => triggerShortcutHit(idx)}
                  >
                    <td style={{ width: 210 }}>
                      <kbd>{s.keys}</kbd>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span>{s.desc}</span>
                        {hitShortcut === idx && (
                          <span className="badge ok">
                            <IconCheck size={12} />
                            <span>{g.shortcutsTested}</span>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginBottom: 0, marginTop: 14 }}>
            <a href="/demo/sample-screen" target="_blank" rel="noreferrer" className="rd-meta-link">
              <span>{g.demoCta}</span>
              <IconExternalLink size={13} />
            </a>
          </p>
        </section>
      </Reveal>
    </>
  );
}
