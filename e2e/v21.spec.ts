import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email = 'manager@example.com', password = 'SasManager!2026') {
  await page.goto('/');
  const loginBox = page.locator('#sasLogin');
  await expect(loginBox).toBeVisible({ timeout: 20_000 });
  await page.locator('#sasEmail').fill(email);
  await page.locator('#sasPassword').fill(password);
  await page.locator('.sas-login-submit').click();
  await expect(loginBox).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('#boot')).toHaveClass(/hide/, { timeout: 25_000 });
  await expect(page.locator('body')).toHaveAttribute('data-page', 'dash', { timeout: 25_000 });
  await expect(page.locator('#sites .site')).toHaveCount(5);
}

test.describe.configure({ mode: 'serial' });

test('V2.1 UI: ログイン→ホーム（実データ・5現場・9画面）', async ({ page }) => {
  await login(page);
  await expect(page.locator('#nav .nb')).toHaveCount(9);
  await expect(page.locator('#sites .site')).toHaveCount(5);
  await expect(page.locator('#nav .nb[data-pg="dash"]')).toHaveClass(/on/);
  await expect(page.locator('#themeBtn')).toBeVisible();
  await expect(page.locator('#sasUserLabel')).toContainText('manager@example.com');
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
  await expect(page.locator('#sasLogin')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('body')).toHaveAttribute('data-page', 'dash', { timeout: 30_000 });
  await expect(html).toHaveAttribute('data-theme', after!);
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
