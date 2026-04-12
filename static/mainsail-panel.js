(function () {
  "use strict";

  if (window.__k1c_cfs_panel_loaded) return;
  window.__k1c_cfs_panel_loaded = true;

  const BASE = String(window.K1C_CFS_URL || "").replace(/\/$/, "");
  if (!BASE) {
    console.error("[K1C CFS] window.K1C_CFS_URL is not set.");
    return;
  }

  const POLL_MS = 3000;
  const RETRY_MS = 1200;
  const FLOAT_AFTER_MS = 20000;
  const MATERIAL_TYPES = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "OTHER"];
  const MATERIAL_PRESETS = {
    PLA: { vendor: "Generic", name: "Generic PLA", temp_min: "190", temp_max: "240" },
    PETG: { vendor: "Generic", name: "Generic PETG", temp_min: "220", temp_max: "260" },
    ABS: { vendor: "Generic", name: "Generic ABS", temp_min: "230", temp_max: "260" },
    ASA: { vendor: "Generic", name: "Generic ASA", temp_min: "240", temp_max: "270" },
    TPU: { vendor: "Generic", name: "Generic TPU", temp_min: "210", temp_max: "240" },
    PA: { vendor: "Generic", name: "Generic PA", temp_min: "240", temp_max: "280" },
    PC: { vendor: "Generic", name: "Generic PC", temp_min: "260", temp_max: "300" },
    OTHER: { vendor: "Generic", name: "Generic Material", temp_min: "200", temp_max: "240" },
  };

  const CARD_ID = "k1c-cfs-card";
  const ROOT_ID = "k1c-cfs-panel";
  const FLOAT_ID = "k1c-cfs-float";
  const MODAL_ID = "k1c-cfs-modal";
  const STYLE_ID = "k1c-cfs-panel-style";

  let root = null;
  let gridEl = null;
  let humidityLabelEl = null;
  let timer = null;
  let observer = null;
  let floatTimer = null;
  let latestSlots = [];
  let latestConnected = false;
  let latestHumidity = null;
  let latestTemp = null;
  let selectedSlot = "";
  let savingSlot = "";
  let feedBtnEl = null;
  let retractBtnEl = null;

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#" + CARD_ID + "{overflow:hidden}",
      "#" + CARD_ID + " .k1c-cfs-card-body{padding:20px 18px 18px}",
      "#" + ROOT_ID + "{font-family:inherit;color:inherit}",
      "#" + ROOT_ID + " *{box-sizing:border-box;font-family:inherit}",
      ".k1c-cfs-shell{display:flex;flex-direction:column;gap:16px;padding:0;background:transparent;border:none;border-radius:0;box-shadow:none}",
      ".k1c-cfs-badge{display:flex;align-items:center;gap:8px;background:#242424;color:#ececec;padding:9px 16px;border-radius:8px;font-size:12px;font-weight:700;border:none;line-height:1}",
      ".k1c-cfs-badge svg{width:15px;height:15px;fill:currentColor;opacity:.95}",
      ".k1c-cfs-badge.humidity{color:#77a7ff;background:#232323;box-shadow:inset 0 1px 0 rgba(255,255,255,.02)}",
      ".k1c-cfs-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
      ".k1c-cfs-item{position:relative;background:#242424;border:1px solid #3a3a3a;border-radius:8px;padding:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer;transition:background .2s ease,border-color .2s ease}",
      ".k1c-cfs-item:hover{background:#2e2e2e}",
      ".k1c-cfs-item.active{background:#2a2a2a;border-color:var(--spool-color,#666)}",
      ".k1c-cfs-loaded-dot{position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 5px #22c55e;z-index:2}",
      ".k1c-cfs-main{display:flex;align-items:center;gap:12px;min-width:0}",
      ".k1c-cfs-spool{width:44px;height:44px;border-radius:50%;background:var(--spool-color,#94a3b8);display:flex;align-items:center;justify-content:center;position:relative;flex-shrink:0;box-shadow:inset 0 0 0 3px rgba(255,255,255,.15),inset 0 0 10px rgba(0,0,0,.6),0 0 8px rgba(0,0,0,.3)}",
      ".k1c-cfs-spool::after{content:'';width:12px;height:12px;border-radius:50%;background:#1c1c1c;box-shadow:inset 0 2px 4px rgba(0,0,0,.8)}",
      ".k1c-cfs-info{display:flex;flex-direction:column;min-width:0}",
      ".k1c-cfs-channel{font-size:11px;color:#9e9e9e;font-weight:700;letter-spacing:.05em;text-transform:uppercase}",
      ".k1c-cfs-type{font-size:19px;font-weight:700;color:#ececec;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".k1c-cfs-edit-inline{background:transparent;border:1px solid transparent;color:#9e9e9e;width:36px;height:36px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s ease}",
      ".k1c-cfs-edit-inline:hover{background:#3a3a3a;color:#ececec}",
      ".k1c-cfs-edit-inline svg,.k1c-cfs-action svg{width:18px;height:18px;fill:currentColor}",
      ".k1c-cfs-controls{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding-top:12px;border-top:1px solid #3a3a3a}",
      ".k1c-cfs-action{background:#2a2a2a;color:#ececec;border:1px solid #3a3a3a;padding:12px 14px;border-radius:8px;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:all .2s ease}",
      ".k1c-cfs-action:hover:not(:disabled){background:#333;border-color:#555}",
      ".k1c-cfs-action:disabled{opacity:.35;cursor:not-allowed}",
      "#" + MODAL_ID + "{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.65);z-index:10001;backdrop-filter:blur(2px)}",
      ".k1c-cfs-modal-card{width:min(520px,calc(100vw - 24px));background:#1a1a1e;color:#ececec;border:1px solid #333;border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:24px;box-shadow:0 25px 50px -12px rgba(0,0,0,.9)}",
      ".k1c-cfs-modal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-bottom:16px;border-bottom:1px solid #2a2a2a}",
      ".k1c-cfs-modal-title{font-size:18px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#ececec}",
      ".k1c-cfs-color-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}",
      ".k1c-cfs-color-avatar{width:80px;height:80px;border-radius:50%;position:relative;overflow:hidden;border:3px solid #2a2a2a;box-shadow:0 4px 15px rgba(0,0,0,.4),inset 0 0 10px rgba(0,0,0,.3);transition:transform .2s ease,border-color .2s ease}",
      ".k1c-cfs-color-avatar:hover{transform:scale(1.05);border-color:#555}",
      ".k1c-cfs-color-avatar input[type='color']{position:absolute;top:-50%;left:-50%;width:200%;height:200%;opacity:0;cursor:pointer;z-index:10}",
      ".k1c-cfs-color-overlay{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s ease;pointer-events:none;z-index:5}",
      ".k1c-cfs-color-avatar:hover .k1c-cfs-color-overlay{opacity:1}",
      ".k1c-cfs-color-overlay svg{width:28px;height:28px;fill:#fff}",
      ".k1c-cfs-color-label{font-size:12px;color:#9e9e9e;font-weight:600;letter-spacing:.05em}",
      ".k1c-cfs-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}",
      ".k1c-cfs-field{display:flex;flex-direction:column;gap:8px}",
      ".k1c-cfs-field.wide{grid-column:span 2}",
      ".k1c-cfs-field label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#9e9e9e;font-weight:600}",
      ".k1c-cfs-field select,.k1c-cfs-field input{width:100%;appearance:none;border:1px solid #2a2a2a;background:#121212;color:#ececec;border-radius:8px;padding:11px 13px;font-size:15px;outline:none}",
      ".k1c-cfs-field select option{background:#121212;color:#ececec}",
      ".k1c-cfs-field select:focus,.k1c-cfs-field input:focus{border-color:#555}",
      ".k1c-cfs-modal-actions{display:flex;justify-content:flex-end;gap:12px;margin-top:4px;padding-top:16px;border-top:1px solid #2a2a2a}",
      ".k1c-cfs-save-btn,.k1c-cfs-cancel-btn{appearance:none;border:1px solid #3a3a3a;background:transparent;color:#ececec;border-radius:8px;padding:8px 16px;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s ease}",
      ".k1c-cfs-save-btn:hover,.k1c-cfs-cancel-btn:hover{background:#2e2e2e;border-color:#555}",
      ".k1c-cfs-save-btn{background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.3);color:#86efac}",
      ".k1c-cfs-save-btn:hover{background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.5)}",
      "#" + FLOAT_ID + "{position:fixed;right:18px;bottom:18px;width:min(520px,calc(100vw - 24px));z-index:9999}",
      "#" + FLOAT_ID + " ." + CARD_ID + "-shell{box-shadow:0 20px 48px rgba(0,0,0,.36)}",
      "@media (max-width:640px){.k1c-cfs-grid,.k1c-cfs-controls,.k1c-cfs-edit-grid{grid-template-columns:1fr}.k1c-cfs-field.wide{grid-column:span 1}}",
    ].join("");
    document.head.appendChild(style);
  }

  function createSvgPath(path) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", path);
    svg.appendChild(p);
    return svg;
  }

  function normalizeColor(value) {
    const raw = String(value || "").trim();
    return raw || "#94a3b8";
  }

  function createField(labelText, inputEl) {
    const wrap = document.createElement("div");
    wrap.className = "k1c-cfs-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    return wrap;
  }

  function updateStatus() {}

  function updateHumidity(humidity, temp) {
    if (!humidityLabelEl) return;
    const humidityValue = humidity === null || humidity === undefined || humidity === "" ? "--" : Math.round(Number(humidity));
    humidityLabelEl.textContent = humidityValue + "%";
    if (humidityLabelEl.parentElement) {
      const tempValue = temp === null || temp === undefined || temp === "" ? "--" : Math.round(Number(temp));
      humidityLabelEl.parentElement.title = "Humidity " + humidityValue + "% / Temp " + tempValue + "C";
    }
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.remove();
  }

  async function saveSlot(slot, draft, saveButton) {
    if (savingSlot) return;
    savingSlot = slot.slot;
    saveButton.disabled = true;
    saveButton.textContent = "Saving";
    try {
      const response = await fetch(BASE + "/api/cfs/slot/" + encodeURIComponent(slot.slot), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: String(draft.type || "").trim().toUpperCase(),
          vendor: String(draft.vendor || "").trim(),
          name: String(draft.name || "").trim(),
          temp_min: String(draft.temp_min || "").trim(),
          temp_max: String(draft.temp_max || "").trim(),
          color: String(draft.color || "").trim(),
        }),
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      closeModal();
      await poll();
    } catch (error) {
      window.alert("Failed to save " + slot.slot + ": " + (error.message || String(error)));
    } finally {
      savingSlot = "";
      saveButton.disabled = false;
      saveButton.textContent = "Save";
    }
  }

  function openEditModal(slot) {
    closeModal();

    const modal = document.createElement("div");
    modal.id = MODAL_ID;

    const card = document.createElement("div");
    card.className = "k1c-cfs-modal-card";
    modal.appendChild(card);

    const head = document.createElement("div");
    head.className = "k1c-cfs-modal-head";
    const title = document.createElement("div");
    title.className = "k1c-cfs-modal-title";
    title.textContent = slot.slot + " Edit Material";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "k1c-cfs-cancel-btn";
    closeBtn.textContent = "Close";
    closeBtn.onclick = closeModal;
    head.appendChild(title);
    head.appendChild(closeBtn);
    card.appendChild(head);

    const colorWrap = document.createElement("div");
    colorWrap.className = "k1c-cfs-color-wrap";
    const colorAvatar = document.createElement("div");
    colorAvatar.className = "k1c-cfs-color-avatar";
    colorAvatar.style.backgroundColor = normalizeColor(slot.color);
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = normalizeColor(slot.color);
    const colorOverlay = document.createElement("div");
    colorOverlay.className = "k1c-cfs-color-overlay";
    colorOverlay.appendChild(createSvgPath("M3 17.2v4.5h4.5l11-11.1-4.5-4.5L3 17.2zm18.7-10.3c.4-.4.4-1 0-1.4l-3.1-3.1c-.4-.4-1-.4-1.4 0l-2.2 2.2 4.5 4.5 2.2-2.2z"));
    colorInput.addEventListener("input", function () {
      colorAvatar.style.backgroundColor = colorInput.value;
    });
    colorAvatar.appendChild(colorInput);
    colorAvatar.appendChild(colorOverlay);
    const colorLabel = document.createElement("span");
    colorLabel.className = "k1c-cfs-color-label";
    colorLabel.textContent = "COLOR";
    colorWrap.appendChild(colorAvatar);
    colorWrap.appendChild(colorLabel);
    card.appendChild(colorWrap);

    const select = document.createElement("select");
    MATERIAL_TYPES.forEach(function (material) {
      const option = document.createElement("option");
      option.value = material;
      option.textContent = material;
      if ((slot.type || "PLA") === material) option.selected = true;
      select.appendChild(option);
    });

    const vendorInput = document.createElement("input");
    vendorInput.type = "text";
    vendorInput.value = slot.vendor || "";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = slot.name || "";

    const tempMinInput = document.createElement("input");
    tempMinInput.type = "number";
    tempMinInput.min = "0";
    tempMinInput.step = "1";
    tempMinInput.value = slot.temp_min == null ? "" : String(slot.temp_min);

    const tempMaxInput = document.createElement("input");
    tempMaxInput.type = "number";
    tempMaxInput.min = "0";
    tempMaxInput.step = "1";
    tempMaxInput.value = slot.temp_max == null ? "" : String(slot.temp_max);

    function applyPreset(materialType) {
      const preset = MATERIAL_PRESETS[materialType];
      if (!preset) return;
      vendorInput.value = preset.vendor;
      nameInput.value = preset.name;
      tempMinInput.value = preset.temp_min;
      tempMaxInput.value = preset.temp_max;
    }

    select.addEventListener("change", function () {
      applyPreset(select.value);
    });

    const grid = document.createElement("div");
    grid.className = "k1c-cfs-edit-grid";
    grid.appendChild(createField("Type", select));
    grid.appendChild(createField("Vendor", vendorInput));
    const nameField = createField("Name", nameInput);
    nameField.classList.add("wide");
    grid.appendChild(nameField);
    grid.appendChild(createField("Min Temp", tempMinInput));
    grid.appendChild(createField("Max Temp", tempMaxInput));
    card.appendChild(grid);

    const actions = document.createElement("div");
    actions.className = "k1c-cfs-modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "k1c-cfs-cancel-btn";
    cancel.textContent = "Cancel";
    cancel.onclick = closeModal;
    const save = document.createElement("button");
    save.type = "button";
    save.className = "k1c-cfs-save-btn";
    save.textContent = "Save";
    save.onclick = function () {
      saveSlot(
        slot,
        {
          type: select.value,
          vendor: vendorInput.value,
          name: nameInput.value,
          temp_min: tempMinInput.value,
          temp_max: tempMaxInput.value,
          color: colorInput.value,
        },
        save
      );
    };
    actions.appendChild(cancel);
    actions.appendChild(save);
    card.appendChild(actions);

    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeModal();
    });

    document.body.appendChild(modal);
  }

  function buildRoot() {
    root = document.createElement("div");
    root.id = ROOT_ID;

    const shell = document.createElement("div");
    shell.className = "k1c-cfs-shell";
    root.appendChild(shell);

    gridEl = document.createElement("div");
    gridEl.className = "k1c-cfs-grid";
    shell.appendChild(gridEl);

    const controls = document.createElement("div");
    controls.className = "k1c-cfs-controls";

    const feedBtn = document.createElement("button");
    feedBtn.type = "button";
    feedBtn.className = "k1c-cfs-action";
    feedBtn.disabled = true;
    feedBtn.appendChild(createSvgPath("M11 4v11.2l-3.6-3.6-1.4 1.4 6 6 6-6-1.4-1.4-3.6 3.6V4h-2z"));
    const feedText = document.createElement("span");
    feedText.textContent = "Feed";
    feedBtn.appendChild(feedText);
    feedBtnEl = feedBtn;

    const retractBtn = document.createElement("button");
    retractBtn.type = "button";
    retractBtn.className = "k1c-cfs-action";
    retractBtn.disabled = true;
    retractBtn.appendChild(createSvgPath("M13 20V8.8l3.6 3.6 1.4-1.4-6-6-6 6 1.4 1.4 3.6-3.6V20h2z"));
    const retractText = document.createElement("span");
    retractText.textContent = "Retract";
    retractBtn.appendChild(retractText);
    retractBtnEl = retractBtn;

    controls.appendChild(feedBtn);
    controls.appendChild(retractBtn);
    shell.appendChild(controls);
    return root;
  }

  function buildPanelCard() {
    const card = document.createElement("div");
    card.id = CARD_ID;
    card.className = "v-card v-sheet theme--dark panel k1c-cfs-panel-card mb-3 mb-md-6";

    const toolbar = document.createElement("header");
    toolbar.className = "panel-toolbar v-sheet theme--dark v-toolbar v-toolbar--dense v-toolbar--flat collapsible";
    toolbar.style.paddingTop = "3px";
    toolbar.style.paddingBottom = "3px";
    const content = document.createElement("div");
    content.className = "v-toolbar__content d-flex align-center justify-space-between";
    content.style.padding = "0 18px 0 20px";
    content.style.minHeight = "46px";
    const title = document.createElement("div");
    title.className = "v-toolbar__title d-flex align-center";
    title.textContent = "CFS";
    content.appendChild(title);

    const humidityBadge = document.createElement("div");
    humidityBadge.className = "k1c-cfs-badge humidity";
    humidityBadge.appendChild(createSvgPath("M12 21.5c-3.5 0-6.5-2.8-6.5-6.2 0-2.8 2.6-6.6 5.8-10.9.3-.4.8-.4 1.2 0 3.2 4.3 5.8 8.1 5.8 10.9 0 3.4-3 6.2-6.3 6.2zm0-14.7C9.3 10.5 7 13.5 7 15.3c0 2.5 2.2 4.7 5 4.7s5-2.2 5-4.7c0-1.8-2.3-4.8-5-8.5z"));
    humidityLabelEl = document.createElement("span");
    humidityLabelEl.className = "k1c-cfs-humidity-label";
    humidityLabelEl.textContent = "--%";
    humidityBadge.appendChild(humidityLabelEl);
    content.appendChild(humidityBadge);

    toolbar.appendChild(content);

    const body = document.createElement("div");
    body.className = "k1c-cfs-card-body";
    body.appendChild(buildRoot());

    card.appendChild(toolbar);
    card.appendChild(body);
    return card;
  }

  function render(slots, connected) {
    if (!gridEl) return;

    latestSlots = Array.isArray(slots) ? slots.slice() : [];
    latestConnected = !!connected;

    if (!selectedSlot || !latestSlots.some(function (slot) { return slot.slot === selectedSlot; })) {
      const active = latestSlots.find(function (slot) { return slot.selected; });
      selectedSlot = active ? active.slot : (latestSlots[0] ? latestSlots[0].slot : "");
    }

    gridEl.innerHTML = "";

    latestSlots.forEach(function (slot) {
      const item = document.createElement("div");
      item.className = "k1c-cfs-item" + (selectedSlot === slot.slot ? " active" : "");
      item.style.setProperty("--spool-color", normalizeColor(slot.color));
      item.onclick = function () {
        selectedSlot = slot.slot;
        render(latestSlots, latestConnected);
      };

      const main = document.createElement("div");
      main.className = "k1c-cfs-main";

      const spool = document.createElement("div");
      spool.className = "k1c-cfs-spool";
      main.appendChild(spool);

      const info = document.createElement("div");
      info.className = "k1c-cfs-info";
      const channel = document.createElement("span");
      channel.className = "k1c-cfs-channel";
      channel.textContent = "Channel " + slot.slot;
      const type = document.createElement("span");
      type.className = "k1c-cfs-type";
      type.textContent = slot.present ? String(slot.type || "Unknown") : "Empty";
      info.appendChild(channel);
      info.appendChild(type);
      main.appendChild(info);

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "k1c-cfs-edit-inline";
      edit.title = "Edit";
      edit.appendChild(createSvgPath("M3 17.2v4.5h4.5l11-11.1-4.5-4.5L3 17.2zm18.7-10.3c.4-.4.4-1 0-1.4l-3.1-3.1c-.4-.4-1-.4-1.4 0l-2.2 2.2 4.5 4.5 2.2-2.2z"));
      edit.onclick = function (event) {
        event.stopPropagation();
        openEditModal(slot);
      };

      item.appendChild(main);
      if (slot.selected) {
        const dot = document.createElement("div");
        dot.className = "k1c-cfs-loaded-dot";
        dot.title = "Loaded";
        item.appendChild(dot);
      }
      item.appendChild(edit);
      gridEl.appendChild(item);
    });

    const selectedSlotData = latestSlots.find(function (s) { return s.slot === selectedSlot; });
    const isLoaded = !!(selectedSlotData && selectedSlotData.selected);
    const isPresent = !!(selectedSlotData && selectedSlotData.present);
    if (feedBtnEl) {
      feedBtnEl.disabled = isLoaded || !isPresent;
      var feedTextEl = feedBtnEl.querySelector("span");
      if (feedTextEl) feedTextEl.textContent = (isPresent && !isLoaded) ? "Switch" : "Feed";
    }
    if (retractBtnEl) retractBtnEl.disabled = !isPresent;

    updateStatus(connected);
    updateHumidity(latestHumidity, latestTemp);
  }

  async function poll() {
    try {
      const response = await fetch(BASE + "/api/cfs", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      latestHumidity = data.cfs_humidity;
      latestTemp = data.cfs_temp;
      render(Array.isArray(data.slots) ? data.slots : [], !!data.connected);
    } catch (error) {
      updateStatus(false);
    }
  }

  function startPolling() {
    if (timer) return;
    poll();
    timer = window.setInterval(poll, POLL_MS);
  }

  function stopPolling() {
    if (!timer) return;
    window.clearInterval(timer);
    timer = null;
  }

  function ensurePanelCard() {
    let card = document.getElementById(CARD_ID);
    if (card) {
      root = document.getElementById(ROOT_ID) || root;
      gridEl = root ? root.querySelector(".k1c-cfs-grid") : gridEl;
      humidityLabelEl = card.querySelector(".k1c-cfs-humidity-label") || humidityLabelEl;
      return card;
    }
    return buildPanelCard();
  }

  function findDashboardColumn() {
    const consoleCard = document.querySelector("main .miniconsole-panel");
    if (consoleCard) {
      const col = consoleCard.closest(".col");
      if (col) return { column: col, after: consoleCard };
    }
    const temperaturesCard = document.querySelector("main .temperature-panel");
    if (temperaturesCard) {
      const col = temperaturesCard.closest(".col");
      if (col) return { column: col, after: temperaturesCard };
    }
    const macrosCard = document.querySelector("main .macros-panel");
    if (macrosCard) {
      const col = macrosCard.closest(".col");
      if (col) return { column: col, after: macrosCard };
    }
    const firstPanel = document.querySelector("main .v-card.panel");
    if (firstPanel) {
      const col = firstPanel.closest(".col");
      if (col) return { column: col, after: firstPanel };
    }
    return null;
  }

  function mountInDashboard() {
    const target = findDashboardColumn();
    if (!target || !target.column) return false;
    const card = ensurePanelCard();
    if (card.parentElement !== target.column) {
      if (target.after && target.after.parentElement === target.column) {
        target.after.insertAdjacentElement("afterend", card);
      } else {
        target.column.appendChild(card);
      }
    }
    const floatWrap = document.getElementById(FLOAT_ID);
    if (floatWrap) floatWrap.remove();
    return true;
  }

  function showFloatingFallback() {
    if (mountInDashboard()) return;
    let wrap = document.getElementById(FLOAT_ID);
    const card = ensurePanelCard();
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = FLOAT_ID;
      const shell = document.createElement("div");
      shell.className = CARD_ID + "-shell";
      wrap.appendChild(shell);
      document.body.appendChild(wrap);
    }
    const shell = wrap.firstElementChild;
    if (shell && card.parentElement !== shell) shell.appendChild(card);
  }

  function ensureMounted() {
    return mountInDashboard();
  }

  function watchLayout() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(function () {
      ensureMounted();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleFallback() {
    if (floatTimer) window.clearTimeout(floatTimer);
    floatTimer = window.setTimeout(function () {
      if (!ensureMounted()) showFloatingFallback();
    }, FLOAT_AFTER_MS);
  }

  function init() {
    ensurePanelCard();
    ensureMounted();
    watchLayout();
    scheduleFallback();
    startPolling();
    window.setInterval(function () {
      ensureMounted();
    }, RETRY_MS);
  }

  window.setTimeout(init, 800);
  window.addEventListener("beforeunload", function () {
    stopPolling();
    closeModal();
  });
})();
