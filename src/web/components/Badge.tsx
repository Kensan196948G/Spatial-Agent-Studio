import type { ReactNode } from 'react';

export type BadgeTone = 'ok' | 'warn' | 'ng' | 'info' | 'muted' | 'accent';

export function Badge({
  tone = 'info',
  children,
  dot = false,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  dot?: boolean;
}): ReactNode {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <i className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
