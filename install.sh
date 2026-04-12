#!/bin/sh
set -eu

SERVICE_NAME="k1c-cfs-mini"
PYTHON_BIN="${PYTHON_BIN:-python3}"
HTTP_PORT="${CFS_HTTP_PORT:-8010}"
WS_URL="${CFS_WS_URL:-ws://127.0.0.1:9999}"
HTTP_HOST="${CFS_HTTP_HOST:-0.0.0.0}"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

has_systemd() {
  command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]
}

prepare_app_dir() {
  app_dir="$1"
  mkdir -p "$app_dir"
  cp "$SCRIPT_DIR/app.py" "$app_dir/app.py"
  cp "$SCRIPT_DIR/requirements.txt" "$app_dir/requirements.txt"
  rm -rf "$app_dir/static"
  cp -r "$SCRIPT_DIR/static" "$app_dir/static"
  "$PYTHON_BIN" -m venv "$app_dir/.venv"
  "$app_dir/.venv/bin/pip" install --upgrade pip
  "$app_dir/.venv/bin/pip" install -r "$app_dir/requirements.txt"
}

install_systemd() {
  app_dir="${APP_DIR:-/opt/k1c-cfs-mini}"
  prepare_app_dir "$app_dir"

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=K1C CFS mini dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$app_dir
Environment=CFS_WS_URL=$WS_URL
Environment=CFS_HTTP_HOST=$HTTP_HOST
Environment=CFS_HTTP_PORT=$HTTP_PORT
ExecStart=$app_dir/.venv/bin/python $app_dir/app.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}.service"
  systemctl --no-pager --full status "${SERVICE_NAME}.service" || true

  echo
  echo "Installed as systemd service."
  echo "Open: http://<HOST>:${HTTP_PORT}"
}

install_portable() {
  app_dir="${APP_DIR:-$SCRIPT_DIR/.k1c-cfs-mini}"
  launcher="$SCRIPT_DIR/run-local.sh"
  prepare_app_dir "$app_dir"

  cat > "$launcher" <<EOF
#!/bin/sh
set -eu
SCRIPT_DIR="\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)"
ENV_FILE="\$SCRIPT_DIR/.env"

if [ -f "\$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "\$ENV_FILE"
fi

if [ "\${CFS_WS_URL:-}" = "" ]; then
  printf 'Printer IP or hostname: ' >&2
  read -r printer_host
  if [ "\$printer_host" = "" ]; then
    printf '%s\n' 'Printer IP or hostname is required.' >&2
    exit 1
  fi
  CFS_WS_URL="ws://\$printer_host:9999"
fi

if [ "\${CFS_HTTP_HOST:-}" = "" ]; then
  CFS_HTTP_HOST="${HTTP_HOST}"
fi

if [ "\${CFS_HTTP_PORT:-}" = "" ]; then
  CFS_HTTP_PORT="${HTTP_PORT}"
fi

cd "$app_dir"
export CFS_WS_URL
export CFS_HTTP_HOST
export CFS_HTTP_PORT
exec "$app_dir/.venv/bin/python" "$app_dir/app.py"
EOF
  chmod +x "$launcher"

  echo
  echo "Installed in portable mode."
  echo "App dir: $app_dir"
  echo "Run: $launcher"
  echo "Optional .env: $SCRIPT_DIR/.env"
  echo "Open: http://127.0.0.1:${HTTP_PORT}"
}

if has_systemd; then
  install_systemd
else
  install_portable
fi
