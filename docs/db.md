# Database — Spatial Agent Studio MVP

## 1. データベース構成

| 用途 | DB名 | 接続 |
| :-- | :-- | :-- |
| 開発・ローカル確認 | `spatial_agent_studio` | Unix socket peer（OSユーザー） |
| 自動テスト | `spatial_agent_studio_test` | Unix socket peer（または `TEST_DATABASE_URL`） |
| Cloudflare Preview | `spatial_agent_studio_preview` | Unix socket peer（APIプロセスのみ） |

本番用DBは作成していません。Preview APIは `spatial_agent_studio_preview` にのみ接続します。

### 接続設定

既定（ローカル）：

```text
postgresql:///spatial_agent_studio?host=/var/run/postgresql
```

別ホスト・専用ロールを使う場合：

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/spatial_agent_studio'
export TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/spatial_agent_studio_test'
```

パスワードは `.env` / systemd Environment / Secret Manager に置き、リポジトリへコミットしません。

## 2. Migration

- 場所：`db/migrations/*.sql`（現在 `001_init.sql`）
- 適用履歴：`schema_migrations`（ファイル名 + 適用日時）
- 実行：

```bash
pnpm run db:migrate
```

- 既に適用済みのファイルはスキップ。1ファイルごとにトランザクション。
- 既存DBを初期化するMigrationは含みません。破壊的変更は追加Migrationとして分離します。

### スキーマ概要

| テーブル | 主な列 | 役割 |
| :-- | :-- | :-- |
| `users` | id, email, password_hash, name, role | manager / staff |
| `sessions` | token_hash, user_id, expires_at | セッション（ハッシュ保存） |
| `sites` | id, code, name, status, cover, splat_count, model jsonb | 現場 |
| `site_versions` | site_id, version_date, progress, is_latest | 4D版 |
| `runs` | site_id, task, status, requested_by, result jsonb, steps jsonb | AI実行 |
| `approvals` | run_id, site_id, status, risk, metrics, requested_by, decided_by | 人の判断 |
| `reports` | site_id, run_id, approval_id, verdict, metrics, findings | 確定レポート |
| `audit_events` | seq, actor, type, detail, prev_hash, hash, created_at | 追記専用監査 |

インデックス：`approvals(status, created_at)`, `approvals(site_id, created_at)`, `runs(site_id, created_at)`, `reports(site_id, created_at)`。

## 3. Seed

```bash
pnpm run db:seed
```

- ユーザー2名（manager / staff）。パスワードは `SEED_*_PASSWORD` から取得（既定はデモ用）。
- 現場5件（site-a〜site-e）と各3版。
- 監査ログが空のときだけ `SEED` イベントを1件作成。
- 既存ユーザー・現場は `ON CONFLICT DO NOTHING` で上書きしません。
- 再実行しても重複しません。

### サンプルデータ

| 現場 | 進捗 | 状態 | 備考 |
| :-- | :-- | :-- | :-- |
| site-a ○○川 築堤・護岸工事 | 100% | active | メインフロー |
| site-b △△橋 下部工 | 55% | attention | 出来形不足の例 |
| site-c □□トンネル 坑口部 | 30% | idle | 休止中 |
| site-d 国道△△号 法面補修工事 | 78% | active | 法面補修 |
| site-e 海岸堤防 嵩上げ工事 | 42% | attention | 嵩上げ・護岸 |

すべて架空です。個人情報・実データは含みません。

## 4. Reset（検証DBのみ）

```bash
ALLOW_DB_RESET=1 \
DATABASE_URL='postgresql:///spatial_agent_studio_test?host=/var/run/postgresql' \
pnpm run db:reset
pnpm run db:migrate
pnpm run db:seed
```

ガード：

- `ALLOW_DB_RESET=1` が必須。
- DB名が `spatial_agent_studio` / `_test` / `_preview` / `_dev` のいずれかであること。
- `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` のみ。他DB・本番DBには実行しません。

## 5. 監査ログの整合性

- `audit_events` は `BEFORE UPDATE OR DELETE` トリガで例外を発生（追記専用）。
- `hash = SHA-256(prev_hash | createdAt | actor | type | detail)`。
- 検証：

```bash
pnpm run db:verify
# または GET /api/audit/verify
```

- 検証は全件を再計算し、`prev_hash` と `hash` の両方を確認。
- 改ざん・欠番・並び替えは `firstBadSeq` で検出。

## 6. バックアップ・復旧

### 取得

```bash
pg_dump -Fc -d spatial_agent_studio_preview -f /path/to/sas-preview-$(date +%Y%m%d).dump
```

### 復元（検証用の別DBへ）

```bash
createdb spatial_agent_studio_restore_test
pg_restore -d spatial_agent_studio_restore_test /path/to/sas-preview-YYYYMMDD.dump
psql -d spatial_agent_studio_restore_test -c 'select count(*) from audit_events;'
```

- 復元先は必ず別DB。既存DBへの上書き復元は行いません。
- 復元後は `pnpm run db:verify` 相当の監査検証を実行してください。
- Previewはサンプルデータのみのため、復旧は「DB再作成 + migrate + seed」でも再現可能です。

## 7. 権限・保持

- ローカルはOSユーザーのpeer認証。DBはlocalhostのみ。
- PostgreSQLのポートをインターネットへ公開していません。
- Preview APIはTunnel経由で到達しますが、DBへはローカルからのみ。
- サンプルデータの保持期間はMVPでは無期限。本番化時に保存期間・削除方針を定義します。
