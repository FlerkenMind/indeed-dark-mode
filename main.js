// ==UserScript==
// @name         Indeed Dark Mode
// @namespace    https://github.com/FlerkenMind
// @version      1.0.0
// @description  Dark mode pour Indeed (toutes les versions pays) : texte clair lisible, boutons et liens aux bonnes couleurs, logos intacts. Alt+Maj+D pour activer / désactiver.
// @author       FlerkenMind
// @license      MIT
// @homepageURL  https://github.com/FlerkenMind/vinted-dark-mode
// @supportURL   https://github.com/FlerkenMind/vinted-dark-mode/issues
// @match        *://*.indeed.com/*
// @noframes
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = true; 
  const STORAGE_KEY = 'indeedDarkEnabled';
  const HUE_KEY = 'indeedDarkKeepHue';
  const PAUSE = 'idm-pause';          
  const KEEP = 'data-idm-keep';       
  const LIFT = 'data-idm-lift';       
  const SCRIM = 'data-idm-scrim';     
  const log = (...a) => { if (DEBUG) console.log('[Indeed Dark Mode]', ...a); };

  const MEDIA = `img, video, canvas, embed, object,
    iframe[src*="youtube" i], iframe[src*="youtu.be" i], iframe[src*="vimeo" i], iframe[src*=".pdf" i],
    [style*="background-image"], [style*="background: url"], [style*="background:url"]`;

  const buildCSS = () => `
    @media not print {
      html {
        background: #fff !important;
        filter: ${filterValue()} !important;
      }
      ${MEDIA} {
        filter: ${filterValue()} !important;
      }
      [style*="background-image"] :is(img, video, canvas),
      [style*="background: url"] :is(img, video, canvas),
      [style*="background:url"] :is(img, video, canvas) {
        filter: none !important;
      }

      [${KEEP}] {
        filter: ${filterValue()} !important;
      }
      [${KEEP}] :is(${MEDIA}) {
        filter: none !important;
      }

         on remonte ces éléments (flèches de carrousel, boutons sur une image…). */
      [${LIFT}] {
        z-index: 1 !important;
      }

      html:not(.${PAUSE}) [${SCRIM}] {
        background-color: var(--idm-scrim) !important;
      }

      /* Pause : site déjà sombre, ou visionneuse de photos ouverte */
      html.${PAUSE} {
        filter: none !important;
      }
      html.${PAUSE} :is(${MEDIA}, [${KEEP}]) {
        filter: none !important;
      }
    }
  `;

  let enabled = true;
  try { enabled = GM_getValue(STORAGE_KEY, true); } catch (e) {}

  let keepHue = true;
  try { keepHue = GM_getValue(HUE_KEY, true); } catch (e) {}
  const filterValue = () => (keepHue ? 'invert(1) hue-rotate(180deg)' : 'invert(1)');

  let styleEl = null;
  let styleSeen = false; 
  let sheet = null;

  function inject() {
    styleSeen = false;
    if (typeof GM_addStyle === 'function') {
      try {
        const el = GM_addStyle(buildCSS());
        if (el && el.setAttribute) { el.setAttribute('data-idm-style', ''); styleEl = el; styleSeen = !!el.isConnected; return; }
      } catch (e) {}
    }
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(buildCSS());
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return;
    } catch (e) {}
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-idm-style', '');
    styleEl.textContent = buildCSS();
    (document.head || document.documentElement).appendChild(styleEl);
    styleSeen = true;
  }

  function remove() {
    document.querySelectorAll('style[data-idm-style]').forEach((x) => x.remove());
    if (styleEl) { styleEl.remove(); styleEl = null; }
    if (sheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      sheet = null;
    }
  }

  function parseColor(c) {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const luminance = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  const isDarkBg = (el, minAlpha) => {
    const c = parseColor(getComputedStyle(el).backgroundColor);
    return !!c && c.a >= minAlpha && luminance(c) < 0.3;
  };

  function pageIsDark() {
    const body = document.body;
    if (!body) return false;
    const vw = window.innerWidth, vh = window.innerHeight;
    const chain = [];
    let el = body;
    for (let i = 0; i < 3 && el; i++) { chain.unshift(el); el = el.firstElementChild; }
    chain.push(document.documentElement);
    for (const n of chain) {
      if (n !== document.documentElement) {
        const r = n.getBoundingClientRect();
        if (r.width < vw * 0.95 || r.height < vh * 0.5) continue;
      }
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a >= 0.9) return luminance(c) < 0.3;
    }
    return false;
  }

  function viewerOpen() {
    if (!document.body) return false;
    const vw = window.innerWidth, vh = window.innerHeight;
    let layer = false, photo = false;
    for (const el of document.elementsFromPoint(vw / 2, vh / 2).slice(0, 20)) {
      if (el === document.documentElement || el === document.body) continue;
      const r = el.getBoundingClientRect();
      if (!layer && r.width >= vw * 0.9 && r.height >= vh * 0.9) {
        const cs = getComputedStyle(el);
        const z = parseInt(cs.zIndex, 10);
        if (cs.position === 'fixed' && Number.isFinite(z) && z > 0) layer = true;
      }
      if (!photo && /^(IMG|VIDEO|CANVAS)$/.test(el.tagName) && r.width >= vw * 0.3 && r.height >= vh * 0.3) photo = true;
    }
    return layer && photo;
  }

  function checkPause() {
    const root = document.documentElement;
    if (!root) return;
    let pause = false;
    try { pause = enabled && (pageIsDark() || viewerOpen()); } catch (e) {}
    if (root.classList.contains(PAUSE) !== pause) log(pause ? 'pause (site déjà sombre ou visionneuse)' : 'reprise');
    root.classList.toggle(PAUSE, pause);
  }

  const PANEL_SEL = 'div, section, aside, header, footer, nav, ul, article, main';
  const mark = (el, why) => {
    el.querySelectorAll(`[${KEEP}]`).forEach((x) => x.removeAttribute(KEEP));
    el.setAttribute(KEEP, '');
    log(why, el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
  };

  const HUE180_INV = [[-0.574, 1.430, 0.144], [0.426, 0.430, 0.144], [0.426, 1.430, -0.856]];
  function preimage(c) { // couleur x telle que filtre(x) = c
    const h = keepHue ? HUE180_INV.map((row) => row[0] * c.r + row[1] * c.g + row[2] * c.b) : [c.r, c.g, c.b];
    const cl = (v) => Math.max(0, Math.min(255, Math.round(255 - v)));
    return `rgba(${cl(h[0])}, ${cl(h[1])}, ${cl(h[2])}, ${c.a})`;
  }
  function applyScrim(el) {
    const c = parseColor(el.getAttribute(SCRIM));
    if (c) el.style.setProperty('--idm-scrim', preimage(c));
  }

  function isScrim(el, vw, vh) {
    if (el === document.body || el === document.documentElement) return false;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.9 || r.height < vh * 0.9) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    const c = parseColor(cs.backgroundColor);
    return !!c && c.a >= 0.15 && c.a <= 0.95 && luminance(c) < 0.3;
  }

  function scanOverlays() {
    if (!document.body) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const cands = new Set(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
    for (const c of document.body.children) { cands.add(c); for (const g of c.children) cands.add(g); }
    for (const d of [...cands]) if (d.parentElement) for (const s of d.parentElement.children) cands.add(s);
    for (const el of cands) {
      if (el.hasAttribute(SCRIM)) continue;
      if (isScrim(el, vw, vh)) {
        el.setAttribute(SCRIM, getComputedStyle(el).backgroundColor);
        applyScrim(el);
        log('voile de modale pré-inversé :', el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : (el.id ? '#' + el.id : '')));
      }
    }
  }

  function scanDark(root) {
    if (!root || root.nodeType !== 1) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const minArea = vw * vh * 0.06;
    const area = (r) => r.width * r.height;
    const rr = root.getBoundingClientRect();
    if (area(rr) < minArea * 0.5) return;

    const list = root.matches(PANEL_SEL) ? [root] : [];
    let n = 0;
    for (const el of root.querySelectorAll(PANEL_SEL)) { list.push(el); if (++n > 4000) break; }

    for (const el of list) {
      if (el === document.body || el === document.documentElement) continue;
      if (el.hasAttribute(KEEP) || el.closest(`[${KEEP}]`)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 160 || r.height < 100 || area(r) < minArea) continue;
      if (r.width >= vw * 0.98 && r.height >= vh * 0.9) continue; // enveloppe de page : jamais
      if (!isDarkBg(el, 0.5)) continue;
      mark(el, 'zone déjà sombre conservée :');
    }
  }

  const lifted = new WeakMap(); // média -> nombre d'enfants du parent au moment du traitement

  function lift(el, depth) {
    if (depth === 0) {
      const media = el.matches('img, video, canvas') ? el : el.querySelector('img, video, canvas');
      if (media) {
        const r = media.getBoundingClientRect();
        if (r.width >= 80 && r.height >= 80) return;
      }
    }
    const cs = getComputedStyle(el);
    if (cs.position !== 'static' && cs.zIndex === 'auto') el.setAttribute(LIFT, '');
    if (depth >= 3) return;
    let n = 0;
    for (const c of el.children) { if (n++ >= 12) break; lift(c, depth + 1); }
  }

  function liftControls() {
    if (!enabled || !document.body) return;
    for (const m of document.querySelectorAll(`img, video, canvas, [${KEEP}]`)) {
      const count = m.parentElement ? m.parentElement.childElementCount : 0;
      if (lifted.get(m) === count) continue;
      lifted.set(m, count);
      let node = m;
      for (let d = 0; d < 3 && node.parentElement && node !== document.body; d++) {
        let k = 0;
        for (let s = node.previousElementSibling; s && k < 8; s = s.previousElementSibling, k++) lift(s, 0);
        node = node.parentElement;
      }
    }
  }

  const HUE180 = [[-0.574, 1.430, 0.144], [0.426, 0.430, 0.144], [0.426, 1.430, -0.856]];
  const clamp255 = (v) => Math.max(0, Math.min(255, v));
  function afterFilter(c) {
    let v = [255 - c.r, 255 - c.g, 255 - c.b];
    if (keepHue) v = HUE180.map((row) => clamp255(row[0] * v[0] + row[1] * v[1] + row[2] * v[2]));
    return { r: v[0], g: v[1], b: v[2] };
  }
  const lin = (u) => { u /= 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
  const relLum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a) });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  function effectiveBg(el) {
    const layers = [];
    let image = false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') image = true;
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
    }
    let base = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return { color: base, image };
  }

  const hasOwnText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true; return false; };

  function audit() {
    if (!document.body) return null;
    const paused = document.documentElement.classList.contains(PAUSE);
    const rows = [];
    let total = 0, scanned = 0;
    for (const el of document.body.querySelectorAll('*')) {
      if (++scanned > 8000) break;
      if (!hasOwnText(el)) continue;
      if (el.closest(`[${KEEP}], svg, img, video, canvas, script, style, noscript`) && !paused) {
        if (el.closest(`[${KEEP}]`)) continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      const fg0 = parseColor(cs.color);
      if (!fg0) continue;
      const bgInfo = effectiveBg(el);
      let fg = fg0.a < 1 ? over(fg0, bgInfo.color) : fg0;
      let bg = bgInfo.color;
      if (!paused) { fg = afterFilter(fg); bg = afterFilter(bg); }
      const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      const ratio = contrast(fg, bg);
      total++;
      if (ratio < need) {
        rows.push({
          élément: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''),
          texte: el.textContent.trim().slice(0, 40),
          contraste: Math.round(ratio * 10) / 10,
          requis: need,
          texte_après: hex(fg),
          fond_après: hex(bg),
          note: bgInfo.image ? 'fond en image : à vérifier à l’œil' : '',
        });
      }
    }
    rows.sort((a, b) => a.contraste - b.contraste);
    console.log(`[Indeed Dark Mode] audit de lisibilité : ${total} textes vérifiés, ${rows.length} sous le seuil` +
      (paused ? ' (mode pause : couleurs d’origine du site)' : '') + ` · mode ${keepHue ? 'teintes conservées' : 'images fidèles'}`);
    if (rows.length) console.table(rows.slice(0, 25));
    return { total, rows, paused };
  }

  const pending = new Set();
  let timer = 0;

  function flush() {
    checkPause();
    if (!enabled) { pending.clear(); return; }
    const nodes = [...pending].slice(0, 80);
    pending.clear();
    for (const n of nodes) if (n.isConnected) { try { scanDark(n); } catch (e) {} }
    try { scanOverlays(); } catch (e) {}
    try { liftControls(); } catch (e) {}
  }

  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(flush, ms); };
  const rescanAll = () => { if (document.body) pending.add(document.body); schedule(50); };

  function apply() {
    remove();
    if (enabled) { inject(); rescanAll(); }
    else document.documentElement && document.documentElement.classList.remove(PAUSE);
    checkPause();
  }

  function toggle() {
    enabled = !enabled;
    try { GM_setValue(STORAGE_KEY, enabled); } catch (e) {}
    apply();
  }

  function toggleHue() {
    keepHue = !keepHue;
    try { GM_setValue(HUE_KEY, keepHue); } catch (e) {}
    log(keepHue ? 'mode : teintes conservées' : 'mode : images fidèles');
    document.querySelectorAll(`[${SCRIM}]`).forEach(applyScrim);
    apply();
  }

  apply();
  log('chargé, actif :', enabled);
  if (typeof window.__IDM_TEST !== 'undefined') window.__idm = { audit, flush, scanOverlays };

  new MutationObserver((records) => {
    if (styleEl && styleEl.isConnected) styleSeen = true;
    else if (enabled && styleEl && styleSeen) apply(); // le site a retiré notre style
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) pending.add(n);
    schedule(250);
  }).observe(document, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', () => { rescanAll(); setTimeout(rescanAll, 1500); setTimeout(rescanAll, 4000); });
  window.addEventListener('load', () => setTimeout(rescanAll, 300));
  window.addEventListener('resize', () => { clearTimeout(window.__idmResize); window.__idmResize = setTimeout(rescanAll, 300); }, { passive: true });
  const afterInteraction = () => { setTimeout(() => { checkPause(); try { scanOverlays(); } catch (e) {} }, 200); setTimeout(checkPause, 600); };
  document.addEventListener('click', afterInteraction, true);
  document.addEventListener('keyup', () => setTimeout(checkPause, 150), true);

  try {
    GM_registerMenuCommand('Activer / désactiver le Dark Mode', toggle);
    GM_registerMenuCommand('Couleurs : teintes conservées ↔ images fidèles', toggleHue);
    GM_registerMenuCommand('Audit de lisibilité (voir la console)', audit);
  } catch (e) {}

  window.addEventListener('keydown', (e) => {
    if (!(e.altKey && e.shiftKey)) return;
    if (e.code === 'KeyD') { e.preventDefault(); toggle(); }
    else if (e.code === 'KeyH') { e.preventDefault(); toggleHue(); }
    else if (e.code === 'KeyA') { e.preventDefault(); audit(); }
  });
})();
