#!/usr/bin/env bash
# 監査ログの日次保全（CSV + sha256）。
# 使い方: scripts/export-audit.sh [DB名]（既定: spatial_agent_studio_preview）
# 出力: ~/.local/share/spatial-agent-studio/audit-exports/audit-<DB>-<UTC>.csv + .sha256
# 保持: 365世代（AUDIT_KEEP で変更可）。DBへは SELECT のみ（書込みなし）。
set -euo pipefail

DB="${1:-spatial_agent_studio_preview}"
KEEP="${AUDIT_KEEP:-365}"
OUT_DIR="${AUDIT_OUT_DIR:-$HOME/.local/share/spatial-agent-studio/audit-exports}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/audit-${DB}-${STAMP}.csv"
mkdir -p "$OUT_DIR"

psql -v ON_ERROR_STOP=1 -d "$DB" -c "\copy (
  SELECT seq, created_at, actor, type, detail, prev_hash, hash
  FROM audit_events ORDER BY seq ASC
) TO '$FILE' WITH (FORMAT csv, HEADER true)"

sha256sum "$FILE" > "$FILE.sha256"
ls -1t "$OUT_DIR"/audit-"${DB}"-*.csv 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old" "$old.sha256"
done

echo "[audit-export] ok db=$DB rows=$(($(wc -l < "$FILE") - 1)) file=$FILE"
