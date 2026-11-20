# V2.1 UI — Cloudflare Preview 検証記録

実施日時：2026-11-20 12:32〜12:34 JST
対象：V2.1システム版（9画面）の静的UIシェル＋APIブリッジ
対象コード：PR #11（`7fb6779`）＋ヘッダー調整（PR #12）
Preview：<https://spatial-agent-studio-preview.pages.dev>（デプロイ `69ed0a62`）

## 検証（`node scripts/preview-smoke.mjs`）

| 検証 | 結果 |
| :-- | :-- |
| API health | `ok=true`, `db=up`（03:33:34Z） |
| CORS preflight | `204` + Pages Origin許可 |
| ログイン → V2.1ホーム | **PASS**（5現場・9画面） |
| 現場カードから現場Bを選択 | **PASS**（site-b / △△橋 下部工、3Dビュー） |
| ライト/ダーク切替 | **PASS**（light → dark） |
| 承認ページ | **PASS**（承認履歴 1件以上） |
| 監査ペイン | **PASS**（17件） |

**PREVIEW SMOKE: PASS**

## 証跡画像

- [preview-v21-dashboard.png](preview-v21-dashboard.png) — V2.1ホーム（実データ5現場）
- [preview-v21-site.png](preview-v21-site.png) — V2.1 3Dビュー（現場B）
- [preview-v21-approvals.png](preview-v21-approvals.png) — V2.1承認ページ
- [preview-v21-audit.png](preview-v21-audit.png) — V2.1監査ペイン

## 実データ範囲

- 実データ：ホーム（現場・KPI）、3Dビュー、AI出来形/安全離隔の承認、レポート、承認履歴、監査
- V2.1原本のサンプル表示：データ取得 / 3D基盤 / 連携 / 統制 / 構成 / 導入計画
- ログイン：V2.1 UI上のローカルログイン（デモアカウント）。Cloudflare Access OTPは未導入。
- 本番配備は未実施。

## 制約

- Preview APIはこのホストのローカルFastify（7450）＋Tunnel。
- V2.1原本のJS/CSSをそのまま使い、`bridge.js` で実データに接続。
- `web-v21/v21-app.js` は原本への最小パッチ（起動遅延・APIフック・データ公開）のみ。
