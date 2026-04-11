const slotsGrid = document.getElementById("slots-grid");
const slotTemplate = document.getElementById("slot-template");
const connectionPill = document.getElementById("connection-pill");
const lastUpdate = document.getElementById("last-update");
const lastError = document.getElementById("last-error");
const rawBoxsInfo = document.getElementById("raw-boxs-info");
const rawFrames = document.getElementById("raw-frames");
const messagesSeen = document.getElementById("messages-seen");
const lastBoxsInfo = document.getElementById("last-boxs-info");
const refreshButton = document.getElementById("refresh-button");

function fmtTs(unixTs) {
  if (!unixTs) return "-";
  return new Date(unixTs * 1000).toLocaleString("pt-BR");
}

function statusLabel(slot) {
  if (!slot.present) return "Slot vazio";
  if (slot.selected) return "Em uso agora";
  if (slot.status === "rfid") return "Carregado via RFID";
  if (slot.status === "manual") return "Carregado manualmente";
  return "Carregado";
}

function safeValue(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "—";
  return `${value}${suffix}`;
}

function row(label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  return [dt, dd];
}

function renderSlots(slots) {
  slotsGrid.innerHTML = "";
  for (const slot of slots) {
    const fragment = slotTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".slot-card");
    const badge = fragment.querySelector(".slot-badge");
    const label = fragment.querySelector(".slot-label");
    const status = fragment.querySelector(".slot-status");
    const circle = fragment.querySelector(".filament-circle");
    const details = fragment.querySelector(".slot-details");

    label.textContent = slot.slot;
    status.textContent = statusLabel(slot);
    badge.textContent = slot.present ? "Loaded" : "Empty";
    circle.style.setProperty("--slot-color", slot.color || "#d7dce4");

    if (slot.present) {
      card.classList.add("slot-loaded");
      if (slot.selected) card.classList.add("slot-selected");
    } else {
      card.classList.add("slot-empty");
    }

    const pairs = [
      ["Tipo", safeValue(slot.type)],
      ["Nome", safeValue(slot.name)],
      ["Vendor", safeValue(slot.vendor || slot.manufacturer)],
      ["Temp. mín.", safeValue(slot.temp_min, " °C")],
      ["Temp. máx.", safeValue(slot.temp_max, " °C")],
      ["Status", safeValue(statusLabel(slot))],
    ];

    for (const [detailLabel, detailValue] of pairs) {
      const [dt, dd] = row(detailLabel, detailValue);
      details.appendChild(dt);
      details.appendChild(dd);
    }

    slotsGrid.appendChild(fragment);
  }
}

async function loadState() {
  const [cfsResponse, debugResponse] = await Promise.all([
    fetch("/api/cfs", { cache: "no-store" }),
    fetch("/api/debug", { cache: "no-store" }),
  ]);

  const cfs = await cfsResponse.json();
  const debug = await debugResponse.json();

  renderSlots(Array.isArray(cfs.slots) ? cfs.slots : []);

  connectionPill.textContent = cfs.connected ? "Conectado" : "Desconectado";
  connectionPill.className = `pill ${cfs.connected ? "pill-ok" : "pill-warn"}`;
  lastUpdate.textContent = fmtTs(cfs.last_message_at);
  lastError.textContent = cfs.last_error || "Nenhum";
  messagesSeen.textContent = String(debug.messages_seen || 0);
  lastBoxsInfo.textContent = fmtTs(debug.last_boxs_info_at);
  rawBoxsInfo.textContent = JSON.stringify(debug.raw_last_boxs_info || {}, null, 2);
  rawFrames.textContent = JSON.stringify(debug.frames || [], null, 2);
}

async function refreshNow() {
  refreshButton.disabled = true;
  try {
    await loadState();
  } catch (error) {
    lastError.textContent = error.message || String(error);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", refreshNow);

refreshNow();
setInterval(refreshNow, 3000);
