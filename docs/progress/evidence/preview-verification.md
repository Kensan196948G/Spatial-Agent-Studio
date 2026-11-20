# Cloudflare Preview 検証記録

実施日時：2026-11-20 11:00〜11:05 JST（UTC 02:00〜02:05）
実施者：DeepSeek Harness 主エージェント（CTO権限委譲）

## 1. 配備対象

| 項目 | 値 |
| :-- | :-- |
| WebUI | <https://spatial-agent-studio-preview.pages.dev> |
| Pagesプロジェクト | `spatial-agent-studio-preview`（branch: `preview`） |
| 直近デプロイ | <https://046f4340.spatial-agent-studio-preview.pages.dev> |
| デプロイ時刻 | 2026-11-20 10:59 JST 頃 |
| アップロード | 5 files + `_headers` |
| API | <https://sas-api.mirai-dx-platform.com> |
| APIプロセス | ローカルFastify `127.0.0.1:7450`（`nohup`） |
| Tunnel | `spatial-agent-studio` / `5290da16-d855-4b5b-9eac-0d2d566bfc39` |
| DB | ローカルPostgreSQL `spatial_agent_studio_preview` |
| 対象コミット | 初回MVPコミット（GitHub反映前のローカル状態） |

## 2. APIヘルスチェック

```bash
curl -s https://sas-api.mirai-dx-platform.com/api/health
```

```json
{"ok":true,"db":"up","version":"0.1.0","time":"2026-11-20T02:00:18.139Z","aiMode":"demo-deterministic"}
```

**結果：PASS**

## 3. CORSプリフライト

```bash
curl -i -X OPTIONS https://sas-api.mirai-dx-platform.com/api/bootstrap \
  -H 'Origin: https://spatial-agent-studio-preview.pages.dev' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

- `HTTP/2 204`
- `access-control-allow-origin: https://spatial-agent-studio-preview.pages.dev`
- `access-control-allow-headers: content-type, authorization`
- `access-control-allow-credentials: true`

**結果：PASS**

## 4. WebUI実操作（メインフロー）

Playwright（Chromium headless）で以下を実行。

| # | 操作 | 結果 |
| :-- | :-- | :-- |
| 1 | `/login` を開く | ログイン画面表示 |
| 2 | `manager@example.com` / `SasManager!2026` でログイン | ホームへ遷移、3現場・KPI表示 |
| 3 | 現場A「○○川 築堤・護岸工事」を開く | 3Dビュー・AIパネル表示 |
| 4 | 「盛土 出来形管理」をクリック | 6ステップを順次表示 |
| 5 | 6ステップ完了 | 「内容を確認」CTA表示 |
| 6 | 承認モーダルを開く | 評価点数2,688点、合格率93.4%、最大不足-0.59m等を表示 |
| 7 | 「承認して確定」 | モーダル閉止、レポート「出来形管理帳票」表示 |
| 8 | ページ再読込 | レポートがDBから復元 |
| 9 | `/audit` を開く | 「ハッシュ連鎖は整合しています」「VERIFIED」 |

**結果：PASS**

再実行可能なスモーク：`node scripts/preview-smoke.mjs`（`PREVIEW SMOKE: PASS`）。

## 5. DB状態（Preview）

```text
users=2  sites=3  runs=1  approvals=1  reports=1  audit_events=8
approval: status=approved, verdict=是正要（不足部の手直し後に再計測）, decided_atあり
site-a latest version: 2026-11-18 progress=1.000
```

監査ログHEAD（seq 8）：

```text
seq=8  actor=HUMAN:現場代理人・所長（デモ）  type=LOGIN
hash=992263faa144e79d8121cd10d1782cfa638c2969f3f2e6f28b5826888d58d75a
```

## 6. 監査・権限の確認

| 確認 | 結果 |
| :-- | :-- |
| `UPDATE audit_events` | `ERROR: audit_events is append-only`（DBトリガ） |
| staff の承認API | `HTTP 403` + 監査 `DENY` |
| 二重承認 | `HTTP 409 ALREADY_DECIDED` |
| 未認証 bootstrap | `HTTP 401 UNAUTHENTICATED` |
| 監査チェーン検証 | `ok=true`, checked=8（Preview時点） |

## 7. バックアップ・リストア訓練

```bash
pg_dump -Fc -d spatial_agent_studio_preview -f /tmp/sas-preview.dump
createdb spatial_agent_studio_restore_test
/usr/lib/postgresql/17/bin/pg_restore -d spatial_agent_studio_restore_test /tmp/sas-preview.dump
psql -d spatial_agent_studio_restore_test -c 'select count(*) from audit_events;'
dropdb spatial_agent_studio_restore_test
```

結果：

- ダンプ取得成功（31KB）。
- リストア後：`audit=8`, `reports=1`, `approvals=1`。
- 警告：`transaction_timeout` はリストア先のバージョン差で無視（データ整合性に影響なし）。
- 訓練用DBは削除済み。

**結果：PASS（警告1件）**

## 8. 証跡画像

- [preview-dashboard.png](preview-dashboard.png) — ホーム（KPI・現場一覧・承認待ち・監査）
- [preview-site.png](preview-site.png) — 3D現場ビュー（Canvas2D・レイヤ・AIパネル）
- [preview-audit.png](preview-audit.png) — 監査ログ（VERIFIED）
- [preview-smoke.json](preview-smoke.json) — スモーク結果（JSON）

## 9. 制約・未確認

- Preview APIはこのホスト上の `nohup` プロセス。ホスト再起動で停止する。
- Cloudflare Access等のエッジ認証は未設定。Pages URLは公開（デモデータのみ）。
- 実LLM/実3DGSは未接続（デモ）。
- GitHub Actions CIは未適用（ハーネスポリシー）。ローカルで同一検証を実行済み。
- Previewの対象コミットはGitHub反映前のローカル状態。GitHub反映後に同一ビルドを再配備し、
  対象コミットとの対応を再確認する必要がある（未実施）。
