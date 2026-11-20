import { useEffect, useRef, type ReactNode } from 'react';
import { base, embShape, hill } from '@shared/terrain';

type Cover = 'embankment' | 'bridge' | 'tunnel';

const COVER_MARK: Record<Cover, { x: number; z: number }> = {
  embankment: { x: -3, z: 0 },
  bridge: { x: -24, z: 4 },
  tunnel: { x: -34, z: -21 },
};

export function MiniTerrain({
  progress,
  cover,
  className = '',
}: {
  progress: number;
  cover: Cover;
  className?: string;
}): ReactNode {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 320;
    const H = 180;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b1430');
    bg.addColorStop(1, '#081020');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const x0 = -46;
    const x1 = 46;
    const z0 = -33;
    const z1 = 33;
    const cell = 2;
    const px = (x: number): number => ((x - x0) / (x1 - x0)) * W;
    const pz = (z: number): number => ((z - z0) / (z1 - z0)) * H;

    for (let sx = 0; sx < W; sx += cell) {
      for (let sy = 0; sy < H; sy += cell) {
        const x = x0 + ((sx + cell / 2) / W) * (x1 - x0);
        const z = z0 + ((sy + cell / 2) / H) * (z1 - z0);
        let r = 29;
        let g = 46;
        let b = 38;
        const hillH = hill(x, z);
        const emb = embShape(x, z);
        if (x > 21.3 && x < 34.2) {
          r = 22;
          g = 52;
          b = 92;
        } else if (x >= 17.8 && x <= 21.3) {
          r = 82;
          g = 88;
          b = 96;
        } else if (emb > 0.02) {
          const k = Math.min(1, emb / 4);
          r = 118 + k * 34;
          g = 92 + k * 30;
          b = 62 + k * 18;
          const under = Math.max(0, 1 - progress);
          r -= under * 30;
          g -= under * 26;
          b -= under * 18;
        } else if (hillH > 1.2) {
          r = 42;
          g = 82;
          b = 46;
        } else {
          const t = Math.min(1, Math.max(0, (base(x, z) + 0.2) * 1.2));
          r = 54 + t * 20;
          g = 56 + t * 22;
          b = 42 + t * 10;
        }
        ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        ctx.fillRect(sx, sy, cell, cell);
      }
    }

    // contour grid
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.10)';
    ctx.lineWidth = 1;
    for (let x = -40; x <= 40; x += 10) {
      ctx.beginPath();
      ctx.moveTo(px(x), 0);
      ctx.lineTo(px(x), H);
      ctx.stroke();
    }
    for (let z = -30; z <= 30; z += 10) {
      ctx.beginPath();
      ctx.moveTo(0, pz(z));
      ctx.lineTo(W, pz(z));
      ctx.stroke();
    }

    // embankment outline
    ctx.strokeStyle = 'rgba(255, 193, 107, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(px(-14), pz(-14), px(10) - px(-14), pz(14) - pz(-14));
    ctx.setLineDash([]);

    // site marker
    const mark = COVER_MARK[cover];
    const mx = px(mark.x);
    const my = pz(mark.z);
    ctx.strokeStyle = '#38e1ff';
    ctx.fillStyle = '#38e1ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mx - 11, my);
    ctx.lineTo(mx - 4, my);
    ctx.moveTo(mx + 4, my);
    ctx.lineTo(mx + 11, my);
    ctx.moveTo(mx, my - 11);
    ctx.lineTo(mx, my - 4);
    ctx.moveTo(mx, my + 4);
    ctx.lineTo(mx, my + 11);
    ctx.stroke();

    // vignette
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.9);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }, [progress, cover]);

  return <canvas ref={ref} className={`mini-terrain ${className}`.trim()} aria-hidden="true" />;
}
