import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  Approval,
  LayerKey,
  Report,
  Run,
  RunAction,
  SiteDetail,
  TaskKind,
} from '@shared/types';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../toast';
import { Badge } from '../components/Badge';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { ApprovalDialog } from '../components/ApprovalDialog';
import {
  createViewer,
  type CameraViewName,
  type ViewerApi,
  type ViewerStats,
} from '../viewer/scene';
import { fmtDateTime, fmtNumber, relativeTime, TASK_LABELS } from '../format';

const VIEW_BUTTONS: Array<{ key: CameraViewName; label: string }> = [
  { key: 'all', label: '全体' },
  { key: 'emb', label: '盛土' },
  { key: 'cut', label: '切土' },
  { key: 'exc', label: '重機' },
  { key: 'rev', label: '護岸' },
];

const LAYER_BUTTONS: Array<{ key: LayerKey; label: string; tone: string }> = [
  { key: 'terrain', label: '地形', tone: '#8d7a52' },
  { key: 'embankment', label: '盛土', tone: '#d6b07a' },
  { key: 'revetment', label: '護岸', tone: '#a8acb4' },
  { key: 'river', label: '河川', tone: '#3a7fd0' },
  { key: 'machine', label: '重機', tone: '#f2b72a' },
  { key: 'worker', label: '作業員', tone: '#ff8c2a' },
  { key: 'vegetation', label: '植生', tone: '#4f9a4a' },
  { key: 'design', label: '設計面', tone: '#38e1ff' },
];

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  terrain: true,
  embankment: true,
  revetment: true,
  river: true,
  machine: true,
  worker: true,
  vegetation: true,
  design: false,
  ai: true,
};

const PHASE_META: Record<
  Run['steps'][number]['phase'],
  { label: string; icon: 'eye' | 'brain' | 'play' | 'shield' | 'check'; tone: string }
> = {
  perceive: { label: '知覚', icon: 'eye', tone: 'cy' },
  reason: { label: '推論', icon: 'brain', tone: 'vi' },
  act: { label: '操作', icon: 'play', tone: 'am' },
  verify: { label: '検証', icon: 'shield', tone: 'gr' },
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function SiteScreen(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();

  const [site, setSite] = useState<SiteDetail | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);

  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(DEFAULT_LAYERS);
  const [heatmap, setHeatmap] = useState(false);
  const [privacy, setPrivacy] = useState(true);
  const [activeView, setActiveView] = useState<CameraViewName>('all');
  const [frozen, setFrozen] = useState<number | null>(null);
  const [stats, setStats] = useState<ViewerStats | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<ViewerApi | null>(null);
  const cancelRef = useRef(false);

  const loadSite = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [siteRes, approvalsRes, reportsRes] = await Promise.all([
        api.site(id),
        api.approvals('pending'),
        api.siteReports(id),
      ]);
      setSite(siteRes);
      setApprovals(approvalsRes.approvals.filter((a) => a.siteId === id));
      setReports(reportsRes.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : '現場データの読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const refreshSide = useCallback(async () => {
    if (!id) return;
    try {
      const [approvalsRes, reportsRes] = await Promise.all([
        api.approvals('pending'),
        api.siteReports(id),
      ]);
      setApprovals(approvalsRes.approvals.filter((a) => a.siteId === id));
      setReports(reportsRes.reports);
    } catch {
      // 画面の主操作を止めない。次回更新で回復する。
    }
  }, [id]);

  useEffect(() => {
    cancelRef.current = false;
    setLoading(true);
    void loadSite();
    return () => {
      cancelRef.current = true;
    };
  }, [loadSite]);

  useEffect(() => {
    if (site) document.title = `${site.name} ─ Spatial Agent Studio`;
  }, [site]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!site || !canvas || !container) return;
    const viewer = createViewer(canvas, {
      progress: site.model.progress,
      terrainScale: site.model.terrainScale,
    });
    viewerRef.current = viewer;
    viewer.setLayers(DEFAULT_LAYERS);
    viewer.setHeatmap(false);
    viewer.setPrivacy(true);
    viewer.setView('all', 1);
    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      viewer.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    });
    ro.observe(container);
    viewer.resize(container.clientWidth, container.clientHeight);
    const interval = window.setInterval(() => setStats(viewer.getStats()), 800);
    return () => {
      window.clearInterval(interval);
      ro.disconnect();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [site]);

  useEffect(() => {
    viewerRef.current?.setLayers(layers);
  }, [layers]);

  useEffect(() => {
    viewerRef.current?.setHeatmap(heatmap);
  }, [heatmap]);

  useEffect(() => {
    viewerRef.current?.setPrivacy(privacy);
  }, [privacy]);

  function applyAction(action: RunAction | undefined): void {
    if (!action) return;
    const viewer = viewerRef.current;
    switch (action.type) {
      case 'camera':
        setActiveView(action.view);
        viewer?.setView(action.view);
        break;
      case 'layer':
        setLayers((prev) => ({ ...prev, [action.layer]: action.on }));
        viewer?.setLayer(action.layer, action.on);
        break;
      case 'heatmap':
        setHeatmap(action.on);
        viewer?.setHeatmap(action.on);
        break;
      case 'privacy':
        setPrivacy(action.on);
        viewer?.setPrivacy(action.on);
        break;
      case 'overlays':
        viewer?.setOverlays(action.overlays);
        break;
      case 'simTime':
        setFrozen(action.seconds);
        viewer?.setSimTime(action.seconds);
        break;
      case 'highlight':
        break;
      default:
        break;
    }
  }

  function resetScene(): void {
    viewerRef.current?.clearOverlays();
    viewerRef.current?.setSimTime(null);
    viewerRef.current?.setView('all', 700);
    viewerRef.current?.setHeatmap(false);
    setHeatmap(false);
    setFrozen(null);
    setActiveView('all');
    setLayers(DEFAULT_LAYERS);
    setPrivacy(true);
  }

  async function startRun(task: TaskKind): Promise<void> {
    if (!site || running) return;
    setRunning(true);
    setRun(null);
    setVisibleSteps(0);
    setSelectedApproval(null);
    resetScene();
    try {
      const res = await api.run(site.id, task);
      setRun(res.run);
      const steps = res.run.steps;
      for (let i = 0; i < steps.length; i += 1) {
        if (cancelRef.current) return;
        await delay(i === 0 ? 240 : 780);
        if (cancelRef.current) return;
        setVisibleSteps(i + 1);
        applyAction(steps[i]?.action);
      }
      setRunning(false);
      toast.push('AI下書きが完成しました。承認待ちに登録されています。', 'success');
      await refreshSide();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'AIタスクの実行に失敗しました。通信環境を確認してください。';
      toast.push(message, 'error');
      setRunning(false);
    }
  }

  function unfreeze(): void {
    setFrozen(null);
    viewerRef.current?.setSimTime(null);
  }

  function toggleLayer(key: LayerKey): void {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  if (!id) return <ErrorState message="現場IDが不正です。" />;
  if (loading && !site) return <Spinner label="現場と3Dビューを準備中" />;
  if (error && !site) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => void loadSite()} />
      </div>
    );
  }
  if (!site) return null;

  const pendingForSite = approvals.filter((a) => a.status === 'pending');
  const latestRun = run;
  const completedSteps = latestRun ? visibleSteps : 0;
  const runFinished = !!latestRun && !running && visibleSteps >= latestRun.steps.length;
  const canApprove = !!user?.canApprove;

  return (
    <div className="page page-site">
      <div className="page-head site-page-head">
        <div>
          <nav className="breadcrumb" aria-label="パンくず">
            <Link to="/">ホーム</Link>
            <Icon name="chevronRight" size={13} />
            <span>{site.name}</span>
          </nav>
          <div className="site-title-row">
            <h1>{site.name}</h1>
            <Badge tone={site.status === 'active' ? 'ok' : site.status === 'attention' ? 'warn' : 'muted'} dot>
              {site.status === 'active' ? '稼働中' : site.status === 'attention' ? '要注意' : '休止中'}
            </Badge>
            <Badge tone="info">{site.code}</Badge>
            <Badge tone="accent">3DGS サンプル</Badge>
          </div>
          <p className="page-lead">{site.description}</p>
        </div>
        <div className="page-head-actions">
          {pendingForSite.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setSelectedApproval(pendingForSite[0] ?? null)}
            >
              <Icon name="shield" size={16} />
              承認待ち {pendingForSite.length} 件
            </button>
          )}
          <Link to="/audit" className="btn btn-ghost">
            <Icon name="audit" size={16} />
            監査ログ
          </Link>
        </div>
      </div>

      <div className="site-layout">
        <section className="viewer-panel" aria-label="3D現場ビュー">
          <div className="viewer-toolbar">
            <div className="view-buttons" role="group" aria-label="視点">
              {VIEW_BUTTONS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className={`chip ${activeView === v.key ? 'active' : ''}`}
                  onClick={() => {
                    setActiveView(v.key);
                    viewerRef.current?.setView(v.key);
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="toolbar-divider" />
            <div className="layer-chips" role="group" aria-label="レイヤ表示">
              {LAYER_BUTTONS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className={`layer-chip ${layers[l.key] ? 'active' : ''}`}
                  aria-pressed={layers[l.key]}
                  onClick={() => toggleLayer(l.key)}
                >
                  <i style={{ background: l.tone }} aria-hidden="true" />
                  {l.label}
                </button>
              ))}
            </div>
            <div className="toolbar-spacer" />
            <button
              type="button"
              className={`chip toggle ${heatmap ? 'active' : ''}`}
              aria-pressed={heatmap}
              onClick={() => setHeatmap((v) => !v)}
            >
              <Icon name="heat" size={15} />
              出来形ヒートマップ
            </button>
            <button
              type="button"
              className={`chip toggle ${privacy ? 'active' : ''}`}
              aria-pressed={privacy}
              onClick={() => setPrivacy((v) => !v)}
              title="作業員を匿名化表示します"
            >
              <Icon name="lock" size={15} />
              人物を匿名化
            </button>
          </div>

          <div className="viewer-canvas-wrap" ref={containerRef}>
            <canvas ref={canvasRef} className="viewer-canvas" />
            <div className="viewer-hud viewer-hud-top">
              <span className="hud-pill hud-demo">
                <i />
                AI: DEMO
              </span>
              <span className="hud-pill">
                <Icon name="layers" size={13} /> 3DGS {site.splatCount.toLocaleString('ja-JP')} splats
              </span>
            </div>
            <div className="viewer-hud viewer-hud-bottom">
              <span className="hud-note">ドラッグで回転 / ホイールでズーム / Shift+ドラッグで移動</span>
              {frozen !== null && (
                <button type="button" className="hud-button" onClick={unfreeze}>
                  <Icon name="refresh" size={13} />
                  ライブに戻す
                </button>
              )}
            </div>
            <div className="viewer-legend" aria-hidden="true">
              <span>
                <i style={{ background: '#38e1ff' }} /> 設計面
              </span>
              <span>
                <i style={{ background: '#ffb547' }} /> 盛土
              </span>
              <span>
                <i style={{ background: '#ff5d6c' }} /> 危険域
              </span>
            </div>
          </div>

          <div className="viewer-status">
            <span>Renderer: Canvas2D</span>
            <span>表示 splats: {(stats?.visible ?? 0).toLocaleString('ja-JP')}</span>
            <span>Sim: {frozen !== null ? `${fmtNumber(frozen, 1)}s（固定）` : 'ライブ'}</span>
            <span className="viewer-status-right">
              版 {site.versionDate} ／ 盛土進捗 {Math.round(site.progress * 100)}%
            </span>
          </div>
        </section>

        <aside className="agent-panel" aria-label="AIエージェント">
          <div className="agent-head">
            <div>
              <p className="eyebrow">AGENT ／ DEMO</p>
              <h2>AIエージェント</h2>
            </div>
            <span className={`agent-state ${running ? 'running' : ''}`}>
              <i />
              {running ? '実行中' : '待機中'}
            </span>
          </div>

          <p className="agent-disclosure">
            <Icon name="info" size={14} />
            このMVPのAIはスクリプト化されたデモです。計算は決定的なエンジンが行い、外部LLM/APIには接続しません。
          </p>

          {pendingForSite.length > 0 && (
            <div className="pending-banner">
              <Icon name="shield" size={18} />
              <div>
                <b>承認待ちが {pendingForSite.length} 件あります</b>
                <p>AI下書きを確認し、現場代理人が確定してください。</p>
              </div>
              <button type="button" onClick={() => setSelectedApproval(pendingForSite[0] ?? null)}>
                確認する
              </button>
            </div>
          )}

          <div className="task-cards">
            <button
              type="button"
              className="task-card"
              onClick={() => void startRun('asbuilt')}
              disabled={running}
            >
              <span className="task-icon tone-cy">
                <Icon name="heat" size={20} />
              </span>
              <span className="task-body">
                <b>盛土 出来形管理</b>
                <small>設計面との差分・合格率・不足量を評価し、帳票ドラフトを作成</small>
              </span>
              <Icon name="arrowRight" size={16} />
            </button>
            <button
              type="button"
              className="task-card"
              onClick={() => void startRun('safety')}
              disabled={running}
            >
              <span className="task-icon tone-rd">
                <Icon name="hazard" size={20} />
              </span>
              <span className="task-body">
                <b>重機 安全離隔チェック</b>
                <small>旋回範囲と作業員の離隔を60秒走査し、危険域の侵入を判定</small>
              </span>
              <Icon name="arrowRight" size={16} />
            </button>
          </div>

          {!latestRun && (
            <div className="agent-idle">
              <EmptyState
                icon="play"
                title="タスクを選んでAIに依頼"
                description="AIが3Dビューを操作しながら計測・判定し、承認待ちの下書きを作成します。"
              />
            </div>
          )}

          {latestRun && (
            <div className="run-panel">
              <div className="run-head">
                <div>
                  <p className="eyebrow">RUN {latestRun.id.slice(0, 8)}</p>
                  <h3>{TASK_LABELS[latestRun.task]}</h3>
                </div>
                <Badge tone={running ? 'info' : 'ok'} dot>
                  {running ? '実行中' : '完了'}
                </Badge>
              </div>

              <ol className="run-steps" aria-live="polite">
                {latestRun.steps.map((step, i) => {
                  const meta = PHASE_META[step.phase];
                  const shown = i < completedSteps;
                  const current = running && i === completedSteps - 1;
                  return (
                    <li
                      key={step.index}
                      className={`run-step ${shown ? 'shown' : ''} ${current ? 'current' : ''}`}
                    >
                      <span className={`run-step-icon tone-${meta.tone}`}>
                        {meta.icon === 'brain' ? (
                          <Icon name="spark" size={14} />
                        ) : (
                          <Icon name={meta.icon} size={14} />
                        )}
                      </span>
                      <div>
                        <p className="run-step-phase">{meta.label}</p>
                        <p className="run-step-msg">{step.message}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {runFinished && (
                <>
                  <div className="run-result">
                    <div className="run-result-head">
                      <span className={`verdict verdict-${latestRun.result.verdictTone}`}>
                        {latestRun.result.verdict}
                      </span>
                      <span className="run-result-note">数値は計算エンジンによるサンプル評価</span>
                    </div>
                    <div className="metric-grid">
                      {latestRun.result.metrics.slice(0, 6).map((m) => (
                        <div key={m.label} className="metric">
                          <span>{m.label}</span>
                          <b>{m.value}</b>
                        </div>
                      ))}
                    </div>
                    <p className="run-findings">{latestRun.result.findings}</p>
                  </div>

                  {latestRun.approval && latestRun.approval.status === 'pending' && (
                    <div className="approval-cta">
                      <div>
                        <b>{latestRun.approval.title}</b>
                        <p>確定には現場代理人の承認が必要です。</p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setSelectedApproval(latestRun.approval)}
                      >
                        <Icon name="shield" size={16} />
                        内容を確認
                      </button>
                    </div>
                  )}

                  {!canApprove && (
                    <p className="permission-note">
                      <Icon name="lock" size={15} />
                      現在のユーザーは承認権限がありません。承認は現場代理人でログインしてください。
                    </p>
                  )}
                </>
              )}

              {running && (
                <p className="run-progress">
                  <span className="spinner spinner-sm" aria-hidden="true" />
                  ステップ {Math.min(completedSteps, latestRun.steps.length)} / {latestRun.steps.length} を実行中…
                </p>
              )}
            </div>
          )}

          <div className="reports-panel">
            <div className="panel-head">
              <div>
                <h3>確定レポート</h3>
                <p className="panel-sub">承認済みの帳票・判定</p>
              </div>
              <Link to="/approvals" className="panel-link">
                承認一覧
                <Icon name="chevronRight" size={14} />
              </Link>
            </div>
            {reports.length === 0 ? (
              <EmptyState
                icon="audit"
                title="確定レポートはまだありません"
                description="AI下書きを承認すると、ここに登録されます。"
              />
            ) : (
              <ul className="report-list">
                {reports.slice(0, 5).map((r) => (
                  <li key={r.id} className="report-item">
                    <span className={`verdict verdict-${r.verdictTone}`}>{r.verdict}</span>
                    <div>
                      <b>{r.title}</b>
                      <p>
                        {relativeTime(r.createdAt)} ／ {r.createdBy.name}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {selectedApproval && (
        <ApprovalDialog
          approval={selectedApproval}
          canApprove={canApprove}
          onClose={() => setSelectedApproval(null)}
          onDecided={() => {
            setSelectedApproval(null);
            void refreshSide();
          }}
        />
      )}

      <p className="page-footnote">
        <Icon name="info" size={14} />
        AIは下書きまで。確定・提出・作業停止は権限を持つ人が承認して初めて有効になります。
        {run && <span className="footnote-meta">最終実行：{fmtDateTime(run.createdAt)}</span>}
      </p>
    </div>
  );
}
