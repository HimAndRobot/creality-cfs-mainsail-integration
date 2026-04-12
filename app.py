import json
import os
import threading
import time
from collections import deque
from copy import deepcopy

from flask import Flask, jsonify, request, send_from_directory
import websocket


PRINTER_HOST = os.environ.get("PRINTER_HOST", "192.168.1.242")
WS_URL = os.environ.get("CFS_WS_URL", f"ws://{PRINTER_HOST}:9999")
HTTP_HOST = os.environ.get("CFS_HTTP_HOST", "0.0.0.0")
HTTP_PORT = int(os.environ.get("CFS_HTTP_PORT", "8010"))
POLL_INTERVAL = float(os.environ.get("CFS_POLL_INTERVAL", "5"))
HEARTBEAT_INTERVAL = float(os.environ.get("CFS_HEARTBEAT_INTERVAL", "10"))
DEBUG_BUFFER_SIZE = int(os.environ.get("CFS_DEBUG_BUFFER_SIZE", "30"))
EMPTY_COLOR = "#d7dce4"
SLOT_LETTERS = "ABCD"
MATERIAL_TYPES = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "OTHER"]


def normalize_color_hex(value):
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    if raw.startswith("0x"):
        raw = raw[2:]
    if raw.startswith("#"):
        raw = raw[1:]
    raw = "".join(ch for ch in raw if ch in "0123456789abcdef")
    if not raw:
        return ""
    if len(raw) == 7 and raw[0] == "0":
        raw = raw[1:]
    elif len(raw) == 8:
        raw = raw[2:]
    elif len(raw) > 8:
        raw = raw[-6:]
    if len(raw) != 6:
        return ""
    return "#" + raw


def empty_slot(label):
    return {
        "slot": label,
        "box_id": 1,
        "material_index": SLOT_LETTERS.index(label[-1]),
        "state": 0,
        "status": "empty",
        "present": False,
        "selected": False,
        "rfid": "",
        "type": "",
        "name": "",
        "vendor": "",
        "manufacturer": "",
        "color": EMPTY_COLOR,
        "temp_min": None,
        "temp_max": None,
        "used_material_length": None,
        "raw": {},
    }


def normalize_material_type(value):
    material = str(value or "").strip().upper()
    return material if material in MATERIAL_TYPES else ""


def normalize_temperature_value(value):
    if value in (None, ""):
        return None
    try:
        temp = float(value)
    except Exception:
        return None
    if temp < 0:
        return None
    return round(temp, 2)


def normalize_color_value(value):
    color = normalize_color_hex(value)
    return color or None


def printer_color_value(value):
    color = normalize_color_hex(value)
    if not color:
        return ""
    return "#0" + color[1:]


class CfsState:
    def __init__(self):
        self.lock = threading.Lock()
        self.data = {
            "connected": False,
            "last_error": "",
            "last_message_at": 0,
            "last_boxs_info_at": 0,
            "raw_last_message": None,
            "raw_last_boxs_info": None,
            "messages_seen": 0,
            "frames": deque(maxlen=DEBUG_BUFFER_SIZE),
            "cfs_humidity": None,
            "cfs_temp": None,
            "feed_state": None,
            "feed_state_at": 0,
            "slots": [empty_slot(f"1{letter}") for letter in SLOT_LETTERS],
        }

    def update(self, **kwargs):
        with self.lock:
            self.data.update(kwargs)

    def append_frame(self, raw, parsed=None, source="recv"):
        with self.lock:
            self.data["frames"].append(
                {
                    "ts": time.time(),
                    "source": source,
                    "raw": raw,
                    "parsed": parsed,
                }
            )
            self.data["messages_seen"] += 1
            self.data["last_message_at"] = time.time()
            self.data["raw_last_message"] = parsed if parsed is not None else raw
            if source == "recv" and isinstance(parsed, dict) and "feedState" in parsed:
                self.data["feed_state"] = parsed.get("feedState")
                self.data["feed_state_at"] = time.time()

    def snapshot(self):
        with self.lock:
            snap = deepcopy(self.data)
        snap["frames"] = list(snap["frames"])
        return snap

    def set_slots_from_payload(self, payload):
        extracted = extract_slots(payload)
        with self.lock:
            self.data["slots"] = extracted["slots"]
            self.data["cfs_humidity"] = extracted["humidity"]
            self.data["cfs_temp"] = extracted["temp"]
            self.data["raw_last_boxs_info"] = payload
            self.data["last_boxs_info_at"] = time.time()
            self.data["connected"] = True
            self.data["last_error"] = ""


def material_status(state_value, present):
    if not present or state_value == 0:
        return "empty"
    if state_value == 2:
        return "rfid"
    if state_value == 1:
        return "manual"
    return "loaded"


def coerce_temperature_fields(material):
    candidates = {
        "temp_min": material.get("minTemp"),
        "temp_max": material.get("maxTemp"),
    }
    if candidates["temp_min"] is None:
        candidates["temp_min"] = material.get("nozzleTempMin")
    if candidates["temp_max"] is None:
        candidates["temp_max"] = material.get("nozzleTempMax")
    if candidates["temp_min"] is None:
        candidates["temp_min"] = material.get("minPrintTemp")
    if candidates["temp_max"] is None:
        candidates["temp_max"] = material.get("maxPrintTemp")
    return candidates["temp_min"], candidates["temp_max"]


def extract_slots(payload):
    default_slots = {f"1{letter}": empty_slot(f"1{letter}") for letter in SLOT_LETTERS}
    boxs_info = payload.get("boxsInfo") or {}
    material_boxes = boxs_info.get("materialBoxs") or []
    first_cfs_box = None

    for box in material_boxes:
        if not isinstance(box, dict):
            continue
        if box.get("type") != 0:
            continue
        first_cfs_box = box
        break

    if not isinstance(first_cfs_box, dict):
        return {
            "slots": [default_slots[f"1{letter}"] for letter in SLOT_LETTERS],
            "humidity": None,
            "temp": None,
        }

    box_id = first_cfs_box.get("id")
    if not isinstance(box_id, int):
        box_id = 1

    for material in first_cfs_box.get("materials") or []:
        if not isinstance(material, dict):
            continue
        material_index = material.get("id")
        if not isinstance(material_index, int) or not 0 <= material_index <= 3:
            continue

        label = f"{box_id}{SLOT_LETTERS[material_index]}"
        raw_state = int(material.get("state") or 0)
        name = str(material.get("name") or "").strip()
        vendor = str(material.get("vendor") or "").strip()
        material_type = str(material.get("type") or "").strip().upper()
        rfid = str(material.get("rfid") or "").strip()
        rfid_missing = rfid in ("", "0", "00", "000", "0000", "00000", "000000")
        empty_manual_signature = (
            raw_state == 1
            and rfid_missing
            and not name
            and not vendor
            and material_type in ("", "-", "OTHER", "N/A", "NA", "NONE")
        )
        state_value = 0 if empty_manual_signature else raw_state
        present = state_value > 0
        color = normalize_color_hex(material.get("color")) if present else ""
        temp_min, temp_max = coerce_temperature_fields(material)

        default_slots[label] = {
            "slot": label,
            "box_id": box_id,
            "material_index": material_index,
            "state": state_value,
            "status": material_status(state_value, present),
            "present": present,
            "selected": int(material.get("selected") or 0) == 1,
            "rfid": rfid,
            "type": material_type if present else "",
            "name": name if present else "",
            "vendor": vendor if present else "",
            "manufacturer": vendor if present else "",
            "color": color or EMPTY_COLOR,
            "temp_min": temp_min,
            "temp_max": temp_max,
            "used_material_length": material.get("usedMaterialLength"),
            "raw": material,
        }

    return {
        "slots": [default_slots[f"{box_id}{letter}"] for letter in SLOT_LETTERS],
        "humidity": normalize_temperature_value(first_cfs_box.get("humidity")),
        "temp": normalize_temperature_value(first_cfs_box.get("temp")),
    }


class CfsWsClient(threading.Thread):
    def __init__(self, state):
        super().__init__(daemon=True)
        self.state = state
        self.stop_event = threading.Event()
        self.ws_app = None
        self.last_poll = 0
        self.last_heartbeat = 0
        self.keepalive_thread = threading.Thread(target=self.keepalive_loop, daemon=True)
        self.keepalive_thread.start()

    def run(self):
        while not self.stop_event.is_set():
            try:
                self.state.update(connected=False)
                self.ws_app = websocket.WebSocketApp(
                    WS_URL,
                    on_open=self.on_open,
                    on_message=self.on_message,
                    on_error=self.on_error,
                    on_close=self.on_close,
                )
                self.ws_app.run_forever(ping_interval=None, ping_timeout=None)
            except Exception as exc:
                self.state.update(connected=False, last_error=str(exc))
            if not self.stop_event.is_set():
                time.sleep(3)

    def stop(self):
        self.stop_event.set()
        if self.ws_app:
            try:
                self.ws_app.close()
            except Exception:
                pass

    def on_open(self, ws):
        self.state.update(connected=True, last_error="")
        self.send_json({"ModeCode": "heart_beat"})
        self.send_json({"method": "get", "params": {"boxsInfo": 1}})
        self.last_heartbeat = time.time()
        self.last_poll = time.time()

    def on_message(self, ws, message):
        parsed = None
        try:
            parsed = json.loads(message)
        except Exception:
            parsed = None

        self.state.append_frame(message, parsed=parsed)

        if isinstance(message, str) and "heart_beat" in message:
            try:
                ws.send("ok")
                self.state.append_frame("ok", parsed="ok", source="send")
            except Exception as exc:
                self.state.update(last_error=str(exc))
            return

        if isinstance(message, str) and message.strip() == "ok":
            return

        if isinstance(parsed, dict) and "boxsInfo" in parsed:
            self.state.set_slots_from_payload(parsed)

    def on_error(self, ws, error):
        self.state.update(connected=False, last_error=str(error))

    def on_close(self, ws, status_code, message):
        msg = message or f"closed ({status_code})"
        self.state.update(connected=False, last_error=str(msg))

    def send_json(self, payload):
        if not self.ws_app or not self.ws_app.sock or not self.ws_app.sock.connected:
            return False
        raw = json.dumps(payload, ensure_ascii=False)
        try:
            self.ws_app.send(raw)
            self.state.append_frame(raw, parsed=payload, source="send")
            return True
        except Exception as exc:
            self.state.update(last_error=str(exc))
            return False

    def modify_material(self, slot, *, material_type, vendor, name, temp_min=None, temp_max=None, color=None):
        snap = self.state.snapshot()
        slot_data = next((item for item in snap["slots"] if item.get("slot") == slot), None)
        if not slot_data or not slot_data.get("present"):
            return False, "slot-not-present"

        raw = slot_data.get("raw") or {}
        resolved_min = temp_min if temp_min is not None else normalize_temperature_value(
            raw.get("minTemp") if raw.get("minTemp") is not None else slot_data.get("temp_min")
        )
        resolved_max = temp_max if temp_max is not None else normalize_temperature_value(
            raw.get("maxTemp") if raw.get("maxTemp") is not None else slot_data.get("temp_max")
        )

        payload = {
            "method": "set",
            "params": {
                "modifyMaterial": {
                    "boxId": slot_data.get("box_id") or 1,
                    "id": slot_data.get("material_index"),
                    "rfid": str(raw.get("rfid") or slot_data.get("rfid") or ""),
                    "type": material_type,
                    "vendor": vendor,
                    "name": name,
                    "color": printer_color_value(color or raw.get("color") or slot_data.get("color") or ""),
                    "minTemp": resolved_min,
                    "maxTemp": resolved_max,
                    "pressure": str(raw.get("pressure") or ""),
                }
            },
        }
        ok = self.send_json(payload)
        if not ok:
            return False, "ws-send-failed"
        return True, payload

    def feed_in_or_out(self, slot, *, is_feed):
        snap = self.state.snapshot()
        slot_data = next((item for item in snap["slots"] if item.get("slot") == slot), None)
        if not slot_data or not slot_data.get("present"):
            return False, "slot-not-present"

        payload = {
            "method": "set",
            "params": {
                "feedInOrOut": {
                    "boxId": slot_data.get("box_id") or 1,
                    "materialId": slot_data.get("material_index"),
                    "isFeed": 1 if is_feed else 0,
                }
            },
        }
        ok = self.send_json(payload)
        if not ok:
            return False, "ws-send-failed"
        return True, payload

    def keepalive_loop(self):
        while not self.stop_event.is_set():
            now = time.time()
            connected = bool(self.ws_app and self.ws_app.sock and self.ws_app.sock.connected)
            if connected and now - self.last_poll >= POLL_INTERVAL:
                self.send_json({"method": "get", "params": {"boxsInfo": 1}})
                self.last_poll = now
            if connected and now - self.last_heartbeat >= HEARTBEAT_INTERVAL:
                self.send_json({"ModeCode": "heart_beat"})
                self.last_heartbeat = now
            time.sleep(1)


app = Flask(__name__, static_folder="static", static_url_path="/static")
state = CfsState()
ws_client = CfsWsClient(state)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/health")
def api_health():
    snap = state.snapshot()
    return jsonify(
        {
            "ok": True,
            "connected": snap["connected"],
            "last_error": snap["last_error"],
            "last_message_at": snap["last_message_at"],
            "last_boxs_info_at": snap["last_boxs_info_at"],
            "messages_seen": snap["messages_seen"],
            "ws_url": WS_URL,
        }
    )


@app.route("/api/cfs")
def api_cfs():
    snap = state.snapshot()
    return jsonify(
        {
            "connected": snap["connected"],
            "last_error": snap["last_error"],
            "last_message_at": snap["last_message_at"],
            "last_boxs_info_at": snap["last_boxs_info_at"],
            "cfs_humidity": snap["cfs_humidity"],
            "cfs_temp": snap["cfs_temp"],
            "feed_state": snap["feed_state"],
            "feed_state_at": snap["feed_state_at"],
            "slots": snap["slots"],
        }
    )


@app.route("/api/cfs/slot/<slot>", methods=["POST"])
def api_cfs_update_slot(slot):
    slot = str(slot or "").strip().upper()
    if slot not in {f"1{letter}" for letter in SLOT_LETTERS}:
        return jsonify({"ok": False, "error": "invalid-slot"}), 400

    payload = request.get_json(silent=True) or {}
    material_type = normalize_material_type(payload.get("type"))
    vendor = str(payload.get("vendor") or "").strip()
    name = str(payload.get("name") or "").strip()
    temp_min = normalize_temperature_value(payload.get("temp_min"))
    temp_max = normalize_temperature_value(payload.get("temp_max"))
    color = normalize_color_value(payload.get("color"))

    if payload.get("type") not in (None, "") and not material_type:
        return jsonify({"ok": False, "error": "invalid-type", "allowed_types": MATERIAL_TYPES}), 400
    if payload.get("temp_min") not in (None, "") and temp_min is None:
        return jsonify({"ok": False, "error": "invalid-temp-min"}), 400
    if payload.get("temp_max") not in (None, "") and temp_max is None:
        return jsonify({"ok": False, "error": "invalid-temp-max"}), 400
    if payload.get("color") not in (None, "") and color is None:
        return jsonify({"ok": False, "error": "invalid-color"}), 400

    ok, result = ws_client.modify_material(
        slot,
        material_type=material_type,
        vendor=vendor,
        name=name,
        temp_min=temp_min,
        temp_max=temp_max,
        color=color,
    )
    if not ok:
        return jsonify({"ok": False, "error": result}), 400

    time.sleep(0.35)
    snap = state.snapshot()
    updated_slot = next((item for item in snap["slots"] if item.get("slot") == slot), None)
    return jsonify({"ok": True, "slot": updated_slot, "allowed_types": MATERIAL_TYPES, "sent": result})


@app.route("/api/cfs/slot/<slot>/action", methods=["POST"])
def api_cfs_slot_action(slot):
    slot = str(slot or "").strip().upper()
    if slot not in {f"1{letter}" for letter in SLOT_LETTERS}:
        return jsonify({"ok": False, "error": "invalid-slot"}), 400

    payload = request.get_json(silent=True) or {}
    action = str(payload.get("action") or "").strip().lower()
    if action not in {"feed", "retract"}:
        return jsonify({"ok": False, "error": "invalid-action", "allowed_actions": ["feed", "retract"]}), 400

    ok, result = ws_client.feed_in_or_out(slot, is_feed=(action == "feed"))
    if not ok:
        return jsonify({"ok": False, "error": result}), 400

    return jsonify({"ok": True, "slot": slot, "action": action, "sent": result})


@app.route("/api/debug")
def api_debug():
    snap = state.snapshot()
    return jsonify(
        {
            "connected": snap["connected"],
            "last_error": snap["last_error"],
            "last_message_at": snap["last_message_at"],
            "last_boxs_info_at": snap["last_boxs_info_at"],
            "messages_seen": snap["messages_seen"],
            "feed_state": snap["feed_state"],
            "feed_state_at": snap["feed_state_at"],
            "raw_last_message": snap["raw_last_message"],
            "raw_last_boxs_info": snap["raw_last_boxs_info"],
            "frames": snap["frames"],
        }
    )


@app.route("/tampermonkey.user.js")
def tampermonkey_script():
    mainsail_origin = os.environ.get("MAINSAIL_URL", "http://192.168.1.242:4409/").rstrip("/")
    backend_origin = os.environ.get("BACKEND_PUBLIC_URL", f"http://192.168.1.242:{HTTP_PORT}").rstrip("/")
    script = f"""// ==UserScript==
// @name         K1C CFS Panel for Mainsail
// @namespace    local.k1c.cfs
// @version      0.1.0
// @description  Injeta um painel simples do CFS no Mainsail usando a API do backend externo.
// @match        {mainsail_origin}/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {{
  "use strict";
  window.K1C_CFS_URL = "{backend_origin}";
  if (window.__k1c_cfs_loader_loaded) return;
  window.__k1c_cfs_loader_loaded = true;
  const script = document.createElement("script");
  script.src = window.K1C_CFS_URL + "/static/mainsail-panel.js?ts=" + Date.now();
  document.head.appendChild(script);
}})();
"""
    return app.response_class(script, mimetype="application/javascript")


def main():
    websocket.enableTrace(False)
    ws_client.start()
    app.run(host=HTTP_HOST, port=HTTP_PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
