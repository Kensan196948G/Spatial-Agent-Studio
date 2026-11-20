#!/usr/bin/env node
/**
 * Cloudflare Preview smoke verification for the V2.1 UI shell.
 *
 * Verifies: API health, CORS, auto sign-in (no login screen), 5-site dashboard,
 * site switch, light/dark, approvals page, audit pane and the AI: DEMO badge.
 * Saves screenshots + JSON under docs/progress/evidence/.
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
  ui: 'V2.1 static shell',
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
check(
  'api health',
  healthRes.status === 200 && result.health.body.ok === true,
  JSON.stringify(result.health.body),
);

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
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  // Access 通過後はアプリ独自のログイン画面なしで自動サインインする
  await page.locator('body[data-page="dash"]').waitFor({ timeout: 30_000 });
  await page.locator('#boot').waitFor({ state: 'hidden', timeout: 30_000 });
  const siteCount = await page.locator('#sites .site').count();
  const navCount = await page.locator('#nav .nb').count();
  const loginForm = await page.locator('#sasLogin').count();
  const aiBadge = await page.locator('#bdgAi').innerText().catch(() => '');
  check(
    'auto sign-in → V2.1 dashboard',
    siteCount === 5 && navCount === 11 && loginForm === 0,
    `sites=${siteCount} nav=${navCount} loginForm=${loginForm}`,
  );
  check('AI: DEMO badge', /AI:\s*DEMO/.test(aiBadge), aiBadge.trim());
  await page.screenshot({ path: join(OUT, 'preview-v21-dashboard.png'), fullPage: true });
  result.screenshots.push('preview-v21-dashboard.png');

  await page.locator('#sites .site').nth(1).click();
  await page.locator('body[data-page="viewer"]').waitFor({ timeout: 20_000 });
  const picker = await page.locator('#sasSiteSelect').inputValue();
  const title = await page.title();
  check(
    'site selection → 3D viewer',
    picker === 'site-b' && /△△橋/.test(title),
    `${picker} / ${title}`,
  );
  await page.screenshot({ path: join(OUT, 'preview-v21-site.png'), fullPage: false });
  result.screenshots.push('preview-v21-site.png');

  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('#themeBtn').click();
  const after = await page.locator('html').getAttribute('data-theme');
  check('light/dark toggle', before !== after, `${before} → ${after}`);

  await page.locator('#nav .nb[data-pg="approvals"]').click();
  await page.locator('body[data-page="approvals"]').waitFor({ timeout: 20_000 });
  await page.locator('#apHist').waitFor({ state: 'visible', timeout: 20_000 });
  const hist = await page.locator('#apHist tbody tr').count();
  check('approvals page', hist >= 1, `history=${hist}`);
  await page.screenshot({ path: join(OUT, 'preview-v21-approvals.png'), fullPage: true });
  result.screenshots.push('preview-v21-approvals.png');

  await page.locator('#nav .nb[data-pg="viewer"]').click();
  await page.locator('body[data-page="viewer"]').waitFor({ timeout: 20_000 });
  await page.locator('#tabs button[data-p="audit"]').click();
  await page.locator('#audList .au').first().waitFor({ state: 'visible', timeout: 20_000 });
  const auditRows = await page.locator('#audList .au').count();
  check('audit pane', auditRows > 0, `rows=${auditRows}`);
  await page.screenshot({ path: join(OUT, 'preview-v21-audit.png'), fullPage: true });
  result.screenshots.push('preview-v21-audit.png');
} finally {
  await browser.close();
}

result.finishedAt = new Date().toISOString();
result.ok = result.checks.every((c) => c.ok);
writeFileSync(join(OUT, 'preview-smoke.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`\n${result.ok ? 'PREVIEW SMOKE: PASS' : 'PREVIEW SMOKE: FAIL'}`);
process.exitCode = result.ok ? 0 : 1;
