import { useEffect, useRef, useState } from 'react';

interface ScoreRingProps {
  score: number;
  tone: 'pass' | 'warn' | 'fail';
  size?: number;
  strokeWidth?: number;
}

const TONE_COLOR: Record<ScoreRingProps['tone'], string> = {
  pass: 'var(--success-vivid)',
  warn: 'var(--warning-vivid)',
  fail: 'var(--danger-vivid)',
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export function ScoreRing({ score, tone, size = 76, strokeWidth = 6.5 }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const decimals = Number.isInteger(clamped) ? 0 : 1;
  const ringRef = useRef<HTMLDivElement>(null);

  const [inView, setInView] = useState(
    () =>
      prefersReducedMotion() ||
      typeof window === 'undefined' ||
      typeof IntersectionObserver === 'undefined',
  );
  const [displayScore, setDisplayScore] = useState(() => (prefersReducedMotion() ? clamped : 0));
  const [complete, setComplete] = useState(() => prefersReducedMotion());
  const prevRef = useRef(prefersReducedMotion() ? clamped : 0);

  useEffect(() => {
    if (inView) return;
    const node = ringRef.current;
    if (!node) return;
    let rafId = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          rafId = requestAnimationFrame(() => setInView(true));
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(node);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [inView]);

  useEffect(() => {
    if (!inView) return;
    let rafId = 0;
    if (prefersReducedMotion()) {
      prevRef.current = clamped;
      rafId = requestAnimationFrame(() => {
        setDisplayScore(clamped);
        setComplete(true);
      });
      return () => cancelAnimationFrame(rafId);
    }

    const from = prevRef.current;
    if (from === clamped) {
      rafId = requestAnimationFrame(() => setComplete(true));
      return () => cancelAnimationFrame(rafId);
    }

    const duration = 660;
    const factor = decimals ? 10 : 1;

    const startAnimation = () => {
      const start = performance.now();
      setComplete(false);
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 4;
        const raw = from + (clamped - from) * eased;
        const next = t >= 1 ? clamped : Math.round(raw * factor) / factor;
        prevRef.current = next;
        setDisplayScore(next);
        if (t < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          setComplete(true);
        }
      };
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(startAnimation);
    return () => cancelAnimationFrame(rafId);
  }, [inView, clamped, decimals]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - displayScore / 100);
  const center = size / 2;
  const formatted = decimals ? displayScore.toFixed(1) : String(Math.round(displayScore));
  const isWideNumber = formatted.length >= 4;

  return (
    <div
      ref={ringRef}
      className={`score-ring ${tone}${complete ? ' is-complete' : ''}`}
      style={{ width: size, height: size }}
      aria-label={`${clamped}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(15, 23, 42, 0.09)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span className="score-ring-value" style={{ fontSize: isWideNumber ? 15 : 17 }}>
        {formatted}
        <small>%</small>
      </span>
    </div>
  );
}
