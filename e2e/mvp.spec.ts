import { expect, test } from '@playwright/test';

const MANAGER = { email: 'manager@example.com', password: 'SasManager!2026' };
const STAFF = { email: 'staff@example.com', password: 'SasStaff!2026' };

async function login(page: import('@playwright/test').Page, account: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(account.email);
  await page.getByLabel('パスワード').fill(account.password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /ホーム/ })).toBeVisible();
}

async function logout(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /ログアウト/ }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe.configure({ mode: 'serial' });

test('manager: 承認待ちなし → AI出来形下書き → 承認 → 再読込で永続化 → 監査検証', async ({
  page,
}) => {
  await login(page, MANAGER);

  // Empty state before any run
  await page.goto('/approvals');
  await expect(page.getByText('承認待ちはありません')).toBeVisible();

  // Open the 3D site
  await page.goto('/');
  await page.locator('a.site-card[href="/sites/site-a"]').click();
  await expect(page).toHaveURL(/\/sites\/site-a$/);
  await expect(page.locator('canvas.viewer-canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: '○○川 築堤・護岸工事' })).toBeVisible();

  // Run the as-built AI task
  await page.locator('.task-card').first().click();
  const approvalCta = page.locator('.approval-cta button');
  await expect(approvalCta).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.run-step.shown')).toHaveCount(6);

  // Approve the draft
  await approvalCta.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /出来形管理帳票/ })).toBeVisible();
  await expect(dialog.getByText('評価点数')).toBeVisible();
  await dialog.getByRole('button', { name: /承認して確定/ }).click();
  await expect(dialog).not.toBeVisible();

  // Report appears
  await expect(page.locator('.report-item b').first()).toHaveText('出来形管理帳票');

  // Reload: persistence through the API/PostgreSQL
  await page.reload();
  await expect(page.locator('.report-item b').first()).toHaveText('出来形管理帳票', {
    timeout: 15_000,
  });

  // Approved tab shows the decision
  await page.goto('/approvals?status=approved');
  await expect(page.locator('.approval-row').first()).toContainText('承認済み');
  await expect(page.locator('.approval-row').first()).toContainText('出来形管理帳票');

  // Audit chain verifies
  await page.goto('/audit');
  await expect(page.getByText('ハッシュ連鎖は整合しています')).toBeVisible();
  await expect(page.getByText('VERIFIED')).toBeVisible();
  await expect(page.locator('.audit-table tbody tr').first()).toBeVisible();
});

test('staff: AIタスクは実行できるが、承認は権限不足でできない', async ({ page }) => {
  await login(page, MANAGER);
  await logout(page);
  await login(page, STAFF);

  await page.locator('a.site-card[href="/sites/site-a"]').click();
  await expect(page.locator('canvas.viewer-canvas')).toBeVisible();

  await page.locator('.task-card').nth(1).click();
  const approvalCta = page.locator('.approval-cta button');
  await expect(approvalCta).toBeVisible({ timeout: 20_000 });
  await approvalCta.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/現在のユーザーには権限がありません/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /承認して確定/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /却下する/ })).toBeDisabled();
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(dialog).not.toBeVisible();
});

test('manager: 重機の安全離隔下書きを承認し、再読込後もレポートが残る', async ({ page }) => {
  await login(page, MANAGER);
  await page.goto('/sites/site-a');
  await expect(page.locator('canvas.viewer-canvas')).toBeVisible();

  await page.locator('.task-card').nth(1).click();
  const approvalCta = page.locator('.approval-cta button');
  await expect(approvalCta).toBeVisible({ timeout: 20_000 });
  await approvalCta.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('rowheader', { name: '危険エリア半径' })).toBeVisible();
  await expect(dialog.getByText('侵入あり（要確認）').first()).toBeVisible();
  await dialog.getByRole('button', { name: /承認して確定/ }).click();
  await expect(dialog).not.toBeVisible();

  await expect(page.locator('.report-item b').first()).toHaveText('重機の安全離隔アラート');
  await page.reload();
  await expect(page.locator('.report-item b').first()).toHaveText('重機の安全離隔アラート', {
    timeout: 15_000,
  });
});

test('dashboard: APIエラー時にエラー状態と再試行を表示する', async ({ page }) => {
  await login(page, MANAGER);
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'テスト用の障害' } }),
    }),
  );
  await page.goto('/');
  await expect(page.getByText('読み込みに失敗しました')).toBeVisible();
  await expect(page.getByRole('button', { name: '再試行' })).toBeVisible();
});

test('theme: ライト/ダーク切替が再読込後も保持される', async ({ page }) => {
  await login(page, MANAGER);
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');
  await page
    .getByRole('button', { name: /ライトモードに切り替え|ダークモードに切り替え/ })
    .click();
  const after = await html.getAttribute('data-theme');
  expect(after).not.toBe(before);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', after!);
});

test('site selector: 現場を切り替えて3Dビューを開ける', async ({ page }) => {
  await login(page, MANAGER);
  const select = page.getByLabel('現場を選択');
  await expect(select.locator('option')).toHaveCount(6);
  await select.selectOption('site-b');
  await expect(page).toHaveURL(/\/sites\/site-b$/);
  await expect(page.getByRole('heading', { name: '△△橋 下部工' })).toBeVisible();
  await expect(select).toHaveValue('site-b');
});
