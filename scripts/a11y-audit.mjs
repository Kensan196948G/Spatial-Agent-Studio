#!/usr/bin/env node
/**
 * 簡易アクセシビリティ監査（主要画面）。外部依存なし。
 *
 * 使い方:
 *   BASE_URL=https://spatial-agent-studio-preview.pages.dev node scripts/a11y-audit.mjs
 *
 * 検査: lang / ボタン・リンクのアクセシブル名 / フォームのラベル / 画像alt /
 *       H1の有無・見出しレベルの飛び / id重複。失敗時は非0。
 * ※ コントラスト比・スクリーンリーダー実機は対象外（手動監査で補完）。
 */
import { chromium } from '@playwright/test';

const BASE = (process.env.BASE_URL ?? 'https://spatial-agent-studio-preview.pages.dev').replace(/\/$/, '');
const SCREENS = [
  { key: 'dash', nav: null },
  { key: 'viewer', nav: 'viewer' },
  { key: 'approvals', nav: 'approvals' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('body[data-page="dash"]', { timeout: 45_000 });

const results = [];
for (const screen of SCREENS) {
  if (screen.nav) {
    await page.locator(`#nav .nb[data-pg="${screen.nav}"]`).click();
    await page.waitForTimeout(700);
  }
  const found = await page.evaluate(() => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const name = (el) =>
      (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
    const issues = [];
    const lang = document.documentElement.getAttribute('lang');
    if (!lang) issues.push('html[lang] が無い');
    for (const b of document.querySelectorAll('button')) {
      if (visible(b) && !name(b)) issues.push(`ボタンに名前が無い: ${b.id || b.className || '(no id)'}`);
    }
    for (const a of document.querySelectorAll('a')) {
      if (visible(a) && !name(a)) issues.push(`リンクに名前が無い: ${a.getAttribute('href') || ''}`);
    }
    for (const f of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      if (!visible(f)) continue;
      const labelled =
        f.getAttribute('aria-label') ||
        f.getAttribute('aria-labelledby') ||
        (f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`)) ||
        f.closest('label') ||
        f.getAttribute('placeholder');
      if (!labelled) issues.push(`入力にラベルが無い: ${f.id || f.name || f.tagName}`);
    }
    for (const img of document.querySelectorAll('img')) {
      if (visible(img) && !img.hasAttribute('alt')) issues.push(`img[alt] が無い: ${img.getAttribute('src') || ''}`);
    }
    const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
    if (!hs.some((h) => h.tagName === 'H1')) issues.push('H1が無い');
    let prev = 0;
    for (const h of hs) {
      const level = Number(h.tagName.slice(1));
      if (prev && level > prev + 1) issues.push(`見出しレベルの飛び: H${prev} → H${level}`);
      prev = level;
    }
    const ids = new Map();
    for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1);
    for (const [id, n] of ids) if (n > 1) issues.push(`id重複: ${id} (${n})`);
    return { page: document.body.dataset.page, issues };
  });
  results.push({ screen: screen.key, ...found });
}

await browser.close();
const total = results.reduce((n, r) => n + r.issues.length, 0);
const summary = { base: BASE, checkedAt: new Date().toISOString(), screens: results, totalIssues: total, ok: total === 0 };
console.log(JSON.stringify(summary, null, 1));
process.exit(summary.ok ? 0 : 1);
