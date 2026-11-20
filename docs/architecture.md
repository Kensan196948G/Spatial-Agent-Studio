# Architecture — Spatial Agent Studio MVP

## 1. 目的とスコープ

現場の3Dビュー上でAI（デモ）が計測・判定・帳票下書きを行い、**人が承認して初めて確定**する
個人利用MVPです。本番正式版ではなく、主要価値を1人で操作・検証できる最小構成です。

- 対象：PCブラウザ、1ユーザー（manager / staff の2ロール）
- 対象外：実3DGS生成、実LLM、SSO、外部連携、本番配備、マルチテナント

## 2. コンポーネント

```text
┌────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│  V2.1 static UI shell（web-v21/）                           │
│  ├─ 9 screens（V2.1 CSS/HTML/JS 原本）                      │
│  ├─ Canvas2D/WebGPU 3D viewer（v21-app.js）                 │
│  └─ bridge.js（cookie or Bearer / approvals / audit）       │
└──────────────────────────┬─────────────────────────────────┘
                           │ HTTPS (Pages → Tunnel) / same-origin (local)
┌──────────────────────────▼─────────────────────────────────┐
│ Fastify API (Node 22 + TypeScript, port 7440/7450)         │
│  ├─ @fastify/cookie + @fastify/cors                         │
│  ├─ auth: scrypt, session token hash, manager/staff         │
│  ├─ agent: スクリプト化デモ（6ステップ、外部LLMなし）       │
│  ├─ measurements: 決定的計算エンジン（shared）              │
│  ├─ approvals: manager のみ確定、承認時に report 作成      │
│  └─ audit: 追記専用 + SHA-256 ハッシュ連鎖                  │
└──────────────────────────┬─────────────────────────────────┘
                           │ pg (Unix socket peer / DATABASE_URL)
┌──────────────────────────▼─────────────────────────────────┐
│ PostgreSQL 18                                               │
│  users / sessions / sites / site_versions / runs            │
│  approvals / reports / audit_events                         │
└────────────────────────────────────────────────────────────┘
```

## 3. データフロー（出来形管理）

1. `POST /api/sites/:id/runs {task:"asbuilt"}`。
2. APIが現場モデル（`sites.model`）を読み、`buildRun()` が
   `deviationStats` / `embankmentBalance` / `crossSection` を実行。
3. `runs`（result/steps）と `approvals`（pending）を同一トランザクションで作成。
4. `audit_events` に `RUN_REQUESTED` / `RUN_COMPLETED` / `APPROVAL_REQUESTED` を追記。
5. V2.1 UIは`steps`を順に表示し、3Dビューのカメラ・レイヤ・オーバーレイを操作。
6. `POST /api/approvals/:id/decision {decision:"approve"}`。
   - `manager` のみ許可。`staff` は403 + `DENY` 監査。
   - 承認時は `reports` を作成し、`APPROVED` / `REPORT_CREATED` を追記。
7. 再読込時は `GET /api/sites/:id/reports` 等でDBから復元。

## 4. 主要な設計判断

| 判断 | 理由 | 代替案 |
| :-- | :-- | :-- |
| 計算を共有モジュールに集約 | AIが数値を作らない原则をコードで保証。フロントとサーバで同一結果 | サーバのみ計算／クライアントのみ計算 |
| AIをスクリプト化デモに | 外部LLMなしで主要フローと承認境界を検証できる。デモ境界を明示 | 実LLM接続（コスト・権限・再現性の課題） |
| PostgreSQLをローカルに | 個人利用MVP。Migration/Seed/監査を実DBで検証 | SQLite（監査・並行性・本番移行の観点で不利） |
| Bearer + Cookie の両対応 | Pages→Tunnelのクロスオリジンで第三者Cookie制限を回避 | Pages Functionsプロキシ（構成が複雑） |
| 監査ログをDBトリガで追記専用 | アプリ層のバグでも改ざんを防ぐ | アプリ層のみ |
| Canvas2Dのみ | 環境依存が少なく、MVPの主要価値（3D操作とAI下書き）を検証できる | WebGPU（将来） |

## 5. 認証・認可

- パスワード：scrypt（N=16384, r=8, p=1、ユーザーごとのsalt）。
- セッション：32バイト乱数トークン。DBにはSHA-256ハッシュのみ保存。有効期限8時間（設定可）。
- 配布：
  - 同一オリジン：HttpOnly / SameSite=Lax Cookie。
  - クロスオリジン（Pages）：`Authorization: Bearer <token>`。`sessionStorage`に保持。
- 認可：`manager` のみ承認・却下。`staff` は403、監査に`DENY`。
- CSRF：SameSite=Lax + `Origin`許可リスト（`APP_ORIGIN` / `CORS_ORIGINS` / localhost）。
- ログイン試行：同一IP+メールで5回/10分の簡易制限（429）。

## 6. 監査ログ

```text
hash = SHA-256(prev_hash | createdAt(ISO) | actor | type | detail)
```

- `appendAudit()` はPostgreSQLのアドバイザリロックで直列化。
- `verifyAuditChain()` は全件を再計算し、`prev_hash`と`hash`の両方を検証。
- `audit_events` の `UPDATE` / `DELETE` はトリガで例外。
- 主なtype：`LOGIN` / `RUN_REQUESTED` / `RUN_COMPLETED` / `APPROVAL_REQUESTED` /
  `APPROVED` / `REJECTED` / `REPORT_CREATED` / `DENY` / `SEED`。

## 7. デモ境界

| 項目 | 実装 | 明示方法 |
| :-- | :-- | :-- |
| AI | スクリプト化デモ。外部通信なし | ヘッダー `AI: DEMO`、AIパネル注記、README |
| 数値 | 決定的計算エンジン | 画面の「数値は計算エンジン」注記 |
| 3D | 解析的サンプル地形 | 現場カード `3DGS サンプル`、README |
| 人物 | 匿名ID・位置のみ | 「人物を匿名化」トグル、匿名表示 |

## 8. 制約・将来

- Preview APIはホスト上のローカルプロセス。ホスト停止で利用不可。
- 計算エンジンはサンプル地形の解析モデル。実データ適用には3DGS/点群/設計データの取込が必要。
- WebGPU、実LLM、SSO、外部連携はBacklog。
- 詳細は [README](../README.md) と [進捗](../docs/progress/progress.md) を参照。
