import type { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

const baseProps = (size: number, className?: string, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  className,
  style,
});

export function IconFigma({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M9 3h3v6H9a3 3 0 0 1 0-6Z" />
      <path d="M12 3h3a3 3 0 0 1 0 6h-3V3Z" />
      <path d="M12 9h3a3 3 0 1 1-3 3V9Z" />
      <path d="M9 9h3v6H9a3 3 0 0 1 0-6Z" />
      <path d="M9 15h3v3a3 3 0 1 1-3-3Z" />
    </svg>
  );
}

export function IconFigmaColor({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} style={style}>
      <path d="M9 3h3v6H9a3 3 0 0 1 0-6Z" fill="#F24E1E" />
      <path d="M12 3h3a3 3 0 0 1 0 6h-3V3Z" fill="#FF7262" />
      <path d="M9 9h3v6H9a3 3 0 0 1 0-6Z" fill="#A259FF" />
      <circle cx="15" cy="12" r="3" fill="#1ABCFE" />
      <path d="M9 15h3v3a3 3 0 1 1-3-3Z" fill="#0ACF83" />
    </svg>
  );
}

export function IconGlobe({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

export function IconSparkles({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      <path d="M5 16l.6 1.4L7 18l-1.4.6L5 20l-.6-1.4L3 18l1.4-.6L5 16Z" />
    </svg>
  );
}

export function IconLayers({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </svg>
  );
}

export function IconColumns({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </svg>
  );
}

export function IconSplit({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 2v20" />
      <path d="m9 12-2 0" />
      <path d="m17 12-2 0" />
    </svg>
  );
}

export function IconGrid({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconImage({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 16-5-5-5 5-2-2-6 6" />
    </svg>
  );
}

export function IconCheck({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function IconCheckCircle({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M10.3 3.9 2.4 17.5A1.8 1.8 0 0 0 4 20h16a1.8 1.8 0 0 0 1.6-2.5L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

export function IconXCircle({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6" />
      <path d="m15 9-6 6" />
    </svg>
  );
}

export function IconInfo({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function IconCopy({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function IconDownload({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

export function IconTrash({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

export function IconSearch({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function IconSliders({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M4 21v-7" />
      <path d="M4 10V3" />
      <path d="M12 21v-9" />
      <path d="M12 8V3" />
      <path d="M20 21v-5" />
      <path d="M20 12V3" />
      <path d="M2 14h4" />
      <path d="M10 8h4" />
      <path d="M18 16h4" />
    </svg>
  );
}

export function IconChevronDown({ size = 16, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, className, style)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconArrowRight({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function IconArrowLeft({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </svg>
  );
}

export function IconExternalLink({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function IconKey({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L21 8l-3-3" />
    </svg>
  );
}

export function IconPlay({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

export function IconPause({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

export function IconRotateCcw({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function IconBook({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  );
}

export function IconFileBarChart({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 18v-3" />
      <path d="M12 18v-6" />
      <path d="M16 18v-4" />
    </svg>
  );
}

export function IconTarget({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}

export function IconTerminal({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  );
}

export function IconEye({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconLock({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function IconUpload({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 15V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

export function IconPlus({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconRefresh({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M21 12a9 9 0 0 0-15.5-6.3L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15.5 6.3L21 16" />
      <path d="M21 21v-5h-5" />
    </svg>
  );
}

export function IconPalette({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 3a9 9 0 1 0 0 18h1.5a2.2 2.2 0 0 0 2.2-2.2c0-.6-.2-1.1-.6-1.5-.4-.4-.6-.9-.6-1.5a2 2 0 0 1 2-2H18a3 3 0 0 0 3-3c0-4.4-4-7.8-9-7.8Z" />
      <circle cx="7.5" cy="11.5" r="1" />
      <circle cx="10" cy="7.5" r="1" />
      <circle cx="14.5" cy="7.5" r="1" />
    </svg>
  );
}

export function IconType({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v16" />
    </svg>
  );
}

export function IconBox({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

export function IconHelpCircle({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function IconWand({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m15 4-1 1 4 4 1-1a2.83 2.83 0 0 0-4-4Z" />
      <path d="m14 5-10 10 4 4 10-10" />
      <path d="M5 4v3" />
      <path d="M3.5 5.5h3" />
      <path d="M19 15v3" />
      <path d="M17.5 16.5h3" />
    </svg>
  );
}

export function IconMaximize({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
    </svg>
  );
}

export function IconMinimize({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M4 14h6v6" />
      <path d="M20 10h-6V4" />
      <path d="m14 10 7-7" />
      <path d="m3 21 7-7" />
    </svg>
  );
}
