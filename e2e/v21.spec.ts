import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveClass(/hide/, { timeout: 25_000 });
  await expect(page.locator('body')).toHaveAttribute('data-page', 'dash', { timeout: 25_000 });
  await expect(page.locator('#sites .site')).toHaveCount(5);
  await expect(page.locator('#btnLogout')).toBeVisible({ timeout: 15_000 });
}

test.describe.configure({ mode: 'serial' });

test('V2.1 UI: ログイン→ホーム（実データ・5現場・9画面）', async ({ page }) => {
  await login(page);
  await expect(page.locator('#nav .nb')).toHaveCount(11);
  await expect(page.locator('#sites .site')).toHaveCount(5);
  await expect(page.locator('#nav .nb[data-pg="dash"]')).toHaveClass(/on/);
  await expect(page.locator('#themeBtn')).toBeVisible();
  await expect(page.locator('#roleName')).toContainText('現場代理人');
  await expect(page.locator('#bdgAi')).toHaveText(/AI:\s*DEMO/);
});

test('V2.1 UI: ログイン画面なしで起動（Access認証前提）', async ({ page }) => {
  await login(page);
  await expect(page.locator('#sasLogin')).toHaveCount(0);
  await expect(page.locator('#sasSignedOut')).toBeHidden();
  await expect(page.locator('#bdgAccess')).toContainText('Access 未経由');
});

test('V2.1 UI: 現場カードから現場Bを選択して3Dビューへ', async ({ page }) => {
  await login(page);
  await page.locator('#sites .site').nth(1).click();
  await expect(page.locator('body')).toHaveAttribute('data-page', 'viewer');
  await expect(page.locator('#sasSiteSelect')).toHaveValue('site-b');
  await expect(page.locator('#verBar .vchip.on')).toHaveText('10/16');
  await expect(page).toHaveTitle(/△△橋 下部工/);
});

test('V2.1 UI: ライト/ダーク切替が再読込後も保持される', async ({ page }) => {
  await login(page);
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');
  await page.locator('#themeBtn').click();
  const after = await html.getAttribute('data-theme');
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.locator('#sasSignedOut')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('body')).toHaveAttribute('data-page', 'dash', { timeout: 30_000 });
  await expect(html).toHaveAttribute('data-theme', after!);
});

test('V2.1 UI: ログアウト→再サインイン', async ({ page }) => {
  await login(page);
  await page.locator('#btnLogout').click();
  await expect(page.locator('#sasSignedOut')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#sasSignedOutTitle')).toHaveText('ログアウトしました');
  await page.locator('#sasSignedOutAgain').click();
  await login(page);
});

test('V2.1 UI: Accessロール（現場担当者）がメールで決まる', async ({ page }) => {
  await page.route('**/cdn-cgi/access/get-identity', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'staff@example.com' }),
    }),
  );
  await login(page);
  await expect(page.locator('#bdgAccess')).toContainText('Access 認証済み');
  await expect(page.locator('#roleName')).toHaveText('現場担当者');
  await page.locator('#roleBtn').click();
  await expect(page.locator('#roleMenu .ritem')).toHaveCount(1);
  await expect(page.locator('#roleMenu .ritem')).toContainText('現場担当者');
});

test('V2.1 UI: Accessロール（管理者メール）は3ロールを切替できる', async ({ page }) => {
  await page.route('**/cdn-cgi/access/get-identity', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'manager@example.com' }),
    }),
  );
  await login(page);
  await expect(page.locator('#roleName')).toHaveText('現場代理人・所長');
  await page.locator('#roleBtn').click();
  await expect(page.locator('#roleMenu .ritem')).toHaveCount(3);
  await page.locator('#roleMenu .ritem[data-r="hq"]').click();
  await expect(page.locator('#roleName')).toHaveText('本社（工務・安全・品質）');
});

test('V2.1 UI: 監査ログ画面（一覧・絞り込み・詳細・ハッシュ再計算）', async ({ page }) => {
  await login(page);
  await page.locator('#nav .nb[data-pg="audit"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-page', 'audit');
  await expect(page.locator('#auKpis .stat')).toHaveCount(4);
  await expect(page.locator('#auTable tbody tr').first()).toBeVisible({ timeout: 20_000 });
  const rows = await page.locator('#auTable tbody tr').count();
  expect(rows).toBeGreaterThan(10);

  await page.locator('#auType').selectOption({ index: 1 });
  await expect(page.locator('#auTable tbody tr').first()).toBeVisible();

  await page.locator('#auSearch').fill('zzz-no-match');
  await expect(page.locator('#auTable .empty')).toBeVisible();
  await page.locator('#auSearch').fill('');
  await expect(page.locator('#auTable tbody tr').first()).toBeVisible();

  await page.locator('#auTable tbody tr').first().click();
  await expect(page.locator('#auDetail .kv')).toBeVisible();
  await page.locator('#auRecheck').click();
  await expect(page.locator('#auRecheckRes')).toContainText('一致', { timeout: 10_000 });
});

test('V2.1 UI: システム設定画面（環境・権限・データ・監査）', async ({ page }) => {
  await login(page);
  await page.locator('#nav .nb[data-pg="settings"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-page', 'settings');
  await expect(page.locator('#stBody .kv').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#stBody')).toContainText('0.1.0');
  await expect(page.locator('#stBody')).toContainText('Cloudflare Access');
  await expect(page.locator('#stBody table.tbl tbody tr')).toHaveCount(4);

  await page.locator('#stHealth').click();
  await expect(page.locator('.toast')).toContainText('ヘルスチェック');
});

test('V2.1 UI: AI出来形→人の承認→レポート→承認履歴→監査', async ({ page }) => {
  await login(page);
  await page.locator('#nav .nb[data-pg="viewer"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-page', 'viewer');
  await page.locator('.task[data-sc="asbuilt"]').click();
  const approval = page.locator('#mApprove');
  await expect(approval).toHaveClass(/show/, { timeout: 150_000 });
  await expect(page.locator('#apTitle')).toContainText('出来形管理帳票');
  await page.locator('#apYes').click();
  const report = page.locator('#mReport');
  await expect(report).toHaveClass(/show/, { timeout: 30_000 });
  await expect(page.locator('#repBody')).toContainText('出来形管理帳票');
  await page.locator('#mReport .x').click();

  await page.locator('#nav .nb[data-pg="approvals"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-page', 'approvals');
  await expect(page.locator('#apHist tbody tr').first()).toContainText('出来形管理帳票');

  await page.locator('#nav .nb[data-pg="viewer"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-page', 'viewer');
  await page.locator('#tabs button[data-p="audit"]').click();
  await expect(page.locator('#audList .au').first()).toBeVisible({ timeout: 15_000 });
});
