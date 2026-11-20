import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Approval, ApprovalStatus, Report } from '@shared/types';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../toast';
import { Badge, type BadgeTone } from '../components/Badge';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { ApprovalContent } from '../components/ApprovalDialog';
import { fmtDateTime, relativeTime, TASK_LABELS } from '../format';

type Tab = 'pending' | 'approved' | 'rejected' | 'all';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'pending', label: '承認待ち' },
  { key: 'approved', label: '承認済み' },
  { key: 'rejected', label: '却下' },
  { key: 'all', label: 'すべて' },
];

const STATUS_META: Record<ApprovalStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: '承認待ち', tone: 'warn' },
  approved: { label: '承認済み', tone: 'ok' },
  rejected: { label: '却下', tone: 'ng' },
};

export function ApprovalsScreen(): ReactNode {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const initialTab = (params.get('status') as Tab | null) ?? 'pending';
  const [tab, setTab] = useState<Tab>(
    TABS.some((t) => t.key === initialTab) ? initialTab : 'pending',
  );
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.approvals('all');
      setApprovals(res.approvals);
    } catch (err) {
      setError(err instanceof Error ? err.message : '承認一覧の読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = '承認 ─ Spatial Agent Studio';
    void load();
  }, [load]);

  useEffect(() => {
    setParams(tab === 'pending' ? {} : { status: tab }, { replace: true });
  }, [tab, setParams]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { pending: 0, approved: 0, rejected: 0, all: approvals.length };
    for (const a of approvals) c[a.status] += 1;
    return c;
  }, [approvals]);

  const filtered = useMemo(
    () => (tab === 'all' ? approvals : approvals.filter((a) => a.status === tab)),
    [approvals, tab],
  );

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((a) => a.id === selectedId)) {
      setSelectedId(filtered[0]!.id);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find((a) => a.id === selectedId) ?? null;

  function onDecided(approval: Approval, _report: Report | null): void {
    setApprovals((prev) => prev.map((a) => (a.id === approval.id ? approval : a)));
    toast.push('判断を反映しました。監査ログに記録されています。', 'success');
    void load();
  }

  return (
    <div className="page page-approvals">
      <div className="page-head">
        <div>
          <p className="eyebrow">APPROVALS ／ HUMAN IN THE LOOP</p>
          <h1>承認 ─ AIは下書きまで、確定は人</h1>
          <p className="page-lead">
            AIが作成した帳票・判定・アラートの下書きを確認し、権限を持つ人が承認・却下します。
            判断はすべて監査ログ（ハッシュ連鎖）に記録されます。
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            更新
          </button>
        </div>
      </div>

      {loading ? (
        <Spinner label="承認一覧を読み込み中" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="承認の状態">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                <span className="tab-count">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          <div className="approvals-layout">
            <section className="panel approvals-list-panel" aria-label="承認依頼一覧">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={tab === 'pending' ? 'check' : 'audit'}
                  title={
                    tab === 'pending'
                      ? '承認待ちはありません'
                      : tab === 'approved'
                        ? '承認済みはまだありません'
                        : tab === 'rejected'
                          ? '却下はありません'
                          : '承認依頼はまだありません'
                  }
                  description="3D現場でAIタスクを実行すると、承認待ちの下書きが作成されます。"
                />
              ) : (
                <ul className="approval-list">
                  {filtered.map((a) => {
                    const meta = STATUS_META[a.status];
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          className={`approval-row ${a.id === selectedId ? 'selected' : ''}`}
                          onClick={() => setSelectedId(a.id)}
                        >
                          <div className="approval-row-top">
                            <Badge tone={meta.tone} dot>
                              {meta.label}
                            </Badge>
                            <span className="approval-row-time">{relativeTime(a.createdAt)}</span>
                          </div>
                          <p className="approval-row-title">{a.title}</p>
                          <p className="approval-row-sub">
                            {a.siteName} ／ {TASK_LABELS[a.task]} ／ {a.requestedBy.name}
                          </p>
                          <div className="approval-row-foot">
                            <span className={`verdict verdict-${a.verdictTone}`}>{a.verdict}</span>
                            <span className="approval-row-date">{fmtDateTime(a.createdAt)}</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="panel approval-detail-panel" aria-label="承認依頼の詳細">
              {selected ? (
                <ApprovalContent
                  approval={selected}
                  canApprove={!!user?.canApprove}
                  onClose={() => setSelectedId(null)}
                  onDecided={onDecided}
                  compact
                />
              ) : (
                <EmptyState
                  icon="shield"
                  title="依頼を選択してください"
                  description="左の一覧から承認依頼を選ぶと、評価値・AI所見・判断ボタンが表示されます。"
                />
              )}
            </section>
          </div>
        </>
      )}

      <p className="page-footnote">
        <Icon name="lock" size={14} />
        承認・却下は現場代理人（承認権限あり）のみ。権限のない操作は403で拒否され、監査ログにDENYとして記録されます。
      </p>
    </div>
  );
}
