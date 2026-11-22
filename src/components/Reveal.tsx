import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

const canSkipReveal = () =>
  typeof window === 'undefined' ||
  typeof IntersectionObserver === 'undefined' ||
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Revela blocos conforme entram na viewport, respeitando prefers-reduced-motion. */
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const [visible, setVisible] = useState(() => canSkipReveal());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.04, rootMargin: '0px 0px -20px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div
      ref={ref}
      className={`reveal${visible ? ' is-visible' : ''}${className ? ` ${className}` : ''}`}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
