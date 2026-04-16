#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INJECT_START="<!-- K1C_CFS_INJECT_START -->"
INJECT_END="<!-- K1C_CFS_INJECT_END -->"
INIT_SCRIPT="/etc/init.d/S59k1c_cfs_mini"
PANEL_JS_SOURCE="${PANEL_JS_SOURCE:-$SCRIPT_DIR/static/mainsail-panel.js}"
MAINSAIL_HTML="${MAINSAIL_HTML:-/usr/data/mainsail/index.html}"
MAINSAIL_BACKUP_HTML="${MAINSAIL_BACKUP_HTML:-/usr/data/mainsail/index.html.k1c-cfs-mini.bak}"
MAINSAIL_PANEL_JS_TARGET="${MAINSAIL_PANEL_JS_TARGET:-/usr/data/mainsail/k1c-cfs-panel.js}"
FLUIDD_HTML="${FLUIDD_HTML:-/usr/data/fluidd/index.html}"
FLUIDD_BACKUP_HTML="${FLUIDD_BACKUP_HTML:-/usr/data/fluidd/index.html.k1c-cfs-mini.bak}"
FLUIDD_PANEL_JS_TARGET="${FLUIDD_PANEL_JS_TARGET:-/usr/data/fluidd/k1c-cfs-panel.js}"
PRINTER_CFG="${PRINTER_CFG:-/usr/data/printer_data/config/printer.cfg}"
PRINTER_CFG_BACKUP="${PRINTER_CFG_BACKUP:-/usr/data/printer_data/config/printer.cfg.k1c-cfs-mini.bak}"
KLIPPER_EXTRA_SOURCE="${KLIPPER_EXTRA_SOURCE:-$SCRIPT_DIR/klipper/cfs_material_db.py}"
KLIPPER_CFG_SOURCE="${KLIPPER_CFG_SOURCE:-$SCRIPT_DIR/klipper/cfs_material_db.cfg}"
KLIPPER_EXTRA_TARGET="${KLIPPER_EXTRA_TARGET:-/usr/share/klipper/klippy/extras/cfs_material_db.py}"
KLIPPER_EXTRA_PYC_TARGET="${KLIPPER_EXTRA_PYC_TARGET:-/usr/share/klipper/klippy/extras/cfs_material_db.pyc}"
KLIPPER_CFG_TARGET="${KLIPPER_CFG_TARGET:-/usr/data/printer_data/config/cfs_material_db.cfg}"
KLIPPER_INCLUDE_LINE="[include cfs_material_db.cfg]"
CREALITY_WEB_SERVER="${CREALITY_WEB_SERVER:-/usr/bin/web-server}"
CREALITY_WEB_SERVER_DISABLED="${CREALITY_WEB_SERVER_DISABLED:-/usr/bin/web-server.disabled}"
CFS_SERVICE_MARKER="${CFS_SERVICE_MARKER:-$SCRIPT_DIR/.cfs-service-reactivated}"

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_file() {
  [ -f "$1" ] || die "Missing file: $1"
}

target_html() {
  case "$1" in
    mainsail) printf '%s\n' "$MAINSAIL_HTML" ;;
    fluidd) printf '%s\n' "$FLUIDD_HTML" ;;
    *) die "Unknown target: $1" ;;
  esac
}

target_backup_html() {
  case "$1" in
    mainsail) printf '%s\n' "$MAINSAIL_BACKUP_HTML" ;;
    fluidd) printf '%s\n' "$FLUIDD_BACKUP_HTML" ;;
    *) die "Unknown target: $1" ;;
  esac
}

target_panel_js() {
  case "$1" in
    mainsail) printf '%s\n' "$MAINSAIL_PANEL_JS_TARGET" ;;
    fluidd) printf '%s\n' "$FLUIDD_PANEL_JS_TARGET" ;;
    *) die "Unknown target: $1" ;;
  esac
}

pause_and_exit() {
  printf '\nPress Enter to continue.'
  read -r _ || true
  exit 0
}

pull_repo_updates() {
  if [ ! -d "$SCRIPT_DIR/.git" ]; then
    die "Repository metadata not found in $SCRIPT_DIR"
  fi
  printf 'Step 1: pulling latest changes\n'
  git -C "$SCRIPT_DIR" pull --ff-only
}

backup_once() {
  target="$1"
  src="$(target_html "$target")"
  backup="$(target_backup_html "$target")"
  if [ ! -f "$backup" ]; then
    cp "$src" "$backup"
    chmod 644 "$backup" || true
    printf '%s backup created: %s\n' "$target" "$backup"
  else
    printf '%s backup already exists: %s\n' "$target" "$backup"
  fi
}

backup_printer_cfg_once() {
  if [ ! -f "$PRINTER_CFG_BACKUP" ]; then
    cp "$PRINTER_CFG" "$PRINTER_CFG_BACKUP"
    chmod 644 "$PRINTER_CFG_BACKUP" || true
    printf 'Printer config backup created: %s\n' "$PRINTER_CFG_BACKUP"
  else
    printf 'Printer config backup already exists: %s\n' "$PRINTER_CFG_BACKUP"
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
  target="$1"
  target_html_path="$(target_html "$target")"
  tmp_clean="/tmp/k1c-cfs-clean.$$"
  tmp_out="/tmp/k1c-cfs-out.$$"
  trap 'rm -f "$tmp_clean" "$tmp_out"' EXIT INT TERM

  remove_existing_block "$target_html_path" "$tmp_clean"

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
      die "Could not find </head> in $target_html_path"
    }

  cp "$tmp_out" "$target_html_path"
  chmod 644 "$target_html_path" || true
  rm -f "$tmp_clean" "$tmp_out"
  trap - EXIT INT TERM
}

deploy_local_panel() {
  target="$1"
  panel_target="$(target_panel_js "$target")"
  require_file "$PANEL_JS_SOURCE"
  cp "$PANEL_JS_SOURCE" "$panel_target"
  chmod 644 "$panel_target" || true
}

install_klipper_extra() {
  require_file "$KLIPPER_EXTRA_SOURCE"
  require_file "$KLIPPER_CFG_SOURCE"
  cp "$KLIPPER_EXTRA_SOURCE" "$KLIPPER_EXTRA_TARGET"
  chmod 644 "$KLIPPER_EXTRA_TARGET" || true
  rm -f "$KLIPPER_EXTRA_PYC_TARGET"
  cp "$KLIPPER_CFG_SOURCE" "$KLIPPER_CFG_TARGET"
  chmod 644 "$KLIPPER_CFG_TARGET" || true
}

ensure_printer_include() {
  require_file "$PRINTER_CFG"
  if grep -Fqx "$KLIPPER_INCLUDE_LINE" "$PRINTER_CFG"; then
    printf 'Printer config include already exists.\n'
    return
  fi

  tmp_cfg="/tmp/k1c-cfs-printer.$$"
  trap 'rm -f "$tmp_cfg"' EXIT INT TERM
  {
    printf '%s\n' "$KLIPPER_INCLUDE_LINE"
    cat "$PRINTER_CFG"
  } > "$tmp_cfg"
  cp "$tmp_cfg" "$PRINTER_CFG"
  chmod 644 "$PRINTER_CFG" || true
  rm -f "$tmp_cfg"
  trap - EXIT INT TERM
  printf 'Added include to printer config.\n'
}

remove_printer_include() {
  [ -f "$PRINTER_CFG" ] || return 0
  tmp_cfg="/tmp/k1c-cfs-printer.$$"
  trap 'rm -f "$tmp_cfg"' EXIT INT TERM
  awk -v include="$KLIPPER_INCLUDE_LINE" '$0 != include { print }' "$PRINTER_CFG" > "$tmp_cfg"
  cp "$tmp_cfg" "$PRINTER_CFG"
  chmod 644 "$PRINTER_CFG" || true
  rm -f "$tmp_cfg"
  trap - EXIT INT TERM
}

reactivate_cfs_service() {
  printf '\nReactivating CFS service...\n'
  restored_binary=0
  if [ -f "$CREALITY_WEB_SERVER_DISABLED" ] && [ ! -f "$CREALITY_WEB_SERVER" ]; then
    printf 'Step 1: restoring web-server binary\n'
    mv "$CREALITY_WEB_SERVER_DISABLED" "$CREALITY_WEB_SERVER"
    chmod 755 "$CREALITY_WEB_SERVER" || true
    restored_binary=1
  else
    printf 'Step 1: web-server binary already available\n'
  fi

  printf 'Step 2: restarting web-server\n'
  killall -q web-server 2>/dev/null || true
  if [ -f "$CREALITY_WEB_SERVER" ]; then
    "$CREALITY_WEB_SERVER" > /dev/null 2>&1 &
    sleep 1
  else
    die "Missing file: $CREALITY_WEB_SERVER"
  fi

  printf 'Step 3: validating port 9999\n'
  if command -v nc >/dev/null 2>&1; then
    if nc -z 127.0.0.1 9999 >/dev/null 2>&1; then
      printf 'CFS service is listening on port 9999.\n'
    else
      die "CFS service did not start on port 9999"
    fi
  else
    printf 'nc not available; skipped socket validation.\n'
  fi

  if [ "$restored_binary" -eq 1 ]; then
    : > "$CFS_SERVICE_MARKER"
  fi

  printf '\nCFS service reactivated.\n'
  pause_and_exit
}

install_local() {
  targets="$1"
  require_file "$PRINTER_CFG"
  printf '\nInstalling local panel...\n'
  printf 'Step 1: creating backups\n'
  for target in $targets; do
    require_file "$(target_html "$target")"
    backup_once "$target"
  done
  backup_printer_cfg_once
  printf 'Step 2: copying panel script\n'
  for target in $targets; do
    deploy_local_panel "$target"
  done
  printf 'Step 3: injecting frontend\n'
  for target in $targets; do
    write_local_injected_file "$target"
  done
  printf 'Step 4: installing Klipper extra\n'
  install_klipper_extra
  printf 'Step 5: updating printer config\n'
  ensure_printer_include
  printf '\nInstalled local mode.\n'
  for target in $targets; do
    printf '%s target:  %s\n' "$target" "$(target_html "$target")"
    printf '%s backup:  %s\n' "$target" "$(target_backup_html "$target")"
    printf '%s panel:   %s\n' "$target" "$(target_panel_js "$target")"
  done
  printf '\n'
  printf 'Power off the printer, wait 10 seconds, then power it back on. Enjoy.\n\n'
  printf 'Installation finished.\n'
  pause_and_exit
}

update_local() {
  targets="$1"
  require_file "$PRINTER_CFG"
  printf '\nUpdating local panel...\n'
  pull_repo_updates
  printf 'Step 2: ensuring backups exist\n'
  for target in $targets; do
    require_file "$(target_html "$target")"
    backup_once "$target"
  done
  backup_printer_cfg_once
  printf 'Step 3: refreshing injected assets\n'
  rm -f "$MAINSAIL_PANEL_JS_TARGET" "$FLUIDD_PANEL_JS_TARGET"
  rm -f "$KLIPPER_EXTRA_TARGET" "$KLIPPER_EXTRA_PYC_TARGET" "$KLIPPER_CFG_TARGET"
  for target in $targets; do
    deploy_local_panel "$target"
  done
  printf 'Step 4: refreshing frontend injection\n'
  for target in $targets; do
    write_local_injected_file "$target"
  done
  printf 'Step 5: refreshing Klipper extra\n'
  install_klipper_extra
  printf 'Step 6: validating printer config include\n'
  ensure_printer_include
  printf '\nUpdated local mode.\n'
  for target in $targets; do
    printf '%s target:  %s\n' "$target" "$(target_html "$target")"
    printf '%s backup:  %s\n' "$target" "$(target_backup_html "$target")"
    printf '%s panel:   %s\n' "$target" "$(target_panel_js "$target")"
  done
  printf '\n'
  printf 'Update finished.\n'
  pause_and_exit
}

remove_installation() {
  printf '\nRemoving local files and restoring backup...\n'
  printf 'Step 1: restoring backups\n'
  restored_any=0
  for target in mainsail fluidd; do
    target_html_path="$(target_html "$target")"
    backup="$(target_backup_html "$target")"
    if [ -f "$backup" ]; then
      cp "$backup" "$target_html_path"
      chmod 644 "$target_html_path" || true
      printf '%s restored from backup.\n' "$target"
      restored_any=1
    else
      printf '%s backup not found; skipped.\n' "$target"
    fi
  done
  if [ "$restored_any" -eq 0 ]; then
    printf 'No frontend backups found.\n'
  fi
  printf 'Step 2: removing autostart file\n'
  rm -f "$INIT_SCRIPT"
  printf 'Step 3: removing Klipper include\n'
  remove_printer_include
  printf 'Step 4: removing local files\n'
  rm -f "$SCRIPT_DIR/.env" "$SCRIPT_DIR/run-local.sh"
  rm -rf "$SCRIPT_DIR/.k1c-cfs-mini"
  rm -f "$MAINSAIL_PANEL_JS_TARGET" "$FLUIDD_PANEL_JS_TARGET"
  rm -f "$KLIPPER_EXTRA_TARGET" "$KLIPPER_EXTRA_PYC_TARGET" "$KLIPPER_CFG_TARGET"
  printf 'Step 5: restoring previous CFS service state\n'
  if [ -f "$CFS_SERVICE_MARKER" ]; then
    killall -q web-server 2>/dev/null || true
    if [ -f "$CREALITY_WEB_SERVER" ] && [ ! -f "$CREALITY_WEB_SERVER_DISABLED" ]; then
      mv "$CREALITY_WEB_SERVER" "$CREALITY_WEB_SERVER_DISABLED"
    fi
    rm -f "$CFS_SERVICE_MARKER"
    printf 'CFS service disabled again.\n'
  else
    printf 'CFS service state unchanged.\n'
  fi
  printf '\nRemoved.\n'
  printf 'Mainsail backup kept at: %s\n' "$MAINSAIL_BACKUP_HTML"
  printf 'Fluidd backup kept at: %s\n' "$FLUIDD_BACKUP_HTML"
  printf 'Printer config backup kept at: %s\n' "$PRINTER_CFG_BACKUP"
  printf '\n'
  printf 'Removal finished.\n'
  pause_and_exit
}

show_install_menu() {
  printf '\n'
  printf 'Select Targets\n'
  printf '1. Mainsail\n'
  printf '2. Fluidd\n'
  printf '3. Both\n'
  printf 'B. Back\n'
  printf '> '
}

choose_targets() {
  action="$1"
  while :; do
    show_install_menu
    read -r choice || exit 0
    case "$choice" in
      1) "$action" "mainsail" ;;
      2) "$action" "fluidd" ;;
      3) "$action" "mainsail fluidd" ;;
      b|B) return ;;
      *) printf '\nInvalid option.\n' ;;
    esac
  done
}

show_menu() {
  printf '\n'
  printf 'K1C CFS Mainsail Injection\n'
  printf '1. Install\n'
  printf '2. Remove\n'
  printf '3. Reactivate CFS Service\n'
  printf '4. Update\n'
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
        choose_targets install_local
        ;;
      2)
        remove_installation
        ;;
      3)
        reactivate_cfs_service
        ;;
      4)
        choose_targets update_local
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
