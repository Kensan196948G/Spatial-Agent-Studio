#!/usr/bin/env bash
# Spatial Agent Studio — 外形監視（ローカルAPI）
# 失敗時は非0。結果は状態ファイルに残す（systemd timer から実行想定）。
set -euo pipefail

URL="${HEALTH_URL:-http://127.0.0.1:7450/api/health}"
STATE_DIR="${HEALTH_STATE_DIR:-$HOME/.local/state/spatial-agent-studio}"
STATE_FILE="$STATE_DIR/last-health.txt"
mkdir -p "$STATE_DIR"

BODY="$(curl -fsS --max-time 10 "$URL" 2>/dev/null || true)"
NOW="$(date -Is)"
if printf '%s' "$BODY" | grep -q '"ok":true'; then
  printf '%s OK url=%s body=%s\n' "$NOW" "$URL" "$BODY" > "$STATE_FILE"
  echo "[health] OK $BODY"
  exit 0
fi
printf '%s FAIL url=%s body=%s\n' "$NOW" "$URL" "${BODY:-<no response>}" > "$STATE_FILE"
echo "[health] FAIL url=$URL" >&2
exit 1
