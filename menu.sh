#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TARGET_HTML="${TARGET_HTML:-/usr/data/mainsail/index.html}"
BACKUP_HTML="${BACKUP_HTML:-/usr/data/mainsail/index.html.k1c-cfs-mini.bak}"
INJECT_START="<!-- K1C_CFS_INJECT_START -->"
INJECT_END="<!-- K1C_CFS_INJECT_END -->"
INIT_SCRIPT="/etc/init.d/S59k1c_cfs_mini"
PANEL_JS_SOURCE="${PANEL_JS_SOURCE:-$SCRIPT_DIR/static/mainsail-panel.js}"
PANEL_JS_TARGET="${PANEL_JS_TARGET:-/usr/data/mainsail/k1c-cfs-panel.js}"
PRINTER_CFG="${PRINTER_CFG:-/usr/data/printer_data/config/printer.cfg}"
PRINTER_CFG_BACKUP="${PRINTER_CFG_BACKUP:-/usr/data/printer_data/config/printer.cfg.k1c-cfs-mini.bak}"
KLIPPER_EXTRA_SOURCE="${KLIPPER_EXTRA_SOURCE:-$SCRIPT_DIR/klipper/cfs_material_db.py}"
KLIPPER_CFG_SOURCE="${KLIPPER_CFG_SOURCE:-$SCRIPT_DIR/klipper/cfs_material_db.cfg}"
KLIPPER_EXTRA_TARGET="${KLIPPER_EXTRA_TARGET:-/usr/share/klipper/klippy/extras/cfs_material_db.py}"
KLIPPER_EXTRA_PYC_TARGET="${KLIPPER_EXTRA_PYC_TARGET:-/usr/share/klipper/klippy/extras/cfs_material_db.pyc}"
KLIPPER_CFG_TARGET="${KLIPPER_CFG_TARGET:-/usr/data/printer_data/config/cfs_material_db.cfg}"
KLIPPER_INCLUDE_LINE="[include cfs_material_db.cfg]"

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_file() {
  [ -f "$1" ] || die "Missing file: $1"
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

install_local() {
  require_file "$TARGET_HTML"
  require_file "$PRINTER_CFG"
  printf '\nInstalling local panel...\n'
  printf 'Step 1: creating backup\n'
  backup_once
  backup_printer_cfg_once
  printf 'Step 2: copying panel script\n'
  deploy_local_panel
  printf 'Step 3: injecting Mainsail\n'
  write_local_injected_file
  printf 'Step 4: installing Klipper extra\n'
  install_klipper_extra
  printf 'Step 5: updating printer config\n'
  ensure_printer_include
  printf '\nInstalled local mode.\n'
  printf 'Target:  %s\n' "$TARGET_HTML"
  printf 'Backup:  %s\n' "$BACKUP_HTML"
  printf 'Panel:   %s\n\n' "$PANEL_JS_TARGET"
  printf 'Power off the printer, wait 10 seconds, then power it back on. Enjoy.\n\n'
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
  printf 'Step 3: removing Klipper include\n'
  remove_printer_include
  printf 'Step 4: removing local files\n'
  rm -f "$SCRIPT_DIR/.env" "$SCRIPT_DIR/run-local.sh"
  rm -rf "$SCRIPT_DIR/.k1c-cfs-mini"
  rm -f "$PANEL_JS_TARGET"
  rm -f "$KLIPPER_EXTRA_TARGET" "$KLIPPER_EXTRA_PYC_TARGET" "$KLIPPER_CFG_TARGET"
  printf '\nRemoved.\n'
  printf 'Target: %s\n' "$TARGET_HTML"
  printf 'Backup kept at: %s\n' "$BACKUP_HTML"
  printf 'Printer config backup kept at: %s\n' "$PRINTER_CFG_BACKUP"
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
