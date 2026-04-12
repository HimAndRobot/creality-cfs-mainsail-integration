#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TARGET_HTML="${TARGET_HTML:-/usr/data/mainsail/index.html}"
BACKUP_HTML="${BACKUP_HTML:-/usr/data/mainsail/index.html.k1c-cfs-mini.bak}"
DEFAULT_BACKEND_PORT="${CFS_HTTP_PORT:-8010}"
INJECT_START="<!-- K1C_CFS_INJECT_START -->"
INJECT_END="<!-- K1C_CFS_INJECT_END -->"

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

resolve_backend_origin() {
  raw_host="$1"
  raw_port="$2"
  case "$raw_host" in
    __BACK__) printf '__BACK__'; return 0 ;;
  esac
  case "$raw_port" in
    __BACK__) printf '__BACK__'; return 0 ;;
  esac
  raw="$raw_host"
  case "$raw" in
    http://*|https://*) printf '%s' "$raw" ;;
    *:*) printf 'http://%s' "$raw" ;;
    *) printf 'http://%s:%s' "$raw" "$raw_port" ;;
  esac
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

write_injected_file() {
  backend_origin="$1"
  tmp_clean="/tmp/k1c-cfs-clean.$$"
  tmp_out="/tmp/k1c-cfs-out.$$"
  trap 'rm -f "$tmp_clean" "$tmp_out"' EXIT INT TERM

  remove_existing_block "$TARGET_HTML" "$tmp_clean"

  awk \
    -v start="$INJECT_START" \
    -v end="$INJECT_END" \
    -v origin="$backend_origin" '
      {
        if (!inserted && index($0, "</head>")) {
          print start
          print "<script>"
          print "window.K1C_CFS_URL = \"" origin "\";"
          print "if (!window.__k1c_cfs_loader_loaded) {"
          print "  window.__k1c_cfs_loader_loaded = true;"
          print "  const script = document.createElement(\"script\");"
          print "  script.src = window.K1C_CFS_URL + \"/static/mainsail-panel.js?ts=\" + Date.now();"
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

install_remote() {
  require_file "$TARGET_HTML"
  default_host="$(detect_host_ip)"
  backend_host="$(prompt_default "Backend host or IP" "$default_host")"
  [ "$backend_host" = "__BACK__" ] && return 0
  backend_port="$(prompt_default "Backend port" "$DEFAULT_BACKEND_PORT")"
  [ "$backend_port" = "__BACK__" ] && return 0
  backend_origin="$(resolve_backend_origin "$backend_host" "$backend_port")"

  backup_once
  write_injected_file "$backend_origin"

  printf '\nInstalled injection.\n'
  printf 'Target:  %s\n' "$TARGET_HTML"
  printf 'Backup:  %s\n' "$BACKUP_HTML"
  printf 'Backend: %s\n\n' "$backend_origin"
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

start_local_backend() {
  if is_backend_running; then
    printf 'Backend already listening on port %s.\n' "$DEFAULT_BACKEND_PORT"
    return 0
  fi
  if [ ! -x "$SCRIPT_DIR/run-local.sh" ]; then
    die "Missing launcher: $SCRIPT_DIR/run-local.sh"
  fi
  nohup "$SCRIPT_DIR/run-local.sh" >/tmp/k1c-cfs-mini.log 2>&1 &
  sleep 2
  if is_backend_running; then
    printf 'Backend started in background.\n'
  else
    printf 'Backend start could not be confirmed. Check /tmp/k1c-cfs-mini.log\n'
  fi
}

configure_local_autostart() {
  if command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
    printf 'Autostart handled by systemd.\n'
    return 0
  fi
  if command -v crontab >/dev/null 2>&1; then
    tmp_cron="/tmp/k1c-cfs-mini-cron.$$"
    crontab -l 2>/dev/null | grep -v 'k1c-cfs-mini autostart' > "$tmp_cron" || true
    printf '@reboot %s/run-local.sh >/tmp/k1c-cfs-mini.log 2>&1 # k1c-cfs-mini autostart\n' "$SCRIPT_DIR" >> "$tmp_cron"
    crontab "$tmp_cron"
    rm -f "$tmp_cron"
    printf 'Autostart configured in crontab.\n'
    return 0
  fi
  printf 'Autostart was not configured automatically on this Linux.\n'
}

install_local() {
  require_file "$TARGET_HTML"
  printf '\nInstalling local backend...\n'
  CFS_WS_URL="ws://127.0.0.1:9999" \
  CFS_HTTP_HOST="0.0.0.0" \
  CFS_HTTP_PORT="$DEFAULT_BACKEND_PORT" \
    sh "$SCRIPT_DIR/install.sh"
  write_local_env
  configure_local_autostart
  start_local_backend
  backup_once
  write_injected_file "http://127.0.0.1:$DEFAULT_BACKEND_PORT"
  printf '\nInstalled local mode.\n'
  printf 'Target:  %s\n' "$TARGET_HTML"
  printf 'Backup:  %s\n' "$BACKUP_HTML"
  printf 'Backend: http://127.0.0.1:%s\n' "$DEFAULT_BACKEND_PORT"
  printf 'Log:     /tmp/k1c-cfs-mini.log\n\n'
}

install_menu() {
  while :; do
    printf '\n'
    printf 'Install Mode\n'
    printf '1. Run locally on this printer\n'
    printf '2. Use another machine on the network\n'
    printf 'B. Back\n'
    printf '> '
    read -r choice || return 0
    case "$choice" in
      '')
        ;;
      1)
        install_local
        return 0
        ;;
      2)
        install_remote
        return 0
        ;;
      b|B)
        return 0
        ;;
      *)
        printf '\nInvalid option.\n'
        ;;
    esac
  done
}

restore_backup() {
  require_file "$BACKUP_HTML"
  cp "$BACKUP_HTML" "$TARGET_HTML"
  chmod 644 "$TARGET_HTML" || true
  printf '\nBackup restored.\n'
  printf 'Target: %s\n' "$TARGET_HTML"
  printf 'Backup: %s\n\n' "$BACKUP_HTML"
}

show_menu() {
  printf '\n'
  printf 'K1C CFS Mainsail Injection\n'
  printf '1. Install\n'
  printf '2. Restore backup\n'
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
        install_menu
        ;;
      2)
        restore_backup
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
