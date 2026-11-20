/**
 * 3D現場ビュー（Canvas2Dレンダラ）。
 *
 * 既存の承認済みプロトタイプ（V2.1 システム版）の Canvas2D レンダラ／
 * 解析的シーンモデルを、MVP用にTypeScriptモジュールへ移植したものです。
 * WebGPUはMVPでは使用せず、Canvas2Dを明示的なフォールバックとして使います。
 */

import {
  DEFAULT_MODEL,
  EXCAVATOR,
  SITE_VERSIONS,
  base,
  bucketPos,
  clamp,
  design,
  embCur,
  embShape,
  excavatorY,
  height,
  hill,
  lerp,
  rng,
  swingAt,
  truckPos,
  workerPos,
  type SiteModel,
} from '@shared/terrain';
import type { LayerKey, OverlaySpec, SceneGroup, Vec3 } from '@shared/types';

export type ViewerStats = { splats: number; visible: number; renderer: string; simTime: number };

export type ViewerApi = {
  resize: (width: number, height: number) => void;
  setScene: (progress: number, terrainScale: number) => void;
  setLayers: (layers: Partial<Record<LayerKey, boolean>>) => void;
  setLayer: (layer: LayerKey, on: boolean) => void;
  setHeatmap: (on: boolean) => void;
  setPrivacy: (on: boolean) => void;
  setOverlays: (overlays: OverlaySpec[]) => void;
  clearOverlays: () => void;
  setView: (view: CameraViewName, durationMs?: number) => void;
  setSimTime: (seconds: number | null) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  getSimTime: () => number;
  getStats: () => ViewerStats;
  destroy: () => void;
};

export type CameraViewName = 'all' | 'emb' | 'cut' | 'exc' | 'rev';

const G = {
  GROUND: 0,
  EMB: 1,
  HILL: 2,
  REV: 3,
  WATER: 4,
  EXC_B: 5,
  EXC_U: 6,
  TRUCK: 7,
  W1: 8,
  W2: 9,
  W3: 10,
  TREE: 11,
  OFFICE: 12,
  DESIGN: 13,
  CRACK: 14,
} as const;
const NG = 15;

const LAYER_OF: LayerKey[] = [
  'terrain',
  'embankment',
  'terrain',
  'revetment',
  'river',
  'machine',
  'machine',
  'machine',
  'worker',
  'worker',
  'worker',
  'vegetation',
  'terrain',
  'design',
  'revetment',
];

const SCENE_GROUPS: Record<SceneGroup, number[]> = {
  embankment: [G.EMB],
  excavator: [G.EXC_B, G.EXC_U],
  'worker-1': [G.W1],
  'worker-2': [G.W2],
  'worker-3': [G.W3],
  revetment: [G.REV],
  terrain: [G.GROUND, G.HILL],
  design: [G.DESIGN],
};

type Buf = {
  pos: number[];
  col: number[];
  size: number[];
  alpha: number[];
  grp: number[];
  aux: number[];
};

const B: Buf = { pos: [], col: [], size: [], alpha: [], grp: [], aux: [] };
const GR: Record<number, { s: number; e: number }> = {};
const R = rng(20261118);
const rr = (a: number, b: number): number => a + (b - a) * R();

function add(
  x: number,
  y: number,
  z: number,
  r: number,
  g: number,
  b: number,
  s: number,
  a: number,
  gp: number,
  aux = 0,
): void {
  B.pos.push(x, y, z);
  B.col.push(clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1));
  B.size.push(s);
  B.alpha.push(a);
  B.grp.push(gp);
  B.aux.push(aux);
}

const beginG = (g: number): void => {
  GR[g] = { s: B.size.length, e: 0 };
};
const endG = (g: number): void => {
  GR[g]!.e = B.size.length;
};

function box(
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  step: number,
  col: [number, number, number],
  size: number,
  gp: number,
  jit = 0.05,
  faceCol?: (nx: number, ny: number, nz: number, p: Vec3) => [number, number, number] | null,
): void {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const face = (nx: number, ny: number, nz: number): void => {
    const ax: ['x' | 'y' | 'z', 'x' | 'y' | 'z'] = nx ? ['y', 'z'] : ny ? ['x', 'z'] : ['x', 'y'];
    const ext = { x: hx, y: hy, z: hz };
    for (let u = -ext[ax[0]]; u <= ext[ax[0]] + 1e-6; u += step) {
      for (let v = -ext[ax[1]]; v <= ext[ax[1]] + 1e-6; v += step) {
        const p: Vec3 = { x: nx * hx, y: ny * hy, z: nz * hz };
        p[ax[0]] = u + rr(-jit, jit);
        p[ax[1]] = v + rr(-jit, jit);
        const c = faceCol?.(nx, ny, nz, p) ?? col;
        const n = rr(-0.03, 0.03);
        add(cx + p.x, cy + p.y, cz + p.z, c[0] + n, c[1] + n, c[2] + n, size, 1, gp);
      }
    }
  };
  face(1, 0, 0);
  face(-1, 0, 0);
  face(0, 1, 0);
  face(0, -1, 0);
  face(0, 0, 1);
  face(0, 0, -1);
}

function tube(
  pts: Array<[number, number, number]>,
  rad: number,
  step: number,
  col: [number, number, number],
  size: number,
  gp: number,
): void {
  for (let k = 0; k < pts.length - 1; k += 1) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    for (let s = 0; s <= L; s += step) {
      const t = s / L;
      const x = lerp(a[0], b[0], t);
      const y = lerp(a[1], b[1], t);
      const z = lerp(a[2], b[2], t);
      for (let q = 0; q < 5; q += 1) {
        const an = (q / 5) * Math.PI * 2;
        const n = rr(-0.03, 0.03);
        add(x, y + Math.cos(an) * rad, z + Math.sin(an) * rad, col[0] + n, col[1] + n, col[2] + n, size, 1, gp);
      }
    }
  }
}

const LD = (() => {
  const l = Math.hypot(-0.5, 0.8, 0.35);
  return [-0.5 / l, 0.8 / l, 0.35 / l] as const;
})();

function lit(x: number, z: number): number {
  const e = 0.35;
  const hx = (height(x + e, z, DEFAULT_MODEL) - height(x - e, z, DEFAULT_MODEL)) / (2 * e);
  const hz = (height(x, z + e, DEFAULT_MODEL) - height(x, z - e, DEFAULT_MODEL)) / (2 * e);
  const l = Math.hypot(hx, 1, hz);
  const d = (-hx * LD[0] + LD[1] - hz * LD[2]) / l;
  return 0.55 + 0.55 * Math.max(0, d);
}

function buildScene(): void {
  // ground / hill
  for (let x = -46; x <= 46; x += 1.12) {
    for (let z = -33; z <= 33; z += 1.12) {
      const px = x + rr(-0.35, 0.35);
      const pz = z + rr(-0.35, 0.35);
      if (px > 17.8 && px < 34) continue;
      if (embShape(px, pz) > 0.02) continue;
      const y = height(px, pz, DEFAULT_MODEL);
      const hh = hill(px, pz);
      const n = rr(-0.05, 0.05);
      const site = px > -42 && px < 17.8 && pz > -28 && pz < 28;
      const e = Math.hypot((px + 16) / 15, (pz + 20) / 5);
      let c: [number, number, number];
      let g: number = G.GROUND;
      if (px >= 34 || !site) c = [0.27 + n, 0.47 + n * 1.5, 0.22 + n];
      else if (hh > 0.35) {
        g = G.HILL;
        const gr = hh > 4.6 && R() < 0.55;
        c = gr ? [0.33 + n, 0.46 + n, 0.22] : [0.47 + n + hh * 0.01, 0.35 + n, 0.24 + n];
      } else if (Math.abs(e - 1) < 0.13) c = [0.55 + n, 0.53 + n, 0.5 + n];
      else c = [0.58 + n, 0.46 + n, 0.32 + n];
      const L = lit(px, pz);
      add(px, y, pz, c[0] * L, c[1] * L, c[2] * L, 1.22, 0.96, g);
    }
  }

  // embankment
  for (let x = -15; x <= 11; x += 0.7) {
    for (let z = -15; z <= 15; z += 0.7) {
      const px = x + rr(-0.2, 0.2);
      const pz = z + rr(-0.2, 0.2);
      const s = embShape(px, pz);
      if (s <= 0.02) continue;
      const cur = embCur(px, pz, DEFAULT_MODEL);
      const y = base(px, pz) + cur;
      const d = cur - s;
      const n = rr(-0.035, 0.035);
      const band = Math.floor(cur / 0.5) % 2 ? 0.045 : 0;
      const stripe = s > 3.95 && Math.floor(px * 1.3) % 2 ? -0.035 : 0;
      const L = lit(px, pz);
      add(
        px,
        y,
        pz,
        (0.74 + n + band + stripe) * L,
        (0.6 + n + band + stripe) * L,
        (0.42 + n + band * 0.6) * L,
        0.9,
        0.97,
        G.EMB,
        d,
      );
    }
  }

  // revetment
  beginG(G.REV);
  for (let x = 17.8; x <= 21.2; x += 0.37) {
    for (let z = -33; z <= 33; z += 0.37) {
      const px = x + rr(-0.06, 0.06);
      const pz = z + rr(-0.06, 0.06);
      const y = -(px - 18) * 0.85;
      const n = rr(-0.04, 0.04);
      const joint = (pz + 33) % 2 < 0.24 || (px - 17.8) % 1.13 < 0.14;
      const c = joint ? 0.47 : 0.67;
      add(px, y, pz, c + n, c + n, c - 0.02 + n, 0.5, 1, G.REV);
    }
  }
  for (let z = -33; z <= 33; z += 0.36) {
    add(17.55, 0.2, z + rr(-0.04, 0.04), 0.82, 0.82, 0.8, 0.3, 1, G.REV);
  }
  endG(G.REV);

  // cracks
  beginG(G.CRACK);
  const cdef = [
    { id: 'C-1', pl: [[18.35, -6.0], [18.9, -5.5], [19.3, -5.7], [19.9, -5.0], [20.5, -4.6]] },
    { id: 'C-2', pl: [[18.4, 3.9], [18.9, 4.2], [19.4, 4.0], [19.8, 4.4]] },
    { id: 'C-3', pl: [[18.7, 12.8], [19.0, 13.2], [19.3, 13.3]] },
  ] as const;
  for (const c of cdef) {
    const pts = c.pl.map(([x, z]) => ({ x: x - 0.03, y: -(x - 18) * 0.85 + 0.07, z }));
    for (let k = 0; k < pts.length - 1; k += 1) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      const l = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      for (let u = 0; u <= l; u += 0.05) {
        const t = u / l;
        add(
          lerp(a.x, b.x, t) + rr(-0.012, 0.012),
          lerp(a.y, b.y, t) + rr(-0.012, 0.012),
          lerp(a.z, b.z, t) + rr(-0.02, 0.02),
          0.1,
          0.09,
          0.08,
          0.085,
          1,
          G.CRACK,
        );
      }
    }
  }
  endG(G.CRACK);

  // water
  beginG(G.WATER);
  for (let x = 21.3; x <= 34.2; x += 1.15) {
    for (let z = -34; z <= 34; z += 1.15) {
      const n = rr(-0.04, 0.04);
      add(x + rr(-0.3, 0.3), -1.95, z + rr(-0.3, 0.3), 0.15 + n, 0.37 + n, 0.62 + n, 0.95, 0.84, G.WATER, rr(0, 6.28));
    }
  }
  endG(G.WATER);

  // excavator
  const Y: [number, number, number] = [0.96, 0.73, 0.12];
  const DG: [number, number, number] = [0.17, 0.17, 0.19];
  beginG(G.EXC_B);
  box(0, 0.45, 1.15, 4.4, 0.9, 0.8, 0.3, DG, 0.24, G.EXC_B);
  box(0, 0.45, -1.15, 4.4, 0.9, 0.8, 0.3, DG, 0.24, G.EXC_B);
  box(0, 1.0, 0, 1.4, 0.3, 1.4, 0.3, [0.3, 0.3, 0.32], 0.22, G.EXC_B);
  endG(G.EXC_B);
  beginG(G.EXC_U);
  box(-0.2, 1.6, 0, 3.0, 1.1, 2.5, 0.28, Y, 0.22, G.EXC_U);
  box(-1.85, 1.65, 0, 0.7, 1.1, 2.4, 0.28, [0.82, 0.6, 0.1], 0.22, G.EXC_U);
  box(0.75, 2.65, 0.75, 1.1, 1.2, 1.0, 0.22, Y, 0.2, G.EXC_U, 0.04, (nx, _ny, nz, p) =>
    (nx === 1 && p.y > -0.1) || (nz === 1 && p.y > 0) ? [0.16, 0.26, 0.38] : null,
  );
  tube([[1.0, 2.1, -0.35], [4.0, 4.7, -0.35], [6.3, 1.5, -0.35]], 0.2, 0.17, Y, 0.2, G.EXC_U);
  box(6.4, 0.9, -0.35, 0.9, 0.8, 1.0, 0.2, [0.25, 0.25, 0.27], 0.2, G.EXC_U);
  endG(G.EXC_U);

  // dump truck
  beginG(G.TRUCK);
  box(0, 0.75, 0, 5.4, 0.35, 2.0, 0.3, [0.2, 0.2, 0.22], 0.22, G.TRUCK);
  box(2.1, 1.7, 0, 1.3, 1.5, 2.0, 0.25, [0.88, 0.9, 0.93], 0.21, G.TRUCK, 0.04, (nx, _ny, _nz, p) =>
    nx === 1 && p.y > 0 ? [0.15, 0.25, 0.38] : null,
  );
  box(-0.85, 1.55, 0, 3.5, 1.1, 2.1, 0.28, [0.9, 0.45, 0.15], 0.22, G.TRUCK);
  for (let k = 0; k < 70; k += 1) {
    const u = rr(-1.6, 1.6);
    const v = rr(-0.9, 0.9);
    add(-0.85 + u, 2.15 + 0.35 * (1 - Math.abs(u) / 1.7) * (1 - Math.abs(v)), v, 0.5, 0.38, 0.25, 0.26, 1, G.TRUCK);
  }
  for (const wx of [1.9, -0.4, -1.9]) {
    for (const wz of [-1.0, 1.0]) box(wx, 0.45, wz, 0.8, 0.8, 0.35, 0.22, [0.08, 0.08, 0.09], 0.2, G.TRUCK);
  }
  endG(G.TRUCK);

  // workers
  for (const g of [G.W1, G.W2, G.W3]) {
    beginG(g);
    for (const lz of [-0.13, 0.13]) {
      for (let y = 0.05; y <= 0.86; y += 0.13) add(0, y, lz, 0.16, 0.2, 0.38, 0.13, 1, g);
    }
    for (let y = 0.92; y <= 1.46; y += 0.11) {
      for (let q = 0; q < 7; q += 1) {
        const a = (q / 7) * Math.PI * 2;
        const st = Math.abs(y - 1.2) < 0.06;
        add(Math.cos(a) * 0.2, y, Math.sin(a) * 0.22, st ? 0.95 : 1, st ? 0.95 : 0.55, st ? 0.6 : 0.1, 0.12, 1, g);
      }
    }
    for (let q = 0; q < 6; q += 1) add(rr(-0.08, 0.08), 1.6 + rr(-0.05, 0.05), rr(-0.08, 0.08), 0.82, 0.66, 0.52, 0.11, 1, g);
    for (let q = 0; q < 9; q += 1) {
      const a = (q / 9) * Math.PI * 2;
      add(Math.cos(a) * 0.13, 1.76, Math.sin(a) * 0.13, 0.97, 0.97, 0.97, 0.12, 1, g);
    }
    endG(g);
  }

  // trees
  beginG(G.TREE);
  const trees = [
    [-44, -28], [-44, -14], [-44, 0], [-44, 15], [-43, 28], [-30, 31], [-14, 31], [2, 31], [12, 30],
    [-30, -31], [-14, -31], [2, -31], [13, -30], [40, -24], [41, -8], [40, 9], [42, 24],
  ];
  for (const [tx, tz] of trees) {
    const ty = height(tx, tz, DEFAULT_MODEL);
    const h = rr(0.85, 1.25);
    for (let y = 0; y < 1.6 * h; y += 0.25) add(tx, ty + y, tz, 0.35, 0.24, 0.15, 0.2, 1, G.TREE);
    for (let k = 0; k < 55; k += 1) {
      const a = rr(0, 6.28);
      const r = Math.sqrt(R()) * 1.6 * h;
      const yy = rr(-1.2, 1.4) * h;
      const n = rr(-0.06, 0.06);
      add(
        tx + Math.cos(a) * r * (1 - Math.abs(yy) / 2.4),
        ty + 2.9 * h + yy,
        tz + Math.sin(a) * r * (1 - Math.abs(yy) / 2.4),
        0.2 + n,
        0.45 + n * 1.4,
        0.18 + n,
        0.48,
        0.95,
        G.TREE,
      );
    }
  }
  endG(G.TREE);

  // site office
  const oy = height(-34, -21, DEFAULT_MODEL);
  box(-34, oy + 1.35, -21, 6, 2.6, 2.6, 0.38, [0.9, 0.92, 0.95], 0.3, G.OFFICE, 0.04, (_nx, ny, nz, p) =>
    ny === 1 ? [0.35, 0.4, 0.5] : nz === 1 && Math.abs(p.y) < 0.6 ? [0.25, 0.45, 0.7] : null,
  );

  // design surface
  beginG(G.DESIGN);
  for (let x = -14; x <= 10; x += 0.9) {
    for (let z = -14; z <= 14; z += 0.9) {
      const s = embShape(x, z);
      if (s <= 0.02) continue;
      add(x, design(x, z) + 0.06, z, 0.25, 0.9, 1, 0.2, 0.75, G.DESIGN);
    }
  }
  endG(G.DESIGN);
}

buildScene();

const N = B.size.length;
const P0 = new Float32Array(B.pos);
const W = new Float32Array(B.pos);
const C0 = new Float32Array(B.col);
const SZ = new Float32Array(B.size);
const AL = new Float32Array(B.alpha);
const GP = new Uint8Array(B.grp);
const AUX = new Float32Array(B.aux);
const SX = new Float32Array(N);
const SY = new Float32Array(N);
const SW = new Float32Array(N);
const sorted: number[] = [];
const grect: Array<{ x0: number; y0: number; x1: number; y1: number; n: number }> = Array.from(
  { length: NG },
  () => ({ x0: 0, y0: 0, x1: 0, y1: 0, n: 0 }),
);

// 3D dynamics
const sim = { excPaused: false, swing: 0.2, t: 0 };

function placeGroup(g: number, ox: number, oy: number, oz: number, ang: number): void {
  const r = GR[g]!;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  for (let i = r.s; i < r.e; i += 1) {
    const lx = P0[i * 3]!;
    const ly = P0[i * 3 + 1]!;
    const lz = P0[i * 3 + 2]!;
    W[i * 3] = ox + lx * c + lz * s;
    W[i * 3 + 1] = oy + ly;
    W[i * 3 + 2] = oz - lx * s + lz * c;
  }
}

function updateDynamic(model: SiteModel, t: number): void {
  sim.t = t;
  const wr = GR[G.WATER]!;
  for (let i = wr.s; i < wr.e; i += 1) {
    W[i * 3 + 1] = -1.95 + 0.07 * Math.sin(t * 1.6 + P0[i * 3]! * 0.7 + P0[i * 3 + 2]! * 0.45 + AUX[i]! * 0.3);
  }
  if (!sim.excPaused) sim.swing = swingAt(t);
  const ey = excavatorY(model);
  placeGroup(G.EXC_B, EXCAVATOR.x, ey, EXCAVATOR.z, 0.15);
  placeGroup(G.EXC_U, EXCAVATOR.x, ey, EXCAVATOR.z, sim.swing);
  const tp = truckPos(t);
  placeGroup(G.TRUCK, tp.x, height(tp.x, tp.z, model), tp.z, Math.atan2(-tp.dz, tp.dx));
  [G.W1, G.W2, G.W3].forEach((g, k) => {
    const p = workerPos(k, t);
    const q = workerPos(k, t + 0.08);
    const ang = Math.atan2(-(q.z - p.z), q.x - p.x);
    const y = height(p.x, p.z, model);
    placeGroup(g, p.x, y, p.z, ang);
  });
}

// camera
type Camera = { yaw: number; pitch: number; dist: number; tx: number; ty: number; tz: number; fov: number };
const cam: Camera = { yaw: 0.75, pitch: 0.62, dist: 88, tx: -6, ty: 0, tz: 2, fov: (50 * Math.PI) / 180 };
const VIEWS: Record<CameraViewName, Omit<Camera, 'fov'>> = {
  all: { yaw: 0.75, pitch: 0.62, dist: 88, tx: -6, ty: 0, tz: 2 },
  emb: { yaw: 0.42, pitch: 0.62, dist: 40, tx: -2, ty: 2, tz: 0 },
  cut: { yaw: 1.05, pitch: 0.62, dist: 42, tx: -27, ty: 2, tz: 3 },
  exc: { yaw: 0.85, pitch: 0.8, dist: 44, tx: -16, ty: 1, tz: 4 },
  rev: { yaw: 1.4, pitch: 0.62, dist: 24, tx: 19.6, ty: -1.3, tz: 4 },
};

let Wc = 800;
let Hc = 600;
const M = new Float32Array(16);
let focal = 800;
let eye = { x: 0, y: 0, z: 0 };

function computeVP(): void {
  const cp = Math.cos(cam.pitch);
  eye = {
    x: cam.tx + cam.dist * cp * Math.sin(cam.yaw),
    y: cam.ty + cam.dist * Math.sin(cam.pitch),
    z: cam.tz + cam.dist * cp * Math.cos(cam.yaw),
  };
  let zx = eye.x - cam.tx;
  let zy = eye.y - cam.ty;
  let zz = eye.z - cam.tz;
  const l = Math.hypot(zx, zy, zz);
  zx /= l;
  zy /= l;
  zz /= l;
  let xx = zz;
  const xy = 0;
  let xz = -zx;
  const ll = Math.hypot(xx, xz) || 1;
  xx /= ll;
  xz /= ll;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const V = [
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye.x + xy * eye.y + xz * eye.z),
    -(yx * eye.x + yy * eye.y + yz * eye.z),
    -(zx * eye.x + zy * eye.y + zz * eye.z),
    1,
  ];
  const f = 1 / Math.tan(cam.fov / 2);
  const asp = Wc / Hc;
  const near = 0.5;
  const far = 600;
  const nf = 1 / (near - far);
  const P = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, far * nf, -1, 0, 0, far * near * nf, 0];
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += P[k * 4 + r]! * V[c * 4 + k]!;
      M[c * 4 + r] = s;
    }
  }
  focal = (Hc / 2) * f;
}

function proj(p: Vec3): { x: number; y: number; w: number } | null {
  const w = M[3]! * p.x + M[7]! * p.y + M[11]! * p.z + M[15]!;
  if (w < 0.5) return null;
  const cx = M[0]! * p.x + M[4]! * p.y + M[8]! * p.z + M[12]!;
  const cy = M[1]! * p.x + M[5]! * p.y + M[9]! * p.z + M[13]!;
  return { x: (cx / w * 0.5 + 0.5) * Wc, y: (1 - (cy / w * 0.5 + 0.5)) * Hc, w };
}

// layer state
const layers: Record<LayerKey, boolean> = {
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
const grpVis = new Uint8Array(NG);
function refreshVis(): void {
  for (let g = 0; g < NG; g += 1) grpVis[g] = layers[LAYER_OF[g]!] ? 1 : 0;
}
refreshVis();

const ST = {
  heatmap: false,
  privacy: true,
  hi: new Map<number, [number, number, number]>(),
  scan: null as null | { axis: 'x' | 'z'; pos: number },
};

let FOG: [number, number, number] = [0.08, 0.14, 0.3];
const HEAT: Array<[number, [number, number, number]]> = [
  [-1, [0.16, 0.39, 1]],
  [-0.5, [0.19, 0.75, 1]],
  [0, [0.24, 0.88, 0.5]],
  [0.5, [1, 0.83, 0.35]],
  [1, [1, 0.25, 0.25]],
];
function heat(d: number): [number, number, number] {
  const t = clamp(d / 0.4, -1, 1);
  for (let k = 0; k < HEAT.length - 1; k += 1) {
    const [a, ca] = HEAT[k]!;
    const [b, cb] = HEAT[k + 1]!;
    if (t <= b) {
      const u = (t - a) / (b - a);
      return [lerp(ca[0], cb[0], u), lerp(ca[1], cb[1], u), lerp(ca[2], cb[2], u)];
    }
  }
  return HEAT[4]![1];
}

let cr = 0;
let cg = 0;
let cb = 0;
let ca = 1;
let cs = 1;

function shade(i: number, t: number): void {
  let r = C0[i * 3]!;
  let g = C0[i * 3 + 1]!;
  let b = C0[i * 3 + 2]!;
  let a = AL[i]!;
  let s = SZ[i]!;
  const gp = GP[i]!;
  if (gp === G.WATER) {
    const w = 0.5 + 0.5 * Math.sin(t * 2.2 + AUX[i]! + W[i * 3]! * 0.5 + W[i * 3 + 2]! * 0.2);
    r += w * 0.07;
    g += w * 0.13;
    b += w * 0.16;
  } else if (gp === G.EMB && ST.heatmap) {
    const h = heat(AUX[i]!);
    r = h[0];
    g = h[1];
    b = h[2];
  } else if (gp >= G.W1 && gp <= G.W3 && ST.privacy) {
    r = 0.62;
    g = 0.52;
    b = 0.9;
    s *= 2.3;
    a = 0.5;
  } else if (gp === G.DESIGN) {
    const p = 0.5 + 0.5 * Math.sin(t * 2 + W[i * 3]! * 0.3);
    a = 0.45 + 0.35 * p;
  }
  if (gp <= G.REV) s *= 1.15;
  const hc = ST.hi.get(gp);
  if (hc) {
    const p = 0.35 + 0.25 * Math.sin(t * 6);
    r = lerp(r, hc[0], p);
    g = lerp(g, hc[1], p);
    b = lerp(b, hc[2], p);
  }
  if (ST.scan) {
    const v = ST.scan.axis === 'z' ? W[i * 3 + 2]! : W[i * 3]!;
    const d = (v - ST.scan.pos) / 1.4;
    const k = Math.exp(-d * d);
    if (k > 0.01) {
      r = lerp(r, 0.35, k * 0.85);
      g = lerp(g, 1, k * 0.85);
      b = lerp(b, 1, k * 0.85);
    }
  }
  const f = clamp((SW[i]! - 75) / 170, 0, 0.55);
  cr = lerp(r, FOG[0], f);
  cg = lerp(g, FOG[1], f);
  cb = lerp(b, FOG[2], f);
  ca = a;
  cs = s;
}

const sprites = new Map<number, HTMLCanvasElement>();
function sprite(r: number, g: number, b: number): HTMLCanvasElement {
  const ri = (r * 31 + 0.5) | 0;
  const gi = (g * 31 + 0.5) | 0;
  const bi = (b * 31 + 0.5) | 0;
  const key = (ri << 10) | (gi << 5) | bi;
  const cached = sprites.get(key);
  if (cached) return cached;
  const s = document.createElement('canvas');
  s.width = 32;
  s.height = 32;
  const x = s.getContext('2d')!;
  const R8 = (ri * 255) / 31 | 0;
  const G8 = (gi * 255) / 31 | 0;
  const B8 = (bi * 255) / 31 | 0;
  const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  ([
    [0, 1],
    [0.25, 0.78],
    [0.5, 0.37],
    [0.75, 0.11],
    [1, 0],
  ] as const).forEach(([o, a]) => gr.addColorStop(o, `rgba(${R8},${G8},${B8},${a})`));
  x.fillStyle = gr;
  x.fillRect(0, 0, 32, 32);
  sprites.set(key, s);
  return s;
}

function projectAll(): void {
  computeVP();
  for (const r of grect) {
    r.x0 = 1e9;
    r.y0 = 1e9;
    r.x1 = -1e9;
    r.y1 = -1e9;
    r.n = 0;
  }
  sorted.length = 0;
  const hw = Wc * 0.5;
  const hh = Hc * 0.5;
  const m0 = M[0]!;
  const m1 = M[1]!;
  const m3 = M[3]!;
  const m4 = M[4]!;
  const m5 = M[5]!;
  const m7 = M[7]!;
  const m8 = M[8]!;
  const m9 = M[9]!;
  const m11 = M[11]!;
  const m12 = M[12]!;
  const m13 = M[13]!;
  const m15 = M[15]!;
  for (let i = 0; i < N; i += 1) {
    const g = GP[i]!;
    if (!grpVis[g]) continue;
    const x = W[i * 3]!;
    const y = W[i * 3 + 1]!;
    const z = W[i * 3 + 2]!;
    const w = m3 * x + m7 * y + m11 * z + m15;
    if (w < 0.6) continue;
    const sx = ((m0 * x + m4 * y + m8 * z + m12) / w + 1) * hw;
    const sy = (1 - (m1 * x + m5 * y + m9 * z + m13) / w) * hh;
    const r = (SZ[i]! * focal) / w + 4;
    if (sx < -r || sx > Wc + r || sy < -r || sy > Hc + r) continue;
    SX[i] = sx;
    SY[i] = sy;
    SW[i] = w;
    sorted.push(i);
    const gr = grect[g]!;
    if (sx < gr.x0) gr.x0 = sx;
    if (sx > gr.x1) gr.x1 = sx;
    if (sy < gr.y0) gr.y0 = sy;
    if (sy > gr.y1) gr.y1 = sy;
    gr.n += 1;
  }
  sorted.sort((a, b) => SW[b]! - SW[a]!);
}

function drawSprites(ctx: CanvasRenderingContext2D, t: number): void {
  let lastA = -1;
  for (const i of sorted) {
    shade(i, t);
    const rad = Math.min((cs * focal) / SW[i]!, 90);
    if (rad < 0.35) continue;
    if (ca !== lastA) {
      ctx.globalAlpha = ca;
      lastA = ca;
    }
    ctx.drawImage(sprite(cr, cg, cb), SX[i]! - rad, SY[i]! - rad, rad * 2, rad * 2);
  }
  ctx.globalAlpha = 1;
}

// overlays
let overlays: OverlaySpec[] = [];

function aabb(groups: number[]): { min: Vec3; max: Vec3; center: Vec3; n: number } | null {
  const gs = new Set(groups);
  let x0 = 1e9;
  let y0 = 1e9;
  let z0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  let z1 = -1e9;
  let n = 0;
  for (let i = 0; i < N; i += 1) {
    if (!gs.has(GP[i]!)) continue;
    n += 1;
    const x = W[i * 3]!;
    const y = W[i * 3 + 1]!;
    const z = W[i * 3 + 2]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (!n) return null;
  return {
    min: { x: x0, y: y0, z: z0 },
    max: { x: x1, y: y1, z: z1 },
    center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 },
    n,
  };
}

function label(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
): void {
  ctx.font = '12px "Noto Sans JP", "Hiragino Sans", sans-serif';
  const w = Math.min(280, ctx.measureText(text).width + 16);
  const bx = Math.max(4, Math.min(Wc - w - 4, x - w / 2));
  const by = Math.max(4, y - 22);
  ctx.fillStyle = 'rgba(8, 14, 34, 0.88)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, 18, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e6ecff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 8, by + 9, w - 12);
  ctx.textAlign = 'start';
}

function drawOverlays(ctx: CanvasRenderingContext2D): void {
  if (!layers.ai) return;
  for (const o of overlays) {
    if (o.kind === 'bbox') {
      const gs = o.groups.flatMap((g) => SCENE_GROUPS[g]);
      const b = aabb(gs);
      if (!b) continue;
      const corners: Vec3[] = [];
      for (const x of [b.min.x, b.max.x]) {
        for (const y of [b.min.y, b.max.y]) {
          for (const z of [b.min.z, b.max.z]) corners.push({ x, y, z });
        }
      }
      const ps = corners.map(proj).filter((p): p is { x: number; y: number; w: number } => !!p);
      if (ps.length < 4) continue;
      const x0 = Math.min(...ps.map((p) => p.x));
      const x1 = Math.max(...ps.map((p) => p.x));
      const y0 = Math.min(...ps.map((p) => p.y));
      const y1 = Math.max(...ps.map((p) => p.y));
      const L = Math.min(16, (x1 - x0) / 3, (y1 - y0) / 3);
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + L);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x0 + L, y0);
      ctx.moveTo(x1 - L, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y0 + L);
      ctx.moveTo(x1, y1 - L);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 - L, y1);
      ctx.moveTo(x0 + L, y1);
      ctx.lineTo(x0, y1);
      ctx.lineTo(x0, y1 - L);
      ctx.stroke();
      label(ctx, (x0 + x1) / 2, y0, o.label, o.color);
    } else if (o.kind === 'ring') {
      const pts: Array<{ x: number; y: number }> = [];
      for (let k = 0; k <= 64; k += 1) {
        const a = (k / 64) * Math.PI * 2;
        const p = proj({
          x: o.center.x + o.radius * Math.cos(a),
          y: o.center.y + 0.25,
          z: o.center.z + o.radius * Math.sin(a),
        });
        if (!p) break;
        pts.push(p);
      }
      if (pts.length < 8) continue;
      ctx.strokeStyle = o.color;
      ctx.fillStyle = o.color;
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      const top = proj({ x: o.center.x, y: o.center.y + 0.25, z: o.center.z - o.radius });
      if (top) label(ctx, top.x, top.y, o.label, o.color);
    } else if (o.kind === 'link') {
      const a = proj(o.from);
      const b = proj(o.to);
      if (!a || !b) continue;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [a, b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = o.color;
        ctx.fill();
      }
      label(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2, o.label, o.color);
    } else {
      const p = proj(o.point);
      if (!p) continue;
      ctx.fillStyle = o.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      label(ctx, p.x, p.y - 8, o.label, o.color);
    }
  }
}

// camera tween
let tween: {
  from: Camera;
  to: Camera;
  p: number;
  dur: number;
  res?: () => void;
} | null = null;

function tweenStep(dtMs: number): void {
  if (!tween) return;
  tween.p += dtMs / tween.dur;
  const e = tween.p < 0.5 ? 4 * tween.p ** 3 : 1 - (-2 * tween.p + 2) ** 3 / 2;
  for (const k of ['yaw', 'pitch', 'dist', 'tx', 'ty', 'tz'] as const) {
    cam[k] = lerp(tween.from[k], tween.to[k], e);
  }
  if (tween.p >= 1) {
    const res = tween.res;
    tween = null;
    res?.();
  }
}

function setView(view: CameraViewName, durationMs = 800): void {
  const to = { ...cam, ...VIEWS[view] };
  let dy = to.yaw - cam.yaw;
  dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  to.yaw = cam.yaw + dy;
  const res = tween?.res;
  if (res) res();
  tween = { from: { ...cam }, to, p: 0, dur: Math.max(1, durationMs) };
}

// scene update
function applyScene(progress: number, terrainScale: number): SiteModel {
  const model: SiteModel = { ...DEFAULT_MODEL, progress: clamp(progress, 0, 1), terrainScale };
  for (let i = 0; i < N; i += 1) {
    const g = GP[i]!;
    if (g === G.EMB) {
      const x = P0[i * 3]!;
      const z = P0[i * 3 + 2]!;
      const c = embCur(x, z, model);
      W[i * 3 + 1] = base(x, z) + c;
      AUX[i] = c - embShape(x, z);
    } else if (g === G.HILL) {
      const x = P0[i * 3]!;
      const z = P0[i * 3 + 2]!;
      W[i * 3 + 1] = P0[i * 3 + 1]! + hill(x, z) * (terrainScale - 1);
    }
  }
  return model;
}

export function createViewer(
  canvas: HTMLCanvasElement,
  initial: { progress: number; terrainScale: number },
): ViewerApi {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas2D context is unavailable');
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let WcLocal = 800;
  let HcLocal = 600;
  let frozen: number | null = null;
  let currentModel: SiteModel = { ...DEFAULT_MODEL, progress: initial.progress, terrainScale: initial.terrainScale };
  let raf = 0;
  let last = performance.now();
  const start = performance.now();
  let destroyed = false;

  currentModel = applyScene(initial.progress, initial.terrainScale);

  function resize(width: number, height: number): void {
    WcLocal = Math.max(240, Math.floor(width));
    HcLocal = Math.max(200, Math.floor(height));
    Wc = WcLocal;
    Hc = HcLocal;
    canvas.width = Math.round(WcLocal * dpr);
    canvas.height = Math.round(HcLocal * dpr);
    canvas.style.width = `${WcLocal}px`;
    canvas.style.height = `${HcLocal}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(now: number): void {
    if (destroyed) return;
    const dt = Math.min(100, now - last);
    last = now;
    tweenStep(dt);
    const t = frozen ?? (now - start) / 1000;
    updateDynamic(currentModel, t);
    projectAll();
    ctx!.clearRect(0, 0, WcLocal, HcLocal);
    drawSprites(ctx!, t);
    drawOverlays(ctx!);
    raf = requestAnimationFrame(frame);
  }

  function onPointerDown(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    const button = e.button;
    const shift = e.shiftKey;
    let moved = 0;
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - rect.left - startX;
      const dy = ev.clientY - rect.top - startY;
      moved += Math.abs(ev.movementX) + Math.abs(ev.movementY);
      if (button === 2 || shift) {
        const k = cam.dist * 0.0016;
        const rx = Math.cos(cam.yaw);
        const rz = -Math.sin(cam.yaw);
        const fx = -Math.sin(cam.yaw);
        const fz = -Math.cos(cam.yaw);
        cam.tx -= rx * dx * k - fx * dy * k;
        cam.tz -= rz * dx * k - fz * dy * k;
      } else {
        cam.yaw -= dx * 0.006;
        cam.pitch = clamp(cam.pitch + dy * 0.005, 0.08, 1.45);
      }
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      canvas.style.cursor = moved > 4 ? 'grab' : 'grab';
    };
    canvas.style.cursor = 'grabbing';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 6, 220);
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  resize(canvas.clientWidth || 800, canvas.clientHeight || 600);
  raf = requestAnimationFrame(frame);

  return {
    resize,
    setScene(progress, terrainScale) {
      currentModel = applyScene(progress, terrainScale);
    },
    setLayers(next) {
      Object.assign(layers, next);
      refreshVis();
    },
    setLayer(layer, on) {
      layers[layer] = on;
      refreshVis();
    },
    setHeatmap(on) {
      ST.heatmap = on;
    },
    setPrivacy(on) {
      ST.privacy = on;
    },
    setOverlays(next) {
      overlays = next;
    },
    clearOverlays() {
      overlays = [];
    },
    setView,
    setSimTime(seconds) {
      frozen = seconds;
    },
    setTheme(theme) {
      FOG = theme === 'light' ? [0.9, 0.94, 0.98] : [0.08, 0.14, 0.3];
    },
    getSimTime() {
      return frozen ?? (performance.now() - start) / 1000;
    },
    getStats() {
      return { splats: N, visible: sorted.length, renderer: 'Canvas2D', simTime: frozen ?? 0 };
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };
}

export const SITE_VERSION_LABELS = SITE_VERSIONS.map((v) => v.label);
export const SCENE_GROUP_NAMES = Object.keys(SCENE_GROUPS) as SceneGroup[];
export const BUCKET_WORLD = (model: SiteModel, t: number): Vec3 => bucketPos(model, t);
