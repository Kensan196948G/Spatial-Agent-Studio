/**
 * 現場の解析的3Dモデル（サンプル現場）。
 *
 * 実運用では3DGS/点群に置き換わる部分ですが、MVPでは「同じ入力なら必ず同じ答え」を
 * 保証するための決定的な解析モデルとして実装しています。フロントの3Dビューと
 * サーバの計算エンジンがこのモジュールを共有します。
 */

export type SiteModel = {
  /** 盛土の施工進捗 0..1 */
  progress: number;
  /** 地山の見え方（4D版ごとの差分） */
  terrainScale: number;
  /** シーン生成用の乱数シード */
  seed: number;
};

export type SiteVersion = {
  date: string;
  label: string;
  progress: number;
  terrainScale: number;
};

export const SITE_VERSIONS: SiteVersion[] = [
  { date: '2026-10-02', label: '10/02', progress: 0.35, terrainScale: 1.3 },
  { date: '2026-10-16', label: '10/16', progress: 0.55, terrainScale: 1.22 },
  { date: '2026-10-30', label: '10/30', progress: 0.72, terrainScale: 1.15 },
  { date: '2026-11-06', label: '11/06', progress: 0.85, terrainScale: 1.09 },
  { date: '2026-11-13', label: '11/13', progress: 0.94, terrainScale: 1.04 },
  { date: '2026-11-18', label: '11/18', progress: 1, terrainScale: 1 },
];

export const DEFAULT_MODEL: SiteModel = {
  progress: 1,
  terrainScale: 1,
  seed: 20261118,
};

export function modelForProgress(progress: number, seed = DEFAULT_MODEL.seed): SiteModel {
  const p = Math.max(0, Math.min(1, progress));
  const v = SITE_VERSIONS.find((x) => Math.abs(x.progress - p) < 1e-6);
  return { progress: p, terrainScale: v ? v.terrainScale : 1, seed };
}

/** 決定的な乱数生成器（シーン生成用。測定値には使用しない） */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dist3 = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** 基本地形（川底・平場のうねり） */
export function base(x: number, z: number): number {
  return 0.12 * Math.sin(x * 0.13) * Math.cos(z * 0.17) + 0.08 * Math.sin(x * 0.31 + z * 0.23);
}

/** 切土対象の地山（ガウス丘） */
export function hill(x: number, z: number): number {
  return 6.2 * Math.exp(-((x + 32) ** 2 + (z - 6) ** 2) / 60);
}

/** 盛土の設計形状（法肩・法面を含む） */
export function embShape(x: number, z: number): number {
  const dx = Math.max(0, -8 - x, x - 4);
  const dz = Math.max(0, Math.abs(z) - 8);
  return Math.max(0, 4 - Math.max(dx, dz) / 1.5);
}

/** 盛土の施工ばらつき（局所的な不足・過剰） */
export function dev(x: number, z: number): number {
  return (
    0.1 * Math.sin(x * 0.45) * Math.cos(z * 0.38) +
    0.06 * Math.sin(z * 0.9 + 1.3) -
    0.52 * Math.exp(-((x + 3) ** 2 + (z - 4) ** 2) / 12) +
    0.34 * Math.exp(-((x - 2) ** 2 + (z + 5) ** 2) / 6)
  );
}

/** 現況の盛土形状（進捗を考慮） */
export function embCur(x: number, z: number, model: SiteModel): number {
  const s = embShape(x, z);
  if (s <= 0) return 0;
  const k = Math.min(1, s / 0.6);
  return Math.max(0, s + dev(x, z) * k) * clamp(model.progress, 0, 1);
}

/** 設計面の高さ */
export function design(x: number, z: number): number {
  return base(x, z) + embShape(x, z);
}

/** 現況地盤の高さ（3Dビューと測定の基準） */
export function height(x: number, z: number, model: SiteModel = DEFAULT_MODEL): number {
  if (x > 17.8 && x <= 21.2) return -(x - 18) * 0.85;
  if (x > 21.2 && x < 34) return -2.8;
  if (x >= 34 && x < 37) return -2.8 + ((x - 34) / 3) * 2.8 + (base(x, z) * (x - 34)) / 3;
  return base(x, z) + hill(x, z) * model.terrainScale + embCur(x, z, model);
}

export const EXCAVATOR = { x: -19, z: 7 };
export const TRUCK_PATH = { cx: -16, cz: -20, a: 15, b: 5 };

export function excavatorY(model: SiteModel = DEFAULT_MODEL): number {
  return height(EXCAVATOR.x, EXCAVATOR.z, model);
}

/** 作業員の位置（匿名ID W-01〜W-03 の軌道） */
export function workerPos(k: number, t: number): { x: number; z: number } {
  if (k === 0) {
    return { x: -2 + 5 * Math.sin(t * 0.12), z: 1 + 3 * Math.sin(t * 0.07) };
  }
  if (k === 1) {
    const d = 8.6 + 3.6 * Math.cos(t * 0.45);
    return { x: EXCAVATOR.x + 0.8 * d, z: EXCAVATOR.z - 0.6 * d };
  }
  return { x: 15.4, z: -10 + 6 * Math.sin(t * 0.1) };
}

export function truckPos(t: number): { x: number; z: number; dx: number; dz: number } {
  const th = t * 0.22;
  return {
    x: TRUCK_PATH.cx + TRUCK_PATH.a * Math.cos(th),
    z: TRUCK_PATH.cz + TRUCK_PATH.b * Math.sin(th),
    dx: -TRUCK_PATH.a * Math.sin(th),
    dz: TRUCK_PATH.b * Math.cos(th),
  };
}

export function swingAt(t: number): number {
  return 0.95 * Math.sin(t * 0.55) + 0.15;
}

export function rotY(lx: number, lz: number, a: number): [number, number] {
  return [lx * Math.cos(a) + lz * Math.sin(a), -lx * Math.sin(a) + lz * Math.cos(a)];
}

/** バケット先端の世界座標 */
export function bucketPos(
  model: SiteModel = DEFAULT_MODEL,
  t = 0,
): { x: number; y: number; z: number } {
  const [x, z] = rotY(6.4, -0.35, swingAt(t));
  return { x: EXCAVATOR.x + x, y: excavatorY(model) + 0.9, z: EXCAVATOR.z + z };
}

/** 作業半径（旋回中心→バケット先端の水平距離） */
export function workRadius(model: SiteModel = DEFAULT_MODEL, t = 0): number {
  const b = bucketPos(model, t);
  return Math.hypot(b.x - EXCAVATOR.x, b.z - EXCAVATOR.z);
}
