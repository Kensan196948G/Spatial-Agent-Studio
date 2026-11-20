/**
 * デモ用のAIエージェント・オーケストレーター。
 *
 * 重要: このMVPの「AIエージェント」は、実LLM/computer-useではなく、
 * 決定的な計算エンジンを呼び出すスクリプト化されたデモです。数値はすべて
 * src/shared/measurements.ts の計算結果で、LLMが数値を作ることはありません。
 * UI上でも「AI（デモ）」と明示します。
 */

import { crossSection, deviationStats, embankmentBalance, safetyScan } from '../shared/measurements';
import type { SiteModel } from '../shared/terrain';
import type {
  OverlaySpec,
  RiskLevel,
  RunResult,
  RunStep,
  TaskKind,
  VerdictTone,
} from '../shared/types';

export const TASK_LABEL: Record<TaskKind, string> = {
  asbuilt: '盛土 出来形管理',
  safety: '重機 安全離隔チェック',
};

const fmt = (v: number, d = 2): string =>
  Number(v).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number, d = 2): string => `${v >= 0 ? '+' : ''}${fmt(v, d)}`;

export type AgentSite = { id: string; name: string; model: SiteModel };

type ApprovalDraft = {
  title: string;
  summary: string;
  risk: RiskLevel;
  task: TaskKind;
  verdict: string;
  verdictTone: VerdictTone;
  metrics: Array<{ label: string; value: string }>;
  findings: string;
};

export type BuiltRun = {
  result: RunResult;
  steps: RunStep[];
  approval: ApprovalDraft;
};

function asbuilt(site: AgentSite): BuiltRun {
  const stats = deviationStats(site.model);
  const balance = embankmentBalance(site.model);
  const section = crossSection(site.model, stats.worstUnder.z);
  const pass = stats.verdict === 'pass';
  const verdictTone: VerdictTone = pass ? 'ok' : stats.passRate >= 90 ? 'warn' : 'ng';
  const verdict = pass ? '合格' : '是正要（不足部の手直し後に再計測）';

  const findings =
    `合格率 ${fmt(stats.passRate, 1)}%（${stats.n}点中 ${stats.n - stats.outUnder - stats.outOver}点）で、` +
    `平均偏差 ${signed(stats.mean, 3)}m・標準偏差 ${fmt(stats.std, 3)}m です。` +
    `最大不足は ${fmt(stats.min)}m（X=${fmt(stats.worstUnder.x, 1)}, Z=${fmt(stats.worstUnder.z, 1)}）、` +
    `最大過剰は +${fmt(stats.max)}m。不足側 ${stats.outUnder}点・過剰側 ${stats.outOver}点。` +
    (pass
      ? '規格値内ですが、最大不足箇所は追加盛土・再転圧後に再計測してください。'
      : '不足箇所は追加盛土・再転圧を行い、再計測してください。過剰箇所は敷均しで調整可能です。') +
    ` 盛土の不足量は約 ${fmt(balance.underVolumeM3, 0)}m³（設計 ${fmt(balance.designVolumeM3, 0)}m³／現況 ${fmt(balance.currentVolumeM3, 0)}m³）。` +
    '数値は決定的な計算エンジンによるサンプル評価で、LLMは数値を作りません。';

  const metrics = [
    { label: '評価方式', value: `グリッド評価 ${stats.gridM}m` },
    { label: '評価点数', value: `${stats.n} 点` },
    { label: '合格率', value: `${fmt(stats.passRate, 1)} %` },
    { label: '平均偏差', value: `${signed(stats.mean, 3)} m` },
    { label: '標準偏差', value: `${fmt(stats.std, 3)} m` },
    { label: '最大不足', value: `${fmt(stats.min)} m` },
    { label: '最大過剰', value: `+${fmt(stats.max)} m` },
    { label: '規格外（不足／過剰）', value: `${stats.outUnder} ／ ${stats.outOver} 点` },
    { label: '盛土 不足量', value: `${fmt(balance.underVolumeM3, 0)} m³` },
  ];

  const overlays: OverlaySpec[] = [
    { kind: 'bbox', label: '盛土（施工中）', color: '#38e1ff', groups: ['embankment'] },
    {
      kind: 'pin',
      label: `最大不足 ${fmt(stats.min)}m`,
      color: '#ff5d6c',
      point: stats.worstUnder,
    },
    {
      kind: 'pin',
      label: `最大過剰 +${fmt(stats.max)}m`,
      color: '#ffb547',
      point: stats.worstOver,
    },
  ];

  const steps: RunStep[] = [
    {
      index: 0,
      phase: 'perceive',
      message:
        'ビューポートを撮影し、3DGSのシーングラフから盛土・設計面・重機・作業員を認識します。',
      action: { type: 'camera', view: 'all' },
    },
    {
      index: 1,
      phase: 'perceive',
      message:
        '盛土の範囲と設計面を確認しました。人物は匿名ID（W-01〜W-03）と位置のみで扱います。',
      action: { type: 'overlays', overlays },
    },
    {
      index: 2,
      phase: 'reason',
      message:
        '設計面との差分を0.5mグリッドで評価し、規格値±0.20mに対する合格率を計算します。',
      action: { type: 'layer', layer: 'design', on: true },
    },
    {
      index: 3,
      phase: 'act',
      message: `最大不足箇所（X=${fmt(stats.worstUnder.x, 1)}, Z=${fmt(stats.worstUnder.z, 1)}）で横断を表示し、是正候補を注記します。`,
      action: { type: 'heatmap', on: true },
    },
    {
      index: 4,
      phase: 'verify',
      message: `判定：合格率 ${fmt(stats.passRate, 1)}%（${stats.n}点）。規格値±0.20mに対し「${verdict}」と判断します。`,
      action: { type: 'camera', view: 'emb' },
    },
    {
      index: 5,
      phase: 'verify',
      message:
        '帳票ドラフトを作成しました。確定・提出は現場代理人の承認が必要です。承認待ちに登録します。',
    },
  ];

  const result: RunResult = {
    task: 'asbuilt',
    stats,
    balance,
    section,
    findings,
    verdict,
    verdictTone,
    metrics,
    overlays,
    snapshotSimTime: 0,
  };

  return {
    result,
    steps,
    approval: {
      title: '出来形管理帳票（ドラフト）を確定',
      summary:
        'AI（デモ）が3DGS点群と設計面の差分から作成した出来形判定です。確定すると業務レポートに登録され、監査ログに記録されます。',
      risk: 'medium',
      task: 'asbuilt',
      verdict,
      verdictTone,
      metrics,
      findings,
    },
  };
}

function safety(site: AgentSite): BuiltRun {
  const scan = safetyScan(site.model);
  const intruded = scan.intruded;
  const verdictTone: VerdictTone = intruded ? 'ng' : 'ok';
  const verdict = intruded ? '侵入あり（要確認）' : '侵入なし';
  const intrusionAt =
    scan.intrusionAtSeconds === null ? 'なし' : `${fmt(scan.intrusionAtSeconds, 1)} 秒`;

  const findings =
    `危険エリア半径 ${fmt(scan.radiusM, 1)}m（旋回中心→バケット先端の最大水平距離＋余裕1.0m）。` +
    `60秒分を0.2秒刻みで走査し、最小離隔は ${fmt(scan.minDistanceM, 1)}m（${scan.minWorker}）、侵入時刻は ${intrusionAt} でした。` +
    (intruded
      ? '旋回範囲への立入りが発生しています。旋回の一時停止、立入禁止柵・誘導員の配置、合図者との連携手順の再周知を推奨します。'
      : '監視時間内の侵入はありません。監視を継続してください。') +
    ' 人物は匿名ID・位置のみで扱い、個人の評価・監視には使用しません。';

  const metrics = [
    { label: '危険エリア半径', value: `${fmt(scan.radiusM, 1)} m` },
    { label: '最小離隔', value: `${fmt(scan.minDistanceM, 1)} m（${scan.minWorker}）` },
    { label: '侵入時刻', value: intrusionAt },
    { label: '監視時間', value: `${scan.monitoredSeconds} 秒（0.2秒刻み）` },
    { label: '判定', value: verdict },
    { label: '人物情報', value: '匿名ID・位置のみ（外見情報なし）' },
  ];

  const overlays: OverlaySpec[] = [
    {
      kind: 'bbox',
      label: 'バックホウ（旋回中）',
      color: '#f2b72a',
      groups: ['excavator'],
    },
    {
      kind: 'bbox',
      label: '作業員（匿名）',
      color: '#b39bff',
      groups: ['worker-1', 'worker-2', 'worker-3'],
    },
    {
      kind: 'ring',
      label: `危険エリア R=${fmt(scan.radiusM, 1)}m`,
      color: intruded ? '#ff5d6c' : '#3ee07f',
      center: scan.excavator,
      radius: scan.radiusM,
    },
    ...scan.workers.map<OverlaySpec>((w) => ({
      kind: 'link',
      label: `${w.id} ${fmt(w.distanceM, 1)}m`,
      color: w.inside ? '#ff5d6c' : '#3ee07f',
      from: scan.excavator,
      to: { x: w.x, y: scan.excavator.y + 1, z: w.z },
    })),
  ];

  const steps: RunStep[] = [
    {
      index: 0,
      phase: 'perceive',
      message:
        '人物を匿名化した状態で、重機（バックホウ）と作業員の位置を取得します。外見情報は保持しません。',
      action: { type: 'privacy', on: true },
    },
    {
      index: 1,
      phase: 'perceive',
      message: '重機の旋回中心とバケット先端を検出しました。',
      action: { type: 'camera', view: 'exc' },
    },
    {
      index: 2,
      phase: 'reason',
      message:
        'バケット先端の最大水平距離＋余裕1.0mから危険エリア半径を算出します。作業員は匿名IDで距離のみを評価します。',
      action: { type: 'overlays', overlays },
    },
    {
      index: 3,
      phase: 'act',
      message: `60秒分を0.2秒刻みで走査しました。最小離隔 ${fmt(scan.minDistanceM, 1)}m（${scan.minWorker}）、侵入時刻 ${intrusionAt}。`,
      action: { type: 'simTime', seconds: scan.snapshotSeconds },
    },
    {
      index: 4,
      phase: 'verify',
      message: `判定：${verdict}。${intruded ? '旋回の一時停止と作業員の退避を推奨します。' : '監視を継続してください。'}`,
      action: { type: 'overlays', overlays },
    },
    {
      index: 5,
      phase: 'verify',
      message: 'アラート送信・作業停止は人の判断が必要です。承認待ちに登録します。',
    },
  ];

  const result: RunResult = {
    task: 'safety',
    scan,
    findings,
    verdict,
    verdictTone,
    metrics,
    overlays,
    snapshotSimTime: scan.snapshotSeconds,
  };

  return {
    result,
    steps,
    approval: {
      title: '重機の安全離隔アラートを確認',
      summary:
        'AI（デモ）が匿名IDの位置情報から判定した安全離隔チェックです。アラート送信・旋回停止の判断は現場代理人が行います。',
      risk: intruded ? 'high' : 'medium',
      task: 'safety',
      verdict,
      verdictTone,
      metrics,
      findings,
    },
  };
}

export function buildRun(task: TaskKind, site: AgentSite): BuiltRun {
  return task === 'asbuilt' ? asbuilt(site) : safety(site);
}
