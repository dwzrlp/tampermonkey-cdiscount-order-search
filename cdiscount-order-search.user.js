// ==UserScript==
// @name         Cdiscount 订单搜索（黑色简洁版｜图标+多语言+关键词过滤+订单号跳转）
// @namespace    https://github.com/dwzrlp/tampermonkey-cdiscount-order-search
// @version      1.4.4
// @description  在“Mes commandes”页添加一个黑色搜索栏：带图标，中等高度；支持关键词过滤、订单号直达、清空恢复、长按刷新，多语言自动切换，无额外文字提示，更简洁。
// @author       Lipu
// @match        *://*.cdiscount.fr/*
// @match        *://*.cdiscount.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @homepageURL  https://github.com/dwzrlp/tampermonkey-cdiscount-order-search
// @supportURL   https://github.com/dwzrlp/tampermonkey-cdiscount-order-search/issues
// @downloadURL  https://raw.githubusercontent.com/dwzrlp/tampermonkey-cdiscount-order-search/refs/heads/main/cdiscount-order-search.user.js
// @updateURL    https://raw.githubusercontent.com/dwzrlp/tampermonkey-cdiscount-order-search/refs/heads/main/cdiscount-order-search.user.js
// ==/UserScript==

(function () {
    "use strict";

    // —— 多语言 —— //
    const i18n = {
        zh: { search: "搜索", reset: "重置", placeholder: "关键词或订单号…" },
        fr: { search: "Rechercher", reset: "Réinitialiser", placeholder: "Mot-clé ou n° commande…" },
        en: { search: "Search", reset: "Reset", placeholder: "Keyword or order number…" },
    };
    const lang = (navigator.language || "en").toLowerCase();
    const L = lang.startsWith("zh") ? i18n.zh : lang.startsWith("fr") ? i18n.fr : i18n.en;

    // —— 启用条件 —— //
    const isOrderPage = () => {
        const u = location.href.toLowerCase();
        const t = (document.body.innerText || "").toLowerCase();
        return /mes-?commandes|commande|orderhistory|suivi-?commande/.test(u) ||
            /mes commandes|commande du|voir le d[ée]tail|voir ma commande/.test(t);
    };
    if (!isOrderPage()) return;

    // —— 样式（黑色·简洁·图标） —— //
    GM_addStyle(`
    .cdbar {
      display: flex; align-items: center; gap: 8px;
      background: rgba(0,0,0,0.85);
      padding: 10px 12px;
      border-radius: 8px;
      margin: 10px 0 12px;
      border: 1px solid rgba(59,130,246,0.32);
      box-shadow: 0 2px 10px rgba(0,0,0,.25);
      font: 13.5px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      color: #e5e7eb;
    }
    .cdbar-field {
      position: relative;
      flex: 1 1 auto;
      display: flex; align-items: center;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      padding: 6px 10px 6px 34px;
    }
    .cdbar-icon {
      position: absolute;
      left: 10px; top: 50%; transform: translateY(-50%);
      width: 16px; height: 16px; opacity: .9;
    }
    .cdbar-input {
      width: 100%;
      border: none; outline: none;
      background: transparent;
      color: #f3f4f6;
      font-size: 13.5px;
    }
    .cdbar-input::placeholder { color: #a1a1aa; }

    .cdbar-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 12px;
      border: none; border-radius: 6px;
      cursor: pointer; font-weight: 700; font-size: 13px;
      color: #fff; background: rgba(59,130,246,0.78);
      transition: background .2s ease, transform .05s ease;
    }
    .cdbar-btn svg { width: 16px; height: 16px; }
    .cdbar-btn:hover { background: rgba(59,130,246,0.9); }
    .cdbar-btn:active { transform: translateY(1px); }
    .cdbar-btn.reset { background: rgba(107,114,128,0.65); }
    .cdbar-btn.reset:hover { background: rgba(107,114,128,0.8); }

    .cdbar-hidden { display: none!important; }
    .cdbar-highlight { outline: 2px solid rgba(59,130,246,.85); border-radius: 6px; }
  `);

    // —— 功能 —— //
    const norm = (s) => (s || "").toString().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

    function findOrderCards() {
        return [...document.querySelectorAll("div,section,article,li")]
            .filter(el => el.offsetHeight > 100 && /(commande du|voir le d[ée]tail|voir ma commande|€|quantit[ée]|livr[ée]|annul[ée]e)/i.test(el.innerText || ""))
            .slice(0, 400);
    }

    function insertBar() {
        if (document.querySelector(".cdbar")) return;
        const anchor = [...document.querySelectorAll("h1,h2,[role='heading']")].find(h => /mes commandes/i.test(h.textContent || ""));
        const container = anchor?.parentElement || document.querySelector("main") || document.body;

        const bar = document.createElement("div");
        bar.className = "cdbar";
        bar.innerHTML = `
      <div class="cdbar-field">
        <svg class="cdbar-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#c7d2fe" d="M10 2a8 8 0 105.3 14.3l4.7 4.7 1.4-1.4-4.7-4.7A8 8 0 0010 2zm0 2a6 6 0 110 12A6 6 0 0110 4z"/>
        </svg>
        <input id="cdbar-q" class="cdbar-input" type="text" placeholder="${L.placeholder}" />
      </div>

      <button id="cdbar-search" class="cdbar-btn" title="${L.search}">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M10 2a8 8 0 105.3 14.3l4.7 4.7 1.4-1.4-4.7-4.7A8 8 0 0010 2zm0 2a6 6 0 110 12A6 6 0 0110 4z"/></svg>
        <span>${L.search}</span>
      </button>

      <button id="cdbar-reset" class="cdbar-btn reset" title="${L.reset}">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 6V3L8 7l4 4V8c2.8 0 5 2.2 5 5a5 5 0 11-8.5-3.5l-1.4-1.4A7 7 0 1019 13c0-3.9-3.1-7-7-7z"/></svg>
        <span>${L.reset}</span>
      </button>
    `;
        if (anchor && anchor.nextSibling) anchor.parentElement.insertBefore(bar, anchor.nextSibling);
        else container.prepend(bar);

        const $q = bar.querySelector("#cdbar-q");
        const $search = bar.querySelector("#cdbar-search");
        const $reset = bar.querySelector("#cdbar-reset");

        function restoreAll() {
            document.querySelectorAll(".cdbar-hidden").forEach(n => n.classList.remove("cdbar-hidden"));
            document.querySelectorAll(".cdbar-highlight").forEach(n => n.classList.remove("cdbar-highlight"));
        }

        function doSearch() {
            const raw = $q.value.trim();
            const q = norm(raw);

            if (/^[a-z0-9\-]{6,}$/i.test(raw)) {
                window.open(`https://clients.cdiscount.com/DisplayOrderTrackingByScopusId/${raw}.html`, "_blank");
                return;
            }
            if (!q) return restoreAll();

            const terms = q.split(/\s+/).filter(Boolean);
            const cards = findOrderCards();
            cards.forEach(el => {
                const ok = terms.every(t => norm(el.innerText).includes(t));
                el.classList.toggle("cdbar-hidden", !ok);
                el.classList.toggle("cdbar-highlight", ok);
            });
        }

        $search.addEventListener("click", doSearch);
        $reset.addEventListener("click", restoreAll);
        $q.addEventListener("keydown", e => {
            if (e.key === "Enter") doSearch();
            if (e.key === "Escape") { $q.value = ""; restoreAll(); }
        });
        $q.addEventListener("input", () => { if ($q.value === "") restoreAll(); });

        let timer;
        $reset.addEventListener("mousedown", () => timer = setTimeout(() => location.reload(), 1000));
        ["mouseup","mouseleave"].forEach(ev => $reset.addEventListener(ev, () => clearTimeout(timer)));
    }

    if (document.body) insertBar();
    else document.addEventListener("DOMContentLoaded", insertBar);
})();