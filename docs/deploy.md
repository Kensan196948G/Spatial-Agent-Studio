# Cloudflare Preview — 配備・検証・復旧

## 1. 構成

| 層 | 実体 | URL |
| :-- | :-- | :-- |
| WebUI | Cloudflare Pages（静的SPA、Previewプロジェクト） | <https://spatial-agent-studio-preview.pages.dev> |
| API | ローカルFastify（port 7450） + Cloudflare Tunnel | <https://sas-api.mirai-dx-platform.com> |
| DB | ローカルPostgreSQL `spatial_agent_studio_preview` | localhost only |
| 対象コミット | ビルド時に埋め込む（Settings 画面の「配信ビルド」で確認） | — |

- Pagesプロジェクト：`spatial-agent-studio-preview`（production branch: `preview`）
- 直近のデプロイURL：Settings 画面の「配信ビルド」と照合して特定する（`<meta name="sas-commit">` にビルド時のHEADを埋め込み）
- 初回デプロイURL：<https://046f4340.spatial-agent-studio-preview.pages.dev>
- Tunnel：`spatial-agent-studio` / `5290da16-d855-4b5b-9eac-0d2d566bfc39`
- DNS：`sas-api.mirai-dx-platform.com` → `5290da16-....cfargotunnel.com`（proxied）
- 本番環境ではありません。Previewカスタムドメイン（`spatial-agent-studio-preview.mirai-dx-platform.com`）は
  Cloudflare Access（メールOTP）で保護し、**アプリ独自のログイン画面は持ちません**。
  Access通過後にデモアカウントのAPIセッションを自動確立します。ヘッダーの「ログアウト」で
  Accessセッションも終了します（`https://winter-lake-f4c9.cloudflareaccess.com/cdn-cgi/access/logout`）。

## 2. Pagesの配備

```bash
cd /home/kensan/Projects/Business-Project/Spatial-Agent-Studio

# PagesからトンネルAPIを呼ぶためのAPIベースURLを埋め込む
SAS_API_BASE=https://sas-api.mirai-dx-platform.com pnpm run build

npx wrangler pages deploy dist/web \
  --project-name spatial-agent-studio-preview \
  --branch preview \
  --commit-dirty=true \
  --commit-message "Spatial Agent Studio MVP preview"
```

- `web-v21/_headers` がCSP等のヘッダーを付与（`connect-src` にAPI URL）。
- `SAS_API_BASE` が空のビルドは同一オリジンAPI向け（ローカル用）。V2.1 UIの `bridge.js` が meta タグ経由でAPIベースを読みます。
- Pagesのビルド成果物は `dist/web`（V2.1 UI シェル）。

## 2.5 常設化（systemd・稼働中）

**状態（2026-11-20 16:03 JST 〜 稼働中）**：`spatial-agent-studio.service` と
`spatial-agent-studio-cloudflared.service` を user systemd で有効化済み。`Linger=yes` のためログアウト後も継続。
`nohup` 運用は廃止（APIのPPIDはunitのMainPID）。

```bash
systemctl --user is-active spatial-agent-studio.service spatial-agent-studio-cloudflared.service
systemctl --user show spatial-agent-studio.service -p MainPID -p NRestarts -p ActiveState
loginctl show-user kensan -p Linger
journalctl --user -u spatial-agent-studio.service -n 20 --no-pager
```

再有効化・別環境での手順（**AIはサービス操作を行わないため、実行は人間**）：

```bash
# 1) 0600 の env ファイル（CORS / DB / Accessロール割当）を用意済みであること
ls -l ~/.config/spatial-agent-studio/preview-api.env   # -rw------- であること

# 2) unitを配置（リポジトリの deploy/systemd/ からコピー）
mkdir -p ~/.config/systemd/user
cp deploy/systemd/spatial-agent-studio.service        ~/.config/systemd/user/
cp deploy/systemd/spatial-agent-studio-cloudflared.service ~/.config/systemd/user/

# 3) 既存のnohupプロセスを停止（port 7450の実PIDのみ。pkillで一括停止しない）
ss -ltnp | grep 7450            # pid= を確認
kill -TERM <pid>                # 表示されたPIDのみ

# 4) 有効化
systemctl --user daemon-reload
systemctl --user enable --now spatial-agent-studio.service
systemctl --user enable --now spatial-agent-studio-cloudflared.service

# 5) 検証
curl -s http://127.0.0.1:7450/api/health            # {"ok":true,"db":"up"}
curl -s https://sas-api.mirai-dx-platform.com/api/health
curl -s -X OPTIONS https://sas-api.mirai-dx-platform.com/api/bootstrap \
  -H 'Origin: https://spatial-agent-studio-preview.mirai-dx-platform.com' \
  -H 'Access-Control-Request-Method: GET' -o /dev/null -w '%{http_code}\n'   # 204
# Accessロール割当（未登録は403）
```

`spatial-agent-studio.service` は `EnvironmentFile=%h/.config/spatial-agent-studio/preview-api.env` を
読み、明示値（CORS_ORIGINS・DATABASE_URL等）で上書きする。**unitに実メールアドレスは書かない。**

---

## 2.6 バックアップ（日次・復元訓練済み）

```bash
# 手動実行（DB名は既定 spatial_agent_studio_preview）
scripts/backup-db.sh
# → ~/.local/share/spatial-agent-studio/backups/<db>-<UTC>.dump + .sha256（14世代保持）
```

- `pg_dump` は**サーバと同一メジャー**を自動選択（PG16サーバなら 16 の pg_dump。新しいクライアントで
  旧サーバをダンプすると restore できない形式・パラメータが混入する）。
- 日次実行は `deploy/systemd/spatial-agent-studio-backup.{service,timer}`（03:10・Persistent）。
  有効化は人間：`cp deploy/systemd/... ~/.config/systemd/user/ && systemctl --user enable --now spatial-agent-studio-backup.timer`

**復元訓練（2026-11-20 実施・PASS）**

```bash
SCRATCH=sas_restore_drill_$(date +%s)
createdb "$SCRATCH"
/usr/lib/postgresql/16/bin/pg_restore --no-owner --no-privileges -d "$SCRATCH" <dump>
psql -At -d "$SCRATCH" -c "select count(*) from sites" -c "select count(*) from audit_events"
dropdb "$SCRATCH"
# 実測: restore_exit=0 / sites=5 / users=2 / audit=83 / approvals=1
```

## 2.7 監視（外形・5分間隔）

```bash
scripts/healthcheck.sh    # 失敗時は非0。結果は ~/.local/state/spatial-agent-studio/last-health.txt
```

- タイマー：`deploy/systemd/spatial-agent-studio-health.{service,timer}`（OnBoot+2min / 5分ごと）。
- 通知は未接続（本番昇格時に Webhook/メールを定義）。失敗は `journalctl --user -u spatial-agent-studio-health.service` で確認。

---

## 2.8 本番環境の切替手順（準備済み・有効化は人間）

### 構成（準備済み）

| 部品 | 実体 | 状態 |
| :-- | :-- | :-- |
| 本番WebUI | Pages `spatial-agent-studio` → `spatial-agent-studio.mirai-dx-platform.com` | 稼働中（Accessあり） |
| 本番API | `spatial-agent-studio-prod.service`（port 7460） | unit prepared（未起動） |
| 本番APIホスト | `sas-api-prod.mirai-dx-platform.com` → `127.0.0.1:7460` | トンネル設定＋DNS追加済み（**再起動で反映**） |
| 本番DB | `spatial_agent_studio_prod` | 作成・migrate・seed・verify 済み |

### 有効化（人）

```bash
cd /home/kensan/Projects/Business-Project/Spatial-Agent-Studio

# 1) 本番APIユニットを配置して起動
cp deploy/systemd/spatial-agent-studio-prod.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now spatial-agent-studio-prod.service
curl -s http://127.0.0.1:7460/api/health        # {"ok":true,"db":"up"}

# 2) トンネルを再起動して sas-api-prod を反映
systemctl --user restart spatial-agent-studio-cloudflared.service
sleep 5
curl -s https://sas-api-prod.mirai-dx-platform.com/api/health
```

### 本番WebUIを本番APIへ向ける（人 or AI）

```bash
# 本番APIベースで再ビルドして Pages(production) へ配備
SAS_API_BASE=https://sas-api-prod.mirai-dx-platform.com pnpm run build
npx wrangler pages deploy dist/web --project-name spatial-agent-studio --branch main \
  --commit-dirty=true --commit-message "feat: point production UI at the production API"
```

配備後、`https://spatial-agent-studio.mirai-dx-platform.com` で Access ログイン → ダッシュボード →
システム設定「配信ビルド」と API の接続先を確認。CORSは本番APIが本番Originのみ許可します。

---

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

> **Access保護下での検証**：`scripts/preview-smoke.mjs` は `CF_ACCESS_CLIENT_ID` /
> `CF_ACCESS_CLIENT_SECRET` を設定すると、API・ブラウザ双方にサービストークンのヘッダーを付与します。
> `*.pages.dev` を Access で閉じた後もこの方法でスモークを継続できます（手順は
> [docs/security/pages-dev-exposure.md](security/pages-dev-exposure.md) §4.0）。


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

- **Access保護ドメイン（Preview）**：`https://spatial-agent-studio-preview.mirai-dx-platform.com`
  （Pagesカスタムドメイン）。Cloudflare AccessのメールOTPが前段に立ち、未認証はチームドメイン
  `winter-lake-f4c9.cloudflareaccess.com` へ302。許可メールはAccessポリシー
  「Spatial Agent Studio users」（2件）、セッション8時間。
  APIのCORSは同Originを許可済み（`CORS_ORIGINS`）。
  AccessアプリID：`082c00ee-21e7-4a1a-9fa5-93fb3f9c3e58`。
- **メール→ロール割当**：SPAが `/cdn-cgi/access/get-identity` でメールアドレスを取得し、
  `POST /api/auth/access` でセッションを確立します。割当は **APIホスト上の割当ファイル**（推奨）か
  環境変数で管理します。

  | 指定先 | 形式 | 用途 |
  | :-- | :-- | :-- |
  | `SAS_ACCESS_ROLES_FILE` | 1行1件 `email,role1,role2,...`／`@domain,roles` | **推奨**。編集保存だけで反映（再起動不要） |
  | `SAS_ACCESS_ROLES` | `{"mail@example.com":["agent","hq","it"]}` | 個別指定（ファイルに無いメールのみ） |
  | `SAS_ACCESS_ROLE_DOMAINS` | `{"example.co.jp":["field"]}` | ドメイン単位のフォールバック |

  解決順は **ファイルのメール → ファイルのドメイン → env 個別 → env ドメイン**。先頭のロールが既定ロールです。
  許可ロールキーは `field`（現場担当者）/ `agent`（現場代理人・所長）/ `hq`（本社）/ `it`（IT・DX部門）。
  未割当のメールは403（`ROLE_NOT_MAPPED`）で拒否し、SPAは最小権限（現場担当者）で警告表示します。
  **実在のメールアドレスはリポジトリへ入れません**。割当ファイルは `~/.config/spatial-agent-studio/access-roles.txt`
  （0600・git管理外）に置き、`SAS_ACCESS_ROLES_FILE` でパスを渡します（例：
  `set -a; . ~/.config/spatial-agent-studio/preview-api.env; set +a; npx tsx src/api/server.ts`）。
- PagesのPreview URL（`*.pages.dev`）は**Access対象外**でインターネット公開です。
  デモアカウントはREADMEに記載されています。**実データ・個人情報を入れないでください。**
- API Tunnelも公開されています。認証必須APIはセッション/Bearerが必要です。
- 本番正式環境への配備は行っていません。prod用ドメイン（`spatial-agent-studio.mirai-dx-platform.com`）と
  Accessポリシーは未作成です。
- Preview APIはこのホスト上のプロセスです。ホスト停止・再起動で停止します。
