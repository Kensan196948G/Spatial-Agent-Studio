#!/usr/bin/env node
/**
 * Cloudflare Preview smoke verification (human/AI run, not part of CI).
 *
 * - Opens the Pages URL
 * - Logs in with the demo manager account
 * - Verifies the dashboard, 3D site, and audit-chain banner
 * - Saves screenshots + a JSON record under docs/progress/evidence/
 *
 * Usage:
 *   PREVIEW_URL=https://... node scripts/preview-smoke.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.PREVIEW_URL ?? 'https://spatial-agent-studio-preview.pages.dev';
const API = process.env.PREVIEW_API_URL ?? 'https://sas-api.mirai-dx-platform.com';
const OUT = join(process.cwd(), 'docs', 'progress', 'evidence');
mkdirSync(OUT, { recursive: true });

const result = {
  base: BASE,
  api: API,
  startedAt: new Date().toISOString(),
  health: null,
  cors: null,
  checks: [],
  screenshots: [],
};

function check(name, ok, detail) {
  result.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const healthRes = await fetch(`${API}/api/health`);
result.health = { status: healthRes.status, body: await healthRes.json() };
check('api health', healthRes.status === 200 && result.health.body.ok === true, JSON.stringify(result.health.body));

const preflight = await fetch(`${API}/api/bootstrap`, {
  method: 'OPTIONS',
  headers: {
    origin: BASE,
    'access-control-request-method': 'GET',
    'access-control-request-headers': 'authorization',
  },
});
result.cors = {
  status: preflight.status,
  allowOrigin: preflight.headers.get('access-control-allow-origin'),
  allowHeaders: preflight.headers.get('access-control-allow-headers'),
};
check(
  'cors preflight',
  preflight.status === 204 && result.cors.allowOrigin === BASE,
  JSON.stringify(result.cors),
);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('メールアドレス').fill('manager@example.com');
  await page.getByLabel('パスワード').fill('SasManager!2026');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 30_000 });
  await page.getByRole('heading', { name: /ホーム/ }).waitFor({ timeout: 20_000 });
  check('login → dashboard', true, page.url());
  await page.screenshot({ path: join(OUT, 'preview-dashboard.png'), fullPage: true });
  result.screenshots.push('preview-dashboard.png');

  await page.locator('a.site-card[href="/sites/site-a"]').click();
  await page.locator('canvas.viewer-canvas').waitFor({ timeout: 20_000 });
  await page.getByRole('heading', { name: '○○川 築堤・護岸工事' }).waitFor();
  check('3D site workspace', true, page.url());
  await page.screenshot({ path: join(OUT, 'preview-site.png'), fullPage: false });
  result.screenshots.push('preview-site.png');

  await page.goto(`${BASE}/audit`, { waitUntil: 'domcontentloaded' });
  await page.getByText('ハッシュ連鎖は整合しています').waitFor({ timeout: 20_000 });
  const verified = await page.getByText('VERIFIED').isVisible();
  const rows = await page.locator('.audit-table tbody tr').count();
  check('audit hash chain', verified, `rows=${rows}`);
  await page.screenshot({ path: join(OUT, 'preview-audit.png'), fullPage: true });
  result.screenshots.push('preview-audit.png');
} finally {
  await browser.close();
}

result.finishedAt = new Date().toISOString();
result.ok = result.checks.every((c) => c.ok);
writeFileSync(join(OUT, 'preview-smoke.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`\n${result.ok ? 'PREVIEW SMOKE: PASS' : 'PREVIEW SMOKE: FAIL'}`);
process.exitCode = result.ok ? 0 : 1;
