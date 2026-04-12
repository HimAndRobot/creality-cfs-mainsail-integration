const MATERIAL_TYPES = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "OTHER"];

const slotsGrid = document.getElementById("slots-grid");
const slotTemplate = document.getElementById("slot-template");
const connectionPill = document.getElementById("connection-pill");
const timeDisplay = document.getElementById("time-display");
const lastError = document.getElementById("last-error");
const rawBoxsInfo = document.getElementById("raw-boxs-info");
const rawFrames = document.getElementById("raw-frames");
const messagesSeen = document.getElementById("messages-seen");
const lastBoxsInfo = document.getElementById("last-boxs-info");
const refreshButton = document.getElementById("refresh-button");
const themeToggleBtn = document.getElementById("themeToggle");
const iconMoon = document.getElementById("icon-moon");
const iconSun = document.getElementById("icon-sun");
const htmlElement = document.documentElement;

const modal = document.getElementById("editModal");
const modalTitle = document.getElementById("modalTitle");
const modalCloseButton = document.getElementById("modalCloseButton");
const modalCancelButton = document.getElementById("modalCancelButton");
const modalSaveButton = document.getElementById("modalSaveButton");
const colorPreview = document.getElementById("colorAvatarPreview");
const colorInput = document.getElementById("colorPickerInput");
const materialTypeInput = document.getElementById("materialType");
const materialVendorInput = document.getElementById("materialVendor");
const materialNameInput = document.getElementById("materialName");
const materialTempMinInput = document.getElementById("materialTempMin");
const materialTempMaxInput = document.getElementById("materialTempMax");

let latestSlots = [];
let currentEditSlot = null;

function fmtTs(unixTs) {
  if (!unixTs) return "-";
  return new Date(unixTs * 1000).toLocaleString("pt-BR");
}

function fmtClock(unixTs) {
  if (!unixTs) return "Atualizado agora";
  return `Atualizado às ${new Date(unixTs * 1000).toLocaleTimeString("pt-BR")}`;
}

function safeValue(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "-";
  return `${value}${suffix}`;
}

function normalizeColor(value) {
  const raw = String(value || "").trim();
  return raw || "#64748b";
}

function statusLabel(slot) {
  if (!slot.present) return "Vazio";
  if (slot.selected) return "Pronto para uso";
  if (slot.status === "rfid") return "Carregado via RFID";
  if (slot.status === "manual") return "Aguardando";
  return "Aguardando";
}

function statusName(slot) {
  if (!slot.present) return "Nenhum";
  return String(slot.type || "Unknown");
}

function fillMaterialTypes() {
  materialTypeInput.innerHTML = "";
  for (const type of MATERIAL_TYPES) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    materialTypeInput.appendChild(option);
  }
}

function setTheme(theme) {
  htmlElement.setAttribute("data-theme", theme);
  window.localStorage.setItem("theme", theme);
  if (theme === "dark") {
    iconMoon.style.display = "none";
    iconSun.style.display = "block";
  } else {
    iconMoon.style.display = "block";
    iconSun.style.display = "none";
  }
}

function openModal(slot) {
  if (!slot || !slot.present) return;
  currentEditSlot = slot;
  modalTitle.textContent = `EDITAR SLOT ${slot.slot}`;
  colorPreview.style.backgroundColor = normalizeColor(slot.color);
  colorInput.value = normalizeColor(slot.color);
  materialTypeInput.value = String(slot.type || "PLA");
  materialVendorInput.value = String(slot.vendor || slot.manufacturer || "");
  materialNameInput.value = String(slot.name || "");
  materialTempMinInput.value = slot.temp_min == null ? "" : String(slot.temp_min);
  materialTempMaxInput.value = slot.temp_max == null ? "" : String(slot.temp_max);
  modal.classList.add("open");
}

function closeModal() {
  modal.classList.remove("open");
  currentEditSlot = null;
}

async function saveModal() {
  if (!currentEditSlot) return;
  modalSaveButton.disabled = true;
  modalSaveButton.textContent = "Salvando...";
  try {
    const response = await fetch(`/api/cfs/slot/${encodeURIComponent(currentEditSlot.slot)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: materialTypeInput.value,
        vendor: materialVendorInput.value,
        name: materialNameInput.value,
        temp_min: materialTempMinInput.value,
        temp_max: materialTempMaxInput.value,
        color: colorInput.value,
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    closeModal();
    await refreshNow();
  } catch (error) {
    lastError.textContent = error.message || String(error);
  } finally {
    modalSaveButton.disabled = false;
    modalSaveButton.textContent = "Salvar Alterações";
  }
}

function renderSlots(slots) {
  latestSlots = Array.isArray(slots) ? slots.slice() : [];
  slotsGrid.innerHTML = "";

  for (const slot of latestSlots) {
    const fragment = slotTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".slot-card");
    const slotId = fragment.querySelector(".slot-id");
    const slotState = fragment.querySelector(".slot-state");
    const spool = fragment.querySelector(".spool-graphic");
    const indicator = fragment.querySelector(".status-indicator");
    const type = fragment.querySelector(".mat-type");
    const name = fragment.querySelector(".mat-name");
    const vendor = fragment.querySelector(".slot-vendor");
    const tempMin = fragment.querySelector(".slot-temp-min");
    const tempMax = fragment.querySelector(".slot-temp-max");
    const editButton = fragment.querySelector(".slot-edit-button");

    card.style.setProperty("--spool-color", normalizeColor(slot.color));
    slotId.textContent = slot.slot;
    slotState.textContent = statusLabel(slot);
    type.textContent = statusName(slot);
    name.textContent = slot.present ? safeValue(slot.name) : "Sem material";
    vendor.textContent = slot.present ? safeValue(slot.vendor || slot.manufacturer) : "-";
    tempMin.textContent = slot.present ? safeValue(slot.temp_min, " °C") : "-";
    tempMax.textContent = slot.present ? safeValue(slot.temp_max, " °C") : "-";

    if (slot.selected) indicator.classList.add("active");
    if (!slot.present) {
      card.classList.add("slot-empty");
      editButton.disabled = true;
    }

    editButton.addEventListener("click", () => openModal(slot));

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
  connectionPill.className = `badge-status ${cfs.connected ? "badge-status-online" : "badge-status-offline"}`;
  timeDisplay.textContent = fmtClock(cfs.last_message_at);
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

fillMaterialTypes();

const savedTheme =
  window.localStorage.getItem("theme") ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
setTheme(savedTheme);

themeToggleBtn.addEventListener("click", () => {
  const currentTheme = htmlElement.getAttribute("data-theme");
  setTheme(currentTheme === "light" ? "dark" : "light");
});

colorInput.addEventListener("input", () => {
  colorPreview.style.backgroundColor = normalizeColor(colorInput.value);
});

modalCloseButton.addEventListener("click", closeModal);
modalCancelButton.addEventListener("click", closeModal);
modalSaveButton.addEventListener("click", saveModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});
refreshButton.addEventListener("click", refreshNow);

refreshNow();
setInterval(refreshNow, 3000);
