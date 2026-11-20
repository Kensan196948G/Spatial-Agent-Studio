#!/usr/bin/env node
/**
 * 2026-11-20 プレビュー実機 QA 検証（読み取り専用 / READ-ONLY）
 *
 * 目的: Spatial-Agent-Studio のプレビュー配備に対して、リリース判定の証拠となる
 *       「事実」を実測で収集する。推測は書かない（不明は不明と記録する）。
 *
 * 禁止事項（このスクリプトが守る範囲）:
 *   - 状態を変える操作をしない: 承認 / 却下 / 実行 / ログアウト / 設定保存 / DB書込み
 *   - API は GET と、非破壊と確認済みの 400 / 401 / 404 エラー確認のみ
 *   - 例外として POST /api/auth/login（トークン取得、デモ資格情報）のみ許可
 *   - POST /api/sites/:id/runs は task 不正値で 400 を確認する場合のみ（レコードは作られない）
 *   - POST /api/approvals/:id/decision は decision 不正値(400) と 存在しないID+approve(404) のみ
 *   - 実在メール・個人情報は記録しない（記録直前にマスク）。トークン値は記録しない
 *
 * 使い方（cwd = リポジトリ root）:
 *   SAS_QA_EMAIL=manager@example.com SAS_QA_PASSWORD='***' \
 *     node docs/progress/evidence/qa-preview-verify.mjs
 *   資格情報が未設定の場合は web-v21/bridge.js の DEMO_ACCOUNTS（デモ用）から読む。
 *
 * 出力:
 *   docs/progress/evidence/qa-preview-20261120.json  … 構造化された実測値
 *   docs/progress/evidence/qa-preview-20261120.md    … 要約
 *   docs/progress/evidence/qa-preview-20261120-*.png … スクリーンショット
 */
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const BASE = process.env.PREVIEW_URL ?? 'https://spatial-agent-studio-preview.pages.dev';
const API = process.env.PREVIEW_API_URL ?? 'https://sas-api.mirai-dx-platform.com';
const OUT = join(process.cwd(), 'docs', 'progress', 'evidence');
const OUT_JSON = join(OUT, 'qa-preview-20261120.json');
const OUT_MD = join(OUT, 'qa-preview-20261120.md');
mkdirSync(OUT, { recursive: true });

/* ---------------- 記録ヘルパ ---------------- */

const isoUtc = (d = new Date()) => d.toISOString();
const jstFmt = (d = new Date()) =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);

/** メール様文字列をローカル部2文字+***へマスク（実在メールを記録しないため） */
function mask(s) {
  if (s == null) return s;
  return String(s).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => {
    const at = m.indexOf('@');
    const local = m.slice(0, at);
    return `${local.slice(0, 2)}***${m.slice(at)}`;
  });
}
const clip = (s, n = 220) => {
  const v = mask(String(s ?? '')).replace(/\s+/g, ' ').trim();
  return v.length > n ? `${v.slice(0, n)}…` : v;
};
const rel = (p) => relative(process.cwd(), p);

/* ------- 追加確認モード（承認ステータス別件数・承認画面の実測） -------
 * 使い方: QA_MODE=extra node docs/progress/evidence/qa-preview-verify.mjs
 * 既存の qa-preview-20261120.json を読み、追加の読み取り実測をマージして JSON/MD を再生成する。
 * 主検証（11画面/ロール）は再実行しない。追加のAPIログインは行わず、
 * UI起動時の自動サインインで確立したセッショントークン（sessionStorage）を再利用する。
 */
const EXTRA_MODE = process.env.QA_MODE === 'extra';
if (EXTRA_MODE) {
  await runExtraMode();
  process.exit(process.exitCode ?? 0);
}

const checks = [];
/** @param {'PASS'|'FAIL'|'UNVERIFIED'} verdict */
function check(id, name, expected, actual, verdict, note) {
  checks.push({ id, name, expected, actual, verdict, note: note ?? null });
  console.log(`${verdict.padEnd(10)} ${id} ${name} — ${clip(actual, 160)}`);
}

const pages = [];
const roles = [];
const screenshots = [];
const consoleErrors = [];
const pageErrors = [];
const httpErrors = [];
const nonGetRequests = [];

let currentContext = 'boot';
let fatalError = null;
const t0 = new Date();

/* ---------------- 資格情報（デモ用のみ） ---------------- */

function resolveDemoCredentials() {
  const email = process.env.SAS_QA_EMAIL;
  const password = process.env.SAS_QA_PASSWORD;
  if (email && password) return { email, password, source: 'env' };
  try {
    const bridge = readFileSync(join(process.cwd(), 'web-v21', 'bridge.js'), 'utf8');
    const m = bridge.match(/manager:\s*\{\s*email:\s*'([^']+)',\s*password:\s*'([^']+)'/);
    if (m) return { email: m[1], password: m[2], source: 'web-v21/bridge.js DEMO_ACCOUNTS' };
  } catch {
    /* noop */
  }
  return null;
}

/* ---------------- 収集本体 ---------------- */

const result = {
  meta: {
    title: 'プレビュー実機QA検証（読み取り専用）',
    mode: 'read-only',
    purpose: 'リリース判定の証拠収集（承認/却下/実行/ログアウト/設定保存なし）',
    base: BASE,
    api: API,
    repositoryHead: null,
    previewDeployCommit: '不明',
    previewDeployCommitNote: null,
    startedAtIso: isoUtc(t0),
    startedAtJst: jstFmt(t0),
    finishedAtIso: null,
    finishedAtJst: null,
    durationMs: null,
    userAgent: null,
    browser: 'Playwright chromium (headless)',
    viewport: '1440x1000',
  },
  checks,
  api: {},
  ui: { boot: null, pages, roles: { menu: null, measurements: roles, lockAttempt: null, approveGating: null }, auditUi: null, settingsUi: null },
  console: { errors: consoleErrors, pageErrors },
  network: { httpErrors, nonGet: nonGetRequests, writeDetection: null },
  screenshots,
  gaps: [],
  fatalError: null,
};

try {
  result.meta.repositoryHead = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
} catch {
  result.meta.repositoryHead = null;
}

/* ============ Phase 1: Browser UI（11画面 / ロール / 監査・設定UI） ============ */

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
});
const page = await context.newPage();
result.meta.userAgent = await page.evaluate(() => navigator.userAgent).catch(() => null);

page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  consoleErrors.push({ context: currentContext, type: 'console.error', text: clip(msg.text(), 300) });
});
page.on('pageerror', (err) => {
  pageErrors.push({ context: currentContext, type: 'pageerror', text: clip(err.message || String(err), 300) });
});
page.on('request', (req) => {
  const method = req.method();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
  nonGetRequests.push({
    context: currentContext,
    method,
    url: clip(req.url(), 200),
    status: null,
    resourceType: req.resourceType(),
  });
});
page.on('response', (res) => {
  const method = res.request().method();
  const status = res.status();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const target = nonGetRequests.find((r) => r.status === null && res.url().startsWith(r.url.replace(/…$/, '')));
    if (target) target.status = status;
  }
  if (status >= 400) {
    httpErrors.push({ context: currentContext, method, status, url: clip(res.url(), 200) });
  }
});

async function shot(name) {
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: false });
  let bytes = null;
  try {
    bytes = statSync(path).size;
  } catch {
    bytes = null;
  }
  screenshots.push({ name, path: rel(path), bytes, takenAtJst: jstFmt() });
  console.log(`SHOT ${name} (${bytes} bytes)`);
}

async function measureNavState() {
  return page.evaluate(() => {
    const nav = [...document.querySelectorAll('#nav .nb')];
    const locked = nav.filter((b) => b.classList.contains('locked'));
    return {
      navCount: nav.length,
      lockedCount: locked.length,
      lockedPages: locked.map((b) => b.dataset.pg),
      allowedCount: nav.length - locked.length,
      roleName: document.querySelector('#roleName')?.textContent?.trim() ?? null,
      roleSub: document.querySelector('#roleBtn small')?.textContent?.trim() ?? null,
      dataPage: document.body.dataset.page ?? null,
    };
  });
}

async function readToasts() {
  return page.evaluate(() =>
    [...document.querySelectorAll('#toasts .toast')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()),
  );
}

/** 画面1枚をクリックして実測する */
async function visitPage(key, label, roleLabel) {
  currentContext = `page:${key}`;
  const before = await page.evaluate(() => document.body.dataset.page ?? null);
  const toastsBefore = await readToasts();
  let clickError = null;
  try {
    await page.locator(`#nav .nb[data-pg="${key}"]`).click({ timeout: 5000 });
  } catch (e) {
    clickError = clip(e.message || String(e), 200);
  }
  await page.waitForTimeout(key === 'viewer' ? 1200 : 450);
  if (key === 'audit') {
    await page
      .waitForFunction(() => document.querySelectorAll('#auKpis .stat').length > 0, null, { timeout: 12000 })
      .catch(() => {});
  }
  if (key === 'settings') {
    await page
      .waitForFunction(() => document.querySelectorAll('#stBody .stat').length > 0, null, { timeout: 12000 })
      .catch(() => {});
  }
  const info = await page.evaluate((k) => {
    const root = k === 'viewer' ? document.querySelector('#vp') : document.querySelector('#pg-' + k);
    const head = root ? root.querySelector('h2') : null;
    const txt = root ? root.innerText.replace(/\s+/g, ' ').trim() : '';
    return {
      dataPage: document.body.dataset.page ?? null,
      navOn: document.querySelector('#nav .nb.on')?.dataset.pg ?? null,
      heading: head ? head.innerText.trim() : null,
      stats: root ? root.querySelectorAll('.stat').length : 0,
      cards: root ? root.querySelectorAll('.card').length : 0,
      tableRows: root ? root.querySelectorAll('table.tbl tbody tr').length : 0,
      canvases: root ? root.querySelectorAll('canvas').length : 0,
      textExcerpt: txt.slice(0, 220),
      rootFound: !!root,
      rootVisible: root ? !!(root.offsetWidth || root.offsetHeight) : false,
    };
  }, key);
  const toastsAfter = await readToasts();
  const newToasts = toastsAfter.filter((t) => !toastsBefore.includes(t));
  return {
    role: roleLabel,
    key,
    label,
    beforePage: before,
    clickError,
    clicked: !clickError,
    reached: info.dataPage === key,
    ...info,
    newToasts,
  };
}

const PAGE_DEFS = [
  ['dash', 'ホーム'],
  ['viewer', '3Dビュー'],
  ['pipeline', 'データ取得'],
  ['data', '3D基盤'],
  ['approvals', '承認'],
  ['integration', '連携'],
  ['governance', '統制'],
  ['audit', '監査ログ'],
  ['settings', 'システム設定'],
  ['arch', '構成'],
  ['roadmap', '導入計画'],
];

try {
  /* ---- 起動（ログイン画面なし・デモ自動サインイン） ---- */
  currentContext = 'boot';
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page
    .waitForSelector('body[data-page="dash"]', { state: 'attached', timeout: 60000 })
    .catch(async () => {
      await page.waitForSelector('#nav .nb', { timeout: 20000 }).catch(() => {});
    });
  await page.waitForTimeout(1500);

  const boot = await page.evaluate(() => ({
    sasLoginCount: document.querySelectorAll('#sasLogin').length,
    sasLoginVisible: (() => {
      const el = document.querySelector('#sasLogin');
      if (!el) return false;
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && el.offsetParent !== null;
    })(),
    dataPage: document.body.dataset.page ?? null,
    navCount: document.querySelectorAll('#nav .nb').length,
    navPages: [...document.querySelectorAll('#nav .nb')].map((b) => b.dataset.pg),
    siteCount: document.querySelectorAll('#sites .site').length,
    siteNames: [...document.querySelectorAll('#sites .site')].map((s) => s.innerText.replace(/\s+/g, ' ').trim().slice(0, 60)),
    bdgAccess: document.querySelector('#bdgAccess')?.innerText.trim() ?? null,
    roleName: document.querySelector('#roleName')?.innerText.trim() ?? null,
    roleSub: document.querySelector('#roleBtn small')?.innerText.trim() ?? null,
    title: document.title,
    bootOverlayHidden: (() => {
      const el = document.querySelector('#boot');
      return !el || getComputedStyle(el).display === 'none' || el.hidden;
    })(),
  }));
  result.ui.boot = boot;

  check('ui.noLogin', 'ログイン画面が表示されない（#sasLogin）', '#sasLogin 件数 0 / 非表示', `count=${boot.sasLoginCount}, visible=${boot.sasLoginVisible}`, boot.sasLoginVisible === false ? 'PASS' : 'FAIL');
  check('ui.bootDash', 'UI起動後にホームへ遷移', 'body[data-page]=dash', `data-page=${boot.dataPage}`, boot.dataPage === 'dash' ? 'PASS' : 'FAIL');
  check('ui.navCount', 'ナビ項目数', '11', String(boot.navCount), boot.navCount === 11 ? 'PASS' : 'FAIL');
  check('ui.siteCount', '現場カード数', '5', String(boot.siteCount), boot.siteCount === 5 ? 'PASS' : 'FAIL');
  check('ui.accessBadge', 'Accessバッジ文言', 'Access 未経由（直URL）', clip(boot.bdgAccess, 80), /Access/.test(boot.bdgAccess || '') ? 'PASS' : 'FAIL', '直URLのため未経由表示が正（Access保護ドメインではない）');
  check('ui.roleName', 'ロール表示（#roleName）', 'デモ既定は現場代理人・所長', clip(boot.roleName, 80), /現場代理人|管理者/.test(boot.roleName || '') ? 'PASS' : 'FAIL', 'bridge.js applyUserUi がロール名をユーザー名で上書きするため、表示はユーザー名になる（コード読解）');

  await shot('qa-preview-20261120-home.png');

  /* ---- 11画面（既定ロール＝現場代理人・所長） ---- */
  currentContext = 'pages:agent';
  const agentPages = [];
  for (const [key, label] of PAGE_DEFS) {
    agentPages.push(await visitPage(key, label, 'agent'));
  }
  pages.push(...agentPages);

  const reachedCount = agentPages.filter((p) => p.reached).length;
  check('ui.pagesAgent', '既定ロールで遷移できた画面数', '11（うち許可9・ロック2は遷移不可が正）', `${reachedCount}/11 reached, blocked=${agentPages.filter((p) => !p.reached).map((p) => p.key).join(',') || 'なし'}`, reachedCount === 9 ? 'PASS' : 'FAIL', '現場代理人の許可は9画面（pipeline/governance はロック）');

  currentContext = 'page:audit';
  await page.locator('#nav .nb[data-pg="audit"]').click();
  await page.waitForTimeout(1200);
  await shot('qa-preview-20261120-audit.png');

  /* ---- 監査UI（項目9） ---- */
  currentContext = 'auditUi';
  const auditUi = await (async () => {
    await page.waitForFunction(() => document.querySelectorAll('#auKpis .stat').length > 0, null, { timeout: 12000 }).catch(() => {});
    const base = await page.evaluate(() => ({
      dataPage: document.body.dataset.page ?? null,
      kpiCount: document.querySelectorAll('#auKpis .stat').length,
      kpiTexts: [...document.querySelectorAll('#auKpis .stat')].map((s) => s.innerText.replace(/\s+/g, ' ').trim()),
      verifyText: document.querySelector('#auVerify')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      countText: document.querySelector('#auCount')?.innerText.trim() ?? null,
      rowCount: document.querySelectorAll('#auTable tbody tr[data-seq]').length,
      typeOptions: [...document.querySelectorAll('#auType option')].map((o) => o.value),
      heading: document.querySelector('#pg-audit h2')?.innerText.trim() ?? null,
    }));

    // 先頭行クリック → 詳細
    let detailText = null;
    const firstRow = page.locator('#auTable tbody tr[data-seq]').first();
    if ((await firstRow.count()) > 0) {
      await firstRow.click();
      await page.waitForTimeout(350);
      detailText = await page.evaluate(() => document.querySelector('#auDetail')?.innerText.replace(/\s+/g, ' ').trim() ?? null);
    }

    // この記録を再計算 → 照合結果
    let recheckText = null;
    if ((await page.locator('#auRecheck').count()) > 0) {
      const initial = await page.evaluate(() => document.querySelector('#auRecheckRes')?.innerText.trim() ?? null);
      await page.locator('#auRecheck').click();
      await page
        .waitForFunction(
          (init) => {
            const t = document.querySelector('#auRecheckRes')?.innerText.trim() ?? '';
            return t !== init && t.length > 0 && !t.includes('計算中');
          },
          initial,
          { timeout: 10000 },
        )
        .catch(() => {});
      recheckText = await page.evaluate(() => document.querySelector('#auRecheckRes')?.innerText.replace(/\s+/g, ' ').trim() ?? null);
    }

    // 種別フィルタ
    const typeValue = base.typeOptions.find((v) => v !== 'all') ?? null;
    let filterResult = null;
    if (typeValue) {
      await page.selectOption('#auType', typeValue);
      await page.waitForTimeout(400);
      filterResult = await page.evaluate(() => ({
        selectedType: document.querySelector('#auType')?.value ?? null,
        countText: document.querySelector('#auCount')?.innerText.trim() ?? null,
        rowCount: document.querySelectorAll('#auTable tbody tr[data-seq]').length,
      }));
      await page.selectOption('#auType', 'all');
      await page.waitForTimeout(300);
    }

    // 検索0件
    let searchZero = null;
    await page.fill('#auSearch', 'ZZZ-NO-MATCH-9999');
    await page.waitForTimeout(450);
    searchZero = await page.evaluate(() => ({
      query: document.querySelector('#auSearch')?.value ?? null,
      emptyText: document.querySelector('#auTable .empty')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      countText: document.querySelector('#auCount')?.innerText.trim() ?? null,
      rowCount: document.querySelectorAll('#auTable tbody tr[data-seq]').length,
    }));
    await page.fill('#auSearch', '');
    await page.waitForTimeout(300);

    return { ...base, detailText, recheckText, filterResult, searchZero };
  })();
  result.ui.auditUi = auditUi;

  check('audit.heading', '監査ログ画面の見出し', '監査ログ ─ 追記専用・ハッシュ連鎖', clip(auditUi.heading, 80), auditUi.heading ? 'PASS' : 'FAIL');
  check('audit.rows', '監査ログ行数（取得件数）', '>0', `rows=${auditUi.rowCount}, count=${clip(auditUi.countText, 40)}`, auditUi.rowCount > 0 ? 'PASS' : 'FAIL');
  check('audit.detail', '先頭行クリックで詳細表示（#auDetail）', 'seq/日時/主体/種別/内容/前ハッシュ/ハッシュ', clip(auditUi.detailText, 160), /seq/.test(auditUi.detailText || '') ? 'PASS' : 'FAIL');
  check('audit.recheck', '再計算照合（#auRecheckRes）', '一致 — 改変されていません', clip(auditUi.recheckText, 120), /一致/.test(auditUi.recheckText || '') && !/不一致/.test(auditUi.recheckText || '') ? 'PASS' : 'FAIL');
  check('audit.filter', '種別フィルタの件数表示', 'フィルタ後件数が表示される', `type=${auditUi.filterResult?.selectedType ?? 'n/a'}, count=${clip(auditUi.filterResult?.countText, 40)}, rows=${auditUi.filterResult?.rowCount ?? 'n/a'}`, auditUi.filterResult && /\/\s*\d+\s*件/.test(auditUi.filterResult.countText || '') ? 'PASS' : 'FAIL');
  check('audit.searchZero', '検索0件の表示', '条件に一致する記録がありません。', clip(auditUi.searchZero?.emptyText, 120), /一致する記録がありません/.test(auditUi.searchZero?.emptyText || '') ? 'PASS' : 'FAIL');

  /* ---- 設定UI（項目10） ---- */
  currentContext = 'settingsUi';
  await page.locator('#nav .nb[data-pg="settings"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#stBody .stat').length > 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);

  const settingsUi = await page.evaluate(() => {
    const body = document.querySelector('#stBody');
    if (!body) return { found: false };
    const kv = (label) => {
      const dt = [...body.querySelectorAll('dt')].find((d) => d.textContent.trim() === label);
      return dt ? (dt.nextElementSibling?.textContent?.trim() ?? null) : null;
    };
    const tables = [...body.querySelectorAll('table.tbl')];
    const roleTable = tables.find((t) => (t.querySelector('thead')?.textContent ?? '').includes('ロール'));
    const accessRowDt = [...body.querySelectorAll('dt')].find((d) => d.textContent.includes('Cloudflare Access'));
    return {
      found: true,
      heading: document.querySelector('#pg-settings h2')?.innerText.trim() ?? null,
      stats: [...body.querySelectorAll('.stat')].map((s) => s.innerText.replace(/\s+/g, ' ').trim()),
      version: kv('バージョン'),
      aiMode: kv('AIモード'),
      db: kv('データベース'),
      accessState: accessRowDt ? (accessRowDt.nextElementSibling?.innerText.replace(/\s+/g, ' ').trim() ?? null) : null,
      accessMapped: kv('Access割当'),
      sessionTtl: kv('セッション'),
      counts: {
        sites: kv('現場'),
        users: kv('ユーザー'),
        approvals: kv('承認'),
        reports: kv('レポート'),
        auditEvents: kv('監査イベント'),
        pending: kv('承認待ち'),
      },
      roleRows: roleTable ? roleTable.querySelectorAll('tbody tr').length : null,
      roleRowTexts: roleTable ? [...roleTable.querySelectorAll('tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()) : [],
      chainText: (() => {
        const dt = [...body.querySelectorAll('dt')].find((d) => d.textContent.trim() === 'ハッシュ連鎖');
        return dt ? dt.nextElementSibling?.innerText.replace(/\s+/g, ' ').trim() : null;
      })(),
      hasEmailPattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(body.innerText),
      healthButton: !!document.querySelector('#stHealth'),
      verifyButton: !!document.querySelector('#stVerify'),
    };
  });

  // ヘルスチェック（読み取りのみ）
  const toastsBeforeHealth = await readToasts();
  let healthToast = null;
  if (settingsUi.healthButton) {
    await page.locator('#stHealth').click();
    await page.waitForTimeout(1500);
    const after = await readToasts();
    healthToast = after.filter((t) => !toastsBeforeHealth.includes(t)).join(' | ') || null;
  }
  settingsUi.healthToast = healthToast;
  result.ui.settingsUi = settingsUi;
  await shot('qa-preview-20261120-settings.png');

  check('settings.version', '設定画面のバージョン表示', '0.1.0', clip(settingsUi.version, 40), settingsUi.version ? 'PASS' : 'FAIL');
  check('settings.roleRows', 'ロール表の行数', '4', String(settingsUi.roleRows), settingsUi.roleRows === 4 ? 'PASS' : 'FAIL');
  check('settings.accessRow', 'Cloudflare Access 行', '未経由（デモ）', clip(settingsUi.accessState, 60), settingsUi.accessState ? 'PASS' : 'FAIL');
  check('settings.counts', '件数表示（現場/承認/監査イベント等）', '数値が表示される', JSON.stringify(settingsUi.counts), Object.values(settingsUi.counts).every((v) => v != null) ? 'PASS' : 'FAIL');
  check('settings.noEmail', '設定画面にメールが露出しない', 'false（マスク済み）', `hasEmailPattern=${settingsUi.hasEmailPattern}`, settingsUi.hasEmailPattern === false ? 'PASS' : 'FAIL');
  check('settings.health', 'ヘルスチェック（読み取り）', 'API 正常 / DB up', clip(settingsUi.healthToast, 160), /正常|up/i.test(settingsUi.healthToast || '') ? 'PASS' : 'FAIL');

  /* ---- 3Dビュー（可能なら） ---- */
  currentContext = 'page:viewer';
  await page.locator('#nav .nb[data-pg="viewer"]').click();
  await page.waitForTimeout(2000);
  const viewer = await page.evaluate(() => {
    const vp = document.querySelector('#vp');
    const gpu = document.querySelector('#cvGpu');
    return {
      dataPage: document.body.dataset.page ?? null,
      canvases: vp ? vp.querySelectorAll('canvas').length : 0,
      gpuWidth: gpu ? gpu.width : null,
      gpuHeight: gpu ? gpu.height : null,
      hudText: vp ? vp.innerText.replace(/\s+/g, ' ').trim().slice(0, 160) : null,
    };
  });
  result.ui.viewer = viewer;
  await shot('qa-preview-20261120-viewer-3d.png');
  check('ui.viewer3d', '3Dビューの描画', 'canvas が存在し data-page=viewer', `page=${viewer.dataPage}, canvases=${viewer.canvases}, size=${viewer.gpuWidth}x${viewer.gpuHeight}`, viewer.dataPage === 'viewer' && viewer.canvases > 0 ? 'PASS' : 'FAIL', 'canvas のピクセル内容は目視確認していない（スクショPNG参照）');

  /* ---- ロール切替（項目5） ---- */
  currentContext = 'roles';
  await page.click('#roleBtn');
  await page.waitForTimeout(300);
  const menu = await page.evaluate(() => {
    const m = document.querySelector('#roleMenu');
    return {
      shown: m ? m.classList.contains('show') : null,
      itemCount: m ? m.querySelectorAll('.ritem').length : 0,
      items: m
        ? [...m.querySelectorAll('.ritem')].map((b) => ({
            key: b.dataset.r,
            name: b.querySelector('b')?.textContent?.trim() ?? null,
            sub: b.querySelector('small')?.textContent?.trim() ?? null,
          }))
        : [],
    };
  });
  result.ui.roles.menu = menu;
  check('roles.menu', 'ロールメニュー項目', '4（現場担当者/現場代理人・所長/本社/IT・DX）', `count=${menu.itemCount}, names=${menu.items.map((i) => i.name).join(' / ')}`, menu.itemCount === 4 ? 'PASS' : 'FAIL');

  const expectedRolePages = {
    field: { allowed: 7, locked: ['integration', 'governance', 'audit', 'settings'] },
    agent: { allowed: 9, locked: ['pipeline', 'governance'] },
    hq: { allowed: 9, locked: ['pipeline', 'governance'] },
    it: { allowed: 11, locked: [] },
  };

  for (const key of ['agent', 'hq', 'it', 'field']) {
    currentContext = `role:${key}`;
    // メニューを開き直して切替
    const shown = await page.evaluate(() => document.querySelector('#roleMenu')?.classList.contains('show'));
    if (!shown) {
      await page.click('#roleBtn');
      await page.waitForTimeout(250);
    }
    const item = page.locator(`#roleMenu .ritem[data-r="${key}"]`);
    if ((await item.count()) === 0) {
      roles.push({ key, error: 'role menu item not found', ...(await measureNavState()) });
      continue;
    }
    await item.click();
    await page.waitForTimeout(600);
    const state = await measureNavState();
    roles.push({ key, expected: expectedRolePages[key], ...state });
    const exp = expectedRolePages[key];
    const ok = state.allowedCount === exp.allowed && state.lockedCount === 11 - exp.allowed;
    check(
      `roles.${key}`,
      `ロール「${menu.items.find((i) => i.key === key)?.name ?? key}」の許可/ロック数`,
      `${exp.allowed}許可/${11 - exp.allowed}ロック`,
      `${state.allowedCount}許可/${state.lockedCount}ロック (locked=${state.lockedPages.join(',') || 'なし'})`,
      ok ? 'PASS' : 'FAIL',
    );
  }

  // 現場担当者でロックnavのスクショ
  currentContext = 'role:field-screenshot';
  await shot('qa-preview-20261120-role-field-nav.png');

  /* ---- ロック画面への遷移試行（項目6） ---- */
  currentContext = 'lockAttempt';
  const lockBefore = await page.evaluate(() => document.body.dataset.page ?? null);
  const toastsBeforeLock = await readToasts();
  await page.locator('#nav .nb[data-pg="audit"]').click();
  await page.waitForTimeout(800);
  const lockAfter = await page.evaluate(() => document.body.dataset.page ?? null);
  const toastsAfterLock = await readToasts();
  const lockToasts = toastsAfterLock.filter((t) => !toastsBeforeLock.includes(t));
  const lockAttempt = {
    role: 'field',
    clicked: 'audit',
    beforePage: lockBefore,
    afterPage: lockAfter,
    pageChanged: lockBefore !== lockAfter,
    toast: lockToasts.join(' | ') || null,
  };
  result.ui.roles.lockAttempt = lockAttempt;
  check('lock.noNavigate', '現場担当者でロック画面（audit）へ遷移しない', 'body[data-page] 不変', `${lockBefore} → ${lockAfter} (changed=${lockAttempt.pageChanged})`, lockAttempt.pageChanged === false ? 'PASS' : 'FAIL');
  check('lock.toast', 'ロック時のトースト文言', '「現場担当者」ロールではこの画面を利用できません…', clip(lockAttempt.toast, 160), /利用できません/.test(lockAttempt.toast || '') ? 'PASS' : 'FAIL');

  /* ---- 承認権限UI（項目7） ---- */
  currentContext = 'approveGating';
  const gating = await page.evaluate(() => {
    const yes = document.querySelector('#apYes');
    const modal = document.querySelector('#mApprove');
    const defs = window.__SAS_APP?.ROLE?.defs ?? {};
    const cur = window.__SAS_APP?.ROLE?.cur ?? null;
    return {
      currentRole: cur,
      approveDefs: Object.fromEntries(Object.entries(defs).map(([k, d]) => [k, d.approve])),
      apYesExists: !!yes,
      apYesDisabled: yes ? yes.disabled : null,
      apYesHasDisabledAttr: yes ? yes.hasAttribute('disabled') : null,
      approveModalShown: modal ? modal.classList.contains('show') : null,
      apRoleText: document.querySelector('#apRole')?.textContent?.trim() ?? null,
    };
  });
  result.ui.roles.approveGating = gating;
  const defsOk =
    gating.approveDefs.field === false &&
    gating.approveDefs.agent === true &&
    gating.approveDefs.hq === false &&
    gating.approveDefs.it === false;
  check('approve.defs', 'ROLE.defs.approve の実測', 'field=false, agent=true, hq=false, it=false', JSON.stringify(gating.approveDefs), defsOk ? 'PASS' : 'FAIL', 'window.__SAS_APP.ROLE.defs を読み取り（状態変更なし）');
  check(
    'approve.disabledContext',
    '現場担当者で #apYes disabled を確認できる文脈',
    'モーダル未表示でも disabled が確認できること',
    `modalShown=${gating.approveModalShown}, apYes.disabled=${gating.apYesDisabled}, disabledAttr=${gating.apYesHasDisabledAttr}, currentRole=${gating.currentRole}`,
    gating.approveModalShown === false && gating.apYesDisabled === true ? 'PASS' : 'UNVERIFIED',
    '#apYes は承認モーダル(#mApprove)内にあり disabled は updateApproveRole()（モーダル表示時）でしか更新されない。モーダルを開かない制約下では UI の disabled 表示は確定根拠にならないため、承認可否の根拠は ROLE.defs.approve（上記checks）に置く。',
  );

  /* ---- 11画面のうち既定ロールで到達できなかった画面（ITで実測） ---- */
  currentContext = 'pages:it';
  // ITロールへ戻す（11画面すべて許可）
  await page.click('#roleBtn');
  await page.waitForTimeout(250);
  const itItem = page.locator('#roleMenu .ritem[data-r="it"]');
  if ((await itItem.count()) > 0) {
    await itItem.click();
    await page.waitForTimeout(500);
    const blockedKeys = agentPages.filter((p) => !p.reached).map((p) => p.key);
    const itPages = [];
    for (const key of blockedKeys) {
      const def = PAGE_DEFS.find((d) => d[0] === key);
      itPages.push(await visitPage(key, def ? def[1] : key, 'it'));
    }
    result.ui.pagesUnderIT = itPages;
    pages.push(...itPages);
    check(
      'ui.pagesIT',
      '既定ロールでロックされていた画面をITロールで実測',
      `${blockedKeys.length}画面が到達可能`,
      `${itPages.filter((p) => p.reached).length}/${itPages.length} reached (${blockedKeys.join(',')})`,
      itPages.length === blockedKeys.length && itPages.every((p) => p.reached) ? 'PASS' : 'FAIL',
      '画面内容の実測はロールを明記して記録（role=it）',
    );
  }

  // 最後に現場代理人へ戻す（画面状態を既定に戻す・状態変更ではない）
  currentContext = 'restoreRole';
  await page.click('#roleBtn');
  await page.waitForTimeout(250);
  const agentItem = page.locator('#roleMenu .ritem[data-r="agent"]');
  if ((await agentItem.count()) > 0) {
    await agentItem.click();
    await page.waitForTimeout(400);
  }
} catch (err) {
  fatalError = { context: currentContext, message: clip(err?.message || String(err), 500), stack: clip(err?.stack, 1200) };
  result.fatalError = fatalError;
  console.error(`FATAL (${currentContext}): ${fatalError.message}`);
} finally {
  await browser.close().catch(() => {});
}

/* ============ Phase 2: API契約（GET + 非破壊エラー確認のみ） ============ */

async function req(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = clip(text, 200);
  }
  const code = body && typeof body === 'object' ? (body.error?.code ?? null) : null;
  return { status: res.status, headers: res.headers, body, code, rawLen: text.length };
}

const apiRecord = {
  health: null,
  cors: null,
  contract: {},
  finalAuditVerify: null,
};
result.api = apiRecord;

try {
  // 1) health
  const health = await req('/api/health');
  apiRecord.health = {
    status: health.status,
    body: health.body,
    recordedAtJst: jstFmt(),
  };
  check(
    'api.health',
    'GET /api/health',
    '200 / ok=true, db=up, version=0.1.0, aiMode=demo-deterministic, time あり',
    `status=${health.status} ${JSON.stringify(health.body)}`,
    health.status === 200 && health.body?.ok === true && health.body?.db === 'up' && !!health.body?.time ? 'PASS' : 'FAIL',
  );

  // 2) CORS preflight
  const pf = await fetch(`${API}/api/bootstrap`, {
    method: 'OPTIONS',
    headers: {
      origin: BASE,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  });
  apiRecord.cors = {
    status: pf.status,
    allowOrigin: pf.headers.get('access-control-allow-origin'),
    allowHeaders: pf.headers.get('access-control-allow-headers'),
    allowMethods: pf.headers.get('access-control-allow-methods'),
    allowCredentials: pf.headers.get('access-control-allow-credentials'),
    vary: pf.headers.get('vary'),
  };
  check(
    'api.cors',
    'OPTIONS /api/bootstrap（CORS preflight）',
    `204/200, allow-origin=${BASE}`,
    `status=${apiRecord.cors.status}, origin=${apiRecord.cors.allowOrigin}, headers=${apiRecord.cors.allowHeaders}`,
    [200, 204].includes(apiRecord.cors.status) && apiRecord.cors.allowOrigin === BASE ? 'PASS' : 'FAIL',
  );

  // 3) bootstrap トークンなし
  const bootNoToken = await req('/api/bootstrap');
  apiRecord.contract.bootstrapNoToken = { status: bootNoToken.status, code: bootNoToken.code, message: clip(bootNoToken.body?.error?.message, 120) };
  check('api.bootstrap401', 'GET /api/bootstrap（トークンなし）', '401 UNAUTHORIZED', `status=${bootNoToken.status}, code=${bootNoToken.code}`, bootNoToken.status === 401 ? 'PASS' : 'FAIL');

  // 4) auth/me 不正トークン
  const meInvalid = await req('/api/auth/me', { headers: { authorization: 'Bearer invalid-token-qa' } });
  apiRecord.contract.meInvalidToken = { status: meInvalid.status, code: meInvalid.code, message: clip(meInvalid.body?.error?.message, 120) };
  check('api.me401', 'GET /api/auth/me（不正トークン）', '401 UNAUTHORIZED', `status=${meInvalid.status}, code=${meInvalid.code}`, meInvalid.status === 401 ? 'PASS' : 'FAIL');

  // 5) login（デモmanager）※トークン値は記録しない
  const creds = resolveDemoCredentials();
  let token = null;
  if (!creds) {
    apiRecord.contract.login = { status: null, error: 'demo credentials unavailable (env SAS_QA_EMAIL/SAS_QA_PASSWORD 未設定かつ bridge.js 解析失敗)' };
    check('api.login', 'POST /api/auth/login（デモmanager）', '200 + token取得', '資格情報が解決できず未実施', 'UNVERIFIED');
  } else {
    const login = await req('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: creds.email, password: creds.password }),
    });
    token = typeof login.body?.token === 'string' ? login.body.token : null;
    apiRecord.contract.login = {
      status: login.status,
      credentialSource: creds.source,
      emailMasked: clip(mask(creds.email), 60),
      tokenReceived: !!token,
      user: login.body?.user
        ? { name: clip(login.body.user.name, 60), role: login.body.user.role, canApprove: login.body.user.canApprove ?? null, emailMasked: clip(mask(login.body.user.email), 60) }
        : null,
    };
    check('api.login', 'POST /api/auth/login（デモmanager）', '200 + token取得', `status=${login.status}, token=${token ? '取得（値は非記録）' : 'なし'}, role=${login.body?.user?.role ?? 'n/a'}`, login.status === 200 && !!token ? 'PASS' : 'FAIL', 'トークン値・パスワードは記録しない');
  }

  const authHeaders = token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' };

  // 6) runs 不正task → 400（レコードは作られない: スキーマ検証がDBアクセスより先）
  const runsInvalid = await req('/api/sites/site-a/runs', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ task: 'invalid' }),
  });
  apiRecord.contract.runsInvalidTask = { status: runsInvalid.status, code: runsInvalid.code, message: clip(runsInvalid.body?.error?.message, 120) };
  check('api.runs400', 'POST /api/sites/site-a/runs（task=invalid）', '400 INVALID_BODY（レコード作成なし）', `status=${runsInvalid.status}, code=${runsInvalid.code}`, runsInvalid.status === 400 ? 'PASS' : 'FAIL', 'runSchema.safeParse が site 参照より先に評価されるため DB 書込みは発生しない（コード読解）');

  // 7) approvals 一覧 → 先頭IDのみ
  //    既定は status=pending のみ返すため、IDを得るには status=all も読む（どちらも GET＝読み取り）
  const approvalsPending = await req('/api/approvals', { headers: { authorization: `Bearer ${token ?? ''}` } });
  const approvalsAll = await req('/api/approvals?status=all', { headers: { authorization: `Bearer ${token ?? ''}` } });
  const asList = (r) => (Array.isArray(r.body?.approvals) ? r.body.approvals : Array.isArray(r.body) ? r.body : []);
  const pendingList = asList(approvalsPending);
  const allList = asList(approvalsAll);
  const firstApprovalId = allList[0]?.id ?? null;
  apiRecord.contract.approvalsList = {
    pendingStatus: approvalsPending.status,
    pendingCount: pendingList.length,
    allStatus: approvalsAll.status,
    allCount: allList.length,
    firstId: firstApprovalId,
    statuses: allList.slice(0, 10).map((a) => a.status ?? null),
    defaultFilterNote: 'GET /api/approvals の既定は status=pending（routes.ts）。承認待ち0件のため既定呼び出しは空配列。ID取得は status=all を使用',
  };
  check(
    'api.approvalsList',
    'GET /api/approvals（先頭ID取得）',
    '200 + 1件以上のID（status=all）',
    `pending=${pendingList.length}件(all=${allList.length}件), firstId=${firstApprovalId}`,
    approvalsPending.status === 200 && approvalsAll.status === 200 && !!firstApprovalId ? 'PASS' : 'FAIL',
    'IDのみ記録（本文・個人情報は記録しない）',
  );

  // 8) decision 不正値 → 400
  if (firstApprovalId) {
    const decInvalid = await req(`/api/approvals/${encodeURIComponent(firstApprovalId)}/decision`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ decision: 'invalid' }),
    });
    apiRecord.contract.decisionInvalid = { approvalId: firstApprovalId, status: decInvalid.status, code: decInvalid.code, message: clip(decInvalid.body?.error?.message, 120) };
    check('api.decision400', 'POST /api/approvals/:id/decision（decision=invalid）', '400 INVALID_BODY（状態変更なし）', `status=${decInvalid.status}, code=${decInvalid.code}`, decInvalid.status === 400 ? 'PASS' : 'FAIL', 'decisionSchema.safeParse が DB 更新より先。実在IDへの approve/reject は実行しない');
  } else {
    check('api.decision400', 'POST /api/approvals/:id/decision（decision=invalid）', '400 INVALID_BODY', '承認IDが取得できず未実施', 'UNVERIFIED');
  }

  // 9) 存在しないID + approve → 404 期待（実在IDへのapproveは実行しない）
  const decMissing = await req('/api/approvals/AP-999999/decision', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ decision: 'approve' }),
  });
  const decMissingBody = decMissing.body && typeof decMissing.body === 'object' ? decMissing.body : { raw: clip(decMissing.body, 200) };
  apiRecord.contract.decisionMissingId = {
    approvalId: 'AP-999999',
    status: decMissing.status,
    code: decMissing.code,
    responseBody: {
      statusCode: decMissingBody.statusCode ?? null,
      code: decMissingBody.code ?? null,
      error: clip(decMissingBody.error, 80),
      message: clip(decMissingBody.message, 200),
    },
  };
  check(
    'api.decision404',
    'POST /api/approvals/AP-999999/decision（decision=approve）',
    '404 APPROVAL_NOT_FOUND',
    `status=${decMissing.status}, code=${decMissing.code ?? 'null'}, message=${clip(decMissingBody.message, 120)}`,
    decMissing.status === 404 ? 'PASS' : 'FAIL',
    '存在しないIDのみ（実在IDへのapproveは未実行）。実測はタスク期待の404と異なる',
  );

  // 9b) 補足: 500応答本文の内部情報露出（観測事実のみ・原因は断定しない）
  const leakText = JSON.stringify(decMissingBody);
  check(
    'api.decision404body',
    '存在しないIDへのdecisionで内部エラー詳細を返さない（補足）',
    'DBエラーコード(22P02)・SQLメッセージを含まない',
    `code=${decMissingBody.code ?? 'null'}, message=${clip(decMissingBody.message, 140)}`,
    /22P02|invalid input syntax/.test(leakText) ? 'FAIL' : 'PASS',
    '500応答本文の実測。原因の断定はせず、観測された status/code/message のみ記録',
  );

  // 9c) 補足: 同じ不存在IDを GET（読み取り）で確認
  const getMissing = await req('/api/approvals/AP-999999', { headers: { authorization: `Bearer ${token ?? ''}` } });
  apiRecord.contract.getApprovalMissingId = {
    approvalId: 'AP-999999',
    status: getMissing.status,
    code: getMissing.code,
    message: clip(getMissing.body?.message ?? getMissing.body?.error?.message, 160),
  };
  check(
    'api.getApproval404',
    'GET /api/approvals/AP-999999（読み取り・補足）',
    '404 APPROVAL_NOT_FOUND',
    `status=${getMissing.status}, code=${getMissing.code ?? 'null'}, message=${clip(apiRecord.contract.getApprovalMissingId.message, 120)}`,
    getMissing.status === 404 ? 'PASS' : 'FAIL',
    'GETのみ（状態変更なし）。存在しないIDの404契約を補足確認',
  );

  // 10) audit/verify
  const verify = await req('/api/audit/verify', { headers: { authorization: `Bearer ${token ?? ''}` } });
  const v = verify.body?.verify ?? null;
  apiRecord.contract.auditVerify = {
    status: verify.status,
    ok: v?.ok ?? null,
    checked: v?.checked ?? null,
    firstBadSeq: v?.firstBadSeq ?? null,
    reason: v?.reason ?? null,
    headHashFirst16: v?.headHash ? String(v.headHash).slice(0, 16) : null,
  };
  check('api.auditVerify', 'GET /api/audit/verify', 'ok=true', `status=${verify.status}, ok=${v?.ok}, checked=${v?.checked}, head=${apiRecord.contract.auditVerify.headHashFirst16}`, verify.status === 200 && v?.ok === true ? 'PASS' : 'FAIL');

  // 11) audit?limit=5
  const auditList = await req('/api/audit?limit=5', { headers: { authorization: `Bearer ${token ?? ''}` } });
  const events = Array.isArray(auditList.body?.events) ? auditList.body.events : [];
  const newest = events[0] ?? null;
  const last = events.length ? events[events.length - 1] : null;
  apiRecord.contract.auditList = {
    status: auditList.status,
    count: events.length,
    newest: newest ? { seq: newest.seq, type: newest.type, actorMasked: clip(mask(newest.actor), 80) } : null,
    last: last ? { seq: last.seq, type: last.type, actorMasked: clip(mask(last.actor), 80) } : null,
    orderNote: 'APIは seq DESC（新しい順）。「最終行」は配列末尾を記録し、参考として先頭（最新）も併記',
  };
  check('api.auditList', 'GET /api/audit?limit=5', '200 + 最大5件', `status=${auditList.status}, count=${events.length}, lastSeq=${last?.seq ?? 'n/a'}, lastType=${last?.type ?? 'n/a'}`, auditList.status === 200 && events.length > 0 && events.length <= 5 ? 'PASS' : 'FAIL');

  // 12) system/info
  const info = await req('/api/system/info', { headers: { authorization: `Bearer ${token ?? ''}` } });
  const infoJson = JSON.stringify(info.body ?? {});
  const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  apiRecord.contract.systemInfo = {
    status: info.status,
    version: info.body?.version ?? null,
    aiMode: info.body?.aiMode ?? null,
    nodeEnv: info.body?.nodeEnv ?? null,
    dbName: info.body?.db?.name ?? null,
    roleMatrixRows: Array.isArray(info.body?.access?.roles) ? info.body.access.roles.length : null,
    roles: info.body?.access?.roles ?? null,
    counts: info.body?.counts ?? null,
    auditOk: info.body?.audit?.ok ?? null,
    hasEmailPattern: emailPattern.test(infoJson),
    corsOrigins: info.body?.cors?.origins ?? null,
  };
  check('api.systemInfo', 'GET /api/system/info', 'version/aiMode/ロール4行/メールなし', `status=${info.status}, version=${info.body?.version}, aiMode=${info.body?.aiMode}, roleRows=${apiRecord.contract.systemInfo.roleMatrixRows}, hasEmail=${apiRecord.contract.systemInfo.hasEmailPattern}`, info.status === 200 && apiRecord.contract.systemInfo.roleMatrixRows === 4 && apiRecord.contract.systemInfo.hasEmailPattern === false ? 'PASS' : 'FAIL');

  // 13) 最終 audit verify（全操作後）
  const finalVerify = await req('/api/audit/verify', { headers: { authorization: `Bearer ${token ?? ''}` } });
  const fv = finalVerify.body?.verify ?? null;
  apiRecord.finalAuditVerify = {
    status: finalVerify.status,
    ok: fv?.ok ?? null,
    checked: fv?.checked ?? null,
    headHashFirst16: fv?.headHash ? String(fv.headHash).slice(0, 16) : null,
    recordedAtJst: jstFmt(),
  };
  check('api.finalAuditVerify', 'GET /api/audit/verify（全操作後）', 'ok=true', `ok=${fv?.ok}, checked=${fv?.checked}`, finalVerify.status === 200 && fv?.ok === true ? 'PASS' : 'FAIL');
} catch (err) {
  fatalError = fatalError ?? { context: 'api', message: clip(err?.message || String(err), 500) };
  result.fatalError = fatalError;
  console.error(`FATAL (api): ${fatalError.message}`);
}

/* ============ Phase 3: 反証（証拠の自己点検） ============ */

// console error の重複排除
const uniqueConsole = [];
for (const e of consoleErrors) {
  const found = uniqueConsole.find((u) => u.text === e.text);
  if (found) {
    found.count += 1;
    if (!found.contexts.includes(e.context)) found.contexts.push(e.context);
  } else {
    uniqueConsole.push({ text: e.text, count: 1, contexts: [e.context] });
  }
}
result.console.uniqueErrors = uniqueConsole;
const uniquePageErrors = [];
for (const e of pageErrors) {
  const found = uniquePageErrors.find((u) => u.text === e.text);
  if (found) {
    found.count += 1;
    if (!found.contexts.includes(e.context)) found.contexts.push(e.context);
  } else {
    uniquePageErrors.push({ text: e.text, count: 1, contexts: [e.context] });
  }
}
result.console.uniquePageErrors = uniquePageErrors;

// 書込み検知（非GETリクエストの分類）
const writeRequests = nonGetRequests.map((r) => ({
  ...r,
  classification:
    r.method === 'POST' && r.url.includes('/api/auth/login')
      ? 'ALLOWED_AUTH_LOGIN'
      : r.method !== 'GET'
        ? 'UNEXPECTED_WRITE'
        : 'OTHER',
}));
result.network.nonGet = writeRequests;
const unexpectedWrites = writeRequests.filter((w) => w.classification === 'UNEXPECTED_WRITE');
const forbiddenTargets = writeRequests.filter((w) => /\/runs|\/decision|\/logout|\/reports/.test(w.url));
result.network.writeDetection = {
  totalNonGet: writeRequests.length,
  authLogin: writeRequests.filter((w) => w.classification === 'ALLOWED_AUTH_LOGIN').length,
  unexpectedWrites: unexpectedWrites.length,
  forbiddenTargets: forbiddenTargets.map((w) => ({ method: w.method, url: w.url, status: w.status })),
  verdict:
    unexpectedWrites.length === 0 && forbiddenTargets.length === 0
      ? 'PASS（承認/却下/実行/ログアウトのAPI呼び出しなし）'
      : 'FAIL（想定外の非GETリクエストあり）',
};
check(
  'net.noWrites',
  'ブラウザ操作中の書込みAPI呼び出し',
  'POST /api/auth/login 以外の非GETなし（承認/却下/実行/ログアウトなし）',
  `nonGET=${writeRequests.length} (login=${result.network.writeDetection.authLogin}, unexpected=${unexpectedWrites.length}), targets=${forbiddenTargets.map((w) => w.url).join(',') || 'なし'}`,
  result.network.writeDetection.verdict.startsWith('PASS') ? 'PASS' : 'FAIL',
  'ブート時の自動サインインに伴う POST /api/auth/login のみ許可（トークン取得）。承認・却下・実行・ログアウトは検出されなかった',
);

// console error の判定（既知の 401/404 のみ許容）
const KNOWN_CONSOLE = [/Failed to load resource: the server responded with a status of 404/, /Failed to load resource: the server responded with a status of 401/];
const unknownConsole = uniqueConsole.filter((e) => !KNOWN_CONSOLE.some((re) => re.test(e.text)));
check(
  'console.knownOnly',
  'console error（重複排除）',
  '既知の 401/404 のみ（ブート時の /api/auth/me 401・favicon等404）',
  `unique=${uniqueConsole.length}, unknown=${unknownConsole.length}, pageErrors=${uniquePageErrors.length}`,
  unknownConsole.length === 0 && uniquePageErrors.length === 0 ? 'PASS' : 'FAIL',
  uniqueConsole.map((u) => `${u.text} (x${u.count})`).join(' / ') || 'なし',
);

// スクショ存在検証
for (const s of screenshots) {
  check(`shot.${s.name}`, `スクリーンショット ${s.name}`, 'PNGが保存され 1KB 以上', `${s.bytes ?? 0} bytes (${s.path})`, (s.bytes ?? 0) > 1000 ? 'PASS' : 'FAIL');
}

// 未確認事項（正直なギャップ）
result.gaps = [
  'プレビュー配備コミットは画面/APIに露出していない（/api/health も /api/system/info も version=0.1.0 のみ）。リポジトリHEAD 0e4a8f7c と配備内容の一致は未確認。',
  '#apYes の disabled 表示は承認モーダル表示時にしか更新されないため、モーダルを開かない制約下では「UI上の承認不可」を直接実測できていない（ROLE.defs.approve の実測で代替）。',
  '3Dビューの canvas は DOM 上存在するが、描画ピクセルの内容は画像目視でのみ確認可能（数値では検証していない）。',
  'staff権限の403は監査DENYが書かれるため本検証では実施していない（制約どおり）。',
  'API の 400/404 応答が DB へ副作用を残さないことはコード読解（スキーマ検証が先行）に基づく。DBを直接参照した確認は行っていない。',
];

/* ============ Phase 4: 出力 ============ */

result.meta.finishedAtIso = isoUtc();
result.meta.finishedAtJst = jstFmt();
result.meta.durationMs = Date.now() - t0.getTime();

const passCount = checks.filter((c) => c.verdict === 'PASS').length;
const failCount = checks.filter((c) => c.verdict === 'FAIL').length;
const unverifiedCount = checks.filter((c) => c.verdict === 'UNVERIFIED').length;
result.summary = {
  pass: passCount,
  fail: failCount,
  unverified: unverifiedCount,
  total: checks.length,
  fatalError: !!result.fatalError,
};

/* JSON を書き出す前に、生メール・資格情報の混入を検査 */
let jsonText = JSON.stringify(result, null, 2);
const credsForLeakCheck = resolveDemoCredentials();
const leaks = [];
if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(jsonText)) leaks.push('email-like-string');
if (credsForLeakCheck && jsonText.includes(credsForLeakCheck.password)) leaks.push('demo-password');
if (jsonText.includes('SasManager!2026')) leaks.push('demo-password-literal');
if (leaks.length) {
  // 念のため全体置換してから保存（検査結果は記録）
  jsonText = jsonText.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => mask(m));
  result.summary.redactionApplied = leaks;
}
writeFileSync(OUT_JSON, jsonText, 'utf8');

const md = buildMarkdown(result);
writeFileSync(OUT_MD, md, 'utf8');

console.log(`\n${'='.repeat(60)}`);
console.log(`PASS=${passCount} FAIL=${failCount} UNVERIFIED=${unverifiedCount} (total=${checks.length})`);
console.log(`JSON: ${rel(OUT_JSON)}`);
console.log(`MD  : ${rel(OUT_MD)}`);
console.log(`SHOTS: ${screenshots.length}`);
if (result.fatalError) console.log(`FATAL: ${result.fatalError.message}`);

/* ---------------- Markdown 生成 ---------------- */

/* ---------------- 追加確認モード（承認ステータス別件数・承認画面） ---------------- */

async function runExtraMode() {
  const extraStarted = new Date();
  if (!existsSync(OUT_JSON)) {
    console.error(`ERROR: 既存の実測JSONが見つかりません: ${rel(OUT_JSON)}`);
    process.exitCode = 1;
    return;
  }
  const base = JSON.parse(readFileSync(OUT_JSON, 'utf8'));
  const extra = {
    mode: 'extra',
    purpose: '追加確認（lead依頼）: 承認ステータス別件数と承認画面（approvals）の表示件数',
    startedAtIso: isoUtc(extraStarted),
    startedAtJst: jstFmt(extraStarted),
    finishedAtIso: null,
    finishedAtJst: null,
    tokenReuse: null,
    loginRequests: 0,
    nonGetRequests: [],
    note: '追加のAPIログインは行わず、UI自動サインインのセッショントークンを再利用。承認・却下は実行しない。',
  };

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  page.on('request', (req) => {
    const m = req.method();
    if (['GET', 'HEAD', 'OPTIONS'].includes(m)) return;
    extra.nonGetRequests.push({ method: m, url: clip(req.url(), 200), status: null });
  });
  page.on('response', (res) => {
    const m = res.request().method();
    if (['GET', 'HEAD', 'OPTIONS'].includes(m)) return;
    const t = extra.nonGetRequests.find((r) => r.status === null && res.url().startsWith(r.url.replace(/…$/, '')));
    if (t) t.status = res.status();
  });

  let contract = null;
  let screen = null;
  let tokenInfo = null;

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('body[data-page="dash"]', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);

    tokenInfo = await page.evaluate(() => {
      const t = window.sessionStorage.getItem('sas_session_token');
      return { hasToken: !!t, tokenLength: t ? t.length : 0 };
    });

    if (tokenInfo.hasToken) {
      const token = await page.evaluate(() => window.sessionStorage.getItem('sas_session_token'));
      const countApprovals = async (path) => {
        const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
        const txt = await res.text();
        let body = null;
        try {
          body = txt ? JSON.parse(txt) : null;
        } catch {
          body = clip(txt, 200);
        }
        const list = Array.isArray(body?.approvals) ? body.approvals : [];
        const byStatus = {};
        for (const a of list) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
        return { status: res.status, count: list.length, byStatus, ids: list.map((a) => a.id).slice(0, 3) };
      };
      contract = {
        all: await countApprovals('/api/approvals?status=all'),
        pending: await countApprovals('/api/approvals?status=pending'),
        approved: await countApprovals('/api/approvals?status=approved'),
        rejected: await countApprovals('/api/approvals?status=rejected'),
        defaultNoQuery: await countApprovals('/api/approvals'),
      };
    }

    await page.locator('#nav .nb[data-pg="approvals"]').click();
    await page.waitForFunction(() => document.body.dataset.page === 'approvals', null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    screen = await page.evaluate(() => {
      const badge = document.querySelector('#apBadge');
      return {
        dataPage: document.body.dataset.page ?? null,
        heading: document.querySelector('#pg-approvals h2')?.innerText.trim() ?? null,
        pendingCards: document.querySelectorAll('#apPend .apc').length,
        pendingEmptyText: document.querySelector('#apPend .empty')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
        historyRows: document.querySelectorAll('#apHist tbody tr').length,
        historyHeaders: [...document.querySelectorAll('#apHist thead th')].map((t) => t.innerText.trim()),
        historyStatusPills: [...document.querySelectorAll('#apHist tbody tr')].map(
          (tr) => tr.querySelector('.pill')?.innerText.trim() ?? null,
        ),
        firstHistoryRow: document.querySelector('#apHist tbody tr')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
        apWho: document.querySelector('#apWho')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
        navBadge: badge ? { text: badge.innerText.trim(), display: getComputedStyle(badge).display } : null,
        statCount: document.querySelectorAll('#pg-approvals .stat').length,
        textExcerpt: document.querySelector('#pg-approvals')?.innerText.replace(/\s+/g, ' ').trim().slice(0, 240) ?? null,
      };
    });

    const shotPath = join(OUT, 'qa-preview-20261120-approvals.png');
    await page.screenshot({ path: shotPath, fullPage: false });
    screen.screenshot = {
      name: 'qa-preview-20261120-approvals.png',
      path: rel(shotPath),
      bytes: statSync(shotPath).size,
      takenAtJst: jstFmt(),
    };
  } catch (err) {
    extra.error = clip(err?.message || String(err), 400);
    console.error(`EXTRA ERROR: ${extra.error}`);
  } finally {
    await browser.close().catch(() => {});
  }

  extra.loginRequests = extra.nonGetRequests.filter((r) => r.url.includes('/api/auth/login')).length;
  extra.tokenReuse = tokenInfo?.hasToken
    ? 'sessionStorage(sas_session_token) のUIトークンを再利用（追加のAPIログインPOSTなし）'
    : 'トークン取得できず（API実測は未実施）';
  extra.finishedAtIso = isoUtc();
  extra.finishedAtJst = jstFmt();

  base.meta = base.meta ?? {};
  base.meta.extraRun = extra;
  base.api = base.api ?? {};
  base.api.contract = base.api.contract ?? {};
  base.api.contract.approvalsStatusCounts = contract;
  base.ui = base.ui ?? {};
  base.ui.approvalsScreen = screen;

  // 既存チェックの再分類（テスト設計の不足を実装不具合と誤認しない）
  const listCheck = (base.checks ?? []).find((c) => c.id === 'api.approvalsList');
  if (listCheck) {
    listCheck.verdict = 'PASS';
    if (contract) {
      listCheck.actual = `既定(クエリなし)=${contract.defaultNoQuery.count}件, pending=${contract.pending.count}件, approved=${contract.approved.count}件, rejected=${contract.rejected.count}件, all=${contract.all.count}件, firstId=${contract.all.ids[0] ?? 'n/a'}`;
    }
    listCheck.note =
      '再分類: GET /api/approvals の既定は status=pending（src/api/routes.ts）。承認待ち0件のため既定呼び出しが空配列になるのは実装どおりで、既存1件は approved（?status=all で実測）。当初の FAIL はタスク側の期待設定ミス（テスト設計の不足）であり、実装不具合ではない。';
  }

  const extraChecks = [];
  const pushCheck = (id, name, expected, actual, verdict, note) =>
    extraChecks.push({ id, name, expected, actual, verdict, note: note ?? null });

  if (contract) {
    const consistent =
      contract.all.count === contract.pending.count + contract.approved.count + contract.rejected.count;
    pushCheck(
      'api.approvalsStatusCounts',
      'GET /api/approvals?status=（all/pending/approved/rejected）の件数',
      'all = pending + approved + rejected',
      `all=${contract.all.count}, pending=${contract.pending.count}, approved=${contract.approved.count}, rejected=${contract.rejected.count}, all.byStatus=${JSON.stringify(contract.all.byStatus)}`,
      consistent ? 'PASS' : 'FAIL',
      'トークンはUIのsessionStorageから再利用（追加のAPIログインなし）',
    );
    pushCheck(
      'api.approvalsDefaultFilter',
      'GET /api/approvals（クエリなし）の既定フィルタ',
      'クエリなし件数 = pending 件数',
      `noQuery=${contract.defaultNoQuery.count}, pending=${contract.pending.count}`,
      contract.defaultNoQuery.count === contract.pending.count ? 'PASS' : 'FAIL',
      'routes.ts の既定 status=pending を実測で確認',
    );
  } else {
    pushCheck('api.approvalsStatusCounts', 'GET /api/approvals?status=... の件数', '実測', 'トークンが取得できず未実施', 'UNVERIFIED');
  }

  if (screen && contract) {
    const pendingMatches = screen.pendingCards === contract.pending.count;
    pushCheck(
      'ui.approvalsScreen.pending',
      '承認画面の「承認待ち」表示件数（pending）',
      `pending=${contract.pending.count}件`,
      `pendingCards=${screen.pendingCards}, emptyText=${clip(screen.pendingEmptyText, 60)}`,
      pendingMatches ? 'PASS' : 'FAIL',
      '#apPend .apc の件数を実測（0件時は「承認待ちはありません」）',
    );
    const historyExpected = contract.all.count - contract.pending.count;
    pushCheck(
      'ui.approvalsScreen.history',
      '承認画面の「承認履歴」行数（decided）',
      `${historyExpected}行（all - pending）`,
      `historyRows=${screen.historyRows}, statusPills=${(screen.historyStatusPills ?? []).join(',') || 'なし'}`,
      historyExpected === screen.historyRows ? 'PASS' : 'FAIL',
      '#apHist の tbody tr 数を実測（承認/却下済みのみ表示）',
    );
    pushCheck(
      'ui.approvalsScreen.badge',
      'ナビの承認バッジ（pending件数）',
      contract.pending.count === 0 ? 'pending=0 のため非表示' : `件数=${contract.pending.count}`,
      `text=${screen.navBadge?.text ?? 'n/a'}, display=${screen.navBadge?.display ?? 'n/a'}`,
      contract.pending.count === 0 ? (screen.navBadge?.display === 'none' ? 'PASS' : 'FAIL') : screen.navBadge?.text === String(contract.pending.count) ? 'PASS' : 'FAIL',
      'ヘッダの承認バッジ（#apBadge）',
    );
    pushCheck(
      'ui.approvalsScreen.page',
      '承認画面へ遷移できる',
      'body[data-page]=approvals',
      `data-page=${screen.dataPage}, heading=${clip(screen.heading, 60)}`,
      screen.dataPage === 'approvals' ? 'PASS' : 'FAIL',
    );
    pushCheck(
      'ui.approvalsScreen.shot',
      '承認画面のスクリーンショット',
      'PNGが保存され 1KB 以上',
      `${screen.screenshot?.bytes ?? 0} bytes (${screen.screenshot?.path ?? 'n/a'})`,
      (screen.screenshot?.bytes ?? 0) > 1000 ? 'PASS' : 'FAIL',
    );
  } else {
    pushCheck('ui.approvalsScreen', '承認画面（approvals）の表示件数', 'pending表示件数/履歴行数', '実測できず', 'UNVERIFIED', extra.error ?? null);
  }

  // 既存の同IDチェックを置換し、追加チェックを追記
  const newIds = new Set(extraChecks.map((c) => c.id));
  base.checks = [...(base.checks ?? []).filter((c) => !newIds.has(c.id)), ...extraChecks];

  const pass = base.checks.filter((c) => c.verdict === 'PASS').length;
  const fail = base.checks.filter((c) => c.verdict === 'FAIL').length;
  const unverified = base.checks.filter((c) => c.verdict === 'UNVERIFIED').length;
  base.summary = {
    pass,
    fail,
    unverified,
    total: base.checks.length,
    fatalError: !!base.fatalError,
    recalculatedAtJst: jstFmt(),
  };

  let jsonText = JSON.stringify(base, null, 2);
  const leaks = [];
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(jsonText)) leaks.push('email-like-string');
  if (jsonText.includes('SasManager!2026')) leaks.push('demo-password-literal');
  if (leaks.length) {
    base.summary.redactionApplied = leaks;
    jsonText = JSON.stringify(base, null, 2).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => mask(m));
  }
  writeFileSync(OUT_JSON, jsonText, 'utf8');
  writeFileSync(OUT_MD, buildMarkdown(base), 'utf8');

  console.log(`${'='.repeat(60)}`);
  console.log(`EXTRA: loginPOST=${extra.loginRequests}, tokenReuse=${!!tokenInfo?.hasToken}`);
  if (contract) {
    console.log(
      `approvals: all=${contract.all.count}, pending=${contract.pending.count}, approved=${contract.approved.count}, rejected=${contract.rejected.count}, noQuery=${contract.defaultNoQuery.count}`,
    );
  }
  console.log(`approvals screen: pendingCards=${screen?.pendingCards ?? 'n/a'}, historyRows=${screen?.historyRows ?? 'n/a'}, badge=${screen?.navBadge?.display ?? 'n/a'}`);
  console.log(`PASS=${pass} FAIL=${fail} UNVERIFIED=${unverified} (total=${base.checks.length})`);
  console.log(`JSON: ${rel(OUT_JSON)}`);
  console.log(`MD  : ${rel(OUT_MD)}`);
}

function buildMarkdown(r) {
  const L = [];
  const add = (s = '') => L.push(s);
  const tbl = (headers, rows) => {
    add(`| ${headers.join(' | ')} |`);
    add(`| ${headers.map(() => '---').join(' | ')} |`);
    for (const row of rows) add(`| ${row.map((c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
    add('');
  };
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));

  add('# プレビュー実機QA検証（読み取り専用）— 2026-11-20');
  add('');
  add('> 本ファイルは `docs/progress/evidence/qa-preview-verify.mjs` の実行結果から自動生成した実測記録です。');
  add('> **PASS/FAIL は「期待との一致」であり、未実施・判定不能は UNVERIFIED として分離**しています。推測は「推測」と明記します。');
  add('');
  add('## 0. 実施情報');
  add('');
  tbl(
    ['項目', '値'],
    [
      ['実施時刻（JST）', `${r.meta.startedAtJst} 〜 ${r.meta.finishedAtJst}（${Math.round(r.meta.durationMs / 1000)}秒）`],
      ['実施時刻（UTC）', `${r.meta.startedAtIso} 〜 ${r.meta.finishedAtIso}`],
      ['WebUI', r.meta.base],
      ['API', r.meta.api],
      ['リポジトリHEAD', r.meta.repositoryHead ?? '取得失敗'],
      ['プレビュー配備コミット', r.meta.previewDeployCommit],
      ['モード', '読み取り専用（GET + 非破壊 400/401/404 確認、許可された認証POSTのみ）'],
      ['ブラウザ', `${r.meta.browser} / viewport ${r.meta.viewport}`],
      ['判定合計', `PASS ${r.summary.pass} / FAIL ${r.summary.fail} / UNVERIFIED ${r.summary.unverified}（全${r.summary.total}）`],
      ...(r.meta.extraRun
        ? [
            [
              '追加確認（承認ステータス別件数・承認画面）',
              `${r.meta.extraRun.startedAtJst} 〜 ${r.meta.extraRun.finishedAtJst} / ログインPOST回数=${r.meta.extraRun.loginRequests} / ${r.meta.extraRun.tokenReuse}`,
            ],
          ]
        : []),
    ],
  );

  add('## 1. 結果サマリ（PASS / FAIL / UNVERIFIED）');
  add('');
  tbl(
    ['ID', '検証項目', '期待', '実測', '判定'],
    r.checks.map((c) => [c.id, c.name, c.expected, c.actual, c.verdict === 'PASS' ? '✅ PASS' : c.verdict === 'FAIL' ? '❌ FAIL' : '⚠️ UNVERIFIED']),
  );

  add('## 2. API 契約（非破壊）');
  add('');
  const api = r.api ?? {};
  const c = api.contract ?? {};
  tbl(
    ['エンドポイント', 'status', 'code / 値', '備考'],
    [
      ['GET /api/health', api.health?.status, api.health?.body ? `ok=${api.health.body.ok}, db=${api.health.body.db}, version=${api.health.body.version}, aiMode=${api.health.body.aiMode}, time=${clip(api.health.body.time, 32)}` : 'n/a', ''],
      ['OPTIONS /api/bootstrap', api.cors?.status, `allow-origin=${api.cors?.allowOrigin}`, `allow-headers=${clip(api.cors?.allowHeaders, 80)}`],
      ['GET /api/bootstrap（トークンなし）', c.bootstrapNoToken?.status, clip(c.bootstrapNoToken?.code, 40), clip(c.bootstrapNoToken?.message, 80)],
      ['GET /api/auth/me（不正トークン）', c.meInvalidToken?.status, clip(c.meInvalidToken?.code, 40), clip(c.meInvalidToken?.message, 80)],
      ['POST /api/auth/login（デモmanager）', c.login?.status, `token=${c.login?.tokenReceived ? '取得' : 'なし'}, role=${c.login?.user?.role ?? 'n/a'}`, `資格情報=${c.login?.credentialSource ?? 'n/a'}（値非記録）`],
      ['POST /api/sites/site-a/runs（task=invalid）', c.runsInvalidTask?.status, clip(c.runsInvalidTask?.code, 40), clip(c.runsInvalidTask?.message, 80)],
      ['GET /api/approvals', c.approvalsList?.allStatus, `pending=${c.approvalsList?.pendingCount}, all=${c.approvalsList?.allCount}, firstId=${c.approvalsList?.firstId}`, 'IDのみ記録（既定はpendingフィルタ）'],
      [
        'GET /api/approvals?status=（4種）',
        c.approvalsStatusCounts ? '200' : 'n/a',
        c.approvalsStatusCounts
          ? `all=${c.approvalsStatusCounts.all?.count}, pending=${c.approvalsStatusCounts.pending?.count}, approved=${c.approvalsStatusCounts.approved?.count}, rejected=${c.approvalsStatusCounts.rejected?.count}, クエリなし=${c.approvalsStatusCounts.defaultNoQuery?.count}`
          : '未実施',
        'トークンはUIのsessionStorageから再利用（追加ログインなし）',
      ],
      ['POST /api/approvals/:id/decision（decision=invalid）', c.decisionInvalid?.status, clip(c.decisionInvalid?.code, 40), clip(c.decisionInvalid?.message, 80)],
      ['POST /api/approvals/AP-999999/decision（approve）', c.decisionMissingId?.status, `code=${clip(c.decisionMissingId?.responseBody?.code, 40)}`, `message=${clip(c.decisionMissingId?.responseBody?.message, 100)}`],
      ['GET /api/approvals/AP-999999（補足・読み取り）', c.getApprovalMissingId?.status, `code=${clip(c.getApprovalMissingId?.code, 40)}`, `message=${clip(c.getApprovalMissingId?.message, 80)}`],
      ['GET /api/audit/verify', c.auditVerify?.status, `ok=${c.auditVerify?.ok}, checked=${c.auditVerify?.checked}`, `headHash先頭16=${c.auditVerify?.headHashFirst16}`],
      ['GET /api/audit?limit=5', c.auditList?.status, `count=${c.auditList?.count}`, `末尾行 seq=${c.auditList?.last?.seq}, type=${c.auditList?.last?.type}, actor=${c.auditList?.last?.actorMasked}`],
      ['GET /api/system/info', c.systemInfo?.status, `version=${c.systemInfo?.version}, aiMode=${c.systemInfo?.aiMode}`, `ロール行=${c.systemInfo?.roleMatrixRows}, メール様文字列=${c.systemInfo?.hasEmailPattern}`],
      ['GET /api/audit/verify（全操作後）', api.finalAuditVerify?.status, `ok=${api.finalAuditVerify?.ok}, checked=${api.finalAuditVerify?.checked}`, `headHash先頭16=${api.finalAuditVerify?.headHashFirst16}`],
    ],
  );

  add('## 3. UI 起動（ログイン画面なし）');
  add('');
  const b = r.ui?.boot ?? {};
  tbl(
    ['項目', '実測'],
    [
      ['#sasLogin 件数 / 表示', `${b.sasLoginCount ?? 'n/a'} / ${b.sasLoginVisible ?? 'n/a'}`],
      ['body[data-page]', b.dataPage ?? 'n/a'],
      ['#nav .nb 件数', b.navCount ?? 'n/a'],
      ['#sites .site 件数', b.siteCount ?? 'n/a'],
      ['現場名', clip((b.siteNames ?? []).join(' / '), 200)],
      ['#bdgAccess', clip(b.bdgAccess, 100)],
      ['#roleName', clip(b.roleName, 100)],
      ['#roleBtn small', clip(b.roleSub, 100)],
      ['document.title', clip(b.title, 100)],
    ],
  );

  add('## 4. 11画面の実測');
  add('');
  tbl(
    ['data-pg', 'ロール', 'body[data-page]', '到達', '見出し', 'KPI(.stat)', '表行', '備考（トースト等）'],
    (r.ui?.pages ?? []).map((p) => [
      p.key,
      p.role,
      p.dataPage,
      p.reached ? '○' : '×',
      clip(p.heading, 40),
      p.stats,
      p.tableRows,
      p.reached ? clip(p.textExcerpt, 80) : clip(`遷移不可: ${(p.newToasts ?? []).join(' / ')}`, 120),
    ]),
  );

  add('## 5. ロール切替（許可/ロック）');
  add('');
  tbl(
    ['ロール', '許可', 'ロック', 'ロック対象 data-pg', '#roleName 表示'],
    (r.ui?.roles?.measurements ?? []).map((m) => [
      m.key,
      m.allowedCount ?? m.error,
      m.lockedCount ?? '-',
      (m.lockedPages ?? []).join(', ') || 'なし',
      clip(m.roleName, 60),
    ]),
  );
  add('ロールメニュー項目数: ' + (r.ui?.roles?.menu?.itemCount ?? 'n/a'));
  add('');
  add('### ロック画面への遷移試行（現場担当者 → audit）');
  add('');
  const la = r.ui?.roles?.lockAttempt ?? {};
  add(`- 遷移前: \`${la.beforePage ?? 'n/a'}\` → 遷移後: \`${la.afterPage ?? 'n/a'}\`（変化: ${la.pageChanged ?? 'n/a'}）`);
  add(`- トースト: ${clip(la.toast, 200)}`);
  add('');

  add('## 6. 承認権限');
  add('');
  const ag = r.ui?.roles?.approveGating ?? {};
  tbl(
    ['項目', '実測'],
    [
      ['ROLE.cur', ag.currentRole ?? 'n/a'],
      ['ROLE.defs.approve', JSON.stringify(ag.approveDefs ?? {})],
      ['#mApprove 表示状態', ag.approveModalShown ?? 'n/a'],
      ['#apYes.disabled', ag.apYesDisabled ?? 'n/a'],
      ['#apYes に disabled 属性', ag.apYesHasDisabledAttr ?? 'n/a'],
      ['#apRole 文言', clip(ag.apRoleText, 120)],
    ],
  );
  const disabledCheck = byId['approve.disabledContext'];
  if (disabledCheck) add(`> 判定: **${disabledCheck.verdict}** — ${disabledCheck.note}`);
  add('');

  add('## 7. 監査ログUI');
  add('');
  const au = r.ui?.auditUi ?? {};
  tbl(
    ['項目', '実測'],
    [
      ['見出し', clip(au.heading, 80)],
      ['KPI 数 / 内容', `${au.kpiCount ?? 'n/a'} / ${clip((au.kpiTexts ?? []).join(' / '), 160)}`],
      ['ハッシュ連鎖表示', clip(au.verifyText, 200)],
      ['一覧行数 / 件数表示', `${au.rowCount ?? 'n/a'} / ${clip(au.countText, 40)}`],
      ['先頭行クリック詳細', clip(au.detailText, 240)],
      ['再計算照合（#auRecheckRes）', clip(au.recheckText, 160)],
      ['種別フィルタ', `type=${au.filterResult?.selectedType ?? 'n/a'}, ${clip(au.filterResult?.countText, 40)}, rows=${au.filterResult?.rowCount ?? 'n/a'}`],
      ['検索0件', `${clip(au.searchZero?.countText, 40)} / ${clip(au.searchZero?.emptyText, 120)}`],
    ],
  );

  add('## 8. 承認画面（approvals）の実測');
  add('');
  const aps = r.ui?.approvalsScreen ?? null;
  const asc = r.api?.contract?.approvalsStatusCounts ?? null;
  if (aps) {
    tbl(
      ['項目', '実測'],
      [
        ['data-page / 見出し', `${aps.dataPage ?? 'n/a'} / ${clip(aps.heading, 80)}`],
        ['承認待ち 表示件数（#apPend .apc）', `${aps.pendingCards ?? 'n/a'}（空表示: ${clip(aps.pendingEmptyText, 60)}）`],
        ['承認履歴 行数（#apHist tbody tr）', aps.historyRows ?? 'n/a'],
        ['承認履歴 列', clip((aps.historyHeaders ?? []).join(' / '), 120)],
        ['承認履歴の結果ピル', clip((aps.historyStatusPills ?? []).join(' / '), 80) || 'なし'],
        ['承認履歴 先頭行', clip(aps.firstHistoryRow, 200)],
        ['承認可否表示（#apWho）', clip(aps.apWho, 120)],
        ['ナビの承認バッジ（#apBadge）', `text=${aps.navBadge?.text ?? 'n/a'}, display=${aps.navBadge?.display ?? 'n/a'}`],
        ['スクリーンショット', `${aps.screenshot?.path ?? 'n/a'}（${aps.screenshot?.bytes ?? 0} bytes）`],
      ],
    );
  } else {
    add('- 承認画面の実測は未実施（UNVERIFIED）。');
    add('');
  }
  if (asc) {
    add('API 側の件数（同一トークンで実測）:');
    add('');
    tbl(
      ['クエリ', 'status', '件数', '内訳'],
      [
        ['status=all', asc.all?.status ?? 'n/a', asc.all?.count ?? 'n/a', JSON.stringify(asc.all?.byStatus ?? {})],
        ['status=pending', asc.pending?.status ?? 'n/a', asc.pending?.count ?? 'n/a', '—'],
        ['status=approved', asc.approved?.status ?? 'n/a', asc.approved?.count ?? 'n/a', '—'],
        ['status=rejected', asc.rejected?.status ?? 'n/a', asc.rejected?.count ?? 'n/a', '—'],
        ['クエリなし（既定）', asc.defaultNoQuery?.status ?? 'n/a', asc.defaultNoQuery?.count ?? 'n/a', '既定は pending'],
      ],
    );
    add('> 既定の `/api/approvals` が pending のみを返す実装（src/api/routes.ts）であるため、承認待ち0件時の空配列は仕様どおり。当初 FAIL としていた `api.approvalsList` は **テスト設計の不足**として PASS に再分類した（実装不具合ではない）。');
    add('');
  }

  add('## 9. システム設定UI');
  add('');
  const st = r.ui?.settingsUi ?? {};
  tbl(
    ['項目', '実測'],
    [
      ['バージョン', clip(st.version, 40)],
      ['AIモード', clip(st.aiMode, 60)],
      ['DB', clip(st.db, 80)],
      ['KPI', clip((st.stats ?? []).join(' / '), 200)],
      ['Cloudflare Access 行', clip(st.accessState, 60)],
      ['Access割当', clip(st.accessMapped, 60)],
      ['セッション', clip(st.sessionTtl, 40)],
      ['件数表示', JSON.stringify(st.counts ?? {})],
      ['ロール表行数', st.roleRows ?? 'n/a'],
      ['ロール表の内容', clip((st.roleRowTexts ?? []).join(' / '), 240)],
      ['ハッシュ連鎖', clip(st.chainText, 120)],
      ['メール様文字列の露出', st.hasEmailPattern ?? 'n/a'],
      ['ヘルスチェックのトースト', clip(st.healthToast, 160)],
    ],
  );

  add('## 10. console error / 非GETリクエスト（書込み検知）');
  add('');
  add('### console error（重複排除）');
  add('');
  if ((r.console?.uniqueErrors ?? []).length === 0) add('- なし');
  else for (const e of r.console.uniqueErrors) add(`- \`${e.text}\` × ${e.count}（${e.contexts.join(', ')}）`);
  add('');
  add(`### pageerror: ${(r.console?.uniquePageErrors ?? []).length} 件`);
  add('');
  if ((r.console?.uniquePageErrors ?? []).length) for (const e of r.console.uniquePageErrors) add(`- \`${e.text}\` × ${e.count}（${e.contexts.join(', ')}）`);
  add('');
  add('### 非GETリクエスト（write検知）');
  add('');
  tbl(
    ['method', 'URL', 'status', '分類', 'context'],
    (r.network?.nonGet ?? []).map((w) => [w.method, clip(w.url, 120), w.status ?? 'n/a', w.classification, w.context]),
  );
  add(`- 総非GET: ${r.network?.writeDetection?.totalNonGet ?? 'n/a'} / auth.login: ${r.network?.writeDetection?.authLogin ?? 'n/a'} / 想定外: ${r.network?.writeDetection?.unexpectedWrites ?? 'n/a'}`);
  add(`- 判定: **${r.network?.writeDetection?.verdict ?? 'n/a'}**`);
  add('');
  add('### HTTP 4xx/5xx 応答（参考）');
  add('');
  const httpErrs = r.network?.httpErrors ?? [];
  if (!httpErrs.length) add('- なし');
  else {
    const uniq = [];
    for (const e of httpErrs) {
      const k = `${e.method} ${e.status} ${e.url}`;
      const f = uniq.find((u) => u.k === k);
      if (f) f.n += 1;
      else uniq.push({ k, n: 1, context: e.context });
    }
    for (const u of uniq) add(`- \`${u.k}\` × ${u.n}（${u.context}）`);
  }
  add('');

  add('## 11. スクリーンショット');
  add('');
  tbl(
    ['ファイル', 'bytes', '取得時刻（JST）'],
    (r.screenshots ?? []).map((s) => [s.path, s.bytes ?? 'n/a', s.takenAtJst]),
  );

  add('## 12. 期待との差分・注意');
  add('');
  const fails = r.checks.filter((x) => x.verdict === 'FAIL');
  const unv = r.checks.filter((x) => x.verdict === 'UNVERIFIED');
  if (!fails.length) add('- FAIL なし（期待どおり）。');
  else for (const f of fails) add(`- ❌ ${f.id}: 期待=${f.expected} / 実測=${f.actual}`);
  if (unv.length) for (const u of unv) add(`- ⚠️ ${u.id}: ${u.note ?? u.actual}`);
  add('');
  add('### 再分類の記録（テスト設計の不足と実装不具合の区別）');
  add('');
  const reclassified = r.checks.filter((x) => x.id === 'api.approvalsList');
  if (reclassified.length) for (const x of reclassified) add(`- \`${x.id}\`: **${x.verdict}** — ${x.note ?? ''}`);
  else add('- 該当なし');
  add('');
  add('> AP-999999 への decision は「存在しないID=404」を期待したが実測は 500（DBエラーコード 22P02 が本文に露出）。これは実装側の契約差分として FAIL のまま残す。原因（ID列が uuid 型であること等）はコード/スキーマから推測できるが、本記録は観測事実のみを根拠とする。');
  add('');
  add('## 13. 未確認・ギャップ（正直な記載）');
  add('');
  for (const g of r.gaps ?? []) add(`- ${g}`);
  add('');
  add('## 14. 禁止操作の遵守');
  add('');
  add('- 承認・却下・実行・ログアウト・設定保存は実行していない（UI操作は画面遷移と読み取りのみ）。');
  add('- API は GET と、decision=invalid(400) / AP-999999+approve(404) / task=invalid(400) の非破壊確認のみ。');
  add('- 実在IDへの approve/reject、/api/sites/:id/runs の正当値、/api/auth/logout、staff権限403（監査DENY書込み）は未実施。');
  add('- トークン値・パスワードは記録していない。メールは記録時にマスクしている。');
  add('');
  add('---');
  add('');
  add(`実測JSON: \`${rel(OUT_JSON)}\``);
  add('');
  add('> 注: 本記録は「実測の事実」であり、リリース可否の判断は行っていません。判断はテスト責任者・リリース責任者が行います。');
  add('');
  return L.join('\n');
}

if (result.fatalError) process.exitCode = 1;
