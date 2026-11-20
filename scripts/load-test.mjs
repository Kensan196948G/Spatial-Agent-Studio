#!/usr/bin/env node
/**
 * 軽量な負荷試験（依存なし・本番APIを叩く場合は読み取り系のみ）。
 *
 * 使い方:
 *   API_URL=http://127.0.0.1:7450 CONCURRENCY=10 DURATION_MS=10000 node scripts/load-test.mjs
 *
 * 認証: デモアカウントでログインし、Cookie を各リクエストに付ける（読み取りのみ）。
 * 出力: p50/p95/p99・エラー率・RPS の JSON。非0終了はエラー率 > ERROR_RATE_MAX のとき。
 */
const API = (process.env.API_URL ?? 'http://127.0.0.1:7450').replace(/\/$/, '');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const DURATION_MS = Number(process.env.DURATION_MS ?? 10_000);
const ERROR_RATE_MAX = Number(process.env.ERROR_RATE_MAX ?? 0.01);
const EMAIL = process.env.LOAD_EMAIL ?? 'manager@example.com';
const PASSWORD = process.env.LOAD_PASSWORD ?? 'SasManager!2026';
const PATHS = (process.env.LOAD_PATHS ?? '/api/bootstrap,/api/health').split(',');

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) {
  console.error(`[load] login failed: ${login.status}`);
  process.exit(2);
}
const cookies = login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')].filter(Boolean);
const cookie = cookies.map((c) => String(c).split(';')[0]).join('; ');

const latencies = [];
let errors = 0;
let requests = 0;
const started = Date.now();
const deadline = started + DURATION_MS;

async function worker() {
  while (Date.now() < deadline) {
    const path = PATHS[requests % PATHS.length];
    const t0 = performance.now();
    try {
      const res = await fetch(`${API}${path}`, { headers: { cookie } });
      if (!res.ok) errors += 1;
      await res.arrayBuffer();
    } catch {
      errors += 1;
    }
    latencies.push(performance.now() - t0);
    requests += 1;
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

const sorted = latencies.slice().sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const durationSec = (Date.now() - started) / 1000;
const summary = {
  api: API,
  concurrency: CONCURRENCY,
  durationSec: Number(durationSec.toFixed(1)),
  requests,
  rps: Number((requests / durationSec).toFixed(1)),
  errorRate: requests ? Number((errors / requests).toFixed(4)) : 1,
  p50: Math.round(pct(50)),
  p95: Math.round(pct(95)),
  p99: Math.round(pct(99)),
  paths: PATHS,
};
console.log(JSON.stringify(summary, null, 1));
process.exit(summary.errorRate > ERROR_RATE_MAX ? 1 : 0);
