import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Approval, Report } from '@shared/types';
import { api, ApiError } from '../api';
import { useToast } from '../toast';
import { Badge, type BadgeTone } from './Badge';
import { Icon } from './Icon';
import { fmtDateTime, RISK_LABELS, TASK_LABELS } from '../format';

export function ApprovalContent({
  approval,
  canApprove,
  onClose,
  onDecided,
  compact = false,
}: {
  approval: Approval;
  canApprove: boolean;
  onClose: () => void;
  onDecided?: (approval: Approval, report: Report | null) => void;
  compact?: boolean;
}): ReactNode {
  const toast = useToast();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tone: BadgeTone =
    approval.status === 'approved' ? 'ok' : approval.status === 'rejected' ? 'ng' : 'warn';
  const statusLabel =
    approval.status === 'approved' ? '承認済み' : approval.status === 'rejected' ? '却下' : '承認待ち';

  async function decide(decision: 'approve' | 'reject'): Promise<void> {
    setBusy(decision);
    setError(null);
    try {
      const res = await api.decide(approval.id, decision, note.trim() || undefined);
      toast.push(
        decision === 'approve'
          ? '承認しました。業務レポートを登録しました。'
          : '却下しました。監査ログに記録しました。',
        decision === 'approve' ? 'success' : 'warn',
      );
      onDecided?.(res.approval, res.report);
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '判断の送信に失敗しました。';
      setError(message);
      toast.push(message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`approval-content ${compact ? 'compact' : ''}`.trim()}>
      <div className="approval-head">
        <div>
          <p className="eyebrow">
            {TASK_LABELS[approval.task]} ／ {approval.siteName}
          </p>
          <h2 id="approval-title">{approval.title}</h2>
        </div>
        <div className="approval-head-badges">
          <Badge tone={tone} dot>
            {statusLabel}
          </Badge>
          <Badge tone={approval.risk === 'high' ? 'ng' : approval.risk === 'medium' ? 'warn' : 'info'}>
            {RISK_LABELS[approval.risk]}
          </Badge>
        </div>
      </div>

      <p className="approval-summary">{approval.summary}</p>

      <div className="approval-meta">
        <span>依頼者：{approval.requestedBy.name}</span>
        <span>作成：{fmtDateTime(approval.createdAt)}</span>
        {approval.decidedBy && (
          <span>
            判断：{approval.decidedBy.name}（{fmtDateTime(approval.decidedAt)}）
          </span>
        )}
      </div>

      <div className="approval-verdict">
        <span className={`verdict verdict-${approval.verdictTone}`}>{approval.verdict}</span>
        <span className="approval-verdict-note">
          AI（デモ）の下書きです。数値は決定的な計算エンジンが算出しています。
        </span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">AI下書きの評価値</caption>
          <tbody>
            {approval.metrics.map((m) => (
              <tr key={m.label}>
                <th scope="row">{m.label}</th>
                <td>{m.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="findings">
        <p className="findings-title">
          <Icon name="info" size={15} /> AI所見（ドラフト）
        </p>
        <p>{approval.findings}</p>
      </div>

      {approval.status === 'pending' ? (
        <div className="approval-actions">
          <label className="field approval-note">
            <span>判断メモ（任意・監査ログに記録）</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例：最大不足箇所を明日再計測。承認は帳票ドラフトのみ。"
              rows={2}
              maxLength={500}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!canApprove && (
            <p className="permission-note">
              <Icon name="lock" size={15} />
              承認・却下は現場代理人（承認権限あり）のみ実行できます。現在のユーザーには権限がありません。
            </p>
          )}
          <div className="approval-buttons">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={busy !== null}
            >
              あとで判断
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void decide('reject')}
              disabled={!canApprove || busy !== null}
            >
              <Icon name="x" size={16} />
              {busy === 'reject' ? '送信中…' : '却下する'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void decide('approve')}
              disabled={!canApprove || busy !== null}
            >
              <Icon name="check" size={16} />
              {busy === 'approve' ? '承認中…' : '承認して確定'}
            </button>
          </div>
        </div>
      ) : (
        <div className="approval-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}

export function ApprovalDialog({
  approval,
  canApprove,
  onClose,
  onDecided,
}: {
  approval: Approval;
  canApprove: boolean;
  onClose: () => void;
  onDecided?: (approval: Approval, report: Report | null) => void;
}): ReactNode {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          ref={closeRef}
          aria-label="閉じる"
        >
          <Icon name="x" size={18} />
        </button>
        <ApprovalContent
          approval={approval}
          canApprove={canApprove}
          onClose={onClose}
          onDecided={onDecided}
        />
      </div>
    </div>
  );
}
