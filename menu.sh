#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TARGET_HTML="${TARGET_HTML:-/usr/data/mainsail/index.html}"
BACKUP_HTML="${BACKUP_HTML:-/usr/data/mainsail/index.html.k1c-cfs-mini.bak}"
DEFAULT_BACKEND_PORT="${CFS_HTTP_PORT:-8010}"
INJECT_START="<!-- K1C_CFS_INJECT_START -->"
INJECT_END="<!-- K1C_CFS_INJECT_END -->"
INIT_SCRIPT="/etc/init.d/S59k1c_cfs_mini"
PANEL_JS_SOURCE="${PANEL_JS_SOURCE:-$SCRIPT_DIR/static/mainsail-panel.js}"
PANEL_JS_TARGET="${PANEL_JS_TARGET:-/usr/data/mainsail/k1c-cfs-panel.js}"

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_file() {
  [ -f "$1" ] || die "Missing file: $1"
}

detect_host_ip() {
  ip_guess=""
  if command -v hostname >/dev/null 2>&1; then
    ip_guess="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [ -z "$ip_guess" ] && command -v ip >/dev/null 2>&1; then
    ip_guess="$(ip route get 1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
  fi
  if [ -z "$ip_guess" ]; then
    ip_guess="127.0.0.1"
  fi
  printf '%s' "$ip_guess"
}

prompt_default() {
  prompt_text="$1"
  default_value="$2"
  printf '%s [%s] (B to go back): ' "$prompt_text" "$default_value" >&2
  read -r answer || true
  case "$answer" in
    b|B) printf '__BACK__'; return 0 ;;
  esac
  if [ -z "$answer" ]; then
    printf '%s' "$default_value"
  else
    printf '%s' "$answer"
  fi
}

pause_and_exit() {
  printf '\nPress Enter to continue.'
  read -r _ || true
  exit 0
}

backup_once() {
  if [ ! -f "$BACKUP_HTML" ]; then
    cp "$TARGET_HTML" "$BACKUP_HTML"
    chmod 644 "$BACKUP_HTML" || true
    printf 'Backup created: %s\n' "$BACKUP_HTML"
  else
    printf 'Backup already exists: %s\n' "$BACKUP_HTML"
  fi
}

remove_existing_block() {
  src="$1"
  dst="$2"
  awk -v start="$INJECT_START" -v end="$INJECT_END" '
    index($0, start) { skip = 1; next }
    index($0, end) { skip = 0; next }
    !skip { print }
  ' "$src" > "$dst"
}

write_local_injected_file() {
  tmp_clean="/tmp/k1c-cfs-clean.$$"
  tmp_out="/tmp/k1c-cfs-out.$$"
  trap 'rm -f "$tmp_clean" "$tmp_out"' EXIT INT TERM

  remove_existing_block "$TARGET_HTML" "$tmp_clean"

  awk \
    -v start="$INJECT_START" \
    -v end="$INJECT_END" '
      {
        if (!inserted && index($0, "</head>")) {
          print start
          print "<script>"
          print "window.K1C_CFS_WS_URL = \"ws://\" + window.location.hostname + \":9999\";"
          print "if (!window.__k1c_cfs_loader_loaded) {"
          print "  window.__k1c_cfs_loader_loaded = true;"
          print "  const script = document.createElement(\"script\");"
          print "  script.src = \"/k1c-cfs-panel.js?ts=\" + Date.now();"
          print "  document.head.appendChild(script);"
          print "}"
          print "</script>"
          print end
          inserted = 1
        }
        print
      }
      END {
        if (!inserted) exit 7
      }
    ' "$tmp_clean" > "$tmp_out" || {
      rm -f "$tmp_clean" "$tmp_out"
      trap - EXIT INT TERM
      die "Could not find </head> in $TARGET_HTML"
    }

  cp "$tmp_out" "$TARGET_HTML"
  chmod 644 "$TARGET_HTML" || true
  rm -f "$tmp_clean" "$tmp_out"
  trap - EXIT INT TERM
}

deploy_local_panel() {
  require_file "$PANEL_JS_SOURCE"
  cp "$PANEL_JS_SOURCE" "$PANEL_JS_TARGET"
  chmod 644 "$PANEL_JS_TARGET" || true
}

write_local_env() {
  cat > "$SCRIPT_DIR/.env" <<EOF
CFS_WS_URL=ws://127.0.0.1:9999
CFS_HTTP_HOST=0.0.0.0
CFS_HTTP_PORT=$DEFAULT_BACKEND_PORT
EOF
}

is_backend_running() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -i :"$DEFAULT_BACKEND_PORT" >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$DEFAULT_BACKEND_PORT\$"
    return $?
  fi
  return 1
}

backend_health_ok() {
  if command -v wget >/dev/null 2>&1; then
    wget -q -T 3 -O - "http://127.0.0.1:$DEFAULT_BACKEND_PORT/api/health" >/dev/null 2>&1
    return $?
  fi
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "http://127.0.0.1:$DEFAULT_BACKEND_PORT/api/health" >/dev/null 2>&1
    return $?
  fi
  return 1
}

start_local_backend() {
  if [ -f "$INIT_SCRIPT" ]; then
    "$INIT_SCRIPT" restart >/dev/null 2>&1 || true
  else
    if [ ! -x "$SCRIPT_DIR/run-local.sh" ]; then
      die "Missing launcher: $SCRIPT_DIR/run-local.sh"
    fi
    nohup "$SCRIPT_DIR/run-local.sh" >/tmp/k1c-cfs-mini.log 2>&1 &
  fi

  retries=0
  while [ "$retries" -lt 10 ]; do
    if backend_health_ok; then
      printf 'Backend is healthy on port %s.\n' "$DEFAULT_BACKEND_PORT"
      return 0
    fi
    retries=$((retries + 1))
    sleep 1
  done

  printf 'Backend is still starting. Check /tmp/k1c-cfs-mini.log if it does not come up.\n'
  return 0
}

configure_local_autostart() {
  if command -v start-stop-daemon >/dev/null 2>&1 && [ -d /etc/init.d ]; then
    cat > "$INIT_SCRIPT" <<EOF
#!/bin/sh
PID_FILE="/var/run/k1c-cfs-mini.pid"
PYTHON_BIN="$SCRIPT_DIR/.k1c-cfs-mini/.venv/bin/python"
APP_FILE="$SCRIPT_DIR/.k1c-cfs-mini/app.py"
CFS_WS_URL="ws://127.0.0.1:9999"
CFS_HTTP_HOST="0.0.0.0"
CFS_HTTP_PORT="$DEFAULT_BACKEND_PORT"

start() {
  [ -x "\$PYTHON_BIN" ] || exit 1
  export CFS_WS_URL CFS_HTTP_HOST CFS_HTTP_PORT
  start-stop-daemon -S -q -b -m -p "\$PID_FILE" --exec "\$PYTHON_BIN" -- "\$APP_FILE"
}

stop() {
  start-stop-daemon -K -q -p "\$PID_FILE" || true
}

restart() {
  stop
  sleep 1
  start
}

case "\$1" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart|reload)
    restart
    ;;
  *)
    echo "Usage: \$0 {start|stop|restart}"
    exit 1
    ;;
esac

exit \$?
EOF
    chmod +x "$INIT_SCRIPT"
    printf 'Autostart configured: %s\n' "$INIT_SCRIPT"
    return 0
  fi
  printf 'Autostart was not configured automatically on this Linux.\n'
}

remove_local_autostart() {
  if [ -f "$INIT_SCRIPT" ]; then
    "$INIT_SCRIPT" stop >/dev/null 2>&1 || true
    rm -f "$INIT_SCRIPT"
    printf 'Removed init autostart: %s\n' "$INIT_SCRIPT"
    return 0
  fi
  printf 'No init autostart script found.\n'
}

install_local() {
  require_file "$TARGET_HTML"
  printf '\nInstalling local panel...\n'
  printf 'Step 1: creating backup\n'
  backup_once
  printf 'Step 2: copying panel script\n'
  deploy_local_panel
  printf 'Step 3: injecting Mainsail\n'
  write_local_injected_file
  printf '\nInstalled local mode.\n'
  printf 'Target:  %s\n' "$TARGET_HTML"
  printf 'Backup:  %s\n' "$BACKUP_HTML"
  printf 'Panel:   %s\n\n' "$PANEL_JS_TARGET"
  printf 'Installation finished.\n'
  pause_and_exit
}

remove_installation() {
  require_file "$BACKUP_HTML"
  printf '\nRemoving local files and restoring backup...\n'
  printf 'Step 1: restoring backup\n'
  cp "$BACKUP_HTML" "$TARGET_HTML"
  chmod 644 "$TARGET_HTML" || true
  printf 'Step 2: removing autostart file\n'
  rm -f "$INIT_SCRIPT"
  printf 'Step 3: removing local files\n'
  rm -f "$SCRIPT_DIR/.env" "$SCRIPT_DIR/run-local.sh"
  rm -rf "$SCRIPT_DIR/.k1c-cfs-mini"
  rm -f "$PANEL_JS_TARGET"
  printf '\nRemoved.\n'
  printf 'Target: %s\n' "$TARGET_HTML"
  printf 'Backup kept at: %s\n' "$BACKUP_HTML"
  printf 'Running processes were left untouched on purpose.\n\n'
  printf 'Removal finished.\n'
  pause_and_exit
}

show_menu() {
  printf '\n'
  printf 'K1C CFS Mainsail Injection\n'
  printf '1. Install\n'
  printf '2. Remove\n'
  printf 'Q. Quit\n'
  printf '> '
}

main() {
  while :; do
    show_menu
    read -r choice || exit 0
    case "$choice" in
      '')
        ;;
      1)
        install_local
        ;;
      2)
        remove_installation
        ;;
      q|Q)
        exit 0
        ;;
      *)
        printf '\nInvalid option.\n'
        ;;
    esac
  done
}

main "$@"
