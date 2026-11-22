import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  delay?: number;
  decimals?: number;
  localeFormat?: boolean;
  startOnView?: boolean;
  className?: string;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function formatNumber(val: number, decimals: number, localeFormat: boolean): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(val * factor) / factor;
  if (localeFormat) {
    return rounded.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return decimals > 0 ? rounded.toFixed(decimals) : String(Math.round(rounded));
}

/** Anima números com interpolação suave ao entrar na tela ou mudar de valor. */
export function CountUp({
  value,
  prefix = '',
  suffix = '',
  duration = 560,
  delay = 0,
  decimals,
  localeFormat = false,
  startOnView = true,
  className,
}: CountUpProps) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const resolvedDecimals = decimals ?? (Number.isInteger(safeValue) ? 0 : 1);
  const ref = useRef<HTMLSpanElement>(null);

  const [inView, setInView] = useState(
    () =>
      !startOnView ||
      prefersReducedMotion() ||
      typeof window === 'undefined' ||
      typeof IntersectionObserver === 'undefined',
  );
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? safeValue : 0));
  const [counting, setCounting] = useState(false);
  const prevRef = useRef(prefersReducedMotion() ? safeValue : 0);

  useEffect(() => {
    if (inView) return;
    const node = ref.current;
    if (!node) return;
    let rafId = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          rafId = requestAnimationFrame(() => setInView(true));
        }
      },
      { threshold: 0.05 },
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
    let delayTimer = 0;

    if (prefersReducedMotion()) {
      prevRef.current = safeValue;
      rafId = requestAnimationFrame(() => {
        setDisplay(safeValue);
        setCounting(false);
      });
      return () => cancelAnimationFrame(rafId);
    }

    const from = prevRef.current;
    if (from === safeValue) {
      rafId = requestAnimationFrame(() => setCounting(false));
      return () => cancelAnimationFrame(rafId);
    }

    const safeDuration = Math.max(1, duration);
    const factor = 10 ** resolvedDecimals;

    const startAnimation = () => {
      const start = performance.now();
      setCounting(true);
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / safeDuration);
        const eased = 1 - (1 - t) ** 3;
        const raw = from + (safeValue - from) * eased;
        const next = t >= 1 ? safeValue : Math.round(raw * factor) / factor;
        prevRef.current = next;
        setDisplay(next);
        if (t < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          setCounting(false);
        }
      };
      rafId = requestAnimationFrame(step);
    };

    if (delay > 0) {
      delayTimer = window.setTimeout(startAnimation, delay);
    } else {
      rafId = requestAnimationFrame(startAnimation);
    }

    return () => {
      window.clearTimeout(delayTimer);
      cancelAnimationFrame(rafId);
    };
  }, [inView, safeValue, duration, delay, resolvedDecimals]);

  const displayFormatted = formatNumber(display, resolvedDecimals, localeFormat);
  const finalFormatted = formatNumber(safeValue, resolvedDecimals, localeFormat);

  return (
    <span
      ref={ref}
      className={`count-up${counting ? ' is-counting' : ''}${className ? ` ${className}` : ''}`}
      aria-label={`${prefix}${finalFormatted}${suffix}`}
    >
      <span aria-hidden="true">
        {prefix}
        {displayFormatted}
        {suffix}
      </span>
    </span>
  );
}
