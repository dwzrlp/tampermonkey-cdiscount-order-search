// ==UserScript==
// @name         Cdiscount 订单搜索（多语言+关键词过滤+订单号跳转）
// @namespace    https://github.com/dwzrlp/tampermonkey-cdiscount-order-search
// @version      1.3.0
// @description  Mes commandes 页面内嵌搜索：关键词仅保留匹配；输入订单号直达 https://clients.cdiscount.com/DisplayOrderTrackingByScopusId/[ID].html；支持多语言自动切换与一键恢复。
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

  // --- 多语言字典 ---
  const i18n = {
    zh: {
      search: "搜索",
      reset: "重置",
      placeholder: "输入商品关键词或订单号…",
      ready: "就绪",
      tip: "输入关键词或订单号后点击“搜索”",
      restored: "已恢复全部订单",
      showing: (m, t) => `只保留匹配：${m}/${t}`,
      jumping: (id) => `正在跳转到订单 ${id} …`,
    },
    fr: {
      search: "Rechercher",
      reset: "Réinitialiser",
      placeholder: "Saisissez un mot-clé ou un numéro de commande…",
      ready: "Prêt",
      tip: "Entrez un mot-clé ou un numéro de commande puis cliquez sur « Rechercher »",
      restored: "Toutes les commandes sont affichées",
      showing: (m, t) => `Commandes correspondantes : ${m}/${t}`,
      jumping: (id) => `Ouverture de la commande ${id} …`,
    },
    en: {
      search: "Search",
      reset: "Reset",
      placeholder: "Enter product keyword or order number…",
      ready: "Ready",
      tip: "Enter a keyword or order number, then click 'Search'",
      restored: "All orders restored",
      showing: (m, t) => `Showing matches: ${m}/${t}`,
      jumping: (id) => `Opening order ${id}...`,
    },
  };

  const lang = (navigator.language || "en").toLowerCase();
  const L =
    lang.startsWith("zh") ? i18n.zh :
    lang.startsWith("fr") ? i18n.fr :
    i18n.en;

  const norm = (s) =>
    (s || "").toString().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

  const isOrderPage = () => {
    const u = location.href.toLowerCase();
    const t = (document.body.innerText || "").toLowerCase();
    return (
      /mes-?commandes|commande|orderhistory|suivi-?commande/.test(u) ||
      /mes commandes|commande du|voir le d[ée]tail|voir ma commande/.test(t)
    );
  };
  if (!isOrderPage()) return;

  GM_addStyle(`
    .cds-bar{width:100%;box-sizing:border-box;margin:12px 0 16px;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;display:flex;flex-wrap:wrap;gap:10px;align-items:center;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
    .cds-bar input[type=text]{flex:1 1 360px;min-width:260px;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;background:#fff}
    .cds-bar button{padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;background:#f3f4f6;cursor:pointer}
    .cds-bar button.primary{background:#2d6cdf;color:#fff;border-color:#2454a8}
    .cds-bar .muted{opacity:.8;font-size:12px}
    .cds-highlight{outline:2px solid #2d6cdf!important;outline-offset:2px;border-radius:8px}
    .cds-hidden{display:none!important}
  `);

  function closestOrderCard(from){
    const kw=/(commande du|voir le d[ée]tail|voir ma commande|commande annul[ée]e|livr[ée]|quantit[ée]|€)/i;
    let el=from;
    while(el&&el!==document.body){
      const txt=(el.textContent||"").trim();
      if(txt.length>60 && kw.test(txt) && el.tagName!=="MAIN") return el;
      el=el.parentElement;
    }
    return null;
  }

  function findOrderCards(excludeEl){
    const actions=[...document.querySelectorAll("a,button")]
      .filter(a=>/voir le d[ée]tail|voir ma commande|d[ée]tails?/i.test((a.textContent||"").toLowerCase()));
    const aCards=actions.map(closestOrderCard).filter(Boolean);
    const heads=[...document.querySelectorAll("*")]
      .filter(n=>/commande du/i.test((n.textContent||"").toLowerCase()));
    const hCards=heads.map(closestOrderCard).filter(Boolean);
    let cards=[...new Set([...aCards,...hCards])];
    if(!cards.length){
      const main=document.querySelector("main")||document.body;
      cards=[...main.querySelectorAll(":scope > div, section, article, li")]
        .filter(el=>(el.textContent||"").trim().length>100 && /(commande|voir|d[ée]tail|€|quantit[ée])/i.test(el.textContent||""))
        .slice(0,300);
    }
    return cards.filter(el=>{
      if(!el) return false;
      if(el===document.body||el===document.documentElement) return false;
      if(["HTML","BODY","MAIN","HEADER","FOOTER","NAV"].includes(el.tagName)) return false;
      if(excludeEl && (el===excludeEl || el.contains(excludeEl) || excludeEl.contains(el))) return false;
      return true;
    });
  }

  function insertBar(){
    if(document.querySelector(".cds-bar")) return;

    const anchor=[...document.querySelectorAll("h1,h2,[role='heading']")]
      .find(h=>/mes commandes/i.test((h.textContent||"").toLowerCase()));
    const container=anchor?.parentElement||(document.querySelector("main")||document.body);

    const bar=document.createElement("div");
    bar.className="cds-bar";
    bar.innerHTML=`
      <input id="cds-q" type="text" placeholder="${L.placeholder}" />
      <button id="cds-search" class="primary">${L.search}</button>
      <button id="cds-reset">${L.reset}</button>
      <span id="cds-stat" class="muted">${L.ready}</span>
    `;
    if(anchor && anchor.nextSibling) anchor.parentElement.insertBefore(bar, anchor.nextSibling);
    else container.prepend(bar);

    const $q=bar.querySelector("#cds-q");
    const $search=bar.querySelector("#cds-search");
    const $reset=bar.querySelector("#cds-reset");
    const $stat=bar.querySelector("#cds-stat");

    function globalRestore(){
      document.querySelectorAll(".cds-hidden").forEach(n=>n.classList.remove("cds-hidden"));
      document.querySelectorAll(".cds-highlight").forEach(n=>n.classList.remove("cds-highlight"));
      $stat.textContent=L.restored;
    }

    function doSearch(){
      const raw=$q.value.trim();
      const q=norm(raw);

      // 订单号跳转
      if(/^[a-z0-9\-]{6,}$/i.test(raw)){
        const url=`https://clients.cdiscount.com/DisplayOrderTrackingByScopusId/${raw}.html`;
        window.open(url,"_blank");
        $stat.textContent=L.jumping(raw);
        return;
      }

      if(!q){ globalRestore(); return; }

      const terms=q.split(/\s+/).filter(Boolean);
      const cards=findOrderCards(bar);
      let matched=0; const set=new Set();

      cards.forEach(el=>{
        const txt=norm(el.textContent||"");
        if(terms.every(t=>txt.includes(t))){ matched++; set.add(el); }
      });

      cards.forEach(el=>{
        if(set.has(el)){
          el.classList.remove("cds-hidden");
          el.classList.add("cds-highlight");
        }else{
          el.classList.add("cds-hidden");
          el.classList.remove("cds-highlight");
        }
      });

      $stat.textContent=L.showing(matched,cards.length);
    }

    function onInputChange(){ if($q.value.trim()==="") globalRestore(); }
    function hardRestore(){ location.reload(); }

    $search.addEventListener("click", doSearch);
    $reset.addEventListener("click", globalRestore);
    $q.addEventListener("input", onInputChange);
    $q.addEventListener("keydown", e=>{
      if(e.key==="Enter") doSearch();
      if(e.key==="Escape"){ $q.value=""; globalRestore(); }
    });

    let timer=null;
    $reset.addEventListener("mousedown",()=>timer=setTimeout(hardRestore,1000));
    ["mouseup","mouseleave"].forEach(ev=>$reset.addEventListener(ev,()=>clearTimeout(timer)));

    $stat.textContent=L.tip;
  }

  if(document.body) insertBar();
  else document.addEventListener("DOMContentLoaded", insertBar);

  const _ps=history.pushState;
  history.pushState=function(){
    const r=_ps.apply(this,arguments);
    setTimeout(()=>insertBar(),200);
    return r;
  };
  window.addEventListener("popstate",()=>setTimeout(()=>insertBar(),200));
})();
