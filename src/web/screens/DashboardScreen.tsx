import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Approval, AuditEvent, Bootstrap, SiteSummary } from '@shared/types';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../toast';
import { Badge, type BadgeTone } from '../components/Badge';
import { Icon, type IconName } from '../components/Icon';
import { KpiCard } from '../components/KpiCard';
import { MiniTerrain } from '../components/MiniTerrain';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { fmtDateTime, relativeTime } from '../format';

const STATUS: Record<SiteSummary['status'], { label: string; tone: BadgeTone }> = {
  active: { label: '稼働中', tone: 'ok' },
  attention: { label: '要注意', tone: 'warn' },
  idle: { label: '休止中', tone: 'muted' },
};

const AUDIT_ICON: Record<string, IconName> = {
  LOGIN: 'user',
  LOGOUT: 'logout',
  RUN_REQUESTED: 'play',
  RUN_COMPLETED: 'check',
  APPROVAL_REQUESTED: 'shield',
  APPROVED: 'check',
  REJECTED: 'x',
  REPORT_CREATED: 'audit',
  SEED: 'database',
  DENY: 'lock',
  LOGIN_FAILED: 'alert',
  LOGIN_THROTTLED: 'lock',
};

function auditTone(type: string): BadgeTone {
  if (['APPROVED', 'REPORT_CREATED', 'RUN_COMPLETED'].includes(type)) return 'ok';
  if (['REJECTED', 'DENY', 'LOGIN_FAILED', 'LOGIN_THROTTLED'].includes(type)) return 'ng';
  if (['APPROVAL_REQUESTED', 'RUN_REQUESTED'].includes(type)) return 'warn';
  return 'info';
}

function SiteCard({ site }: { site: SiteSummary }): ReactNode {
  const status = STATUS[site.status];
  const pct = Math.round(site.progress * 100);
  return (
    <Link to={`/sites/${site.id}`} className="site-card">
      <div className="site-card-visual">
        <MiniTerrain progress={site.progress} cover={site.cover} />
        <span className="site-card-code">{site.code}</span>
        <span className="site-card-status">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </span>
      </div>
      <div className="site-card-body">
        <h3>{site.name}</h3>
        <p className="site-card-desc">{site.description}</p>
        <div className="progress-row">
          <span className="progress-label">盛土進捗</span>
          <span className="progress-track" aria-hidden="true">
            <span className="progress-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="progress-value">{pct}%</span>
        </div>
        <div className="site-card-meta">
          <span>
            <Icon name="calendar" size={13} /> 版 {site.versionDate || '—'}
          </span>
          <span>
            <Icon name="database" size={13} /> {site.splatCount.toLocaleString('ja-JP')} splats
          </span>
          <span className={site.pendingApprovals ? 'meta-alert' : ''}>
            <Icon name="shield" size={13} /> 承認待ち {site.pendingApprovals}
          </span>
        </div>
        <span className="site-open">
          3D現場を開く
          <Icon name="arrowRight" size={15} />
        </span>
      </div>
    </Link>
  );
}

function PendingItem({ approval }: { approval: Approval }): ReactNode {
  return (
    <Link to="/approvals" className="pending-item">
      <div className="pending-item-top">
        <Badge tone={approval.risk === 'high' ? 'ng' : approval.risk === 'medium' ? 'warn' : 'info'}>
          {approval.risk === 'high' ? '影響大' : approval.risk === 'medium' ? '影響中' : '影響小'}
        </Badge>
        <span className="pending-time">{relativeTime(approval.createdAt)}</span>
      </div>
      <p className="pending-title">{approval.title}</p>
      <p className="pending-sub">
        {approval.siteName} ／ {approval.requestedBy.name}
      </p>
    </Link>
  );
}

function ActivityItem({ event }: { event: AuditEvent }): ReactNode {
  const tone = auditTone(event.type);
  return (
    <li className="activity-item">
      <span className={`activity-icon tone-${tone}`}>
        <Icon name={AUDIT_ICON[event.type] ?? 'info'} size={14} />
      </span>
      <div className="activity-body">
        <p>
          <b>{event.actor}</b>
          <span className="activity-type">{event.type}</span>
        </p>
        <p className="activity-detail">{event.detail}</p>
      </div>
      <span className="activity-time">{relativeTime(event.createdAt)}</span>
    </li>
  );
}

export function DashboardScreen(): ReactNode {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.bootstrap();
      setData(res);
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'ホーム ─ Spatial Agent Studio';
    void load();
  }, [load]);

  async function refresh(): Promise<void> {
    setLoading(true);
    await load();
    toast.push('最新の状態に更新しました。', 'info');
    setLoading(false);
  }

  if (loading && !data) return <Spinner label="現場データを読み込み中" />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void refresh()} />;
  if (!data) return null;

  const { dashboard } = data;
  const k = dashboard.kpis;

  return (
    <div className="page page-dashboard">
      <div className="page-head">
        <div>
          <p className="eyebrow">HOME ／ {user?.name ?? ''}</p>
          <h1>ホーム ─ 現場の「AI下書き → 人の承認」を横断表示</h1>
          <p className="page-lead">
            3D現場ごとの進捗・AI下書き・承認待ち・安全アラートを1画面で確認できます。
            {updatedAt && <span className="updated-at">最終更新 {fmtDateTime(updatedAt)}</span>}
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
            <Icon name="refresh" size={16} />
            更新
          </button>
          <Link to="/approvals" className="btn btn-primary">
            <Icon name="shield" size={16} />
            承認待ちを確認
            {k.pendingApprovals > 0 && <span className="btn-count">{k.pendingApprovals}</span>}
          </Link>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard icon="cube" label="稼働現場" value={k.activeSites} unit="現場" hint="全現場のうち稼働中" />
        <KpiCard
          icon="shield"
          label="承認待ち"
          value={k.pendingApprovals}
          unit="件"
          hint="AI下書きの確定待ち"
          tone={k.pendingApprovals > 0 ? 'am' : 'cy'}
        />
        <KpiCard
          icon="spark"
          label="AI下書き（7日）"
          value={k.draftsThisWeek}
          unit="件"
          hint="実行したAIタスク"
          tone="vi"
        />
        <KpiCard
          icon="hazard"
          label="安全アラート（7日）"
          value={k.alertsThisWeek}
          unit="件"
          hint="離隔侵入を検知した実行"
          tone={k.alertsThisWeek > 0 ? 'rd' : 'gr'}
        />
        <KpiCard
          icon="clock"
          label="削減時間（試算）"
          value={k.savedHours.toFixed(1)}
          unit="h"
          hint="下書き件数×1.4hのサンプル試算"
          tone="gr"
        />
      </div>

      <div className="dashboard-grid">
        <section className="panel panel-sites" aria-labelledby="sites-heading">
          <div className="panel-head">
            <div>
              <h2 id="sites-heading">現場一覧</h2>
              <p className="panel-sub">撮影 → 3DGS → AIチェック → 承認の最新状況</p>
            </div>
            <span className="panel-count">{dashboard.sites.length} 現場</span>
          </div>
          {dashboard.sites.length === 0 ? (
            <EmptyState
              icon="cube"
              title="現場が登録されていません"
              description="`pnpm db:seed` でサンプル現場を登録してください。"
            />
          ) : (
            <div className="site-grid">
              {dashboard.sites.map((s) => (
                <SiteCard key={s.id} site={s} />
              ))}
            </div>
          )}
        </section>

        <div className="dashboard-side">
          <section className="panel" aria-labelledby="pending-heading">
            <div className="panel-head">
              <div>
                <h2 id="pending-heading">承認待ち</h2>
                <p className="panel-sub">AIは下書きまで。確定は人。</p>
              </div>
              <Link to="/approvals" className="panel-link">
                すべて見る
                <Icon name="chevronRight" size={14} />
              </Link>
            </div>
            {dashboard.pending.length === 0 ? (
              <EmptyState
                icon="shield"
                title="承認待ちはありません"
                description="3D現場でAIタスクを実行すると、ここに下書きが表示されます。"
              />
            ) : (
              <div className="pending-list">
                {dashboard.pending.map((a) => (
                  <PendingItem key={a.id} approval={a} />
                ))}
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="activity-heading">
            <div className="panel-head">
              <div>
                <h2 id="activity-heading">最近の動き</h2>
                <p className="panel-sub">監査ログ（ハッシュ連鎖）の最新12件</p>
              </div>
              <Link to="/audit" className="panel-link">
                監査ログ
                <Icon name="chevronRight" size={14} />
              </Link>
            </div>
            {dashboard.recent.length === 0 ? (
              <EmptyState icon="audit" title="まだ記録がありません" />
            ) : (
              <ol className="activity-list">
                {dashboard.recent.map((e) => (
                  <ActivityItem key={e.seq} event={e} />
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      <p className="page-footnote">
        <Icon name="info" size={14} />
        本画面は個人利用MVPです。現場・数値・人物はすべて架空のサンプルで、AIエージェントはデモ動作です。
      </p>
    </div>
  );
}
