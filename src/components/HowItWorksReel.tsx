import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useI18n } from '../i18n/useI18n.ts';
import {
  IconArrowRight,
  IconCheck,
  IconCheckCircle,
  IconCopy,
  IconFigmaColor,
  IconGlobe,
  IconLock,
  IconMaximize,
  IconMinimize,
  IconPause,
  IconPlay,
  IconRotateCcw,
  IconTerminal,
} from './Icons.tsx';
import './howItWorksReel.css';

const SCENE_MS = 6000;
const SCENE_COUNT = 6;
const TOTAL_MS = SCENE_MS * SCENE_COUNT;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function formatClock(ms: number): string {
  const sec = Math.min(TOTAL_MS / 1000, Math.max(0, Math.floor(ms / 1000)));
  return `0:${String(sec).padStart(2, '0')}`;
}

const FIGMA_URL_TEXT = 'https://figma.com/design/SAMPLEFILE.../UI-Kit?node-id=101-202';
const SCREEN_URL_TEXT = 'http://localhost:3000/releases';

function StageCursor({ x, y, pressed }: { x: number; y: number; pressed?: boolean }) {
  return (
    <div
      className={`reel-cursor${pressed ? ' pressed' : ''}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      aria-hidden="true"
    >
      <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
        <path
          d="M1.5 1.5L6.5 15.5L8.9 9.7L14.5 7.5L1.5 1.5Z"
          fill="#18181B"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function HowItWorksReel({ onJumpToForm }: { onJumpToForm?: () => void }) {
  const { t } = useI18n();
  const r = t.validate.reel;

  const [reducedMotion] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  const [playing, setPlaying] = useState(() => !reducedMotion);
  const [elapsedMs, setElapsedMs] = useState(() => (reducedMotion ? SCENE_MS * 3 + 700 : 0));
  const [speed, setSpeed] = useState<1 | 1.5>(1);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [inView, setInView] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [theater, setTheater] = useState(false);
  const [flash, setFlash] = useState<{ key: number; playing: boolean } | null>(null);

  const shellRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        setInView(entries.some((entry) => entry.isIntersecting));
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!theater) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setTheater(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [theater]);

  useEffect(() => {
    if (!playing || (!inView && !theater) || scrubbing) return;
    let rafId = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(80, Math.max(0, now - last));
      last = now;
      setElapsedMs((prev) => (prev + dt * speed) % TOTAL_MS);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, inView, theater, scrubbing, speed]);

  const ratioFromClientX = useCallback((clientX: number): number | null => {
    const track = trackRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return clamp01((clientX - rect.left) / rect.width);
  }, []);

  const seekToClientX = useCallback(
    (clientX: number) => {
      const ratio = ratioFromClientX(clientX);
      if (ratio === null) return;
      setElapsedMs(ratio * (TOTAL_MS - 40));
    },
    [ratioFromClientX],
  );

  const handleTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    seekToClientX(e.clientX);
  };

  const handleTrackPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ratio = ratioFromClientX(e.clientX);
    if (ratio !== null) setHoverRatio(ratio);
    if (scrubbing) seekToClientX(e.clientX);
  };

  const handleTrackPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    setScrubbing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleTrackKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setElapsedMs((prev) => (prev + 1250) % TOTAL_MS);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setElapsedMs((prev) => (prev - 1250 + TOTAL_MS) % TOTAL_MS);
    } else if (e.key === ' ') {
      e.preventDefault();
      setPlaying((v) => !v);
    }
  };

  const togglePlayFromStage = () => {
    setPlaying((cur) => {
      const next = !cur;
      setFlash((f) => ({ key: (f?.key ?? 0) + 1, playing: next }));
      return next;
    });
  };

  const jumpToChapter = (index: number) => {
    setElapsedMs(index * SCENE_MS + 160);
    if (!reducedMotion) setPlaying(true);
  };

  const jumpToEnginePillar = (pillarIndex: number) => {
    const offsets = [300, 1800, 3300, 4800];
    setElapsedMs(SCENE_MS * 3 + (offsets[pillarIndex] ?? 300));
  };

  const replay = () => {
    setElapsedMs(0);
    setPlaying(true);
  };

  const sceneIndex = Math.min(SCENE_COUNT - 1, Math.floor(elapsedMs / SCENE_MS));
  const p = clamp01((elapsedMs % SCENE_MS) / SCENE_MS);
  const chapter = r.chapters[sceneIndex];
  const subIndex = Math.min(2, Math.floor(p * 3));
  const currentSubtitle = chapter.subtitles[subIndex] ?? chapter.caption;

  const sceneEnter = easeOutCubic(clamp01(p / 0.1));
  const sceneExit = reducedMotion ? 1 : 1 - easeInOutCubic(clamp01((p - 0.92) / 0.08));
  const sceneOpacity = Math.min(sceneEnter, sceneExit);

  // Réguas arquitetônicas da mesa de luz
  const rulerXRange =
    sceneIndex === 0
      ? [18, 64]
      : sceneIndex === 1
        ? [8, 84]
        : sceneIndex === 2
          ? [6, 88]
          : sceneIndex === 3
            ? [10, 80]
            : sceneIndex === 4
              ? [12, 48]
              : [12, 76];
  const rulerYRange =
    sceneIndex === 0
      ? [16, 68]
      : sceneIndex === 1
        ? [10 + p * 60, 16]
        : sceneIndex === 2
          ? [14, 72]
          : sceneIndex === 3
            ? [14, 72]
            : sceneIndex === 4
              ? [16, 68]
              : [18, 64];

  // ===== ATO 01: Links =====
  const figmaTypedFrac = clamp01((p - 0.06) / 0.28);
  const figmaTyped = FIGMA_URL_TEXT.slice(0, Math.round(figmaTypedFrac * FIGMA_URL_TEXT.length));
  const figmaDone = p >= 0.34;
  const figmaTyping = p >= 0.06 && !figmaDone;

  const screenTypedFrac = clamp01((p - 0.38) / 0.22);
  const screenTyped = SCREEN_URL_TEXT.slice(0, Math.round(screenTypedFrac * SCREEN_URL_TEXT.length));
  const screenDone = p >= 0.6;
  const screenTyping = figmaDone && !screenDone;

  const c1Move1 = easeOutCubic(clamp01((p - 0.56) / 0.12));
  const c1Move2 = easeOutCubic(clamp01((p - 0.68) / 0.14));
  const c1CursorX = p < 0.68 ? lerp(28, 46, c1Move1) : lerp(46, 80, c1Move2);
  const c1CursorY = p < 0.68 ? lerp(36, 58, c1Move1) : lerp(58, 79, c1Move2);
  const c1Pressed = p >= 0.83 && p < 0.9;

  // ===== ATO 02: Chrome headless isolado + DevTools (CDP) + 4 esperas =====
  const scanProg = easeInOutCubic(clamp01((p - 0.12) / 0.72));
  const scanY = lerp(8, 90, scanProg);
  const cmd1 = p >= 0.08;
  const cmd2 = p >= 0.25;
  const cmd3 = p >= 0.56;
  const cmd4 = p >= 0.78;
  const wait1 = p >= 0.18;
  const wait2 = p >= 0.34;
  const wait3 = p >= 0.52;
  const wait4 = p >= 0.68;

  // ===== ATO 03: Login SSO humano + trava cross-origin =====
  const ssoStage1 = p >= 0.06;
  const ssoStage2 = p >= 0.32;
  const ssoStage3 = p >= 0.64;
  const pwdChars = Math.round(clamp01((p - 0.38) / 0.22) * 8);

  // ===== ATO 04: Bancada Microscópio do Motor 100% =====
  const engStep = p < 0.26 ? 0 : p < 0.52 ? 1 : p < 0.76 ? 2 : 3;
  const engSubP =
    engStep === 0
      ? clamp01(p / 0.26)
      : engStep === 1
        ? clamp01((p - 0.26) / 0.26)
        : engStep === 2
          ? clamp01((p - 0.52) / 0.24)
          : clamp01((p - 0.76) / 0.24);

  const engDeltaE = lerp(2.6, 0.2, easeOutCubic(clamp01(engSubP / 0.62)));
  const engSpacingPx = lerp(18.5, 24.0, easeOutCubic(clamp01(engSubP / 0.65)));
  const engIouPct = Math.round(lerp(72, 94, easeOutCubic(clamp01(engSubP / 0.62))));
  const engBoxShift = lerp(12, 0, easeOutCubic(clamp01(engSubP / 0.62)));

  const enginePillars = [
    { num: '01', label: r.engineScene.railColor },
    { num: '02', label: r.engineScene.railSpacing },
    { num: '03', label: r.engineScene.railMatch },
    { num: '04', label: r.engineScene.railBidir },
  ];

  // ===== ATO 04: Cortina Lado a Lado + Inspector =====
  const wipeFirst = easeInOutCubic(clamp01((p - 0.06) / 0.22));
  const wipeBack = easeInOutCubic(clamp01((p - 0.28) / 0.24));
  const splitPct = p < 0.28 ? lerp(80, 18, wipeFirst) : lerp(18, 52, wipeBack);
  const pin1Visible = p >= 0.18;
  const pin2Visible = p >= 0.32;
  const pin3Visible = p >= 0.44;
  const diffActive = p >= 0.5;

  // ===== ATO 05: CSS Fix + Nota 100% =====
  const c5Move = easeOutCubic(clamp01((p - 0.05) / 0.18));
  const c5CursorX = lerp(32, 82, c5Move);
  const c5CursorY = lerp(62, 17, c5Move);
  const c5Pressed = p >= 0.23 && p < 0.29;
  const c5Copied = p >= 0.25;
  const codeScanLine = Math.floor(lerp(1, 5, clamp01(p / 0.34)));
  const fixMorph = easeOutCubic(clamp01((p - 0.36) / 0.38));
  const scoreValue = Math.round(lerp(78, 100, fixMorph));
  const ringCircumference = 2 * Math.PI * 40;
  const ringOffset = ringCircumference * (1 - scoreValue / 100);
  const checksCount = Math.round(lerp(28, 34, fixMorph));
  const check1Fixed = p >= 0.42;
  const check2Fixed = p >= 0.52;
  const check3Fixed = p >= 0.62;
  const allFixed = p >= 0.74;

  const hoverMs = hoverRatio !== null ? hoverRatio * TOTAL_MS : 0;
  const hoverScene = Math.min(SCENE_COUNT - 1, Math.floor(hoverMs / SCENE_MS));

  const playerBody = (
    <div className={`reel-frame${theater ? ' is-theater' : ''}`}>
      <div className="reel-topbar">
        <div className="reel-topbar-left">
          <span className="reel-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="reel-act-pill">
            <span className="reel-act-num">{chapter.num} / 06</span>
            <span>{chapter.label}</span>
          </span>
        </div>

        <div className="reel-topbar-right">
          {playing && (
            <span className="reel-live-badge">
              <span className="reel-live-dot" aria-hidden="true" />
              <span>{r.liveBadge}</span>
            </span>
          )}
          <span className="reel-timecode">{formatClock(elapsedMs)} / 0:36</span>
          <button
            type="button"
            className="reel-icon-top-btn"
            aria-label={theater ? r.theaterClose : r.theaterOpen}
            title={theater ? r.theaterClose : r.theaterOpen}
            onClick={() => setTheater((v) => !v)}
          >
            {theater ? <IconMinimize size={13} /> : <IconMaximize size={13} />}
          </button>
        </div>
      </div>

      <div
        className="reel-stage-wrap"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, [role="tab"]')) return;
          togglePlayFromStage();
        }}
      >
        {/* Réguas arquitetônicas */}
        <div className="reel-ruler-top" aria-hidden="true">
          <div
            className="reel-ruler-band-x"
            style={{ left: `${rulerXRange[0]}%`, width: `${rulerXRange[1]}%` }}
          />
          {[0, 320, 640, 960, 1280].map((mark) => (
            <span key={mark}>{mark}</span>
          ))}
        </div>

        <div className="reel-ruler-left" aria-hidden="true">
          <div
            className="reel-ruler-band-y"
            style={{ top: `${rulerYRange[0]}%`, height: `${rulerYRange[1]}%` }}
          />
          {[0, 160, 320, 480].map((mark) => (
            <span key={mark}>{mark}</span>
          ))}
        </div>

        <div className="reel-stage">
          {/* ===== ATO 01: Colar links ===== */}
          {sceneIndex === 0 && (
            <div key="scene-0" className="reel-scene" style={{ opacity: sceneOpacity }}>
              <div className="reel-s1-card">
                <div className="reel-card-head">
                  <div className="reel-card-title">
                    <span className="reel-square-mark" aria-hidden="true" />
                    <span>{r.scene1.windowTitle}</span>
                  </div>
                  <span className="reel-mono-tag">FIGMA + URL</span>
                </div>

                <div className="reel-field-stack">
                  <div className={`reel-input-box${figmaTyping ? ' active' : ''}`}>
                    <div className="reel-input-label-row">
                      <span className="reel-input-label">
                        <IconFigmaColor size={13} />
                        {r.scene1.figmaField}
                      </span>
                      {figmaDone && <span className="reel-badge pass">{r.scene1.parsedOk}</span>}
                    </div>
                    <div className="reel-input-value">
                      <span>{figmaTyped}</span>
                      {figmaTyping && <span className="reel-caret" aria-hidden="true" />}
                    </div>
                  </div>

                  <div className={`reel-input-box${screenTyping ? ' active' : ''}`}>
                    <div className="reel-input-label-row">
                      <span className="reel-input-label">
                        <IconGlobe size={13} />
                        {r.scene1.screenField}
                      </span>
                      {screenDone && <span className="reel-badge pass">{r.scene1.screenLive}</span>}
                    </div>
                    <div className="reel-input-value">
                      <span>{screenTyped}</span>
                      {screenTyping && <span className="reel-caret" aria-hidden="true" />}
                    </div>
                  </div>
                </div>

                <div className="reel-zero-auth-pill">
                  <IconCheckCircle size={13} />
                  <span>{r.scene1.zeroAuthBadge}</span>
                </div>

                <div className="reel-s1-footer">
                  <span className="reel-mono-muted">1440 × 1200 · 1x desktop</span>
                  <span className={`reel-cta-mock${c1Pressed ? ' pressed' : ''}`}>{r.scene1.cta}</span>
                </div>

                <StageCursor x={c1CursorX} y={c1CursorY} pressed={c1Pressed} />
              </div>
            </div>
          )}

          {/* ===== ATO 02: Chrome headless isolado + CDP + 4 esperas ===== */}
          {sceneIndex === 1 && (
            <div key="scene-1" className="reel-scene" style={{ opacity: sceneOpacity }}>
              <div className="reel-pipe-grid">
                <div className="reel-panel-card">
                  <div className="reel-card-head">
                    <span className="reel-card-title">
                      <IconTerminal size={13} />
                      <span>{r.chromeScene.serverTitle}</span>
                    </span>
                    <span className="reel-mono-tag">{r.chromeScene.cdpEndpoint}</span>
                  </div>

                  <div className="reel-profile-box">
                    <div className="reel-profile-head">
                      <span className="reel-badge pass">{r.chromeScene.profileBadge}</span>
                    </div>
                    <span className="reel-profile-note">{r.chromeScene.isolationNote}</span>
                  </div>

                  <div className="reel-cdp-list">
                    {[
                      { lit: cmd1, label: r.chromeScene.commands[0] },
                      { lit: cmd2, label: r.chromeScene.commands[1] },
                      { lit: cmd3, label: r.chromeScene.commands[2] },
                      { lit: cmd4, label: r.chromeScene.commands[3] },
                    ].map((cmd, idx) => (
                      <div key={cmd.label} className={`reel-cdp-row${cmd.lit ? ' lit' : ''}`}>
                        <span className="reel-cdp-idx">0{idx + 1}</span>
                        <code>{cmd.label}</code>
                        {cmd.lit && <IconCheck size={12} />}
                      </div>
                    ))}
                  </div>

                  <div className="reel-panel-foot">
                    <span>{r.chromeScene.cdpTitle}</span>
                    <strong>{r.chromeScene.autoShutdown}</strong>
                  </div>
                </div>

                <div className="reel-panel-card">
                  <div className="reel-card-head">
                    <span className="reel-card-title">
                      <IconGlobe size={13} />
                      <span>{r.chromeScene.viewportTitle}</span>
                    </span>
                    <span className="reel-mono-tag">1x · DPR 1</span>
                  </div>

                  <div className="reel-dom-viewport">
                    <div className="reel-dom-bar">
                      <span className="reel-dom-title">Upcoming Releases</span>
                      <span className="reel-dom-btn">New Release</span>
                    </div>
                    <div className="reel-dom-list">
                      <div className="reel-dom-item">
                        <span>Checkout Flow</span>
                        <span className="reel-badge pass">Ready</span>
                      </div>
                      <div className="reel-dom-item">
                        <span>Billing Portal</span>
                        <span className="reel-badge warn">Review</span>
                      </div>
                    </div>

                    {cmd3 && (
                      <div className="reel-scan-line" style={{ top: `${scanY}%` }} aria-hidden="true">
                        <span className="reel-scan-tag">validator.js · {Math.round(scanY * 12)}px</span>
                      </div>
                    )}
                  </div>

                  <div className="reel-wait-block">
                    <div className="reel-wait-title">{r.chromeScene.waitTitle}</div>
                    <div className="reel-wait-grid">
                      {[
                        { done: wait1, label: r.chromeScene.waits[0] },
                        { done: wait2, label: r.chromeScene.waits[1] },
                        { done: wait3, label: r.chromeScene.waits[2] },
                        { done: wait4, label: r.chromeScene.waits[3] },
                      ].map((w) => (
                        <div key={w.label} className={`reel-wait-pill${w.done ? ' done' : ''}`}>
                          <span>{w.done ? '✓' : '·'}</span>
                          <span>{w.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== ATO 03: Login SSO humano + trava cross-origin ===== */}
          {sceneIndex === 2 && (
            <div key="scene-2" className="reel-scene" style={{ opacity: sceneOpacity }}>
              <div className="reel-engine-shell">
                <div className="reel-sso-grid">
                  <div className={`reel-panel-card reel-sso-card${ssoStage1 ? ' lit' : ''}`}>
                    <div className="reel-card-head">
                      <span className="reel-mono-tag">{r.loginScene.col1Tag}</span>
                      <span className="reel-badge warn">SSO</span>
                    </div>
                    <div className="reel-sso-visual">
                      <div className="reel-sso-url">/app → /sso/login</div>
                      <div className="reel-sso-form-mock">
                        <span>Sign in required</span>
                        <span className="reel-sso-bar" />
                      </div>
                    </div>
                    <strong className="reel-sso-title">{r.loginScene.col1Title}</strong>
                    <p className="reel-sso-body">{r.loginScene.col1Body}</p>
                  </div>

                  <div className={`reel-panel-card reel-sso-card${ssoStage2 ? ' lit' : ''}`}>
                    <div className="reel-card-head">
                      <span className="reel-mono-tag">{r.loginScene.col2Tag}</span>
                      <span className={`reel-badge${pwdChars >= 8 ? ' pass' : ''}`}>.chrome-profile</span>
                    </div>
                    <div className="reel-sso-visual">
                      <div className="reel-sso-url">Window: visible · Login</div>
                      <div className="reel-sso-pwd-box">
                        <span>{'•'.repeat(pwdChars)}</span>
                        {ssoStage2 && pwdChars < 8 && <span className="reel-caret" aria-hidden="true" />}
                      </div>
                    </div>
                    <strong className="reel-sso-title">{r.loginScene.col2Title}</strong>
                    <p className="reel-sso-body">{r.loginScene.col2Body}</p>
                  </div>

                  <div className={`reel-panel-card reel-sso-card${ssoStage3 ? ' lit' : ''}`}>
                    <div className="reel-card-head">
                      <span className="reel-mono-tag">{r.loginScene.col3Tag}</span>
                      <IconLock size={13} />
                    </div>
                    <div className="reel-sso-visual">
                      <div className="reel-lock-row">
                        <span>site-externo.app</span>
                        <span className="reel-badge fail">403 Blocked</span>
                      </div>
                      <div className="reel-lock-row">
                        <span>localhost (app)</span>
                        <span className="reel-badge pass">200 OK</span>
                      </div>
                    </div>
                    <strong className="reel-sso-title">{r.loginScene.col3Title}</strong>
                    <p className="reel-sso-body">{r.loginScene.col3Body}</p>
                  </div>
                </div>

                <div className="reel-floor-bar">
                  <span className="reel-floor-lock">LOCAL</span>
                  <span className="reel-floor-text">{r.loginScene.reqsBar}</span>
                </div>
              </div>
            </div>
          )}

          {/* ===== ATO 04: Bancada Microscópio do Motor 100% ===== */}
          {sceneIndex === 3 && (
            <div key="scene-3" className="reel-scene" style={{ opacity: sceneOpacity }}>
              <div className="reel-engine-shell">
                <div className="reel-engine-layout">
                  <div className="reel-engine-rail" role="tablist" aria-label={r.chapters[3].label}>
                    {enginePillars.map((pillar, idx) => {
                      const active = idx === engStep;
                      const done = idx < engStep;
                      return (
                        <button
                          key={pillar.num}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={`reel-rail-btn${active ? ' active' : ''}${done ? ' done' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            jumpToEnginePillar(idx);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                            }
                          }}
                        >
                          <span className="reel-rail-num">{pillar.num}</span>
                          <span className="reel-rail-label">{pillar.label}</span>
                          {done && <IconCheck size={12} />}
                          {active && (
                            <span
                              className="reel-rail-fill"
                              style={{ width: `${engSubP * 100}%` }}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="reel-engine-stage">
                    {engStep === 0 && (
                      <div className="reel-micro-pane">
                        <div className="reel-micro-head">
                          <strong>{r.engineScene.colorTitle}</strong>
                          <span className={`reel-badge${engDeltaE <= 0.5 ? ' pass' : ' warn'}`}>
                            ΔE {engDeltaE.toFixed(1)}
                          </span>
                        </div>
                        <p className="reel-micro-sub">{r.engineScene.colorSub}</p>

                        <div className="reel-alpha-eq">
                          <span className="reel-swatch-chip">
                            <span className="reel-swatch" style={{ background: '#f3f3ef' }} />
                            <code>#F3F3EF</code>
                          </span>
                          <span className="reel-eq-op">+</span>
                          <span className="reel-swatch-chip">
                            <span className="reel-swatch" style={{ background: 'rgba(13, 153, 255, 0.8)' }} />
                            <code>80%</code>
                          </span>
                          <span className="reel-eq-op">=</span>
                          <span className="reel-swatch-chip strong">
                            <span className="reel-swatch" style={{ background: '#3baeff' }} />
                            <code>#3BAEFF</code>
                          </span>
                        </div>

                        <div className="reel-de-ruler">
                          <div className="reel-de-track">
                            <div className="reel-de-pass-zone" />
                            <div
                              className="reel-de-marker"
                              style={{ left: `${clamp01(engDeltaE / 12) * 100}%` }}
                            />
                          </div>
                          <div className="reel-de-scale">
                            <span>0.0</span>
                            <span>0.5 limit</span>
                            <span>11.4 fail</span>
                          </div>
                        </div>

                        <div className="reel-micro-foot">
                          <span className="reel-badge pass">{r.engineScene.colorFloor}</span>
                        </div>
                      </div>
                    )}

                    {engStep === 1 && (
                      <div className="reel-micro-pane">
                        <div className="reel-micro-head">
                          <strong>{r.engineScene.spacingTitle}</strong>
                          <span className={`reel-badge${engSpacingPx >= 23.95 ? ' pass' : ''}`}>
                            {engSpacingPx.toFixed(1)}px
                          </span>
                        </div>
                        <p className="reel-micro-sub">{r.engineScene.spacingSub}</p>

                        <div className="reel-caliper-diagram">
                          <div className="reel-caliper-top-edge">box-edge (y = 0)</div>
                          <div
                            className="reel-caliper-stem"
                            style={{ height: `${lerp(20, 32, clamp01(engSubP / 0.65))}px` }}
                          >
                            <span className="reel-caliper-readout">{engSpacingPx.toFixed(1)}px</span>
                          </div>
                          <div className="reel-caliper-optical-line">
                            <span>Upcoming Releases</span>
                          </div>
                        </div>

                        <div className="reel-micro-foot">
                          <div className="reel-css-compare">
                            <code>{r.engineScene.spacingCssA}</code>
                            <span>≈</span>
                            <code>{r.engineScene.spacingCssB}</code>
                          </div>
                          <span className={`reel-badge${engSpacingPx >= 23.95 ? ' pass' : ''}`}>
                            {r.engineScene.spacingEqual}
                          </span>
                        </div>
                      </div>
                    )}

                    {engStep === 2 && (
                      <div className="reel-micro-pane">
                        <div className="reel-micro-head">
                          <strong>{r.engineScene.matchTitle}</strong>
                          <span className={`reel-badge${engIouPct >= 90 ? ' pass' : ''}`}>
                            IoU {engIouPct}%
                          </span>
                        </div>
                        <p className="reel-micro-sub">{r.engineScene.matchSub}</p>

                        <div className="reel-iou-bench">
                          <div className="reel-iou-box-wrap">
                            <span className="reel-iou-figma">Figma · 320×44</span>
                            <span
                              className="reel-iou-dom"
                              style={{ transform: `translate(${engBoxShift}px, ${engBoxShift * 0.6}px)` }}
                            >
                              DOM · 320×44
                            </span>
                          </div>
                          <span className={`reel-badge${engIouPct >= 90 ? ' pass' : ''}`}>
                            {r.engineScene.matchConfirm}
                          </span>
                        </div>

                        <div className="reel-micro-foot">
                          <span className="reel-mono-muted">withoutNumbers()</span>
                          <span className="reel-badge warn">{r.engineScene.matchSampleWarn}</span>
                        </div>
                      </div>
                    )}

                    {engStep === 3 && (
                      <div className="reel-micro-pane">
                        <div className="reel-micro-head">
                          <strong>{r.engineScene.bidirTitle}</strong>
                          <span className="reel-mono-tag">Figma ↔ Tela</span>
                        </div>
                        <p className="reel-micro-sub">{r.engineScene.bidirSub}</p>

                        <div className="reel-bidir-table">
                          <div className="reel-bidir-row">
                            <span className="reel-bidir-dir">Figma → Tela</span>
                            <span className="reel-mono-muted">Primary Action</span>
                            <span className="reel-badge fail">{r.engineScene.bidirMissing}</span>
                          </div>
                          <div className="reel-bidir-row">
                            <span className="reel-bidir-dir">Tela → Figma</span>
                            <span className="reel-mono-muted">+ Export JSON</span>
                            <span className="reel-badge warn">{r.engineScene.bidirExtra}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="reel-floor-bar">
                  <span className="reel-floor-lock">100%</span>
                  <span className="reel-floor-text">{r.engineScene.floorBar}</span>
                </div>
              </div>
            </div>
          )}

          {/* ===== ATO 05: Lado a lado + Inspector ===== */}
          {sceneIndex === 4 && (
            <div key="scene-4" className="reel-scene" style={{ opacity: sceneOpacity }}>
              <div className="reel-split-layout">
                <div className="reel-panel-card">
                  <div className="reel-card-head">
                    <span className="reel-mono-tag">{r.scene3.figmaPanel}</span>
                    <span className="reel-badge fail">{r.scene3.pixelDiffTag}</span>
                    <span className="reel-mono-tag">{r.scene3.screenPanel}</span>
                  </div>

                  <div className="reel-split-viewport">
                    {/* Camada inferior: Tela construída */}
                    <div className="reel-sv-layer is-screen">
                      <div className="reel-sv-header">
                        <div>
                          <div className="reel-sv-title">Upcoming Releases</div>
                          <div className="reel-sv-sub">v2.4 · 12 tasks</div>
                        </div>
                        <span className={`reel-sv-btn screen${diffActive ? ' highlight' : ''}`}>
                          New Release
                        </span>
                      </div>
                      <div className="reel-sv-rows">
                        <div className="reel-sv-row">
                          <span>Checkout Flow</span>
                          <span className="reel-badge pass">Ready</span>
                        </div>
                        <div className="reel-sv-row">
                          <span>Billing Portal</span>
                          <span className="reel-badge warn">Review</span>
                        </div>
                      </div>
                    </div>

                    {/* Camada superior recortada: Figma oficial */}
                    <div
                      className="reel-sv-layer is-figma"
                      style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
                    >
                      <div className="reel-sv-header">
                        <div>
                          <div className="reel-sv-title">Upcoming Releases</div>
                          <div className="reel-sv-sub">v2.4 · 12 tasks</div>
                        </div>
                        <span className="reel-sv-btn figma">New Release</span>
                      </div>
                      <div className="reel-sv-rows">
                        <div className="reel-sv-row">
                          <span>Checkout Flow</span>
                          <span className="reel-badge pass">Ready</span>
                        </div>
                        <div className="reel-sv-row">
                          <span>Billing Portal</span>
                          <span className="reel-badge warn">Review</span>
                        </div>
                      </div>
                    </div>

                    <div className="reel-sv-divider" style={{ left: `${splitPct}%` }} aria-hidden="true">
                      <span className="reel-sv-knob" />
                    </div>

                    {pin1Visible && <span className="reel-pin" style={{ left: '26%', top: '24%' }}>1</span>}
                    {pin2Visible && <span className="reel-pin active" style={{ left: '78%', top: '25%' }}>2</span>}
                    {pin3Visible && <span className="reel-pin" style={{ left: '78%', top: '68%' }}>3</span>}
                  </div>
                </div>

                <aside className="reel-panel-card">
                  <div className="reel-card-head">
                    <span className="reel-card-title">{r.scene3.inspectorTitle}</span>
                    <span className="reel-badge fail">{r.scene3.diffBadge}</span>
                  </div>

                  <div className="reel-diff-list">
                    <div className="reel-diff-row">
                      <span className="reel-diff-prop">{r.scene3.colorLabel}</span>
                      <div className="reel-diff-pair">
                        <code>#18181B</code>
                        <span>→</span>
                        <code className="err">#3B82F6</code>
                        <span className="reel-mono-muted">ΔE 11.4</span>
                      </div>
                    </div>
                    <div className="reel-diff-row">
                      <span className="reel-diff-prop">{r.scene3.radiusLabel}</span>
                      <div className="reel-diff-pair">
                        <code>10px</code>
                        <span>→</span>
                        <code className="err">4px</code>
                      </div>
                    </div>
                    <div className="reel-diff-row">
                      <span className="reel-diff-prop">{r.scene3.fontLabel}</span>
                      <div className="reel-diff-pair">
                        <code>600</code>
                        <span>→</span>
                        <code className="err">500</code>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          )}

          {/* ===== ATO 06: CSS Fix + Nota 100% ===== */}
          {sceneIndex === 5 && (
            <div key="scene-5" className="reel-scene" style={{ opacity: sceneOpacity }}>
              <div className="reel-fix-grid">
                <div className="reel-panel-card reel-code-panel">
                  <div className="reel-card-head">
                    <span className="reel-card-title">{r.scene4.fixTitle}</span>
                    <span className={`reel-copy-btn${c5Pressed ? ' pressed' : ''}${c5Copied ? ' copied' : ''}`}>
                      {c5Copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                      <span>{c5Copied ? r.scene4.copiedBtn : r.scene4.copyBtn}</span>
                    </span>
                  </div>

                  <pre className="reel-code-block">
                    <div className={`reel-code-line${codeScanLine === 1 ? ' active' : ''}`}>
                      <span className="ln">1</span>
                      <span>{`.btn-primary {`}</span>
                    </div>
                    <div className={`reel-code-line${codeScanLine === 2 ? ' active' : ''}`}>
                      <span className="ln">2</span>
                      <span>{`  background: #18181b;`}</span>
                    </div>
                    <div className={`reel-code-line${codeScanLine === 3 ? ' active' : ''}`}>
                      <span className="ln">3</span>
                      <span>{`  border-radius: 10px;`}</span>
                    </div>
                    <div className={`reel-code-line${codeScanLine === 4 ? ' active' : ''}`}>
                      <span className="ln">4</span>
                      <span>{`  font-weight: 600;`}</span>
                    </div>
                    <div className="reel-code-line">
                      <span className="ln">5</span>
                      <span>{`}`}</span>
                    </div>
                  </pre>

                  <StageCursor x={c5CursorX} y={c5CursorY} pressed={c5Pressed} />
                </div>

                <div className="reel-panel-card reel-result-panel">
                  <div className="reel-card-head">
                    <span className="reel-mono-tag">
                      {allFixed ? r.scene4.afterLabel : r.scene4.beforeLabel}
                    </span>
                    <span
                      className={`reel-preview-btn${allFixed ? ' fixed' : ''}`}
                      style={{
                        borderRadius: `${lerp(4, 10, fixMorph)}px`,
                        background: allFixed ? '#18181b' : fixMorph > 0.5 ? '#27272a' : '#3b82f6',
                        fontWeight: fixMorph > 0.5 ? 600 : 500,
                      }}
                    >
                      New Release
                    </span>
                  </div>

                  <div className="reel-result-body">
                    <div className="reel-score-ring">
                      <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
                        <circle
                          cx="48"
                          cy="48"
                          r="40"
                          fill="none"
                          stroke="#e6e6e0"
                          strokeWidth="7"
                        />
                        <circle
                          cx="48"
                          cy="48"
                          r="40"
                          fill="none"
                          stroke={scoreValue === 100 ? '#0b875b' : '#18181b'}
                          strokeWidth="7"
                          strokeLinecap="round"
                          strokeDasharray={ringCircumference}
                          strokeDashoffset={ringOffset}
                          transform="rotate(-90 48 48)"
                        />
                      </svg>
                      <span className="reel-score-num">{scoreValue}%</span>
                    </div>

                    <div className="reel-check-list">
                      <div className={`reel-check-row${check1Fixed ? ' pass' : ''}`}>
                        <span>{check1Fixed ? '✓' : '✕'}</span>
                        <span>background: #18181B</span>
                      </div>
                      <div className={`reel-check-row${check2Fixed ? ' pass' : ''}`}>
                        <span>{check2Fixed ? '✓' : '✕'}</span>
                        <span>border-radius: 10px</span>
                      </div>
                      <div className={`reel-check-row${check3Fixed ? ' pass' : ''}`}>
                        <span>{check3Fixed ? '✓' : '✕'}</span>
                        <span>font-weight: 600</span>
                      </div>
                    </div>
                  </div>

                  <div className="reel-panel-foot">
                    <span className={`reel-badge${allFixed ? ' pass' : ''}`}>
                      {allFixed ? r.scene4.perfectBadge : r.scene4.appliedBadge}
                    </span>
                    <strong>
                      {checksCount}/34 {r.scene4.checksOk.replace(/^\d+\/\d+\s*/, '')}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {flash && (
            <div key={flash.key} className="reel-stage-flash" aria-hidden="true">
              {flash.playing ? <IconPlay size={20} /> : <IconPause size={20} />}
            </div>
          )}
        </div>
      </div>

      {/* Faixa fixa dedicada abaixo do palco: 0% sobreposição */}
      <div className="reel-caption-bar">
        {showSubtitles && (
          <div key={`${sceneIndex}-${subIndex}`} className="reel-subtitle-strip" aria-live="polite">
            <span className="reel-cc-tag">CC</span>
            <span className="reel-cc-text">{currentSubtitle}</span>
          </div>
        )}
        <div className="reel-caption-main">
          <span className="reel-caption-num">{chapter.num}</span>
          <div className="reel-caption-copy">
            <strong>{chapter.headline}</strong>
            <span>{chapter.caption}</span>
          </div>
        </div>
      </div>

      {/* Controles + Scrubber */}
      <div className="reel-controls">
        <div className="reel-ctrl-left">
          <button
            type="button"
            className="reel-ctrl-btn primary"
            aria-label={playing ? r.pauseLabel : r.playLabel}
            title={playing ? r.pauseLabel : r.playLabel}
            onClick={() => setPlaying((v) => !v)}
          >
            {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
          </button>
          <button
            type="button"
            className="reel-ctrl-btn"
            aria-label={r.replayLabel}
            title={r.replayLabel}
            onClick={replay}
          >
            <IconRotateCcw size={14} />
          </button>
          <button
            type="button"
            className="reel-speed-btn"
            onClick={() => setSpeed((s) => (s === 1 ? 1.5 : 1))}
          >
            {speed}×
          </button>
          <button
            type="button"
            className={`reel-cc-btn${showSubtitles ? ' active' : ''}`}
            aria-pressed={showSubtitles}
            aria-label={showSubtitles ? r.subtitlesOn : r.subtitlesOff}
            title={showSubtitles ? r.subtitlesOn : r.subtitlesOff}
            onClick={() => setShowSubtitles((v) => !v)}
          >
            CC
          </button>
        </div>

        <div
          ref={trackRef}
          className="reel-scrubber"
          role="slider"
          tabIndex={0}
          aria-label={r.scrubberLabel}
          aria-valuemin={0}
          aria-valuemax={36}
          aria-valuenow={Math.round(elapsedMs / 1000)}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={handleTrackPointerUp}
          onPointerLeave={() => {
            setScrubbing(false);
            setHoverRatio(null);
          }}
          onKeyDown={handleTrackKeyDown}
        >
          {hoverRatio !== null && (
            <div
              className="reel-scrub-tooltip"
              style={{ left: `${hoverRatio * 100}%` }}
              aria-hidden="true"
            >
              <span className="reel-scrub-tt-time">{formatClock(hoverMs)}</span>
              <span>
                {r.chapters[hoverScene].num} · {r.chapters[hoverScene].label}
              </span>
            </div>
          )}

          {r.chapters.map((ch, idx) => {
            const segStart = idx * SCENE_MS;
            const segEnd = segStart + SCENE_MS;
            const segFill = clamp01((elapsedMs - segStart) / (segEnd - segStart));
            return (
              <div key={ch.num} className="reel-scrub-seg">
                <div className="reel-scrub-fill" style={{ width: `${segFill * 100}%` }} />
              </div>
            );
          })}
          <span
            className="reel-scrub-thumb"
            aria-hidden="true"
            style={{ left: `${clamp01(elapsedMs / TOTAL_MS) * 100}%` }}
          />
        </div>
      </div>

      {/* 6 capítulos limpos */}
      <div className="reel-chapters">
        {r.chapters.map((ch, idx) => {
          const active = idx === sceneIndex;
          const segFill = clamp01((elapsedMs - idx * SCENE_MS) / SCENE_MS);
          return (
            <button
              key={ch.num}
              type="button"
              className={`reel-chapter-btn${active ? ' active' : ''}`}
              onClick={() => jumpToChapter(idx)}
            >
              <span
                className="reel-chapter-progress"
                style={{ width: `${segFill * 100}%` }}
                aria-hidden="true"
              />
              <span className="reel-chapter-num">{ch.num}</span>
              <span className="reel-chapter-label">{ch.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <section ref={shellRef} className="reel-shell" aria-label={r.title}>
      <div className="reel-header">
        <div className="reel-header-copy">
          <div className="reel-eyebrow">
            <span className="reel-eyebrow-mark" aria-hidden="true" />
            <span>{r.eyebrow}</span>
          </div>
          <h2>{r.title}</h2>
          <p>{r.subtitle}</p>
        </div>

        <div className="reel-header-actions">
          <button
            type="button"
            className="btn secondary small"
            onClick={() => setTheater((v) => !v)}
          >
            <IconMaximize size={13} />
            <span>{r.theaterOpen}</span>
          </button>
          {onJumpToForm && (
            <button type="button" className="btn small reel-jump-btn" onClick={onJumpToForm}>
              <span>{r.jumpToForm}</span>
              <IconArrowRight size={14} className="reel-jump-arrow" />
            </button>
          )}
        </div>
      </div>

      {theater ? (
        <div
          className="reel-theater-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={r.title}
          onClick={(e) => {
            if (e.target === e.currentTarget) setTheater(false);
          }}
        >
          <div className="reel-theater-dialog">{playerBody}</div>
        </div>
      ) : (
        playerBody
      )}
    </section>
  );
}
