# インシデント対応手順（本番）

最終更新：2026-11-20
対象：`https://spatial-agent-studio.mirai-dx-platform.com`（WebUI）／`https://sas-api-prod.mirai-dx-platform.com`（API予定）／`spatial-agent-studio.pages.dev`

> サービス操作（systemd）は**人間が実行**する。AIは手順・検証コマンド・証跡収集を担当する。

## 1. 検知

| 経路 | 確認方法 |
| :-- | :-- |
| 外形監視 | `~/\.local/state/spatial-agent-studio/last-health.txt` の FAIL、`journalctl --user -u spatial-agent-studio-health.service` |
| 利用者申告 | 画面のエラー、ログイン不可 |
| 監査 | 監査ログの異常（DENY/AI_BLOCKED の急増） |
| Cloudflare | ダッシュボードの 5xx / Access 失敗 |

## 2. 初動（5分以内）

```bash
# 状態確認（読み取りのみ）
systemctl --user is-active spatial-agent-studio.service \
  spatial-agent-studio-cloudflared.service \
  spatial-agent-studio-prod.service 2>/dev/null
curl -s --max-time 5 http://127.0.0.1:7450/api/health
curl -s --max-time 5 https://sas-api.mirai-dx-platform.com/api/health
journalctl --user -u spatial-agent-studio.service -n 50 --no-pager
scripts/healthcheck.sh
```

判定：
- APIは応答するがUIだけ → Pages側（配備・Access）を疑う
- APIが落ちている → §3 再起動
- DBエラー → §4 復元

## 3. 再起動

```bash
systemctl --user restart spatial-agent-studio.service
sleep 3
curl -s http://127.0.0.1:7450/api/health
```

本番APIを分離済みの場合：

```bash
systemctl --user restart spatial-agent-studio-prod.service
curl -s http://127.0.0.1:7460/api/health
```

トンネル：

```bash
systemctl --user restart spatial-agent-studio-cloudflared.service
curl -s https://sas-api.mirai-dx-platform.com/api/health
```

## 4. ロールバック

**WebUI（Pages）**：直前の正常デプロイへ戻す。

```bash
npx wrangler pages deployment list --project-name spatial-agent-studio | head
npx wrangler pages deploy <前の配備ディレクトリ> --project-name spatial-agent-studio --branch main
# もしくはダッシュボードで該当デプロイを「Rollback」
```

**API（コード）**：直前の正常コミットへ戻して再起動。

```bash
git log --oneline -5
git checkout <正常コミット>
systemctl --user restart spatial-agent-studio.service
```

**DB**：直近バックアップから復元（破壊的操作のため**人の判断**）。

```bash
LATEST=$(ls -1t ~/.local/share/spatial-agent-studio/backups/*.dump | head -1)
createdb restore_check
/usr/lib/postgresql/16/bin/pg_restore --no-owner --no-privileges -d restore_check "$LATEST"
psql -At -d restore_check -c "select count(*) from audit_events"
# 内容を確認してから切替（本番DBへの上書きは承認必須）
```

## 5. 証跡

| 種別 | 場所 |
| :-- | :-- |
| APIログ | `journalctl --user -u spatial-agent-studio.service` |
| 監査 | 画面の監査ログ／`GET /api/audit`／CSV |
| 外形監視 | `~/.local/state/spatial-agent-studio/last-health.txt` |
| バックアップ | `~/.local/share/spatial-agent-studio/backups/`（sha256付き） |
| 配備 | `<meta name="sas-commit">`／システム設定「配信ビルド」 |

## 6. 事後

1. 時系列（検知・初動・復旧・終了）を記録
2. 原因と再発防止を `docs/progress/progress.md` へ追記
3. 監査ログに「誰が何をしたか」が残っていることを確認
4. 必要ならバックアップ/監視/レート制限の設定を見直す

## 7. 訓練（年1回以上）

- 実施：`systemctl --user restart` → health 200 復帰、所要時間を記録
- 実施：バックアップ復元（scratch DB）→ 行数一致、scratch削除
- 記録：実施日・所要・気づきを `docs/progress/progress.md` に追記
