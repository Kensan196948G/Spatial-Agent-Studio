#!/usr/bin/env bash
# Spatial Agent Studio — PostgreSQL バックアップ（ローカル・日次想定）
# 使い方: scripts/backup-db.sh [DB名]   （既定: spatial_agent_studio_preview）
# 出力: ~/.local/share/spatial-agent-studio/backups/<db>-<UTC時刻>.dump + .sha256
# 保持: 14世代（BACKUP_KEEP で変更可）。失敗時は非0で終了する。
set -euo pipefail

DB="${1:-spatial_agent_studio_preview}"
KEEP="${BACKUP_KEEP:-14}"
OUT_DIR="${BACKUP_DIR:-$HOME/.local/share/spatial-agent-studio/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/${DB}-${STAMP}.dump"

# pg_dump は**サーバと同一メジャー**に揃える（新しいクライアントで旧サーバをダンプすると
# restore できない形式・パラメータが混入する）。見つからなければ PATH の pg_dump を使う。
SERVER_MAJOR="${PG_SERVER_MAJOR:-$(psql -At -d "$DB" -c 'show server_version' 2>/dev/null | cut -d. -f1)}"
if [ -n "$SERVER_MAJOR" ] && [ -x "/usr/lib/postgresql/$SERVER_MAJOR/bin/pg_dump" ]; then
  PG_DUMP="/usr/lib/postgresql/$SERVER_MAJOR/bin/pg_dump"
else
  PG_DUMP="pg_dump"
fi

mkdir -p "$OUT_DIR"
"$PG_DUMP" --format=custom --no-owner --no-privileges --file "$FILE" "$DB"
sha256sum "$FILE" > "$FILE.sha256"

# 保持世代を超えた古いバックアップを削除（新しい順に残す）
ls -1t "$OUT_DIR"/"${DB}"-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old" "$old.sha256"
done

echo "[backup] ok db=$DB file=$FILE size=$(stat -c%s "$FILE")B"
