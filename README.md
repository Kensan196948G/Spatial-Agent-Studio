# Spatial Agent Studio

**空間AIエージェント・スタジオ（土木業務オートパイロット）— 個人利用MVP**

現場を3Dで見て、AIが計測・集計・帳票の下書きまで進め、**確定は人が行う**。
すべての判断と操作は、改ざん検知可能な監査ログ（ハッシュ連鎖）に残ります。

> **重要：AIはデモです。** 本MVPの「AIエージェント」はスクリプト化されたデモで、外部LLM/APIには接続しません。
> 数値は `src/shared/measurements.ts` の**決定的な計算エンジン**が算出します。AIが数値を作ることはありません。
> 現場・人物・数値はすべて架空のサンプルです。

---

## 30秒でわかる

| 項目 | 内容 |
| :-- | :-- |
| 🎯 **目的** | 夕方に集中する写真整理・集計・帳票作成をAIの下書きに置き換え、人は確認・判断・現場に時間を使う |
| 👥 **利用者** | 現場代理人・所長（承認可）、現場担当者（承認不可）。個人利用MVP |
| 🧭 **主要フロー** | ① 出来形管理：AI計測→下書き→人の承認→DB保存→再読込 ② 重機の安全離隔 ③ 承認・監査 |
| 🖥️ **構成** | React + Vite（WebUI）／ Fastify + TypeScript（API）／ PostgreSQL（ローカル）／ Cloudflare Pages + Tunnel（Preview） |
| 🎨 **UI** | **ライト／ダーク切替**（OS設定＋手動、再読込後も保持）、**現場セレクタ**（5現場） |
| 🔒 **統制** | 承認は `manager` のみ、監査ログは追記専用、ハッシュ連鎖を再計算して検証 |
| ⚠️ **対象外** | 実3DGS生成、実LLM/computer-use、SSO、外部連携、本番配備 |

### いま試せるURL

| 用途 | URL |
| :-- | :-- |
| **Cloudflare Pages Preview（WebUI）** | <https://spatial-agent-studio-preview.pages.dev> |
| **API（Cloudflare Tunnel）** | <https://sas-api.mirai-dx-platform.com/api/health> |
| ローカルAPI | <http://127.0.0.1:7440/api/health> |
| ローカルWeb（Vite） | <http://127.0.0.1:5174> |

PreviewのAPIは、このホストのローカルPostgreSQL（`spatial_agent_studio_preview`）に接続しています。
対象コミット：`930415d`（main、PR #6 merge）／WebUIデプロイ `8b5bf4d3`
GitHub：<https://github.com/Kensan196948G/Spatial-Agent-Studio>

![Cloudflare Preview dashboard](docs/progress/evidence/preview-dashboard.png)

### デモアカウント

| ロール | メール | パスワード | できること |
| :-- | :-- | :-- | :-- |
| 現場代理人・所長 | `manager@example.com` | `SasManager!2026` | AIタスク、**承認・却下**、監査閲覧 |
| 現場担当者 | `staff@example.com` | `SasStaff!2026` | AIタスク、閲覧（**承認は403**） |

> パスワードはデモ用です。共有・公開環境では必ず変更してください（`SEED_*_PASSWORD`）。

---

## 主要フロー（受入済み）

### 1. 出来形管理（メインフロー）

1. ログイン → ホーム → 現場A「○○川 築堤・護岸工事」を開く
2. 「盛土 出来形管理」をクリック
3. AI（デモ）が6ステップで3Dビューを操作：知覚 → 推論 → 操作 → 検証
4. 帳票ドラフトが生成され、**承認待ち**に登録
5. 「内容を確認」→「承認して確定」
6. レポートが登録され、**ページ再読込後もDBから復元**
7. 監査ログでハッシュ連鎖が `VERIFIED`

### 2. 重機 安全離隔チェック

- 旋回中心・バケット先端・作業員3名の位置を60秒分（0.2秒刻み）走査
- 危険エリア半径 `7.5m`、最小離隔 `5.0m`（W-02）、侵入時刻 `4.2秒` を算出
- アラート送信・旋回停止は人の承認が必要

### 3. 承認・監査

- 承認一覧で下書きを確認し、承認／却下
- 承認時のみレポートを作成
- 監査ログは `APPROVED` / `REJECTED` / `DENY` 等を追記
- `audit_events` はDBトリガで `UPDATE` / `DELETE` を拒否

---

## クイックスタート（ローカル）

### 前提

- Node.js 22+
- pnpm 12+
- PostgreSQL 16+（ローカル）

### 1. 依存関係

```bash
pnpm install
```

### 2. データベース

ローカルでは **Unixソケットのpeer認証**（OSユーザー）を既定にしています。専用DBを作成します。

```bash
createdb spatial_agent_studio
createdb spatial_agent_studio_test
createdb spatial_agent_studio_preview
pnpm run db:migrate
pnpm run db:seed
pnpm run db:verify
```

別ホスト・別ロールのPostgreSQLを使う場合：

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/spatial_agent_studio'
export TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/spatial_agent_studio_test'
pnpm run db:migrate && pnpm run db:seed
```

`.env.example` に全環境変数の名前と用途を記載しています（値はコミットしない）。

### 3. 起動

```bash
pnpm run dev
# Web: http://127.0.0.1:5174
# API: http://127.0.0.1:7440
```

Viteが `/api` をAPIへプロキシします。本番ビルドをAPIから配信する場合：

```bash
pnpm run build
pnpm run start   # http://127.0.0.1:7440
```

### 4. テスト

```bash
pnpm run typecheck
pnpm run lint
pnpm run test:unit
pnpm run test:api     # test DBをreset→migrate→seedしてから実行
pnpm run build
pnpm run test:e2e     # test DB reset + build + Playwright
pnpm ci:local        # local CI runner + GitHub status ci/local-verify
pnpm run secret-scan
```

`test:e2e` はローカルAPIを起動し、AI出来形の承認→再読込→監査検証、staff権限拒否、安全離隔の承認→再読込、APIエラー状態を検証します。

---

## アーキテクチャ

```text
Browser (React + Vite)
  ├─ 3D viewer (Canvas2D) ── src/web/viewer/scene.ts
  ├─ screens ─────────────── login / dashboard / site / approvals / audit
  └─ API client ──────────── cookie or Bearer token
        │
        ▼
Fastify API (src/api)
  ├─ auth / sessions ─────── scrypt + HttpOnly cookie + Bearer
  ├─ AI orchestrator ─────── demo steps (src/api/agent.ts)
  ├─ calculation engine ──── src/shared/measurements.ts
  ├─ approvals / reports ─── 人の承認でのみ確定
  └─ audit hash chain ────── SHA-256(prev|ts|actor|type|detail)
        │
        ▼
PostgreSQL (local)
  users / sessions / sites / site_versions / runs / approvals / reports / audit_events
```

- **フロントとサーバで同じ計算エンジン**を使用。同じ入力なら同じ数値になります。
- **AIは数値を作らない**：`deviationStats` / `embankmentBalance` / `safetyScan` の結果を下書きに使用。
- **確定は人**：`POST /api/approvals/:id/decision` は `manager` のみ。`staff` は403 + 監査DENY。
- **監査は追記専用**：DBトリガ + ハッシュ連鎖検証。

詳細：[docs/architecture.md](docs/architecture.md) / [docs/api.md](docs/api.md) / [docs/db.md](docs/db.md)

---

## Cloudflare Preview

Previewは次の2部品で構成しています。

| 部品 | 実体 | URL |
| :-- | :-- | :-- |
| WebUI | Cloudflare Pages（静的SPA） | <https://spatial-agent-studio-preview.pages.dev> |
| API | ローカルFastify + Cloudflare Tunnel | <https://sas-api.mirai-dx-platform.com> |
| DB | ローカルPostgreSQL `spatial_agent_studio_preview` | localhost only |

- Pagesのビルドは `VITE_API_BASE_URL=https://sas-api.mirai-dx-platform.com` を設定。
- クロスオリジンでは **Bearerトークン**（sessionStorage）を使用し、Cookieの第三者制限を回避。
- APIは `CORS_ORIGINS` でPagesのOriginのみ許可。
- トンネル設定：[deploy/cloudflared/config.yml](deploy/cloudflared/config.yml)
- systemd unit（参考）：[deploy/systemd/](deploy/systemd/)

再配備手順・検証手順：[docs/deploy.md](docs/deploy.md)

> **本番ではありません。** Cloudflare PagesのPreviewプロジェクトと、ローカルAPIのTunnelです。
> 本番正式環境への昇格、DNS/Accessポリシーの変更は行っていません。

---

## セキュリティ / デモ境界

- 秘密情報はリポジトリに含めません。`.env` はgitignore済みです。
- ローカルDBはUnixソケットpeer認証（または環境変数の専用ロール）。
- パスワードはscrypt（N=16384, r=8, p=1）でハッシュ化。
- セッションはHttpOnly + SameSite=Lax Cookie、またはBearerトークン（Pages用）。
- 監査ログは追記専用。ハッシュ連鎖を全件再計算して検証。
- **AI（デモ）**：外部LLM/APIへは接続しません。画面に `AI: DEMO` を常時表示。
- **サンプルデータ**：現場・人物・数値は架空です。

### 既知の制約

- 実3DGS/点群/LiDARの取込、WebGPUレンダラは未実装（Canvas2Dのみ）。
- 実LLM/computer-use、AIゲートウェイ、SSO、Teams/帳票/原価連携は対象外。
- スマートフォン詳細最適化は未実施（PCブラウザ中心）。
- Cloudflare PreviewのAPIはこのホストが起動している間のみ利用可能。
- **GitHub ActionsのCIワークフローは未適用**：ハーネスの `DEPLOY=critical` ポリシーが `.github/workflows/**` へのAI書き込みを拒否します。代わりに**ローカルCIランナー**（`pnpm ci:local`）が実際の全検証を実行し、GitHubのコミットステータス `ci/local-verify` を投稿します。mainのrulesetはこのステータスを**Required Check**として要求するため、CI未実施のPRはマージできません。PR #8では **BLOCKED → `ci/local-verify` success → auto-merge** を実際に確認済みです（[証跡](docs/progress/evidence/ci-gate-proof.md)）。GitHub Actions用テンプレートは人間の適用用に [templates/ci/ci.yml](templates/ci/ci.yml) へ残しています。
- **WebUI設計仕様 v1.0 は承認待ち**：既存V2.1デザインのMVP適用として実装済み。

---

## ディレクトリ

```text
src/
  api/       Fastify API（auth / routes / agent / audit / db）
  shared/    決定的計算エンジン + 型定義
  web/       React WebUI（screens / components / viewer / styles）
db/
  migrations/001_init.sql
scripts/     db migrate/seed/verify/reset, secret scan
tests/       unit / API integration
e2e/         Playwright
deploy/      systemd / cloudflared 設定
docs/        設計仕様・API・DB・配備・進捗
reference/   既存プロトタイプ（V1.0 / V1.1 / V2.1）
templates/   人間適用用のCIテンプレート
```

---

## 復旧・再開

| 状況 | 対応 |
| :-- | :-- |
| DBを作り直す（検証DBのみ） | `ALLOW_DB_RESET=1 DATABASE_URL='...spatial_agent_studio_test' pnpm run db:reset && pnpm run db:migrate && pnpm run db:seed` |
| Preview APIが落ちた | `nohup env ... tsx src/api/server.ts` を再起動（[docs/deploy.md](docs/deploy.md)） |
| Tunnelが落ちた | `nohup cloudflared --config deploy/cloudflared/config.yml tunnel run` |
| 監査ログを検証 | 画面の「ハッシュ連鎖を検証」または `GET /api/audit/verify` |
| 承認をやり直す | 監査ログは不変。新しいAI実行を追加して再判断する（既存レコードは削除しない） |

作業記録・未完了・次の一手：[docs/progress/progress.md](docs/progress/progress.md)

---

## ドキュメント

- [WebUI 設計仕様 v1.0（OpenDesign成果物）](docs/design/webui-design-v1.html)
- [アーキテクチャ](docs/architecture.md)
- [API](docs/api.md)
- [DB・Migration・Seed](docs/db.md)
- [Cloudflare Preview / 配備・検証](docs/deploy.md)
- [進捗・判断・証跡](docs/progress/progress.md)

---

## ライセンス

UNLICENSED — 個人利用MVPのため。外部公開・再配布前に権利確認を行ってください。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
