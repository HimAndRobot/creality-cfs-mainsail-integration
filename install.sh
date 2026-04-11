#!/bin/sh
set -eu

APP_DIR="/opt/k1c-cfs-mini"
SERVICE_NAME="k1c-cfs-mini"
PYTHON_BIN="${PYTHON_BIN:-python3}"
HTTP_PORT="${CFS_HTTP_PORT:-8010}"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

mkdir -p "$APP_DIR"
cp "$SCRIPT_DIR/app.py" "$APP_DIR/app.py"
cp "$SCRIPT_DIR/requirements.txt" "$APP_DIR/requirements.txt"
rm -rf "$APP_DIR/static"
cp -r "$SCRIPT_DIR/static" "$APP_DIR/static"

$PYTHON_BIN -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=K1C CFS mini dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment=CFS_WS_URL=ws://127.0.0.1:9999
Environment=CFS_HTTP_HOST=0.0.0.0
Environment=CFS_HTTP_PORT=$HTTP_PORT
ExecStart=$APP_DIR/.venv/bin/python $APP_DIR/app.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true

echo
echo "Instalado. Abra: http://<IP-DA-IMPRESSORA>:${HTTP_PORT}"
