// ==UserScript==
// @name         K1C CFS Panel for Mainsail
// @namespace    local.k1c.cfs
// @version      0.1.0
// @description  Injeta um painel simples do CFS no Mainsail usando a API do backend externo.
// @match        http://192.168.1.242:4409/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  window.K1C_CFS_URL = "http://127.0.0.1:8010";

  if (window.__k1c_cfs_loader_loaded) return;
  window.__k1c_cfs_loader_loaded = true;

  const script = document.createElement("script");
  script.src = window.K1C_CFS_URL + "/static/mainsail-panel.js?ts=" + Date.now();
  script.onload = function () {
    console.log("[K1C CFS] painel carregado");
  };
  script.onerror = function () {
    console.error("[K1C CFS] falha ao carregar " + script.src);
  };
  document.head.appendChild(script);
})();
