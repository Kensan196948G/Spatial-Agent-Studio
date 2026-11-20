import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Spinner({ label = '読み込み中' }: { label?: string }): ReactNode {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({
  icon = 'info',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <p className="empty-title">{title}</p>
      {description && <p className="empty-desc">{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): ReactNode {
  return (
    <div className="error-state" role="alert">
      <Icon name="alertCircle" size={22} />
      <div>
        <p className="error-title">読み込みに失敗しました</p>
        <p className="error-desc">{message}</p>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          <Icon name="refresh" size={16} />
          再試行
        </button>
      )}
    </div>
  );
}
