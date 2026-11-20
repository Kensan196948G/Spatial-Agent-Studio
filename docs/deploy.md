# Cloudflare Preview — 配備・検証・復旧

## 1. 構成

| 層 | 実体 | URL |
| :-- | :-- | :-- |
| WebUI | Cloudflare Pages（静的SPA、Previewプロジェクト） | <https://spatial-agent-studio-preview.pages.dev> |
| API | ローカルFastify（port 7450） + Cloudflare Tunnel | <https://sas-api.mirai-dx-platform.com> |
| DB | ローカルPostgreSQL `spatial_agent_studio_preview` | localhost only |
| 対象コミット | `930415d`（main、PR #6 merge） | — |

- Pagesプロジェクト：`spatial-agent-studio-preview`（production branch: `preview`）
- 直近のデプロイURL：<https://8b5bf4d3.spatial-agent-studio-preview.pages.dev>（対象コミット `930415d`）
- 初回デプロイURL：<https://046f4340.spatial-agent-studio-preview.pages.dev>
- Tunnel：`spatial-agent-studio` / `5290da16-d855-4b5b-9eac-0d2d566bfc39`
- DNS：`sas-api.mirai-dx-platform.com` → `5290da16-....cfargotunnel.com`（proxied）
- 本番環境ではありません。Cloudflare Access等のエッジ認証は付けていません（アプリのログインで保護）。

## 2. Pagesの配備

```bash
cd /home/kensan/Projects/Business-Project/Spatial-Agent-Studio

# PagesからトンネルAPIを呼ぶためのAPIベースURLを埋め込む
VITE_API_BASE_URL=https://sas-api.mirai-dx-platform.com pnpm run build

npx wrangler pages deploy dist/web \
  --project-name spatial-agent-studio-preview \
  --branch preview \
  --commit-dirty=true \
  --commit-message "Spatial Agent Studio MVP preview"
```

- `public/_headers` がCSP等のヘッダーを付与（`connect-src` にAPI URL）。
- `VITE_API_BASE_URL` が空のビルドは同一オリジンAPI向け（ローカル用）。
- Pagesのビルド成果物は `dist/web`。

## 3. APIの起動

### ローカル確認（開発）

```bash
pnpm run dev:api   # 7440
```

### Preview（7450）

DBを準備：

```bash
DB='postgresql:///spatial_agent_studio_preview?host=/var/run/postgresql'
DATABASE_URL="$DB" pnpm run db:migrate
DATABASE_URL="$DB" pnpm run db:seed
```

API起動：

```bash
nohup env \
  NODE_ENV=production \
  PORT=7450 HOST=127.0.0.1 \
  APP_ORIGIN=https://spatial-agent-studio-preview.pages.dev \
  CORS_ORIGINS=https://spatial-agent-studio-preview.pages.dev,https://8b5bf4d3.spatial-agent-studio-preview.pages.dev \
  COOKIE_SECURE=true \
  DATABASE_URL='postgresql:///spatial_agent_studio_preview?host=/var/run/postgresql' \
  node_modules/.bin/tsx src/api/server.ts \
  > /tmp/sas-preview-api.log 2>&1 &
```

ログ：`/tmp/sas-preview-api.log`

### Tunnel起動

```bash
nohup /usr/local/bin/cloudflared --no-autoupdate \
  --config deploy/cloudflared/config.yml tunnel run \
  > /tmp/sas-tunnel.log 2>&1 &
```

ログ：`/tmp/sas-tunnel.log`

> 現在はPreview検証のため `nohup` で起動しています。常設化する場合は
> `deploy/systemd/spatial-agent-studio.service` と
> `deploy/systemd/spatial-agent-studio-cloudflared.service` を
> `~/.config/systemd/user/` にコピーし、`systemctl --user enable --now` を人間が実行してください
> （ハーネスポリシーによりAIからのサービス操作は制限されています）。

## 4. 検証

### APIヘルス

```bash
curl -s https://sas-api.mirai-dx-platform.com/api/health
# {"ok":true,"db":"up","version":"0.1.0","time":"...","aiMode":"demo-deterministic"}
```

### CORSプリフライト

```bash
curl -s -i -X OPTIONS https://sas-api.mirai-dx-platform.com/api/bootstrap \
  -H 'Origin: https://spatial-agent-studio-preview.pages.dev' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
# 204 + access-control-allow-origin: https://spatial-agent-studio-preview.pages.dev
```

### WebUIの主要フロー

1. <https://spatial-agent-studio-preview.pages.dev/login> を開く。
2. `manager@example.com` / `SasManager!2026` でログイン。
3. ホーム → 「○○川 築堤・護岸工事」→「盛土 出来形管理」。
4. 6ステップ完了後、「内容を確認」→「承認して確定」。
5. レポートが表示される。ページを再読込しても残る。
6. 監査ログで「ハッシュ連鎖は整合しています / VERIFIED」を確認。

検証記録：[docs/progress/evidence/preview-verification.md](progress/evidence/preview-verification.md)

## 5. ロールバック

- **Pages**：直前のデプロイURL（`https://<hash>.spatial-agent-studio-preview.pages.dev`）を確認し、
  必要なら同じビルドを `wrangler pages deploy` で再配備。DBは変更されません。
- **API**：`/tmp/sas-preview-api.log` を確認し、プロセスを停止して同じコマンドで再起動。
- **Tunnel**：`/tmp/sas-tunnel.log` を確認し、再起動。
- **DB**：Previewはサンプルデータのみ。`ALLOW_DB_RESET=1` + `spatial_agent_studio_preview` で
  reset → migrate → seed により再現可能。既存データの削除は検証DBに限定。

## 6. 公開範囲・注意

- PagesのPreview URLはインターネット公開です。アプリのログイン（デモアカウント）で保護していますが、
  デモアカウントはREADMEに記載されています。**実データ・個人情報を入れないでください。**
- API Tunnelも公開されています。認証必須APIはセッション/Bearerが必要です。
- 本番正式環境への配備、DNS/Accessポリシーの変更は行っていません。
- Preview APIはこのホスト上のプロセスです。ホスト停止・再起動で停止します。
