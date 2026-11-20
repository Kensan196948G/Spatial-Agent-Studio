import type { ReactNode } from 'react';

export type IconName =
  | 'home'
  | 'cube'
  | 'shield'
  | 'audit'
  | 'arrowRight'
  | 'play'
  | 'check'
  | 'x'
  | 'alert'
  | 'alertCircle'
  | 'user'
  | 'logout'
  | 'refresh'
  | 'clock'
  | 'layers'
  | 'heat'
  | 'lock'
  | 'users'
  | 'chart'
  | 'pin'
  | 'chevronRight'
  | 'info'
  | 'database'
  | 'activity'
  | 'eye'
  | 'camera'
  | 'ruler'
  | 'hazard'
  | 'calendar'
  | 'external'
  | 'spark';

const PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  cube: (
    <>
      <path d="M12 2.5 3.5 7.2v9.6L12 21.5l8.5-4.7V7.2z" />
      <path d="M3.5 7.2 12 12l8.5-4.8" />
      <path d="M12 12v9.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 2.8v5.4c0 4.4-2.9 7.8-7 9.8-4.1-2-7-5.4-7-9.8V5.8z" />
      <path d="m8.7 11.8 2.3 2.3 4.3-4.6" />
    </>
  ),
  audit: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h5M8 16h3" />
      <path d="m14.5 16.5 1.6 1.6 3-3.2" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5z" />,
  check: <path d="m4.5 12.5 4.7 4.7L19.5 6.8" />,
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.8 20h18.4z" />
      <path d="M12 9v5" />
      <path d="M12 17.2v.1" />
    </>
  ),
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5v.1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20.5c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4h4.5v16H14" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h10" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v5h-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.3l3.5 2" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 4.5-9 4.5L3 7.5z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </>
  ),
  heat: (
    <>
      <path d="M12 3c2.8 3.2 5 6.2 5 9.2A5 5 0 0 1 7 12.2C7 9.2 9.2 6.2 12 3z" />
      <path d="M12 12v9" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 20c1-3.2 3.4-4.9 6-4.9s5 1.7 6 4.9" />
      <path d="M16 5.8a3.2 3.2 0 0 1 0 5.4M17.5 15.2c2 .5 3.4 2.1 4 4.3" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16v-4M12 16V7M16 16v-6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6.5-5.4 6.5-10.5A6.5 6.5 0 0 0 5.5 10.5C5.5 15.6 12 21 12 21z" />
      <circle cx="12" cy="10.3" r="2.2" />
    </>
  ),
  chevronRight: <path d="m9 5 7 7-7 7" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.5v.1" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  activity: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3v12H4z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  ruler: (
    <>
      <path d="m3.5 15.5 12-12 5 5-12 12z" />
      <path d="m7 12 2 2M9.5 9.5l2 2M12 7l2 2" />
    </>
  ),
  hazard: (
    <>
      <path d="M12 3 2.8 20h18.4z" />
      <path d="M12 8.5v4.5" />
      <path d="M12 16.2v.1" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5.5H4.5V6H10" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m5.6 5.6 2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}): ReactNode {
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
