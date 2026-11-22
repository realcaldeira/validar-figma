import { useId } from 'react';

interface BrandLogoProps {
  size?: number;
}

export function BrandLogo({ size = 32 }: BrandLogoProps) {
  const uid = useId();
  const tileId = `figma-tile-${uid}`;
  const badgeId = `figma-badge-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
      className="brand-logo-svg"
    >
      <defs>
        <linearGradient id={tileId} x1="18" y1="0.5" x2="18" y2="35.5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2F2F2F" />
          <stop offset="100%" stopColor="#181818" />
        </linearGradient>
        <linearGradient id={badgeId} x1="25.5" y1="19.3" x2="25.5" y2="31.7" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#28A9FF" />
          <stop offset="100%" stopColor="#0D99FF" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="35" height="35" rx="9.5" fill={`url(#${tileId})`} stroke="rgba(255,255,255,0.14)" />
      <g className="brand-logo-shapes">
        <path className="bl-s1" d="M12.6 7.4H15.7V13.6H12.6A3.1 3.1 0 0 1 12.6 7.4Z" fill="#F24E1E" />
        <path className="bl-s2" d="M15.7 7.4H18.8A3.1 3.1 0 0 1 18.8 13.6H15.7V7.4Z" fill="#FF7262" />
        <path className="bl-s3" d="M12.6 13.6H15.7V19.8H12.6A3.1 3.1 0 0 1 12.6 13.6Z" fill="#A259FF" />
        <circle className="bl-s4" cx="18.8" cy="16.7" r="3.1" fill="#1ABCFE" />
        <path className="bl-s5" d="M12.6 19.8H15.7V22.9A3.1 3.1 0 1 1 12.6 19.8Z" fill="#0ACF83" />
      </g>
      <g className="brand-logo-badge">
        <circle cx="25.5" cy="25.5" r="6.2" fill={`url(#${badgeId})`} stroke="#1B1B1B" strokeWidth="2.2" />
        <path
          className="brand-logo-check"
          d="M22.8 25.6L24.6 27.4L28.3 23.5"
          stroke="#FFFFFF"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
