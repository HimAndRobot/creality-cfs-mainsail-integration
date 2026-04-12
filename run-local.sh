#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/.k1c-cfs-mini"
ENV_FILE="$SCRIPT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

if [ "${CFS_WS_URL:-}" = "" ]; then
  printf 'Printer IP or hostname: ' >&2
  read -r printer_host
  if [ "$printer_host" = "" ]; then
    printf '%s\n' 'Printer IP or hostname is required.' >&2
    exit 1
  fi
  CFS_WS_URL="ws://$printer_host:9999"
fi

if [ "${CFS_HTTP_HOST:-}" = "" ]; then
  CFS_HTTP_HOST="0.0.0.0"
fi

if [ "${CFS_HTTP_PORT:-}" = "" ]; then
  CFS_HTTP_PORT="8010"
fi

cd "$APP_DIR"
export CFS_WS_URL
export CFS_HTTP_HOST
export CFS_HTTP_PORT
exec "$APP_DIR/.venv/bin/python" "$APP_DIR/app.py"
