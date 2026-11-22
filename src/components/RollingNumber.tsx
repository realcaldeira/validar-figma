import { useEffect, useRef, useState } from 'react';

interface RollingNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  localeFormat?: boolean;
  rollOnMount?: boolean;
  fast?: boolean;
  className?: string;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function formatValue(value: number, decimals: number, localeFormat: boolean): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  if (localeFormat) {
    return rounded.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return decimals > 0 ? rounded.toFixed(decimals) : String(Math.round(rounded));
}

/** Rolagem vertical estilo odômetro para números vivos e KPIs. */
export function RollingNumber({
  value,
  decimals,
  prefix = '',
  suffix = '',
  localeFormat = false,
  rollOnMount = true,
  fast = false,
  className,
}: RollingNumberProps) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const resolvedDecimals = decimals ?? (Number.isInteger(safeValue) ? 0 : 1);
  const formatted = formatValue(safeValue, resolvedDecimals, localeFormat);
  const ref = useRef<HTMLSpanElement>(null);

  const [inView, setInView] = useState(
    () =>
      !rollOnMount ||
      prefersReducedMotion() ||
      typeof window === 'undefined' ||
      typeof IntersectionObserver === 'undefined',
  );

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

  const activeStr = inView ? formatted : formatted.replace(/[0-9]/g, '0');
  const chars = [...activeStr];
  const len = chars.length;

  return (
    <span
      ref={ref}
      className={`roll-num${fast ? ' fast' : ''}${className ? ` ${className}` : ''}`}
      aria-label={`${prefix}${formatted}${suffix}`}
    >
      {prefix && (
        <span className="roll-sep" aria-hidden="true">
          {prefix}
        </span>
      )}
      <span className="roll-digits" aria-hidden="true">
        {chars.map((ch, idx) => {
          const digit = ch >= '0' && ch <= '9' ? Number(ch) : null;
          if (digit === null) {
            return (
              <span key={`s-${len - idx}`} className="roll-sep">
                {ch}
              </span>
            );
          }
          return (
            <span key={`d-${len - idx}`} className="roll-digit">
              <span
                className="roll-strip"
                style={{
                  transform: `translate3d(0, -${digit * 10}%, 0)`,
                  transitionDelay: fast ? '0ms' : `${Math.min(idx * 28, 120)}ms`,
                }}
              >
                {DIGITS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
      {suffix && (
        <span className="roll-sep" aria-hidden="true">
          {suffix}
        </span>
      )}
    </span>
  );
}
