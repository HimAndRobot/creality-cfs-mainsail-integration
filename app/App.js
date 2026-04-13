import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { StatusBar } from "expo-status-bar";
import jpeg from "jpeg-js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Image,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

const STORAGE_KEY = "k1c-cfs-editor-printers";
const SLOT_LETTERS = ["A", "B", "C", "D"];
const MATERIAL_TYPES = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "OTHER"];
const MATERIAL_PRESETS = {
  PLA: { vendor: "Generic", name: "Generic PLA", tempMin: "190", tempMax: "240" },
  PETG: { vendor: "Generic", name: "Generic PETG", tempMin: "220", tempMax: "260" },
  ABS: { vendor: "Generic", name: "Generic ABS", tempMin: "230", tempMax: "260" },
  ASA: { vendor: "Generic", name: "Generic ASA", tempMin: "240", tempMax: "270" },
  TPU: { vendor: "Generic", name: "Generic TPU", tempMin: "210", tempMax: "240" },
  PA: { vendor: "Generic", name: "Generic PA", tempMin: "240", tempMax: "280" },
  PC: { vendor: "Generic", name: "Generic PC", tempMin: "260", tempMax: "300" },
  OTHER: { vendor: "Generic", name: "Generic Material", tempMin: "200", tempMax: "240" }
};
const COLOR_PRESETS = [
  "#f5f5f5", "#d4d4d8", "#94a3b8", "#171717",
  "#3b82f6", "#2563eb", "#22c55e", "#ef4444",
  "#f59e0b", "#a855f7", "#ec4899", "#14b8a6"
];

function normalizeColorHex(value) {
  const rawValue = String(value || "").trim().toLowerCase();
  if (!rawValue) return "#d1d5db";
  let raw = rawValue;
  if (raw.startsWith("0x")) raw = raw.slice(2);
  if (raw.startsWith("#")) raw = raw.slice(1);
  raw = raw.replace(/[^0-9a-f]/g, "");
  if (!raw) return "#d1d5db";
  if (raw.length === 7 && raw[0] === "0") raw = raw.slice(1);
  else if (raw.length === 8) raw = raw.slice(2);
  else if (raw.length > 8) raw = raw.slice(-6);
  if (raw.length !== 6) return "#d1d5db";
  return "#" + raw;
}

function printerColorValue(value) {
  const color = normalizeColorHex(value);
  return "#0" + color.slice(1);
}

function defaultSlots() {
  return SLOT_LETTERS.map((letter, index) => ({
    slot: `1${letter}`,
    material_index: index,
    box_id: 1,
    present: false,
    selected: false,
    type: "",
    name: "",
    vendor: "",
    color: "#3f3f46",
    temp_min: "",
    temp_max: "",
    rfid: "",
    raw: {}
  }));
}

function coerceTemperatureFields(material) {
  let tempMin = material.minTemp;
  let tempMax = material.maxTemp;
  if (tempMin == null) tempMin = material.nozzleTempMin;
  if (tempMax == null) tempMax = material.nozzleTempMax;
  if (tempMin == null) tempMin = material.minPrintTemp;
  if (tempMax == null) tempMax = material.maxPrintTemp;
  return [tempMin, tempMax];
}

function extractSlots(payload) {
  const slots = defaultSlots();
  const boxsInfo = payload?.boxsInfo || {};
  const materialBoxes = Array.isArray(boxsInfo.materialBoxs) ? boxsInfo.materialBoxs : [];
  const firstCfsBox = materialBoxes.find((box) => box && box.type === 0);

  if (!firstCfsBox) {
    return { slots, humidity: null, temp: null };
  }

  (firstCfsBox.materials || []).forEach((material) => {
    if (!material || typeof material !== "object") return;
    const index = material.id;
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    const [tempMin, tempMax] = coerceTemperatureFields(material);

    slots[index] = {
      slot: `1${SLOT_LETTERS[index]}`,
      material_index: index,
      box_id: Number.isInteger(firstCfsBox.id) ? firstCfsBox.id : 1,
      present: Number(material.state || 0) > 0,
      selected: Number(material.selected || 0) === 1,
      type: String(material.type || "").trim().toUpperCase(),
      name: String(material.name || "").trim(),
      vendor: String(material.vendor || "").trim(),
      color: normalizeColorHex(material.color),
      temp_min: tempMin == null ? "" : String(tempMin),
      temp_max: tempMax == null ? "" : String(tempMax),
      rfid: String(material.rfid || "").trim(),
      raw: material
    };
  });

  return {
    slots,
    humidity: firstCfsBox.humidity == null ? null : Number(firstCfsBox.humidity),
    temp: firstCfsBox.temp == null ? null : Number(firstCfsBox.temp)
  };
}

function base64ToUint8Array(base64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const str = String(base64 || "").replace(/[^A-Za-z0-9+/=]/g, "");
  const out = [];
  for (let i = 0; i < str.length; i += 4) {
    const enc1 = chars.indexOf(str.charAt(i));
    const enc2 = chars.indexOf(str.charAt(i + 1));
    const enc3 = chars.indexOf(str.charAt(i + 2));
    const enc4 = chars.indexOf(str.charAt(i + 3));
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    out.push(chr1);
    if (str.charAt(i + 2) !== "=") out.push(chr2);
    if (str.charAt(i + 3) !== "=") out.push(chr3);
  }
  return Uint8Array.from(out);
}

function colorFromPoint(base64, xRatio, yRatio) {
  const bytes = base64ToUint8Array(base64);
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  const { data, width, height } = decoded;
  const centerX = Math.max(0, Math.min(width - 1, Math.round(width * xRatio)));
  const centerY = Math.max(0, Math.min(height - 1, Math.round(height * yRatio)));
  const radius = Math.max(4, Math.floor(Math.min(width, height) * 0.028));
  const samples = [];

  for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if ((dx * dx) + (dy * dy) > radius * radius) continue;
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (a < 24) continue;
      const brightness = (r + g + b) / 3;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const distance = Math.sqrt((dx * dx) + (dy * dy));
      samples.push({
        r,
        g,
        b,
        brightness,
        chroma,
        distance
      });
    }
  }

  if (!samples.length) return "#d1d5db";

  const centerBrightness = samples
    .filter((sample) => sample.distance <= Math.max(1, radius * 0.45))
    .reduce((acc, sample, _, arr) => acc + (sample.brightness / Math.max(1, arr.length)), 0);

  let filtered = samples;
  if (centerBrightness <= 95) {
    filtered = samples
      .slice()
      .sort((a, b) => a.brightness - b.brightness || a.distance - b.distance)
      .slice(0, Math.max(8, Math.floor(samples.length * 0.35)));
  } else if (centerBrightness <= 145) {
    filtered = samples
      .slice()
      .sort((a, b) => (a.brightness + a.distance * 10) - (b.brightness + b.distance * 10))
      .slice(0, Math.max(8, Math.floor(samples.length * 0.28)));
  } else {
    filtered = samples
      .slice()
      .sort((a, b) => (b.chroma - a.chroma) || (a.distance - b.distance) || (a.brightness - b.brightness))
      .slice(0, Math.max(8, Math.floor(samples.length * 0.2)));
  }

  const total = filtered.reduce((acc, sample) => {
    acc.r += sample.r;
    acc.g += sample.g;
    acc.b += sample.b;
    return acc;
  }, { r: 0, g: 0, b: 0 });
  const r = Math.round(total.r / filtered.length);
  const g = Math.round(total.g / filtered.length);
  const b = Math.round(total.b / filtered.length);
  return "#" + [r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function getContainImageRect(containerWidth, containerHeight, imageWidth, imageHeight) {
  const imageRatio = imageWidth / imageHeight;
  const containerRatio = containerWidth / containerHeight;
  if (imageRatio > containerRatio) {
    const width = containerWidth;
    const height = width / imageRatio;
    return { x: 0, y: (containerHeight - height) / 2, width, height };
  }
  const height = containerHeight;
  const width = height * imageRatio;
  return { x: (containerWidth - width) / 2, y: 0, width, height };
}

function Button({ label, onPress, primary = false }) {
  return (
    <Pressable style={[styles.button, primary && styles.buttonPrimary]} onPress={onPress}>
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, keyboardType = "default" }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={styles.input}
        placeholderTextColor="#6b7280"
      />
    </View>
  );
}

function TopBar({ title, subtitle, leftLabel, onLeftPress, rightLabel, onRightPress }) {
  return (
    <View style={styles.topBar}>
      <View style={styles.topBarSide}>
        {leftLabel ? <Button label={leftLabel} onPress={onLeftPress} /> : <View style={styles.topSpacer} />}
      </View>
      <View style={styles.topBarCenter}>
        <Text style={styles.topBarTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.topBarSubtitle}>{subtitle}</Text>}
      </View>
      <View style={[styles.topBarSide, styles.topBarSideRight]}>
        {rightLabel ? <Button label={rightLabel} primary onPress={onRightPress} /> : <View style={styles.topSpacer} />}
      </View>
    </View>
  );
}

function Stat({ label, value, active = false }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, active && styles.statValueActive]}>{value}</Text>
    </View>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [printers, setPrinters] = useState([]);
  const [activePrinterId, setActivePrinterId] = useState(null);
  const [slots, setSlots] = useState(defaultSlots());
  const [selectedSlot, setSelectedSlot] = useState("");
  const [humidity, setHumidity] = useState(null);
  const [temp, setTemp] = useState(null);
  const [status, setStatus] = useState("Disconnected");
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [latestFeedState, setLatestFeedState] = useState(null);
  const [previousFeedState, setPreviousFeedState] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionSlot, setActionSlot] = useState("");
  const [printerMenu, setPrinterMenu] = useState(null);
  const [screen, setScreen] = useState({ name: "printers" });
  const [printerDraft, setPrinterDraft] = useState({ name: "", host: "" });
  const [editDraft, setEditDraft] = useState({
    type: "PLA",
    vendor: "",
    name: "",
    tempMin: "",
    tempMax: "",
    color: "#d1d5db"
  });
  const [extractingColor, setExtractingColor] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [photoArea, setPhotoArea] = useState({ width: 1, height: 1 });
  const [pickerTarget, setPickerTarget] = useState({ x: 0.5, y: 0.5 });
  const [pickerPreviewColor, setPickerPreviewColor] = useState("#d1d5db");
  const wsRef = useRef(null);
  const pendingActionRef = useRef(null);
  const latestFeedStateRef = useRef(null);
  const slotsRef = useRef(defaultSlots());
  const cameraRef = useRef(null);
  const transition = useRef(new Animated.Value(1)).current;
  const printerMenuAnim = useRef(new Animated.Value(0)).current;

  const activePrinter = useMemo(
    () => printers.find((printer) => printer.id === activePrinterId) || null,
    [printers, activePrinterId]
  );

  const printerList = useMemo(() => {
    return printers.map((printer) => {
      const isActive = printer.id === activePrinterId;
      const isOnline = isActive && status === "Connected";
      const previewSlots = isActive
        ? slots.map((slot) => (slot.present ? slot.color : "#27272a"))
        : ["#f4f4f5", "#ef4444", "#18181b", "#3b82f6"];

      return {
        ...printer,
        isOnline,
        previewSlots
      };
    });
  }, [printers, activePrinterId, status, slots]);

  useEffect(() => {
    pendingActionRef.current = pendingAction;
  }, [pendingAction]);

  useEffect(() => {
    latestFeedStateRef.current = latestFeedState;
  }, [latestFeedState]);

  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  const editingSlot = screen.name === "edit"
    ? screen.slot
    : screen.name === "camera"
      ? screen.slot
      : screen.name === "pick-color"
        ? screen.slot
        : screen.name === "color-picker"
          ? screen.slot
          : null;

  useEffect(() => {
    (async function bootstrap() {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          setPrinters(parsed);
          if (parsed[0]) setActivePrinterId(parsed[0].id);
        }
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(printers)).catch(() => {});
  }, [printers]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setReconnectNonce((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(transition, { toValue: 0, duration: 0, useNativeDriver: true }),
      Animated.timing(transition, { toValue: 1, duration: 220, useNativeDriver: true })
    ]).start();
  }, [screen, transition]);

  useEffect(() => {
    if (selectedSlot && !slots.some((slot) => slot.slot === selectedSlot)) {
      setSelectedSlot("");
    }
  }, [slots, selectedSlot]);

  useEffect(() => {
    if (!pendingAction) return;

    const targetSlotState = pendingAction.targetSlot
      ? slots.find((slot) => slot.slot === pendingAction.targetSlot)
      : null;
    const previousSlotState = pendingAction.previousSelectedSlot
      ? slots.find((slot) => slot.slot === pendingAction.previousSelectedSlot)
      : null;

    let completed = false;
    if (pendingAction.kind === "retract") {
      completed = !!previousSlotState && !previousSlotState.selected;
    } else if (!pendingAction.targetSlot && pendingAction.source === "machine") {
      const anySelectedSlot = slots.find((slot) => slot.selected);
      if (pendingAction.previousSelectedSlot) {
        completed = !!anySelectedSlot && anySelectedSlot.slot !== pendingAction.previousSelectedSlot;
      } else {
        completed = !!anySelectedSlot;
      }
    } else {
      completed = !!targetSlotState && targetSlotState.selected;
    }

    if (completed) {
      setActionSlot("");
      setPendingAction(null);
    }
  }, [slots, pendingAction]);

  useEffect(() => {
    if (!activePrinter) {
      setStatus("Disconnected");
      setSlots(defaultSlots());
      setSelectedSlot("");
      setHumidity(null);
      setTemp(null);
      setLatestFeedState(null);
      setPreviousFeedState(null);
      setPendingAction(null);
      setActionSlot("");
      return undefined;
    }

    setStatus("Connecting");
    const ws = new WebSocket(`ws://${activePrinter.host}:9999`);
    wsRef.current = ws;
    let pollTimer = null;
    let heartbeatTimer = null;
    let reconnectTimer = null;

    ws.onopen = () => {
      setStatus("Connected");
      ws.send(JSON.stringify({ ModeCode: "heart_beat" }));
      ws.send(JSON.stringify({ method: "get", params: { boxsInfo: 1 } }));
      pollTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: "get", params: { boxsInfo: 1 } }));
        }
      }, 3000);
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ModeCode: "heart_beat" }));
        }
      }, 10000);
    };

    ws.onmessage = (event) => {
      const message = event.data;
      if (typeof message === "string" && message.includes("heart_beat")) {
        if (ws.readyState === WebSocket.OPEN) ws.send("ok");
        return;
      }
      if (message === "ok") return;
      try {
        const parsed = JSON.parse(message);
        if (Object.prototype.hasOwnProperty.call(parsed, "feedState")) {
          const nextFeedState = parsed.feedState;
          const previous = latestFeedStateRef.current;
          if (!pendingActionRef.current && previous !== nextFeedState) {
            startExternalActionFromFeedState(nextFeedState);
          }
          setPreviousFeedState(previous);
          setLatestFeedState(nextFeedState);
          latestFeedStateRef.current = nextFeedState;
        }
        if (parsed?.boxsInfo) {
          const extracted = extractSlots(parsed);
          setSlots(extracted.slots);
          setHumidity(extracted.humidity);
          setTemp(extracted.temp);
        }
      } catch (_) {}
    };

    ws.onerror = () => setStatus("Error");
    ws.onclose = () => {
      setStatus("Disconnected");
      reconnectTimer = setTimeout(() => {
        setReconnectNonce((value) => value + 1);
      }, 1200);
    };

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws.close(); } catch (_) {}
      wsRef.current = null;
    };
  }, [activePrinter, reconnectNonce]);

  function navigate(next) {
    setScreen(next);
  }

  function sendJson(payload) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
    wsRef.current.send(JSON.stringify(payload));
    return true;
  }

  function requestBoxInfo() {
    sendJson({ method: "get", params: { boxsInfo: 1 } });
  }

  function startExternalActionFromFeedState(feedState) {
    if (pendingActionRef.current) return;
    if (typeof feedState !== "number" || feedState <= 0) return;

    const currentLoadedSlot = slotsRef.current.find((slot) => slot.selected);
    const previousSelectedSlot = currentLoadedSlot ? currentLoadedSlot.slot : "";

    if (feedState >= 111 && feedState <= 113) {
      const next = {
        type: "retract",
        kind: "retract",
        targetSlot: "",
        previousSelectedSlot,
        startedAt: Date.now(),
        source: "machine"
      };
      setPendingAction(next);
      setActionSlot(previousSelectedSlot || "__machine__");
      return;
    }

    if (feedState >= 102 && feedState <= 107) {
      const next = {
        type: "feed",
        kind: previousSelectedSlot ? "switch" : "feed",
        targetSlot: "",
        previousSelectedSlot,
        startedAt: Date.now(),
        source: "machine"
      };
      setPendingAction(next);
      setActionSlot("__machine__");
    }
  }

  function savePrinter() {
    const name = printerDraft.name.trim();
    const host = printerDraft.host.trim();
    if (!name || !host) return;
    const printer = { id: `printer-${Date.now()}`, name, host };
    const next = [...printers, printer];
    setPrinters(next);
    setActivePrinterId(printer.id);
    setPrinterDraft({ name: "", host: "" });
    navigate({ name: "printers" });
  }

  function openPrinter(printer) {
    setActivePrinterId(printer.id);
    setSelectedSlot("");
    navigate({ name: "printer" });
  }

  function openPrinterMenu(printer) {
    setPrinterMenu(printer);
    printerMenuAnim.setValue(0);
    Animated.timing(printerMenuAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true
    }).start();
  }

  function closePrinterMenu() {
    Animated.timing(printerMenuAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true
    }).start(() => setPrinterMenu(null));
  }

  function removePrinterById(printerId) {
    const printer = printers.find((item) => item.id === printerId);
    if (!printer) return;
    const next = printers.filter((item) => item.id !== printerId);
    setPrinters(next);
    if (activePrinterId === printerId) {
      setActivePrinterId(next[0]?.id || null);
    }
    setSelectedSlot("");
    closePrinterMenu();
    navigate({ name: "printers" });
  }

  function openEdit(slot) {
    setEditDraft({
      type: slot.type || "PLA",
      vendor: slot.vendor || "",
      name: slot.name || "",
      tempMin: slot.temp_min || "",
      tempMax: slot.temp_max || "",
      color: normalizeColorHex(slot.color)
    });
    navigate({ name: "edit", slot });
  }

  async function runSlotAction(slot, action) {
    if (!slot || !action || actionSlot) return;
    const currentLoadedSlot = slots.find((item) => item.selected);
    const previousSelectedSlot = currentLoadedSlot ? currentLoadedSlot.slot : "";
    const actionKind = action === "retract"
      ? "retract"
      : (previousSelectedSlot && previousSelectedSlot !== slot.slot ? "switch" : "feed");

    setPendingAction({
      type: action,
      kind: actionKind,
      targetSlot: slot.slot,
      previousSelectedSlot,
      startedAt: Date.now(),
      source: "panel"
    });
    setActionSlot(slot.slot);

    try {
      const ok = sendJson({
        method: "set",
        params: {
          feedInOrOut: {
            boxId: slot.box_id || 1,
            materialId: slot.material_index,
            isFeed: action === "feed" ? 1 : 0
          }
        }
      });
      if (!ok) throw new Error("WebSocket not connected");
      setTimeout(requestBoxInfo, 300);
    } catch (_) {
      setActionSlot("");
      setPendingAction(null);
      Alert.alert("Could not run this action.");
    }
  }

  function applyPreset(type) {
    const preset = MATERIAL_PRESETS[type] || MATERIAL_PRESETS.OTHER;
    setEditDraft((current) => ({
      ...current,
      type,
      vendor: current.vendor || preset.vendor,
      name: current.name || preset.name,
      tempMin: current.tempMin || String(preset.tempMin),
      tempMax: current.tempMax || String(preset.tempMax)
    }));
  }

  function updateDraftColor(value) {
    const next = normalizeColorHex(value || "");
    setEditDraft((current) => ({ ...current, color: next || current.color }));
  }

  async function updatePickerPreviewFromArea(nextX, nextY) {
    if (!capturedPhoto?.uri || !capturedPhoto?.width || !capturedPhoto?.height) return;
    try {
      const targetX = nextX * Math.max(1, photoArea.width);
      const targetY = nextY * Math.max(1, photoArea.height);
      const localX = Math.max(0, Math.min(photoContainRect.width, targetX - photoContainRect.x));
      const localY = Math.max(0, Math.min(photoContainRect.height, targetY - photoContainRect.y));
      const xRatio = photoContainRect.width <= 0 ? 0.5 : localX / photoContainRect.width;
      const yRatio = photoContainRect.height <= 0 ? 0.5 : localY / photoContainRect.height;
      const centerX = Math.round(capturedPhoto.width * xRatio);
      const centerY = Math.round(capturedPhoto.height * yRatio);
      const cropSize = Math.max(48, Math.floor(Math.min(capturedPhoto.width, capturedPhoto.height) * 0.04));
      const originX = Math.max(0, Math.min(capturedPhoto.width - cropSize, centerX - Math.floor(cropSize / 2)));
      const originY = Math.max(0, Math.min(capturedPhoto.height - cropSize, centerY - Math.floor(cropSize / 2)));

      const cropped = await ImageManipulator.manipulateAsync(
        capturedPhoto.uri,
        [{ crop: { originX, originY, width: cropSize, height: cropSize } }],
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!cropped.base64) return;
      const color = colorFromPoint(cropped.base64, 0.5, 0.5);
      setPickerPreviewColor(color);
    } catch (_) {}
  }

  async function openCamera(slot) {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    if (!permission?.granted) {
      Alert.alert("Camera permission required");
      return;
    }
    navigate({ name: "camera", slot });
  }

  async function capturePhoto() {
    try {
      if (!cameraRef.current) return;
      const rawResult = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.45,
        skipProcessing: true
      });
      if (!rawResult?.uri || !editingSlot) return;

      const maxDimension = 1200;
      const resizeAction =
        rawResult.width >= rawResult.height
          ? { resize: { width: Math.min(maxDimension, rawResult.width || maxDimension) } }
          : { resize: { height: Math.min(maxDimension, rawResult.height || maxDimension) } };

      const result = await ImageManipulator.manipulateAsync(
        rawResult.uri,
        [resizeAction],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!result?.base64 || !result?.uri) return;
      setCapturedPhoto(result);
      setPickerTarget({ x: 0.5, y: 0.5 });
      setPickerPreviewColor("#d1d5db");
      navigate({ name: "pick-color", slot: editingSlot });
    } catch (_) {
      Alert.alert("Could not capture the photo.");
    }
  }

  async function confirmColorPick() {
    if (!capturedPhoto?.uri) return;
    try {
      setExtractingColor(true);
      const color = normalizeColorHex(pickerPreviewColor) || "#d1d5db";
      setEditDraft((current) => ({ ...current, color }));
      setCapturedPhoto(null);
      navigate({ name: "edit", slot: editingSlot });
    } catch (_) {
      Alert.alert("Could not extract color from this point.");
    } finally {
      setExtractingColor(false);
    }
  }

  function saveFilament() {
    if (!editingSlot || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const payload = {
      method: "set",
      params: {
        modifyMaterial: {
          boxId: editingSlot.box_id || 1,
          id: editingSlot.material_index,
          rfid: String(editingSlot.rfid || ""),
          type: String(editDraft.type || "").trim().toUpperCase(),
          vendor: String(editDraft.vendor || "").trim(),
          name: String(editDraft.name || "").trim(),
          color: printerColorValue(editDraft.color),
          minTemp: Number(editDraft.tempMin || 0),
          maxTemp: Number(editDraft.tempMax || 0),
          pressure: Number(editingSlot.raw?.pressure != null ? editingSlot.raw.pressure : 0.04)
        }
      }
    };
    wsRef.current.send(JSON.stringify(payload));
    navigate({ name: "printer" });
    setTimeout(requestBoxInfo, 250);
  }

  const animatedStyle = {
    opacity: transition,
    transform: [{
      translateY: transition.interpolate({ inputRange: [0, 1], outputRange: [10, 0] })
    }]
  };

  const selectedSlotData = slots.find((slot) => slot.slot === selectedSlot) || null;
  const currentLoadedSlot = slots.find((slot) => slot.selected) || null;
  const currentLoadedSlotName = currentLoadedSlot ? currentLoadedSlot.slot : "";
  const actionLocked = !!pendingAction;
  const externalFeedPending = !!pendingAction
    && pendingAction.source === "machine"
    && pendingAction.kind !== "retract"
    && !pendingAction.targetSlot;
  const canFeed = !!selectedSlotData && selectedSlotData.present && !selectedSlotData.selected && !actionLocked && !actionSlot;
  const canRetract = !!selectedSlotData && selectedSlotData.present && !actionLocked && !actionSlot;
  const photoContainRect = useMemo(() => {
    if (!capturedPhoto?.width || !capturedPhoto?.height) {
      return { x: 0, y: 0, width: Math.max(1, photoArea.width), height: Math.max(1, photoArea.height) };
    }
    return getContainImageRect(
      Math.max(1, photoArea.width),
      Math.max(1, photoArea.height),
      capturedPhoto.width,
      capturedPhoto.height
    );
  }, [capturedPhoto, photoArea.height, photoArea.width]);

  useEffect(() => {
    if (screen.name !== "pick-color" || !capturedPhoto?.base64) return;
    updatePickerPreviewFromArea(pickerTarget.x, pickerTarget.y);
  }, [capturedPhoto, pickerTarget.x, pickerTarget.y, photoArea.height, photoArea.width, photoContainRect.height, photoContainRect.width, photoContainRect.x, photoContainRect.y, screen.name]);

  const targetPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      const nextX = Math.max(photoContainRect.x, Math.min(photoContainRect.x + photoContainRect.width, locationX)) / Math.max(1, photoArea.width);
      const nextY = Math.max(photoContainRect.y, Math.min(photoContainRect.y + photoContainRect.height, locationY)) / Math.max(1, photoArea.height);
      setPickerTarget({ x: nextX, y: nextY });
      updatePickerPreviewFromArea(nextX, nextY);
    },
    onPanResponderMove: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      const nextX = Math.max(photoContainRect.x, Math.min(photoContainRect.x + photoContainRect.width, locationX)) / Math.max(1, photoArea.width);
      const nextY = Math.max(photoContainRect.y, Math.min(photoContainRect.y + photoContainRect.height, locationY)) / Math.max(1, photoArea.height);
      setPickerTarget({ x: nextX, y: nextY });
      updatePickerPreviewFromArea(nextX, nextY);
    }
  }), [capturedPhoto, photoArea.width, photoArea.height, photoContainRect.x, photoContainRect.y, photoContainRect.width, photoContainRect.height]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <Animated.View style={[styles.screen, animatedStyle, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
        {screen.name === "printers" && (
          <View style={styles.printersScreen}>
            <ScrollView contentContainerStyle={styles.printersPage} showsVerticalScrollIndicator={false}>
              <View style={styles.printersHeader}>
                <Text style={styles.printersTitle}>Your Printers</Text>
                <Text style={styles.printersSubtitle}>K1C CFS Editor</Text>
              </View>

              {printerList.length === 0 ? (
                <View style={styles.emptyStateShell}>
                  <Pressable style={styles.emptyState} onPress={() => navigate({ name: "add-printer" })}>
                    <View style={styles.emptyIconWrap}>
                      <View style={styles.emptyIconCircle}>
                        <Text style={styles.emptyIconPrinter}>▣</Text>
                      </View>
                      <View style={styles.emptyIconPlus}>
                        <Text style={styles.emptyIconPlusText}>+</Text>
                      </View>
                    </View>

                    <Text style={styles.emptyTitle}>No printers found</Text>
                    <Text style={styles.emptyText}>
                      Add your K1C printer to start managing your filaments and colors in the CFS.
                    </Text>

                    <View style={styles.emptyActionButton}>
                      <Text style={styles.emptyActionPlus}>+</Text>
                      <Text style={styles.emptyActionText}>Add First Printer</Text>
                    </View>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.printerList}>
                  {printerList.map((printer) => (
                    <Pressable
                      key={printer.id}
                      style={styles.printerCard}
                      onPress={() => openPrinter(printer)}
                      onLongPress={() => openPrinterMenu(printer)}
                      delayLongPress={350}
                    >
                      <View style={styles.printerCardTop}>
                        <View style={styles.printerCardTextBlock}>
                          <View style={styles.printerMetaRow}>
                            <Text style={styles.cardEyebrow}>Printer</Text>
                            <View style={[styles.statusPill, printer.isOnline ? styles.statusPillOnline : styles.statusPillOffline]}>
                              <Text style={[styles.statusDot, printer.isOnline ? styles.statusDotOnline : styles.statusDotOffline]}>●</Text>
                              <Text style={[styles.statusPillText, printer.isOnline ? styles.statusPillTextOnline : styles.statusPillTextOffline]}>
                                {printer.isOnline ? "Online" : "Offline"}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.printerName}>{printer.name}</Text>
                          <Text style={styles.printerHost}>{printer.host}</Text>
                        </View>

                        <View style={styles.chevronBubble}>
                          <Text style={styles.chevronText}>›</Text>
                        </View>
                      </View>

                      <View style={styles.printerCardFooter}>
                        <Text style={styles.cfsLabel}>CFS Status</Text>
                        <View style={styles.cfsDotsWrap}>
                          {printer.previewSlots.map((color, index) => (
                            <View
                              key={`${printer.id}-${index}`}
                              style={[styles.cfsDot, { backgroundColor: color }]}
                            />
                          ))}
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}

            </ScrollView>

            <Pressable style={styles.fab} onPress={() => navigate({ name: "add-printer" })}>
              <Text style={styles.fabText}>+</Text>
            </Pressable>
          </View>
        )}

        {screen.name === "add-printer" && (
          <View style={styles.editScreen}>
            <ScrollView contentContainerStyle={styles.editPage} showsVerticalScrollIndicator={false}>
              <View style={styles.printerHeader}>
                <Pressable style={styles.backCircle} onPress={() => navigate({ name: "printers" })}>
                  <Text style={styles.backCircleText}>‹</Text>
                </Pressable>

                <View style={styles.printerHeaderCenter}>
                  <Text style={styles.printerHeaderTitle}>Add Printer</Text>
                  <Text style={styles.printerHeaderIp}>Name and IP address</Text>
                </View>

                <Pressable style={styles.saveCircle} onPress={savePrinter}>
                  <Text style={styles.saveCircleText}>Save</Text>
                </Pressable>
              </View>

              <View style={styles.editFormCard}>
                <View style={styles.largeField}>
                  <Text style={styles.fieldLabel}>Name</Text>
                  <TextInput
                    value={printerDraft.name}
                    onChangeText={(value) => setPrinterDraft((d) => ({ ...d, name: value }))}
                    style={styles.largeInput}
                    placeholder="K1C Office"
                    placeholderTextColor="#6b7280"
                  />
                </View>
                <View style={styles.largeField}>
                  <Text style={styles.fieldLabel}>IP or host</Text>
                  <TextInput
                    value={printerDraft.host}
                    onChangeText={(value) => setPrinterDraft((d) => ({ ...d, host: value }))}
                    style={styles.largeInput}
                    placeholder="192.168.1.242"
                    placeholderTextColor="#6b7280"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>
            </ScrollView>
          </View>
        )}

        {screen.name === "printer" && (
          <View style={styles.printerScreen}>
            <ScrollView contentContainerStyle={styles.printerPage} showsVerticalScrollIndicator={false}>
              <View style={styles.printerHeader}>
                <Pressable style={styles.backCircle} onPress={() => navigate({ name: "printers" })}>
                  <Text style={styles.backCircleText}>‹</Text>
                </Pressable>

                <View style={styles.printerHeaderCenter}>
                  <Text style={styles.printerHeaderTitle}>{activePrinter?.name || "Printer"}</Text>
                  <Text style={styles.printerHeaderIp}>{activePrinter?.host || ""}</Text>
                </View>

                <View style={styles.backCircleGhost} />
              </View>

              <View style={styles.compactStatsRow}>
                <View style={styles.compactStatCard}>
                  <View style={styles.compactStatIconBox}>
                    <Text style={styles.compactStatIcon}>💧</Text>
                  </View>
                  <View style={styles.compactStatTextBlock}>
                    <Text style={styles.compactStatLabel}>Humidity</Text>
                    <Text style={styles.compactStatValue}>{humidity == null ? "--%" : `${Math.round(humidity)}%`}</Text>
                  </View>
                </View>

                <View style={styles.compactStatCard}>
                  <View style={styles.compactStatIconBox}>
                    <View style={styles.tempGlyph}>
                      <View style={styles.tempGlyphStem} />
                      <View style={styles.tempGlyphBulb} />
                    </View>
                  </View>
                  <View style={styles.compactStatTextBlock}>
                    <Text style={styles.compactStatLabel}>Temp</Text>
                    <Text style={styles.compactStatValue}>{temp == null ? "--°C" : `${Math.round(temp)}°C`}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.filamentsHeaderRow}>
                <Text style={styles.sectionLabel}>Filaments</Text>
              </View>

              <View style={styles.slotList}>
                {slots.map((slot) => {
                  const isSelected = selectedSlot === slot.slot;
                  const slotIsPending = actionLocked && !!pendingAction
                    && (pendingAction.targetSlot === slot.slot || pendingAction.previousSelectedSlot === slot.slot);

                  return (
                    <Pressable
                      key={slot.slot}
                      style={[
                        styles.slotListCard,
                        isSelected && styles.slotListCardSelected,
                        !slot.present && styles.slotListCardEmpty
                      ]}
                      onPress={() => slot.present && setSelectedSlot(isSelected ? "" : slot.slot)}
                    >
                      <View style={styles.slotCardContent}>
                        <View style={styles.slotMain}>
                          <View style={[styles.spool, { backgroundColor: slot.present ? (slot.color || "#3f3f46") : "#27272a" }]}>
                            {slot.selected && !slotIsPending && <View style={styles.loadedDotLarge} />}
                            {slotIsPending && (
                              <View style={styles.loadingDotShell}>
                                <ActivityIndicator size="small" color="#60a5fa" />
                              </View>
                            )}
                          </View>

                          <View style={styles.slotInfo}>
                            <Text style={[styles.slotChannel, isSelected && styles.slotChannelSelected]}>
                              Channel {slot.slot}
                            </Text>
                            <Text style={styles.slotType}>
                              {slot.present ? (slot.type || "Unknown") : "Empty"}
                            </Text>
                            <Text style={styles.slotMeta}>
                              {slot.present
                                ? ([slot.vendor, slot.name].filter(Boolean).join(" · ") || "Tap to edit")
                                : "No filament"}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.slotActions}>
                          <Pressable
                            onPress={(event) => {
                              event.stopPropagation();
                              if (slot.present) openEdit(slot);
                            }}
                            style={styles.editIconButton}
                          >
                            <Text style={styles.editIconText}>✎</Text>
                          </Pressable>

                          <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                            {isSelected && <View style={styles.radioInner} />}
                          </View>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {!!selectedSlotData && (
              <View style={[styles.bottomBar, { paddingBottom: insets.bottom > 0 ? 6 : 8 }]}>
                <View style={styles.bottomActions}>
                  <Pressable
                    style={[styles.actionButton, styles.retractButton, !canRetract && styles.actionButtonDisabled]}
                    disabled={!canRetract}
                    onPress={() => selectedSlotData && runSlotAction(selectedSlotData, "retract")}
                  >
                    <Text style={[styles.actionIcon, !canRetract && styles.actionIconDisabled]}>↑</Text>
                    <Text style={[styles.actionText, !canRetract && styles.actionTextDisabled]}>Retract</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.actionButton, styles.feedButton, !canFeed && styles.actionButtonDisabled]}
                    disabled={!canFeed}
                    onPress={() => selectedSlotData && runSlotAction(selectedSlotData, "feed")}
                  >
                    {externalFeedPending ? (
                      <View style={styles.buttonLoadingWrap}>
                        <ActivityIndicator size="small" color="#60a5fa" />
                        <Text style={[styles.feedActionText, !canFeed && styles.actionTextDisabled]}>Loading</Text>
                      </View>
                    ) : (
                      <>
                        <Text style={[styles.actionIcon, styles.feedActionIcon, !canFeed && styles.actionIconDisabled]}>↓</Text>
                        <Text style={[styles.feedActionText, !canFeed && styles.actionTextDisabled]}>
                          {selectedSlotData?.present && currentLoadedSlotName && !selectedSlotData?.selected ? "Switch" : "Feed"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>

                <Text style={styles.helperText}>
                  {`Channel ${selectedSlot} selected for actions.`}
                </Text>
              </View>
            )}
          </View>
        )}

        {screen.name === "edit" && editingSlot && (
          <View style={styles.editScreen}>
            <ScrollView contentContainerStyle={styles.editPage} showsVerticalScrollIndicator={false}>
              <View style={styles.printerHeader}>
                <Pressable style={styles.backCircle} onPress={() => navigate({ name: "printer" })}>
                  <Text style={styles.backCircleText}>‹</Text>
                </Pressable>

                <View style={styles.printerHeaderCenter}>
                  <Text style={styles.printerHeaderTitle}>{editDraft.type || editingSlot.type || "Filament"}</Text>
                  <Text style={styles.printerHeaderIp}>Channel {editingSlot.slot}</Text>
                </View>

                <Pressable style={styles.saveCircle} onPress={saveFilament}>
                  <Text style={styles.saveCircleText}>Save</Text>
                </Pressable>
              </View>

              <View style={styles.editColorCard}>
                <Pressable style={styles.editColorButton} onPress={() => navigate({ name: "color-picker", slot: editingSlot })}>
                  <View style={[styles.editColorBubble, { backgroundColor: editDraft.color }]} />
                </Pressable>

                <View style={styles.editColorInfo}>
                  <Text style={styles.editColorTitle}>Spool color</Text>
                  <Text style={styles.editColorHex}>{editDraft.color.toUpperCase()}</Text>
                  <Text style={styles.editColorHint}>Take a photo, then tap the exact spool color.</Text>
                  <Pressable style={styles.cameraActionButton} onPress={() => openCamera(editingSlot)}>
                    <Text style={styles.cameraActionText}>Open Camera</Text>
                  </Pressable>
                </View>
              </View>

              <Text style={styles.sectionLabel}>Material Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow}>
                {MATERIAL_TYPES.map((type) => (
                  <Pressable
                    key={type}
                    style={[styles.typeChip, editDraft.type === type && styles.typeChipActive]}
                    onPress={() => applyPreset(type)}
                  >
                    <Text style={[styles.typeChipText, editDraft.type === type && styles.typeChipTextActive]}>{type}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={styles.editFormCard}>
                <Field label="Vendor" value={editDraft.vendor} onChangeText={(value) => setEditDraft((d) => ({ ...d, vendor: value }))} />
                <Field label="Name" value={editDraft.name} onChangeText={(value) => setEditDraft((d) => ({ ...d, name: value }))} />
                <View style={styles.tempFieldsRow}>
                  <View style={styles.tempFieldCol}>
                    <Field label="Min Temp" value={editDraft.tempMin} keyboardType="numeric" onChangeText={(value) => setEditDraft((d) => ({ ...d, tempMin: value }))} />
                  </View>
                  <View style={styles.tempFieldCol}>
                    <Field label="Max Temp" value={editDraft.tempMax} keyboardType="numeric" onChangeText={(value) => setEditDraft((d) => ({ ...d, tempMax: value }))} />
                  </View>
                </View>
              </View>
            </ScrollView>
          </View>
        )}

        {screen.name === "camera" && editingSlot && (
          <View style={styles.cameraPage}>
            <View style={styles.printerHeader}>
              <Pressable style={styles.backCircle} onPress={() => navigate({ name: "edit", slot: editingSlot })}>
                <Text style={styles.backCircleText}>‹</Text>
              </Pressable>
              <View style={styles.printerHeaderCenter}>
                <Text style={styles.printerHeaderTitle}>Camera</Text>
                <Text style={styles.printerHeaderIp}>Capture the spool</Text>
              </View>
              <View style={styles.backCircleGhost} />
            </View>
            <View style={styles.cameraFrame}>
              {cameraPermission?.granted ? (
                <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back" />
              ) : (
                <View style={styles.cameraFallback}>
                  <Text style={styles.emptyText}>Camera permission required.</Text>
                </View>
              )}
            </View>
            <Text style={styles.cameraHint}>Center the spool color and capture it.</Text>
            <Pressable style={styles.captureButton} onPress={capturePhoto}>
              <View style={styles.captureInner} />
            </Pressable>
          </View>
        )}

        {screen.name === "pick-color" && editingSlot && capturedPhoto && (
          <View style={styles.cameraPage}>
            <View style={styles.printerHeader}>
              <Pressable style={styles.backCircle} onPress={() => navigate({ name: "camera", slot: editingSlot })}>
                <Text style={styles.backCircleText}>‹</Text>
              </Pressable>
              <View style={styles.printerHeaderCenter}>
                <Text style={styles.printerHeaderTitle}>Pick Color</Text>
                <Text style={styles.printerHeaderIp}>Move the target to the spool color</Text>
              </View>
              <View style={styles.backCircleGhost} />
            </View>
            <Text style={styles.cameraHint}>Move the point to the area you want to capture.</Text>
            <View style={styles.pickPreviewCard}>
              <View style={[styles.pickPreviewSwatch, { backgroundColor: pickerPreviewColor }]} />
              <View style={styles.pickPreviewTextWrap}>
                <Text style={styles.pickPreviewLabel}>Selected area color</Text>
                <Text style={styles.pickPreviewValue}>{pickerPreviewColor.toUpperCase()}</Text>
              </View>
            </View>
            <View
              style={styles.photoArea}
              onLayout={(event) => setPhotoArea(event.nativeEvent.layout)}
              {...targetPanResponder.panHandlers}
            >
              <Image source={{ uri: capturedPhoto.uri }} style={styles.photoImage} resizeMode="contain" />
              <View
                pointerEvents="none"
                style={[
                  styles.pickTarget,
                  {
                    left: pickerTarget.x * Math.max(1, photoArea.width),
                    top: pickerTarget.y * Math.max(1, photoArea.height)
                  }
                ]}
              >
                <View style={styles.pickTargetCore} />
              </View>
            </View>
            <Pressable style={styles.selectColorButton} onPress={confirmColorPick}>
              <Text style={styles.selectColorButtonText}>Select</Text>
            </Pressable>
          </View>
        )}

        {screen.name === "color-picker" && editingSlot && (
          <View style={styles.cameraPage}>
            <View style={styles.printerHeader}>
              <Pressable style={styles.backCircle} onPress={() => navigate({ name: "edit", slot: editingSlot })}>
                <Text style={styles.backCircleText}>‹</Text>
              </Pressable>
              <View style={styles.printerHeaderCenter}>
                <Text style={styles.printerHeaderTitle}>Choose Color</Text>
                <Text style={styles.printerHeaderIp}>Pick a preset or type a hex color</Text>
              </View>
              <Pressable style={styles.saveCircle} onPress={() => navigate({ name: "edit", slot: editingSlot })}>
                <Text style={styles.saveCircleText}>Done</Text>
              </Pressable>
            </View>

            <View style={styles.colorModalCard}>
              <Text style={styles.colorModalTitle}>Choose Color</Text>
              <Text style={styles.colorModalSubtitle}>Tap a preset or type a hex color.</Text>

              <View style={styles.colorPresetGrid}>
                {COLOR_PRESETS.map((color) => (
                  <Pressable
                    key={color}
                    style={[
                      styles.colorPreset,
                      { backgroundColor: color },
                      editDraft.color.toLowerCase() === color.toLowerCase() && styles.colorPresetActive
                    ]}
                    onPress={() => updateDraftColor(color)}
                  />
                ))}
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Hex Color</Text>
                <TextInput
                  value={editDraft.color}
                  onChangeText={updateDraftColor}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  placeholder="#3b82f6"
                  placeholderTextColor="#6b7280"
                />
              </View>
            </View>
          </View>
        )}

        {extractingColor && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <View style={styles.loadingOverlayCard}>
              <ActivityIndicator size="small" color="#79a9ff" />
              <Text style={styles.loadingText}>Extracting color around the selected point…</Text>
            </View>
          </View>
        )}

        {!!printerMenu && (
          <View style={styles.menuOverlay}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={closePrinterMenu} />
            <Animated.View
              style={[
                styles.printerMenuSheet,
                {
                  opacity: printerMenuAnim,
                  transform: [{
                    translateY: printerMenuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [30, 0]
                    })
                  }]
                }
              ]}
            >
              <View style={styles.printerMenuHandle} />
              <Text style={styles.printerMenuTitle}>{printerMenu.name}</Text>
              <Text style={styles.printerMenuSubtitle}>{printerMenu.host}</Text>

              <Pressable style={styles.printerMenuDanger} onPress={() => removePrinterById(printerMenu.id)}>
                <Text style={styles.printerMenuDangerText}>Remove Printer</Text>
              </Pressable>

              <Pressable style={styles.printerMenuCancel} onPress={closePrinterMenu}>
                <Text style={styles.printerMenuCancelText}>Cancel</Text>
              </Pressable>
            </Animated.View>
          </View>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#131313" },
  screen: { flex: 1 },
  page: { paddingHorizontal: 18, paddingBottom: 18, gap: 16 },
  printersScreen: { flex: 1, position: "relative" },
  printersPage: { paddingHorizontal: 20, paddingBottom: 120 },
  printersHeader: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 14,
    paddingBottom: 24
  },
  printersTitle: { color: "#ffffff", fontSize: 28, fontWeight: "900", letterSpacing: 0.2 },
  printersSubtitle: { color: "#71717a", fontSize: 14, fontWeight: "700", marginTop: 4 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
    gap: 12
  },
  topBarSide: { minWidth: 88 },
  topBarSideRight: { alignItems: "flex-end" },
  topBarCenter: { flex: 1, alignItems: "center" },
  topBarTitle: { color: "#f3f4f6", fontSize: 20, fontWeight: "900" },
  topBarSubtitle: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
  topSpacer: { width: 72, height: 1 },
  button: {
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16
  },
  buttonPrimary: { backgroundColor: "#315cff", borderColor: "#315cff" },
  buttonText: { color: "#f3f4f6", fontWeight: "800", fontSize: 15 },
  buttonTextPrimary: { color: "#fff" },
  emptyStateShell: {
    flex: 1,
    minHeight: 520,
    justifyContent: "center"
  },
  emptyState: {
    minHeight: 380,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 32
  },
  emptyIconWrap: {
    width: 120,
    height: 120,
    marginBottom: 26,
    alignItems: "center",
    justifyContent: "center"
  },
  emptyIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 999,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "rgba(63,63,70,0.55)",
    alignItems: "center",
    justifyContent: "center"
  },
  emptyIconPrinter: {
    color: "#52525b",
    fontSize: 34,
    fontWeight: "700"
  },
  emptyIconPlus: {
    position: "absolute",
    right: 12,
    bottom: 4,
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: "#2563eb",
    borderWidth: 4,
    borderColor: "#09090b",
    alignItems: "center",
    justifyContent: "center"
  },
  emptyIconPlusText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 22
  },
  emptyTitle: { color: "#e4e4e7", fontSize: 25, fontWeight: "900", marginBottom: 10 },
  emptyText: { color: "#71717a", fontSize: 14, textAlign: "center", lineHeight: 22, maxWidth: 260 },
  emptyActionButton: {
    marginTop: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#f4f4f5",
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 14
  },
  emptyActionPlus: { color: "#09090b", fontSize: 20, fontWeight: "900", lineHeight: 20 },
  emptyActionText: { color: "#09090b", fontSize: 16, fontWeight: "900" },
  stack: { gap: 12 },
  printerList: { gap: 16 },
  printerCard: {
    backgroundColor: "rgba(24,24,27,0.96)",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 28,
    padding: 20
  },
  printerCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 18
  },
  printerCardTextBlock: { flex: 1, paddingRight: 16 },
  printerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    flexWrap: "wrap"
  },
  cardEyebrow: {
    color: "#71717a",
    textTransform: "uppercase",
    letterSpacing: 2.2,
    fontSize: 10,
    fontWeight: "800",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  statusPillOnline: { backgroundColor: "rgba(52,211,153,0.1)" },
  statusPillOffline: { backgroundColor: "rgba(244,63,94,0.1)" },
  statusDot: { fontSize: 9, lineHeight: 10 },
  statusDotOnline: { color: "#34d399" },
  statusDotOffline: { color: "#fb7185" },
  statusPillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  statusPillTextOnline: { color: "#6ee7b7" },
  statusPillTextOffline: { color: "#fda4af" },
  printerName: { color: "#ffffff", fontSize: 34, fontWeight: "900", marginBottom: 4 },
  printerHost: { color: "#a1a1aa", fontSize: 14, fontWeight: "600" },
  chevronBubble: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: "#27272a",
    alignItems: "center",
    justifyContent: "center"
  },
  chevronText: { color: "#a1a1aa", fontSize: 24, fontWeight: "700", marginTop: -2 },
  arrow: { color: "#7c3aed", fontSize: 28, fontWeight: "700" },
  printerCardFooter: {
    marginTop: 2,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: "rgba(63,63,70,0.55)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  cfsLabel: { color: "#71717a", fontSize: 12, fontWeight: "700" },
  cfsDotsWrap: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#09090b",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(39,39,42,0.75)",
    paddingHorizontal: 9,
    paddingVertical: 7
  },
  cfsDot: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)"
  },
  sheet: {
    backgroundColor: "#1d1d1d",
    borderRadius: 24,
    padding: 18,
    gap: 14
  },
  sheetTitle: { color: "#f3f4f6", fontSize: 24, fontWeight: "900" },
  sheetActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  statsRow: { flexDirection: "row", gap: 10 },
  printerScreen: { flex: 1 },
  printerPage: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 168 },
  editScreen: { flex: 1 },
  editPage: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 28, gap: 18 },
  printerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(39,39,42,0.45)",
    marginBottom: 24
  },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#27272a",
    alignItems: "center",
    justifyContent: "center"
  },
  backCircleText: { color: "#d4d4d8", fontSize: 28, lineHeight: 30, marginTop: -2 },
  backCircleGhost: { width: 40, height: 40 },
  saveCircle: {
    minWidth: 58,
    height: 40,
    borderRadius: 999,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14
  },
  saveCircleText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  printerHeaderCenter: { alignItems: "center", justifyContent: "center" },
  printerHeaderTitle: { color: "#ffffff", fontSize: 22, fontWeight: "900" },
  printerHeaderIp: { color: "#71717a", fontSize: 12, marginTop: 3 },
  compactStatsRow: { flexDirection: "row", gap: 12, marginBottom: 24 },
  compactStatCard: {
    flex: 1,
    backgroundColor: "rgba(24,24,27,0.8)",
    borderWidth: 1,
    borderColor: "rgba(39,39,42,0.75)",
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  compactStatIconBox: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible"
  },
  compactStatIcon: {
    color: "#60a5fa",
    fontSize: 24,
    lineHeight: 26,
    textAlign: "center"
  },
  tempGlyph: {
    width: 16,
    height: 22,
    alignItems: "center",
    justifyContent: "flex-end"
  },
  tempGlyphStem: {
    position: "absolute",
    top: 1,
    width: 8,
    height: 13,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#fbbf24",
    backgroundColor: "transparent"
  },
  tempGlyphBulb: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: "#fbbf24"
  },
  compactStatTextBlock: { alignItems: "center" },
  compactStatLabel: {
    color: "#71717a",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5
  },
  compactStatValue: { color: "#d4d4d8", fontSize: 14, fontWeight: "900", marginTop: 4 },
  statCard: {
    flex: 1,
    backgroundColor: "#202020",
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14
  },
  statLabel: { color: "#9ca3af", fontSize: 12, fontWeight: "700", marginBottom: 4 },
  statValue: { color: "#f3f4f6", fontSize: 18, fontWeight: "900" },
  statValueActive: { color: "#22c55e" },
  sectionLabel: {
    color: "#8b8b93",
    textTransform: "uppercase",
    letterSpacing: 1.8,
    fontSize: 12,
    fontWeight: "800"
  },
  filamentsHeaderRow: { marginBottom: 14 },
  slotList: { gap: 12 },
  slotListCard: {
    backgroundColor: "rgba(24,24,27,0.45)",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 24,
    overflow: "hidden"
  },
  slotListCardSelected: {
    backgroundColor: "rgba(37,99,235,0.08)",
    borderColor: "#3b82f6",
    shadowColor: "#3b82f6",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }
  },
  slotCardContent: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  slotCard: {
    backgroundColor: "#232323",
    borderRadius: 22,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  slotCardEmpty: { opacity: 0.55 },
  slotMain: { flexDirection: "row", alignItems: "center", gap: 14, flex: 1 },
  spool: {
    width: 58,
    height: 58,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }
  },
  slotInfo: { flex: 1 },
  slotChannel: {
    color: "#71717a",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    marginBottom: 4
  },
  slotChannelSelected: { color: "#60a5fa" },
  slotType: { color: "#f3f4f6", fontSize: 28, fontWeight: "900", marginBottom: 4 },
  slotMeta: { color: "#a1a1aa", fontSize: 14 },
  slotRight: { alignItems: "center", gap: 8 },
  slotActions: { flexDirection: "row", alignItems: "center", gap: 14, paddingLeft: 10 },
  editIconButton: { padding: 8 },
  editIconText: { color: "#a1a1aa", fontSize: 18 },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#3f3f46",
    alignItems: "center",
    justifyContent: "center"
  },
  radioOuterSelected: { borderColor: "#3b82f6" },
  radioInner: { width: 10, height: 10, borderRadius: 999, backgroundColor: "#3b82f6" },
  loadedDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#22c55e",
    shadowColor: "#22c55e",
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 }
  },
  loadedDotLarge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: "#22c55e",
    borderWidth: 2,
    borderColor: "#18181b"
  },
  loadingDotLarge: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: "#60a5fa"
  },
  loadingDotShell: {
    position: "absolute",
    top: -5,
    right: -5,
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center"
  },
  colorCard: {
    backgroundColor: "#232323",
    borderRadius: 24,
    padding: 18,
    flexDirection: "row",
    gap: 16,
    alignItems: "center"
  },
  colorButton: {
    width: 128,
    height: 128,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "#3f3f46"
  },
  colorBubble: { flex: 1 },
  colorInfo: { flex: 1, gap: 8 },
  colorTitle: { color: "#f3f4f6", fontSize: 22, fontWeight: "900" },
  colorValue: { color: "#9ca3af", fontSize: 14, fontWeight: "700" },
  colorHint: { color: "#a1a1aa", fontSize: 14, lineHeight: 20 },
  editColorCard: {
    backgroundColor: "rgba(24,24,27,0.72)",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 24,
    padding: 16,
    flexDirection: "row",
    gap: 16,
    alignItems: "center"
  },
  editColorButton: {
    width: 112,
    height: 112,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "#3f3f46"
  },
  editColorBubble: { flex: 1 },
  editColorInfo: { flex: 1, gap: 8 },
  editColorTitle: { color: "#fff", fontSize: 24, fontWeight: "900" },
  editColorHex: { color: "#a1a1aa", fontSize: 14, fontWeight: "800" },
  editColorHint: { color: "#71717a", fontSize: 14, lineHeight: 20 },
  cameraActionButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: "#2563eb",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  cameraActionText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    padding: 18
  },
  loadingOverlayCard: {
    backgroundColor: "rgba(30,36,54,0.96)",
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    maxWidth: 320
  },
  loadingText: { color: "#c7d2fe", fontSize: 14, flex: 1 },
  menuOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.42)",
    justifyContent: "flex-end",
    padding: 16
  },
  printerMenuSheet: {
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 24,
    padding: 18,
    gap: 14
  },
  printerMenuHandle: {
    alignSelf: "center",
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#3f3f46",
    marginBottom: 2
  },
  printerMenuTitle: { color: "#ffffff", fontSize: 22, fontWeight: "900", textAlign: "center" },
  printerMenuSubtitle: { color: "#71717a", fontSize: 14, textAlign: "center", marginTop: -6, marginBottom: 6 },
  printerMenuDanger: {
    backgroundColor: "rgba(127,29,29,0.18)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.28)",
    borderRadius: 18,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center"
  },
  printerMenuDangerText: { color: "#fca5a5", fontSize: 16, fontWeight: "900" },
  printerMenuCancel: {
    backgroundColor: "#27272a",
    borderRadius: 18,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center"
  },
  printerMenuCancelText: { color: "#f4f4f5", fontSize: 15, fontWeight: "800" },
  colorModalCard: {
    width: "100%",
    backgroundColor: "rgba(24,24,27,0.72)",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 24,
    padding: 18,
    gap: 16
  },
  colorModalTitle: { color: "#fff", fontSize: 22, fontWeight: "900" },
  colorModalSubtitle: { color: "#71717a", fontSize: 14, lineHeight: 20 },
  colorPresetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12
  },
  colorPreset: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)"
  },
  colorPresetActive: {
    borderColor: "#60a5fa",
    transform: [{ scale: 1.05 }]
  },
  typeRow: { gap: 8, paddingVertical: 4 },
  typeChip: {
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14
  },
  typeChipActive: { backgroundColor: "#315cff", borderColor: "#315cff" },
  typeChipText: { color: "#f3f4f6", fontWeight: "800" },
  typeChipTextActive: { color: "#fff" },
  formCard: { backgroundColor: "#232323", borderRadius: 24, padding: 18, gap: 14 },
  editFormCard: {
    backgroundColor: "rgba(24,24,27,0.72)",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 24,
    padding: 18,
    gap: 14
  },
  largeField: { gap: 10 },
  field: { gap: 8 },
  fieldLabel: {
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 1.8,
    fontSize: 11,
    fontWeight: "800"
  },
  input: {
    backgroundColor: "#111111",
    borderRadius: 16,
    color: "#f3f4f6",
    paddingVertical: 14,
    paddingHorizontal: 14,
    fontSize: 16
  },
  largeInput: {
    backgroundColor: "#111111",
    borderRadius: 18,
    color: "#f3f4f6",
    paddingVertical: 18,
    paddingHorizontal: 16,
    fontSize: 18
  },
  tempFieldsRow: { flexDirection: "row", gap: 12 },
  tempFieldCol: { flex: 1 },
  cameraPage: { flex: 1, paddingHorizontal: 18, gap: 16 },
  cameraFrame: {
    flex: 1,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#111"
  },
  cameraFallback: { flex: 1, justifyContent: "center", alignItems: "center" },
  cameraHint: { color: "#a1a1aa", fontSize: 15, textAlign: "center" },
  pickPreviewCard: {
    backgroundColor: "rgba(24,24,27,0.72)",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  pickPreviewSwatch: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)"
  },
  pickPreviewTextWrap: { flex: 1 },
  pickPreviewLabel: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.4
  },
  pickPreviewValue: { color: "#f4f4f5", fontSize: 15, fontWeight: "900", marginTop: 2 },
  captureButton: {
    alignSelf: "center",
    width: 84,
    height: 84,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    justifyContent: "center",
    alignItems: "center"
  },
  captureInner: {
    width: 62,
    height: 62,
    borderRadius: 999,
    backgroundColor: "#fff"
  },
  photoArea: {
    flex: 1,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#0f0f10",
    justifyContent: "center",
    alignItems: "center"
  },
  photoImage: { width: "100%", height: "100%" },
  pickTarget: {
    position: "absolute",
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center"
  },
  pickTargetCore: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#60a5fa"
  },
  selectColorButton: {
    backgroundColor: "#2563eb",
    borderRadius: 18,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center"
  },
  selectColorButtonText: { color: "#fff", fontSize: 17, fontWeight: "900" },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(9,9,11,0.92)",
    borderTopWidth: 1,
    borderTopColor: "rgba(39,39,42,0.8)",
    paddingHorizontal: 24,
    paddingTop: 10
  },
  bottomActions: { flexDirection: "row", gap: 12 },
  actionButton: {
    flex: 1,
    minHeight: 58,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  retractButton: {
    backgroundColor: "#27272a"
  },
  feedButton: {
    backgroundColor: "#2563eb"
  },
  actionButtonDisabled: {
    backgroundColor: "#18181b"
  },
  actionIcon: { color: "#a1a1aa", fontSize: 18, fontWeight: "900" },
  feedActionIcon: { color: "#ffffff" },
  actionIconDisabled: { color: "#52525b" },
  actionText: { color: "#ffffff", fontSize: 17, fontWeight: "900" },
  feedActionText: { color: "#ffffff", fontSize: 17, fontWeight: "900" },
  actionTextDisabled: { color: "#52525b" },
  helperText: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 6
  },
  buttonLoadingWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  buttonLoadingDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#60a5fa"
  },
  fab: {
    position: "absolute",
    right: 24,
    bottom: 26,
    width: 58,
    height: 58,
    borderRadius: 999,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1d4ed8",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8
  },
  fabText: { color: "#ffffff", fontSize: 30, fontWeight: "500", lineHeight: 30, marginTop: -1 }
});
