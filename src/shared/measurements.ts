/**
 * 決定的な業務計算エンジン。
 *
 * - 出来形: 設計面と現況面の差分をグリッド評価（平均・標準偏差・合格率・最大不足/過剰）
 * - 土量: 盛土設計体積と現況体積の差（不足・過剰）
 * - 断面: 指定Zでの現況 vs 設計の横断と最大偏差
 * - 安全離隔: 旋回中心・バケット・作業員の距離を時系列スキャンし、最小離隔と侵入を判定
 *
 * すべて純粋関数です。フロントとサーバで同じ入力から同じ数値になります。
 */

import {
  EXCAVATOR,
  bucketPos,
  clamp,
  embCur,
  embShape,
  excavatorY,
  height,
  type SiteModel,
  workerPos,
  workRadius,
} from './terrain';

export type Point3 = { x: number; y: number; z: number };

export type DeviationStats = {
  method: 'grid_vs_design';
  gridM: number;
  toleranceM: number;
  n: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  passRate: number;
  outUnder: number;
  outOver: number;
  worstUnder: Point3 & { deviation: number };
  worstOver: Point3 & { deviation: number };
  verdict: 'pass' | 'fail';
  verdictBasis: string;
};

export type EmbankmentBalance = {
  designVolumeM3: number;
  currentVolumeM3: number;
  underVolumeM3: number;
  overVolumeM3: number;
  netRequiredM3: number;
  gridM: number;
};

export type SectionPoint = {
  x: number;
  current: number;
  design: number | null;
  deviation: number | null;
};

export type CrossSection = {
  z0: number;
  worstDeviation: number;
  worstX: number;
  points: SectionPoint[];
};

export type SafetyWorker = {
  id: string;
  x: number;
  z: number;
  distanceM: number;
  inside: boolean;
};

export type SafetyScan = {
  radiusM: number;
  monitoredSeconds: number;
  scanStepSeconds: number;
  excavator: Point3;
  bucket: Point3;
  workers: SafetyWorker[];
  minDistanceM: number;
  minWorker: string;
  intruded: boolean;
  intrusionAtSeconds: number | null;
  snapshotSeconds: number;
  verdict: 'intruded' | 'clear';
  basis: string;
};

const EMB_BOUNDS = { x0: -14, x1: 10, z0: -14, z1: 14 };
const DEFAULT_GRID = 0.5;
const DEFAULT_TOLERANCE = 0.2;
const PASS_THRESHOLD = 95;

/** 出来形のグリッド評価 */
export function deviationStats(
  model: SiteModel,
  toleranceM = DEFAULT_TOLERANCE,
  gridM = DEFAULT_GRID,
): DeviationStats {
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let pass = 0;
  let outUnder = 0;
  let outOver = 0;
  let worstUnder = { x: 0, y: 0, z: 0, deviation: 0 };
  let worstOver = { x: 0, y: 0, z: 0, deviation: 0 };

  for (let x = EMB_BOUNDS.x0 + gridM / 2; x < EMB_BOUNDS.x1; x += gridM) {
    for (let z = EMB_BOUNDS.z0 + gridM / 2; z < EMB_BOUNDS.z1; z += gridM) {
      const shape = embShape(x, z);
      if (shape <= 0.05) continue;
      const current = embCur(x, z, model);
      const d = current - shape;
      n += 1;
      sum += d;
      sumSq += d * d;
      if (d < min) {
        min = d;
        worstUnder = { x, y: height(x, z, model), z, deviation: d };
      }
      if (d > max) {
        max = d;
        worstOver = { x, y: height(x, z, model), z, deviation: d };
      }
      if (Math.abs(d) <= toleranceM) pass += 1;
      else if (d < 0) outUnder += 1;
      else outOver += 1;
    }
  }

  if (n === 0) {
    throw new Error('出来形評価点がありません（モデル範囲を確認してください）');
  }

  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const std = Math.sqrt(variance);
  const passRate = (pass / n) * 100;

  return {
    method: 'grid_vs_design',
    gridM,
    toleranceM,
    n,
    mean,
    std,
    min,
    max,
    passRate,
    outUnder,
    outOver,
    worstUnder,
    worstOver,
    verdict: passRate >= PASS_THRESHOLD ? 'pass' : 'fail',
    verdictBasis: `規格値 ±${toleranceM.toFixed(2)}m、合格率 ${PASS_THRESHOLD}% 以上（サンプル基準）`,
  };
}

/** 盛土の設計／現況体積と不足・過剰 */
export function embankmentBalance(model: SiteModel, gridM = DEFAULT_GRID): EmbankmentBalance {
  let design = 0;
  let current = 0;
  let under = 0;
  let over = 0;
  const cell = gridM * gridM;

  for (let x = EMB_BOUNDS.x0 + gridM / 2; x < EMB_BOUNDS.x1; x += gridM) {
    for (let z = EMB_BOUNDS.z0 + gridM / 2; z < EMB_BOUNDS.z1; z += gridM) {
      const shape = embShape(x, z);
      if (shape <= 0.02) continue;
      const cur = embCur(x, z, model);
      design += shape * cell;
      current += cur * cell;
      if (cur < shape) under += (shape - cur) * cell;
      else over += (cur - shape) * cell;
    }
  }

  return {
    designVolumeM3: design,
    currentVolumeM3: current,
    underVolumeM3: under,
    overVolumeM3: over,
    netRequiredM3: under - over,
    gridM,
  };
}

/** 指定Zの横断面（現況 vs 設計） */
export function crossSection(model: SiteModel, z0: number): CrossSection {
  const points: SectionPoint[] = [];
  let worstDeviation = 0;
  let worstX = 0;

  for (let x = -17; x <= 13.0001; x += 0.25) {
    const shape = embShape(x, z0);
    const current = height(x, z0, model);
    const design = shape > 0 ? designAt(x, z0) : null;
    let deviation: number | null = null;
    if (design !== null) {
      deviation = current - design;
      if (Math.abs(deviation) > Math.abs(worstDeviation)) {
        worstDeviation = deviation;
        worstX = x;
      }
    }
    points.push({ x, current, design, deviation });
  }

  return { z0, worstDeviation, worstX, points };
}

function designAt(x: number, z: number): number {
  // 局所 import を避けるため terrain の公開関数を利用（tree-shaking 済み）
  return baseHeight(x, z) + embShape(x, z);
}

function baseHeight(x: number, z: number): number {
  // terrain.design と同じ式。height()と循環しないよう直接計算する。
  return 0.12 * Math.sin(x * 0.13) * Math.cos(z * 0.17) + 0.08 * Math.sin(x * 0.31 + z * 0.23);
}

/**
 * 重機の安全離隔スキャン。
 * 危険エリア半径は「旋回中心→バケット先端の最大水平距離 + 余裕1.0m」。
 * 60秒分を0.2秒刻みで走査し、最小離隔と最初の侵入時刻を返す。
 */
export function safetyScan(model: SiteModel): SafetyScan {
  const step = 0.2;
  const monitoredSeconds = 60;
  const marginM = 1.0;

  let maxRadius = 0;
  for (let t = 0; t <= monitoredSeconds; t += step) {
    maxRadius = Math.max(maxRadius, workRadius(model, t));
  }
  const radiusM = Math.ceil((maxRadius + marginM) * 10) / 10;

  let minDistanceM = Number.POSITIVE_INFINITY;
  let minWorkerIndex = 0;
  let minSeconds = 0;
  let intrusionAtSeconds: number | null = null;

  for (let t = 0; t <= monitoredSeconds; t += step) {
    for (let k = 0; k < 3; k += 1) {
      const p = workerPos(k, t);
      const d = Math.hypot(p.x - EXCAVATOR.x, p.z - EXCAVATOR.z);
      if (d < minDistanceM) {
        minDistanceM = d;
        minWorkerIndex = k;
        minSeconds = t;
      }
      if (intrusionAtSeconds === null && d < radiusM) {
        intrusionAtSeconds = t;
      }
    }
  }

  const snapshotSeconds = minSeconds;
  const excavator = {
    x: EXCAVATOR.x,
    y: excavatorY(model),
    z: EXCAVATOR.z,
  };
  const bucket = bucketPos(model, snapshotSeconds);
  const workers: SafetyWorker[] = [0, 1, 2].map((k) => {
    const p = workerPos(k, snapshotSeconds);
    const d = Math.hypot(p.x - EXCAVATOR.x, p.z - EXCAVATOR.z);
    return {
      id: `W-0${k + 1}`,
      x: p.x,
      z: p.z,
      distanceM: d,
      inside: d < radiusM,
    };
  });

  return {
    radiusM,
    monitoredSeconds,
    scanStepSeconds: step,
    excavator,
    bucket,
    workers,
    minDistanceM,
    minWorker: `W-0${minWorkerIndex + 1}`,
    intruded: minDistanceM < radiusM,
    intrusionAtSeconds,
    snapshotSeconds,
    verdict: minDistanceM < radiusM ? 'intruded' : 'clear',
    basis: `旋回半径＋余裕 ${marginM.toFixed(1)}m、監視 ${monitoredSeconds}秒（0.2秒刻み）`,
  };
}

/** 多角形範囲の切土・盛土体積（グリッド積分）。手動計測ツール用。 */
export function volumeInPolygon(
  polygon: Array<{ x: number; z: number }>,
  model: SiteModel,
  referenceY = 0,
  step = 0.5,
): { cutM3: number; fillM3: number; areaM2: number; cells: number } {
  if (polygon.length < 3) {
    return { cutM3: 0, fillM3: 0, areaM2: 0, cells: 0 };
  }
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const p of polygon) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }

  let cut = 0;
  let fill = 0;
  let cells = 0;
  const cell = step * step;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let z = z0 + step / 2; z < z1; z += step) {
      if (!pointInPolygon(x, z, polygon)) continue;
      cells += 1;
      const h = height(x, z, model) - referenceY;
      if (h > 0) cut += h * cell;
      else fill += -h * cell;
    }
  }

  return { cutM3: cut, fillM3: fill, areaM2: polygonArea(polygon), cells };
}

export function pointInPolygon(
  x: number,
  z: number,
  polygon: Array<{ x: number; z: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonArea(polygon: Array<{ x: number; z: number }>): number {
  let s = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    s += (polygon[j]!.x + polygon[i]!.x) * (polygon[j]!.z - polygon[i]!.z);
  }
  return Math.abs(s) / 2;
}

export { clamp };
