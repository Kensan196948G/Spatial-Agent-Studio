# API — Spatial Agent Studio MVP

ベースURL：ローカル `http://127.0.0.1:7440`、Preview `https://sas-api.mirai-dx-platform.com`。

## 認証

- 同一オリジン：`POST /api/auth/login` が `sas_session` Cookie（HttpOnly / SameSite=Lax）を設定。
- クロスオリジン（Cloudflare Pages）：ログイン応答の `token` を `Authorization: Bearer <token>` で送信。
- 認証が必要なAPIは未認証時に `401 UNAUTHENTICATED`。

```json
POST /api/auth/login
{ "email": "manager@example.com", "password": "SasManager!2026" }

200 OK
{
  "user": { "id": "...", "email": "...", "name": "現場代理人・所長（デモ）", "role": "manager", "canApprove": true },
  "token": "..."   // クロスオリジン用。同一オリジンではCookieでも可
}
```

## エラー形式

```json
{ "error": { "code": "FORBIDDEN", "message": "承認・却下は現場代理人（承認権限あり）のみ実行できます。" } }
```

| HTTP | code 例 | 意味 |
| :-- | :-- | :-- |
| 400 | `INVALID_BODY` | 入力不正 |
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` / `INVALID_CREDENTIALS` | 未認証・認証失敗 |
| 403 | `FORBIDDEN` / `ORIGIN_FORBIDDEN` | 権限不足・Origin不許可 |
| 404 | `SITE_NOT_FOUND` / `APPROVAL_NOT_FOUND` | 対象なし |
| 409 | `ALREADY_DECIDED` | 既に承認/却下済み |
| 429 | `TOO_MANY_ATTEMPTS` | ログイン試行制限 |
| 500 | `INTERNAL_ERROR` | サーバ内部エラー |
| 503 | （health） | DB不通 |

## エンドポイント

### 認証・ユーザー

| Method | Path | 認証 | 説明 |
| :-- | :-- | :-- | :-- |
| POST | `/api/auth/login` | 不要 | ログイン。Cookie + token |
| POST | `/api/auth/logout` | 任意 | セッション破棄 |
| GET | `/api/auth/me` | 必須 | 現在のユーザー |
| GET | `/api/bootstrap` | 必須 | `{ user, dashboard }` |

### 現場・ダッシュボード

| Method | Path | 認証 | 説明 |
| :-- | :-- | :-- | :-- |
| GET | `/api/health` | 不要 | `{ ok, db, version, aiMode }` |
| GET | `/api/dashboard` | 必須 | 現場一覧・KPI・承認待ち・最近の監査 |
| GET | `/api/sites` | 必須 | 現場セレクタ用の現場一覧 |
| GET | `/api/sites/:id` | 必須 | 現場詳細（model / versions） |
| GET | `/api/sites/:id/reports` | 必須 | 現場の確定レポート |

### AI実行（デモ）

```json
POST /api/sites/:id/runs
{ "task": "asbuilt" }   // or "safety"

201 Created
{
  "run": {
    "id": "...",
    "task": "asbuilt",
    "status": "completed",
    "result": {
      "stats": { "n": 2688, "passRate": 93.415, "mean": -0.023, "min": -0.589, "max": 0.321, ... },
      "balance": { "designVolumeM3": 1632.67, "underVolumeM3": 32.56, ... },
      "section": { "z0": 3.8, "worstDeviation": -0.59, ... },
      "verdict": "是正要（不足部の手直し後に再計測）",
      "metrics": [{ "label": "合格率", "value": "93.4 %" }, ...],
      "overlays": [...]
    },
    "steps": [{ "index": 0, "phase": "perceive", "message": "...", "action": {...} }, ...],
    "approval": { "id": "...", "status": "pending", ... }
  },
  "auditEvents": [...]
}
```

- `task="safety"` は `result.scan` に `radiusM` / `minDistanceM` / `intruded` / `workers` を返す。
- `steps[].action` はUIのビュー操作指示（camera / layer / heatmap / privacy / simTime / overlays）。

### 承認・レポート

| Method | Path | 認証 | 説明 |
| :-- | :-- | :-- | :-- |
| GET | `/api/approvals?status=pending\|approved\|rejected\|all` | 必須 | 承認一覧 |
| GET | `/api/approvals/:id` | 必須 | 承認詳細 |
| POST | `/api/approvals/:id/decision` | managerのみ | `{ decision: "approve"\|"reject", note?: string }` |
| GET | `/api/reports` | 必須 | 全レポート（最大50） |

```json
POST /api/approvals/:id/decision
{ "decision": "approve", "note": "最大不足箇所を明日再計測" }

200 OK
{
  "approval": { "status": "approved", "decidedBy": { "name": "現場代理人・所長（デモ）" }, ... },
  "report": { "id": "...", "title": "出来形管理帳票", "verdict": "...", ... }
}
```

- `staff` が実行すると `403 FORBIDDEN`、監査に `DENY`。
- 二重判断は `409 ALREADY_DECIDED`。
- `reject` の場合は `report: null`。

### 監査

| Method | Path | 認証 | 説明 |
| :-- | :-- | :-- | :-- |
| GET | `/api/audit?limit=200` | 必須 | 最新イベント + 検証結果 |
| GET | `/api/audit/verify` | 必須 | ハッシュ連鎖の検証のみ |

```json
{
  "events": [
    { "seq": 18, "actor": "HUMAN:現場代理人・所長（デモ）", "type": "APPROVED",
      "detail": "出来形管理帳票（ドラフト）を確定 / ○○川 築堤・護岸工事",
      "prevHash": "...", "hash": "...", "createdAt": "2026-11-20T..." }
  ],
  "verify": { "ok": true, "checked": 18, "firstBadSeq": null, "reason": null, "headHash": "..." }
}
```

## CORS / セキュリティヘッダー

- 許可Origin：`APP_ORIGIN`、`CORS_ORIGINS`（カンマ区切り）、localhost:5174/7440。
- Cloudflare Pages のデプロイ別サブドメイン（`<hash>.<project>.pages.dev`）も、
  設定済みPagesプロジェクト配下であれば許可（例：`45b9e8ff.spatial-agent-studio-preview.pages.dev`）。
- `credentials: true`、許可ヘッダー `content-type, authorization`。
- すべてのAPI応答に `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`。
- `NODE_ENV=production` では HSTS と CSP を付与。
