import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuditEvent, AuditVerifyResult } from '@shared/types';
import { api } from '../api';
import { useToast } from '../toast';
import { Badge, type BadgeTone } from '../components/Badge';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { fmtDateTime, shortenHash } from '../format';

function eventTone(type: string): BadgeTone {
  if (['APPROVED', 'REPORT_CREATED', 'RUN_COMPLETED'].includes(type)) return 'ok';
  if (['REJECTED', 'DENY', 'LOGIN_FAILED', 'LOGIN_THROTTLED'].includes(type)) return 'ng';
  if (['APPROVAL_REQUESTED', 'RUN_REQUESTED'].includes(type)) return 'warn';
  return 'info';
}

function actorTone(actor: string): string {
  if (actor.startsWith('AI:')) return 'actor-ai';
  if (actor.startsWith('HUMAN:')) return 'actor-human';
  return 'actor-system';
}

export function AuditScreen(): ReactNode {
  const toast = useToast();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [verify, setVerify] = useState<AuditVerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.audit(200);
      setEvents(res.events);
      setVerify(res.verify);
    } catch (err) {
      setError(err instanceof Error ? err.message : '監査ログの読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = '監査ログ ─ Spatial Agent Studio';
    void load();
  }, [load]);

  async function reverify(): Promise<void> {
    setVerifying(true);
    try {
      const res = await api.auditVerify();
      setVerify(res.verify);
      toast.push(
        res.verify.ok
          ? `検証OK：${res.verify.checked}件のハッシュ連鎖が一致しました。`
          : `検証NG：seq ${res.verify.firstBadSeq} で不一致を検出しました。`,
        res.verify.ok ? 'success' : 'error',
      );
    } catch (err) {
      toast.push(err instanceof Error ? err.message : '検証に失敗しました。', 'error');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="page page-audit">
      <div className="page-head">
        <div>
          <p className="eyebrow">AUDIT ／ HASH CHAIN</p>
          <h1>監査ログ ─ 全操作をハッシュでつなぎ、改ざんを検知</h1>
          <p className="page-lead">
            ログイン、AIタスク、承認・却下、レポート登録を追記専用の監査ログに記録します。
            各レコードは前レコードのハッシュを含み、連鎖を再計算して検証できます。
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            更新
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void reverify()}
            disabled={verifying}
          >
            <Icon name="shield" size={16} />
            {verifying ? '検証中…' : 'ハッシュ連鎖を検証'}
          </button>
        </div>
      </div>

      {verify && (
        <div className={`verify-banner ${verify.ok ? 'ok' : 'ng'}`} role="status">
          <span className="verify-icon">
            <Icon name={verify.ok ? 'check' : 'alertCircle'} size={22} />
          </span>
          <div className="verify-body">
            <p className="verify-title">
              {verify.ok ? 'ハッシュ連鎖は整合しています' : 'ハッシュ連鎖の不一致を検出しました'}
            </p>
            <p className="verify-sub">
              検証件数 {verify.checked} 件
              {verify.headHash ? ` ／ HEAD ${shortenHash(verify.headHash, 14, 8)}` : ' ／ HEAD なし'}
              {!verify.ok && verify.reason ? ` ／ 理由: ${verify.reason}` : ''}
            </p>
          </div>
          <Badge tone={verify.ok ? 'ok' : 'ng'}>{verify.ok ? 'VERIFIED' : 'TAMPERED?'}</Badge>
        </div>
      )}

      {loading ? (
        <Spinner label="監査ログを読み込み中" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : events.length === 0 ? (
        <EmptyState
          icon="audit"
          title="監査ログはまだありません"
          description="ログイン・AI実行・承認を行うと、ここに追記されます。"
        />
      ) : (
        <section className="panel audit-panel" aria-label="監査ログ一覧">
          <div className="panel-head">
            <div>
              <h2>イベント一覧</h2>
              <p className="panel-sub">
                新しい順／最大200件。UPDATE・DELETEはDBトリガで拒否されます。
              </p>
            </div>
            <span className="panel-count">{events.length} 件</span>
          </div>
          <div className="table-wrap">
            <table className="data-table audit-table">
              <caption className="sr-only">監査ログのイベント一覧</caption>
              <thead>
                <tr>
                  <th scope="col">Seq</th>
                  <th scope="col">日時</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Type</th>
                  <th scope="col">Detail</th>
                  <th scope="col">Hash</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.seq}>
                    <td className="mono">#{e.seq}</td>
                    <td className="nowrap">{fmtDateTime(e.createdAt)}</td>
                    <td>
                      <span className={`actor ${actorTone(e.actor)}`}>{e.actor}</span>
                    </td>
                    <td>
                      <Badge tone={eventTone(e.type)}>{e.type}</Badge>
                    </td>
                    <td className="audit-detail">{e.detail}</td>
                    <td className="mono hash-cell" title={`hash=${e.hash}\nprev=${e.prevHash}`}>
                      {shortenHash(e.hash, 8, 6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="page-footnote">
        <Icon name="lock" size={14} />
        監査ログは追記専用です。DBトリガによりUPDATE/DELETEは拒否され、ハッシュ連鎖の再計算で改ざんを検知できます。
      </p>
    </div>
  );
}
