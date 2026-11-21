import React, { useId } from 'react';

interface OrbitLogoProps {
  size?: number;
  showWordmark?: boolean;
  subtitle?: string;
  className?: string;
  wordmarkClassName?: string;
}

export function OrbitLogo({
  size = 40,
  showWordmark = false,
  subtitle,
  className = '',
  wordmarkClassName = '',
}: OrbitLogoProps) {
  const uid = useId().replace(/:/g, '');
  const planetGradId = `orbit-planet-${uid}`;
  const ringGradId = `orbit-ring-${uid}`;

  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id={planetGradId} x1="18" y1="16" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#C084FC" />
            <stop offset="52%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
          <linearGradient id={ringGradId} x1="8" y1="42" x2="56" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="50%" stopColor="#C084FC" />
            <stop offset="100%" stopColor="#38BDF8" />
          </linearGradient>
        </defs>

        <rect width="64" height="64" rx="18" fill="#0B0B12" />
        <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="17.25" stroke="#29293D" strokeWidth="1.5" />

        {/* Back arc of the tilted orbital ring */}
        <path
          d="M11.5 39.2C14.8 29.8 25.4 22.8 37.8 21.5C46.2 20.6 52.7 23.1 54.4 27.9"
          stroke={`url(#${ringGradId})`}
          strokeWidth="3.2"
          strokeLinecap="round"
          opacity="0.45"
        />

        {/* Core planet orb */}
        <circle cx="32" cy="32" r="13.5" fill={`url(#${planetGradId})`} />
        <circle cx="27.5" cy="27.5" r="4.2" fill="#F8FAFC" opacity="0.22" />

        {/* Front tilted galactic ring */}
        <path
          d="M9.6 36.1C11.3 41.2 21.8 43.3 34.4 40.3C46.9 37.3 55.6 30.8 54.4 25.5"
          stroke={`url(#${ringGradId})`}
          strokeWidth="4.2"
          strokeLinecap="round"
        />

        {/* Orbiting cyan-violet moon */}
        <circle cx="49.5" cy="18.5" r="3.8" fill="#38BDF8" />
        <circle cx="49.5" cy="18.5" r="1.5" fill="#F8FAFC" opacity="0.85" />
      </svg>

      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span
            className={`font-display font-extrabold tracking-tight text-[#F8FAFC] ${wordmarkClassName || 'text-lg'}`}
          >
            ORBIT
          </span>
          {subtitle && <span className="text-[11px] font-medium text-[#A1A1B5] mt-0.5">{subtitle}</span>}
        </span>
      )}
    </span>
  );
}
