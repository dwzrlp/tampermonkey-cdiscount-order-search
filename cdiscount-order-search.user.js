// ==UserScript==
// @name         Cdiscount 订单搜索（黑色简洁版｜图标+多语言+关键词过滤+订单号直达）
// @namespace    https://github.com/dwzrlp/tampermonkey-cdiscount-order-search
// @version      1.4.6
// @description  在“Mes commandes”等页面添加黑色搜索栏：带图标，支持关键词过滤与订单号直达；多语言自动切换；清空恢复/长按刷新；针对 account/home.html 精准插入到 .myLastOrderTitle 后面，带自动等待与DOM监听。
// @author       HyperNovaSigma
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

    const isHomeAccount = () => /clients\.cdiscount\.com\/account\/home\.html/i.test(location.href);

    // —— 启用条件（含 account/home.html） —— //
    const isOrderPage = () => {
        if (isHomeAccount()) return true;
        const u = location.href.toLowerCase();
        const t = (document.body.innerText || "").toLowerCase();
        return /mes-?commandes|commande|orderhistory|suivi-?commande/.test(u) ||
            /mes commandes|commande du|voir le d[ée]tail|voir ma commande/.test(t);
    };
    if (!isOrderPage()) return;

    // —— 样式 —— //
    GM_AddStyles();

    // —— 工具函数 —— //
    const norm = (s) => (s || "").toString().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

    function findOrderCards() {
        return [...document.querySelectorAll("div,section,article,li")]
            .filter(el =>
                el.offsetHeight > 100 &&
                /(commande du|voir le d[ée]tail|voir ma commande|€|quantit[ée]|livr[ée]|annul[ée]e)/i.test(el.innerText || "")
            )
            .slice(0, 400);
    }

    // 等待选择器出现（带超时）+ MutationObserver
    function waitForSelector(selector, { timeout = 10000, root = document } = {}) {
        return new Promise((resolve) => {
            const found = root.querySelector(selector);
            if (found) return resolve(found);

            const obs = new MutationObserver(() => {
                const el = root.querySelector(selector);
                if (el) {
                    obs.disconnect();
                    resolve(el);
                }
            });
            obs.observe(root, { childList: true, subtree: true });

            setTimeout(() => {
                obs.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    function createBar() {
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
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 105.3 14.3l4.7 4.7 1.4-1.4-4.7-4.7A8 8 0 0010 2zm0 2a6 6 0 110 12A6 6 0 0110 4z"/></svg>
        <span>${L.search}</span>
      </button>

      <button id="cdbar-reset" class="cdbar-btn reset" title="${L.reset}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 6V3L8 7l4 4V8c2.8 0 5 2.2 5 5a5 5 0 11-8.5-3.5l-1.4-1.4A7 7 0 1019 13c0-3.9-3.1-7-7-7z"/></svg>
        <span>${L.reset}</span>
      </button>
    `;
        return bar;
    }

    function mountBarAfter(target) {
        if (!target) return false;
        if (document.querySelector(".cdbar")) return true; // 已存在
        const bar = createBar();
        const parent = target.parentElement || document.querySelector("main") || document.body;
        if (target.nextSibling) parent.insertBefore(bar, target.nextSibling);
        else parent.appendChild(bar);
        bindBarEvents(bar);
        return true;
    }

    function mountFallback() {
        if (document.querySelector(".cdbar")) return true;
        const anchor = [...document.querySelectorAll("h1,h2,[role='heading']")]
            .find(h => /mes commandes|mes commande|mes\s+commandes/i.test((h.textContent || "").toLowerCase()));
        const container = anchor?.parentElement || document.querySelector("main") || document.body;
        const bar = createBar();
        container.prepend(bar);
        bindBarEvents(bar);
        return true;
    }

    function bindBarEvents(bar) {
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

            // 订单号直达
            if (/^[a-z0-9\-]{6,}$/i.test(raw)) {
                location.href = `https://clients.cdiscount.com/DisplayOrderTrackingByScopusId/${raw}.html`;
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

        // 长按重置 = 刷新（保险）
        let timer;
        $reset.addEventListener("mousedown", () => timer = setTimeout(() => location.reload(), 1000));
        ["mouseup","mouseleave"].forEach(ev => $reset.addEventListener(ev, () => clearTimeout(timer)));
    }

    async function boot() {
        if (!document.body) return;

        // 1) 若是 account/home.html：等待 .myLastOrderTitle 出现后插入其后
        if (isHomeAccount()) {
            const block = await waitForSelector(".myLastOrderTitle", { timeout: 10000 });
            if (block) {
                // 可选校验：h2 文本包含 “Ma dernière commande”（忽略重音/大小写）
                const txt = norm(block.textContent || "");
                if (/ma derniere commande/.test(txt)) {
                    mountBarAfter(block);
                    return;
                }
                // 即使未匹配到法语文案，也照样插入
                mountBarAfter(block);
                return;
            }
            // 超时兜底
            mountFallback();
            return;
        }

        // 2) 其它订单相关页面：直接常规插入（仍可被 SPA 导航触发多次，已做幂等）
        mountFallback();

        // 3) 监听 SPA/异步变化：若后续加载了目标区域且尚未插入，则补插一次
        const mo = new MutationObserver(() => {
            if (!document.querySelector(".cdbar")) {
                const candidate = document.querySelector(".myLastOrderTitle");
                if (candidate) mountBarAfter(candidate);
            }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
        // 注：如果你担心性能，可在成功插入后 mo.disconnect()。这里保持监听以防页面替换。
    }

    // —— 启动 —— //
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }

    // —— 样式注入函数 —— //
    function GM_AddStyles() {
        const css = `
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
    `;
        if (typeof GM_addStyle === "function") GM_addStyle(css);
        else {
            const style = document.createElement("style");
            style.textContent = css;
            document.head.appendChild(style);
        }
    }
})();