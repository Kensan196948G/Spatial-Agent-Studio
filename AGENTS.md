# AGENTS.md — Spatial Agent Studio

## 役割と報告

- このリポジトリは「個人利用MVP」です。本番正式版ではありません。
- 実装・検証・報告は日本語で行います。事実／仮説／未確認を分け、実行していない検証を成功と報告しません。
- 判断が必要な場合は数字選択式（1/2/3）で提示します。

## スタック

- Node.js 22 / pnpm 12 / TypeScript strict
- Web: React 19 + Vite 6（`src/web`）
- API: Fastify 5（`src/api`）
- DB: PostgreSQL（`db/migrations`, `scripts/db.ts`）
- Test: Vitest（unit/API）+ Playwright（E2E）

## 主要コマンド

```bash
pnpm install
pnpm run dev            # API 7440 + Vite 5174
pnpm run typecheck
pnpm run lint
pnpm run test:unit
pnpm run test:api       # test DB reset→migrate→seed→API tests
pnpm run build
pnpm run test:e2e       # test DB reset + build + Playwright
pnpm ci:local           # local CI + GitHub status ci/local-verify
pnpm run secret-scan
pnpm run db:migrate
pnpm run db:seed
pnpm run db:verify
```

## 不変条件

1. **AIは数値を作らない。** 数値は `src/shared/measurements.ts` の決定的計算エンジンの結果のみ。
2. **確定は人。** 承認・却下は `manager` のみ。`staff` は403 + 監査 `DENY`。
3. **監査ログは追記専用。** `audit_events` の UPDATE/DELETE はDBトリガで拒否。
4. **デモ境界を隠さない。** 画面に `AI: DEMO` を表示し、外部LLM/APIは未接続。
5. **サンプルデータのみ。** 実データ・個人情報をSeed/Preview/テストに入れない。

## DBの安全

- `pnpm run db:reset` は `ALLOW_DB_RESET=1` かつ DB名が `spatial_agent_studio(_test|_preview|_dev)` のときだけ実行。
- 本番DB・実データへの破壊的操作は禁止。
- スキーマ変更は `db/migrations` に追加（既存マイグレーションを書き換えない）。
- Preview DBは `spatial_agent_studio_preview` のみ。

## ハーネスポリシー

- `.github/workflows/**` は `DEPLOY=critical` としてAIから書き込み禁止。
  代わりに `pnpm ci:local` が全検証を実行し、GitHubステータス `ci/local-verify` を投稿する。
  mainのrulesetはこのステータスをRequired Checkとして要求する。
  GitHub Actions用テンプレートは `templates/ci/ci.yml`（人間が適用）。
- 本番配備、DNS/Accessの重大変更、費用発生、破壊的DB操作は人間の承認なしに行わない。
- Preview配備（Cloudflare Pages / 既存Tunnel）は検証範囲。本番昇格は行わない。

## 現在のPreview

| 用途 | URL |
| :-- | :-- |
| WebUI | https://spatial-agent-studio-preview.pages.dev |
| API | https://sas-api.mirai-dx-platform.com |
| DB | ローカル `spatial_agent_studio_preview` |

起動・再配備・復旧手順は [docs/deploy.md](docs/deploy.md) を参照。

## 記録

- 進捗・判断・証跡：`docs/progress/progress.md`
- Preview検証：`docs/progress/evidence/preview-verification.md`
- 設計仕様：`docs/design/webui-design-v1.html`

作業を中断・再開するときは、まず `docs/progress/progress.md` と現在のGit/DB/Preview状態を照合すること。
