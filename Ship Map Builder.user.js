// ==UserScript==
// @name         Ship Map Builder
// @namespace    http://tampermonkey.net/
// @version      3.4.0
// @description  Ship Map + SSP + YMS + Vista + FMC integration
// @author       homziukl
// @match        https://stem-eu.corp.amazon.com/url*
// @match        https://trans-logistics-eu.amazon.com/yms/*
// @match        https://trans-logistics-eu.amazon.com/fmc/*
// @updateURL    https://raw.githubusercontent.com/homziukl/Ship-Map-Builder/main/ship map builder.user.js
// @downloadURL  https://raw.githubusercontent.com/homziukl/Ship-Map-Builder/main/ship map builder.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      trans-logistics-eu.amazon.com
// @connect      jwmjkz3dsd.execute-api.eu-west-1.amazonaws.com
// @connect      fc-inbound-dock-execution-service-eu-eug1-dub.dub.proxy.amazon.com
// @connect      eu.relat.aces.amazon.dev
// @run-at       document-start
// ==/UserScript==

(function () {
'use strict';

// ============================================================
// FMC SHELL — save site code + intercept for bonus data
// ============================================================
if (/trans-logistics-eu\.amazon\.com\/fmc/i.test(location.href)) {
    const detectSite = () => {
        const m = location.pathname.match(/\/fmc\/(?:execution|dashboard|planning|excel)\/([A-Z0-9a-z]+)/i);
        return m ? m[1] : null;
    };
    const SITE = detectSite();
    if (SITE) {
        GM_setValue('shipmap_fmc_site_code', SITE);
        console.log(`[ShipMap:FMC] 📋 Site code saved: ${SITE}`);
    }
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        this._sm_url = url; this._sm_method = method;
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
        if (this._sm_url && /\/fmc\/search\/execution\/by-criteria/i.test(this._sm_url)) {
            if (body && typeof body === 'string') {
                try { GM_setValue('shipmap_fmc_captured_body', body); } catch (e) { console.debug('[ShipMap:FMC] save body failed:', e.message); }
            }
            this.addEventListener('load', () => {
                if (this.status >= 200 && this.status < 300 && this.responseText) {
                    try {
                        const resp = JSON.parse(this.responseText);
                        if (resp.success && resp.returnedObject?.records) {
                            GM_setValue('shipmap_fmc_last_response', JSON.stringify({
                                timestamp: Date.now(),
                                recordCount: resp.returnedObject.records.length,
                                site: SITE
                            }));
                        }
                    } catch (e) { console.debug('[ShipMap:FMC] parse response failed:', e.message); }
                }
            });
        }
        return origSend.apply(this, arguments);
    };
    const addBadge = () => {
        if (!document.body) return;
        const badge = document.createElement('div');
        badge.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:99999;background:rgba(22,33,62,0.92);color:#ff9900;padding:6px 14px;border-radius:8px;font:bold 11px "Amazon Ember",Arial,sans-serif;border:1px solid #ff9900;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
        badge.innerHTML = `🚢 ShipMap FMC | ${SITE || '?'} | synced ✅`;
        document.body.appendChild(badge);
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') addBadge();
    else document.addEventListener('DOMContentLoaded', addBadge);
    return;
}

// ============================================================
// YMS TOKEN CAPTURE (runs ONLY on YMS tab, then exits)
// ============================================================
if (/trans-logistics-eu\.amazon\.com\/yms/i.test(location.href)) {
    const decodeJwtPayload = (tok) => { const b64 = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(b64)); };
    const validateToken = (tok) => { try { const p = decodeJwtPayload(tok); if (p.iss !== 'YMS-1.0') return null; const nowSec = Date.now() / 1000; if (!p.exp || p.exp < nowSec + 60) return null; if (p.nbf && p.nbf > nowSec + 5) return null; const yard = p.context?.yard?.toUpperCase(); if (!yard || yard.length < 3) return null; return { yard, exp: p.exp, accountId: p.context.accountId, user: p.context.userName }; } catch { return null; } };
    const extractToken = () => { const scripts = document.querySelectorAll('script'); for (const s of scripts) { const m = (s.textContent || '').match(/ymsSecurityToken\s*=\s*["']?(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']?/); if (m) return m[1]; } for (const s of scripts) { const m2 = (s.textContent || '').match(/["']token["']\s*:\s*["'](eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']/); if (m2) return m2[1]; } const m3 = document.documentElement.innerHTML.match(/eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/); return m3 ? m3[0] : null; };
    const capture = () => { const tok = extractToken(); if (!tok) return; const info = validateToken(tok); if (!info) return; const siteKey = `yms_token_${info.yard}`; const existing = GM_getValue(siteKey, null); if (existing === tok) return; GM_setValue(siteKey, tok); GM_setValue('yms_token', tok); console.log(`[ShipMap] ✅ Token captured → ${siteKey} | yard=${info.yard}`); };
    if (document.readyState === 'complete') capture();
    else window.addEventListener('load', capture);
    setInterval(capture, 30000);
    return;
}

// ============================================================
// POLYFILL — roundRect for older Chromium
// ============================================================
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
        if (!Array.isArray(radii)) { if (typeof radii === 'undefined') radii = 0; radii = [radii, radii, radii, radii]; }
        const [tl, tr, br, bl] = radii.map(r => (typeof r === 'object' ? r.x || 0 : r) || 0);
        this.beginPath(); this.moveTo(x + tl, y); this.lineTo(x + w - tr, y); this.quadraticCurveTo(x + w, y, x + w, y + tr); this.lineTo(x + w, y + h - br); this.quadraticCurveTo(x + w, y + h, x + w - br, y + h); this.lineTo(x + bl, y + h); this.quadraticCurveTo(x, y + h, x, y + h - bl); this.lineTo(x, y + tl); this.quadraticCurveTo(x, y, x + tl, y); this.closePath(); return this;
    };
}

// ============================================================
// DEBOUNCE UTILITY
// ============================================================
function debounce(fn, ms) { let timer; return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); }; }

// ============================================================
// SILENT CATCH — log errors instead of swallowing them
// ============================================================
function silentCatch(context, fn) {
    try { return fn(); }
    catch (e) { console.debug(`[ShipMap:${context}]`, e.message); }
}

// ============================================================
// PARSE ROUTE — unified route string cleanup
// ============================================================
function parseRoute(raw, { stripPrefix = true, stripSuffix = true } = {}) {
    let r = raw || '';
    if (stripPrefix) r = r.replace(/^[A-Z0-9]+->/i, '');
    if (stripSuffix) r = r.replace(/-(?:H\d|ND|DDU|VCRI)$/i, '');
    return r;
}

// ============================================================
// LIFECYCLE — central timer management
// ============================================================
const Lifecycle = {
    _timers: [],
    register(name, fn, interval) {
        const id = setInterval(fn, interval);
        this._timers.push({ name, id });
        return id;
    },
    unregister(id) {
        clearInterval(id);
        this._timers = this._timers.filter(t => t.id !== id);
    },
    stopAll() {
        for (const t of this._timers) clearInterval(t.id);
        this._timers = [];
        console.log('[ShipMap] Lifecycle: all timers stopped');
    },
};
window.addEventListener('beforeunload', () => Lifecycle.stopAll());

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
    warehouseId: GM_getValue('shipmap_nodeId', 'KTW3'),
    fmcSiteCode: GM_getValue('shipmap_fmc_site_code', 'AT1hgc'),
    baseUrl: 'https://trans-logistics-eu.amazon.com',
    ymsUrl: 'https://jwmjkz3dsd.execute-api.eu-west-1.amazonaws.com/call/getYardStateWithPendingMoves',
    vistaUrl: 'https://trans-logistics-eu.amazon.com/sortcenter/vista/controller/getContainersDetailByCriteria',
    grid: { size: 20, bgColor: '#2a2a2e', gridColor: '#3a3a3e', snapToGrid: true },
    storage: {
        key: 'shipmap_elements_v5', editModeKey: 'shipmap_editmode', nodeIdKey: 'shipmap_nodeId',
        typeOverridesKey: 'shipmap_type_overrides_v2', siteSettingsKey: 'shipmap_site_settings_v3',
        bgImageKey: 'shipmap_bg_image_v1', viewportKey: 'shipmap_viewport_v1',
        legendCollapsedKey: 'shipmap_legend_collapsed', elementsCollapsedKey: 'shipmap_elements_collapsed',
        vistaCollapsedKey: 'shipmap_vista_collapsed', sidebarWidthKey: 'shipmap_sidebar_width',
        trendKey: 'shipmap_trend_v1', minimapKey: 'shipmap_minimap_visible',
    },
    data: { refreshInterval: 120000, ymsRefreshInterval: 60000, vistaRefreshInterval: 120000, trendInterval: 600000, fmcRefreshInterval: 120000, dockmasterRefreshInterval: 120000, relatRefreshInterval: 180000, ymsTokenCaptureInterval: 30000, ymsTokenPickupInterval: 10000, uiRefreshInterval: 60000 },
    urls: {
        dockmaster: 'https://fc-inbound-dock-execution-service-eu-eug1-dub.dub.proxy.amazon.com',
        relat: 'https://eu.relat.aces.amazon.dev',
    },
    maxUndoSteps: 50,
};

// ============================================================
// SITE SETTINGS
// ============================================================
const DEFAULT_SITE = { dsStart:'07:00', dsEnd:'17:30', nsStart:'18:30', nsEnd:'05:00', filterSwapBefore:true, bgOpacity:0.3, bgOffsetX:0, bgOffsetY:0, bgScale:1 };
const SiteSettings = { ...DEFAULT_SITE };
function loadSiteSettings() { silentCatch('loadSiteSettings', () => { const r = GM_getValue(CONFIG.storage.siteSettingsKey, null); if (r) Object.assign(SiteSettings, JSON.parse(r)); }); }
const _saveSiteSettingsNow = () => GM_setValue(CONFIG.storage.siteSettingsKey, JSON.stringify(SiteSettings));
const saveSiteSettings = debounce(_saveSiteSettingsNow, 300);
function saveSiteSettingsImmediate() { _saveSiteSettingsNow(); }
loadSiteSettings();

// ============================================================
// SHIFT HELPERS
// ============================================================
function timeToMin(str) { const [h, m] = str.split(':').map(Number); return h * 60 + (m || 0); }
function getCurrentShift() {
    const now = new Date(), curMin = now.getHours() * 60 + now.getMinutes();
    const ds = timeToMin(SiteSettings.dsStart), dsE = timeToMin(SiteSettings.dsEnd);
    const ns = timeToMin(SiteSettings.nsStart), nsE = timeToMin(SiteSettings.nsEnd);
    const makeDate = (base, mins) => { const d = new Date(base); d.setHours(Math.floor(mins / 60), mins % 60, 0, 0); return d; };
    if (curMin >= ds && curMin < dsE) return { label:'DS', startDate:makeDate(now, ds), endDate:makeDate(now, dsE), dataStartDate:makeDate(now, ds - 300) };
    if (curMin >= ns) { const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1); return { label:'NS', startDate:makeDate(now, ns), endDate:makeDate(tmr, nsE), dataStartDate:makeDate(now, ns - 300) }; }
    const yst = new Date(now); yst.setDate(yst.getDate() - 1);
    return { label:'NS', startDate:makeDate(yst, ns), endDate:makeDate(now, nsE), dataStartDate:makeDate(yst, ns - 300) };
}
function getCurrentShiftLabel() { return getCurrentShift().label; }

// ============================================================
// EQUIPMENT HELPERS
// ============================================================
function isSwapBody(eq) { return eq ? eq.toUpperCase().replace(/[^A-Z0-9]/g, '').includes('SWAP') : false; }
function isOneSwapBody(eq) { if (!eq) return false; const u = eq.toUpperCase().replace(/[^A-Z0-9]/g, ''); return u.includes('ONESWAP') || u.includes('1SWAP') || u === 'ONESWAPBODY'; }
function equipTypeShort(eq) {
    if (!eq) return '';
    const u = eq.toUpperCase().replace(/[^A-Z0-9_ ]/g, '');
    if (isOneSwapBody(eq)) return '1SW'; if (u.includes('SWAP')) return 'SW';
    if (u.includes('SEVEN_HALF') || u.includes('SEVENHALFTONTRUCK')) return '7.5t';
    if (u.includes('SPRINTER')) return 'SPR'; if (u.includes('BOX_TRUCK') || u.includes('BOXTRUCK')) return 'BOX';
    if (u.includes('THREE_WHEELER') || u.includes('THREEWHEELER')) return '3WH';
    if (u.includes('REFRIGER')) return 'REF'; if (u.includes('SKIRTED')) return 'SKR';
    if (u.includes('SOFT')) return 'SFT'; if (u.includes('TRAILER')) return 'TRL';
    return eq.substring(0, 3).toUpperCase();
}
function equipTypeColor(eq) {
    if (!eq) return '#5a6a7a'; if (isOneSwapBody(eq)) return '#e040fb'; if (isSwapBody(eq)) return '#ce93d8';
    const u = eq.toUpperCase();
    if (u.includes('SEVEN_HALF')) return '#66bb6a'; if (u.includes('SPRINTER')) return '#4fc3f7';
    if (u.includes('BOX')) return '#ffb74d'; if (u.includes('REFRIGER')) return '#80deea'; return '#78909C';
}

// ============================================================
// BG IMAGE — with URL support
// ============================================================
const BgImage = {
    img: null, dataUrl: null, bgUrl: null, loaded: false,
    load() { silentCatch('BgImage.load', () => { const url = GM_getValue(CONFIG.storage.bgImageKey + '_url', null); const raw = GM_getValue(CONFIG.storage.bgImageKey, null); if (url) { this.bgUrl = url; this._loadFromUrl(url, raw); } else if (raw) { this.dataUrl = raw; this._createImg(raw); } }); },
    _loadFromUrl(url, fallbackDataUrl) { this.img = new Image(); this.img.crossOrigin = 'anonymous'; this.img.onload = () => { this.loaded = true; R.requestRender(); }; this.img.onerror = () => { if (fallbackDataUrl) { this._createImg(fallbackDataUrl); } else { this.loaded = false; this.img = null; } }; this.img.src = url; },
    _createImg(src) { if (!src) return; this.dataUrl = src; this.img = new Image(); this.img.onload = () => { this.loaded = true; R.requestRender(); }; this.img.onerror = () => { this.loaded = false; this.img = null; }; this.img.src = src; },
    setUrl(url) { this.bgUrl = url; GM_setValue(CONFIG.storage.bgImageKey + '_url', url); this._loadFromUrl(url, this.dataUrl); },
    set(dataUrl) { this.dataUrl = dataUrl; GM_setValue(CONFIG.storage.bgImageKey, dataUrl); this._createImg(dataUrl); },
    remove() { this.dataUrl = null; this.bgUrl = null; this.img = null; this.loaded = false; GM_setValue(CONFIG.storage.bgImageKey, ''); GM_setValue(CONFIG.storage.bgImageKey + '_url', ''); R.requestRender(); },
};
BgImage.load();

// ============================================================
// ELEMENT TYPES
// ============================================================
const DEFAULT_TYPES = {
    chute:{ label:'Chute', color:'#00e5ff', border:'#00b8d4', builtIn:true },
    stage:{ label:'Stage (Orange)', color:'#ff9800', border:'#e68a00', builtIn:true },
    stageGreen:{ label:'Stage (Green)', color:'#00c853', border:'#009d3e', builtIn:true },
    stageBlue:{ label:'Stage (Blue)', color:'#2962ff', border:'#1a44b8', builtIn:true },
    stageYellow:{ label:'Stage (Yellow)', color:'#ffd600', border:'#c7a500', builtIn:true },
    dockDoor:{ label:'Dock Door', color:'#e040fb', border:'#c020d9', builtIn:true },
    obstacle:{ label:'Obstacle', color:'#9e9e9e', border:'#757575', builtIn:true },
};
const ELEMENT_TYPES = {};
function darkenColor(hex, f = 0.72) { const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); if (!m) return hex; return '#' + [1, 2, 3].map(i => Math.round(parseInt(m[i], 16) * f).toString(16).padStart(2, '0')).join(''); }
function loadTypeOverrides() {
    for (const [k, v] of Object.entries(DEFAULT_TYPES)) ELEMENT_TYPES[k] = { ...v };
    silentCatch('loadTypeOverrides', () => { const raw = GM_getValue(CONFIG.storage.typeOverridesKey, null); if (raw) { const ov = JSON.parse(raw); for (const [k, v] of Object.entries(ov)) { if (ELEMENT_TYPES[k]) { if (v.label) ELEMENT_TYPES[k].label = v.label; if (v.color) { ELEMENT_TYPES[k].color = v.color; ELEMENT_TYPES[k].border = v.border || darkenColor(v.color); } } else ELEMENT_TYPES[k] = { label:v.label||k, color:v.color||'#888', border:v.border||darkenColor(v.color||'#888'), builtIn:false }; } } });
}
function saveTypeOverrides() { const ov = {}; for (const [k, v] of Object.entries(ELEMENT_TYPES)) ov[k] = { label:v.label, color:v.color, border:v.border, builtIn:!!v.builtIn }; GM_setValue(CONFIG.storage.typeOverridesKey, JSON.stringify(ov)); }
function resetTypeOverrides() { for (const k of Object.keys(ELEMENT_TYPES)) if (!DEFAULT_TYPES[k]) delete ELEMENT_TYPES[k]; for (const [k, v] of Object.entries(DEFAULT_TYPES)) ELEMENT_TYPES[k] = { ...v }; saveTypeOverrides(); }
function addCustomType(label, color) { let i = 1; while (ELEMENT_TYPES[`custom_${i}`]) i++; const key = `custom_${i}`; ELEMENT_TYPES[key] = { label:label||`Custom ${i}`, color:color||'#888', border:darkenColor(color||'#888'), builtIn:false }; saveTypeOverrides(); return key; }
function removeType(key) { if (!ELEMENT_TYPES[key]) return false; delete ELEMENT_TYPES[key]; saveTypeOverrides(); return true; }
loadTypeOverrides();

// ============================================================
// UTILITY
// ============================================================
const MODE = { SELECT:'select', ADD:'add', DELETE:'delete' };
function snap(v) { return CONFIG.grid.snapToGrid ? Math.round(v / CONFIG.grid.size) * CONFIG.grid.size : v; }
function matchElement(el, label) {
    if (!label) return false;
    const lu = label.toUpperCase().trim();
    const LOOSE_PREFIXES = ['SLAM STATION', 'KTW3-SHIPPINGSORTER1'];
    if (el.name) { const nu = el.name.toUpperCase().trim(); if (nu === lu) return true; if (nu.endsWith('*') && lu.startsWith(nu.slice(0, -1))) return true; const isLoose = LOOSE_PREFIXES.some(p => nu.startsWith(p) || lu.startsWith(p)); if (isLoose) { if (lu.startsWith(nu) && lu.length > nu.length) return true; if (nu.startsWith(lu) && nu.length > lu.length) return true; } }
    if (el.chute) { const cu = el.chute.toUpperCase().trim(); if (cu === lu) return true; if (cu.endsWith(lu) || lu.endsWith(cu)) return true; const parts = el.chute.split('-'); const suffix = parts[parts.length - 1]?.toUpperCase(); if (suffix && (suffix === lu || lu.endsWith(suffix))) return true; }
    return false;
}

// ============================================================
// MATCH INDEX — O(1) element lookup by label
// ============================================================
const MatchIndex = {
    _exactName: new Map(), _exactChute: new Map(), _chuteSuffix: new Map(),
    _wildcards: [], _looseElements: [], _allChuteEntries: [],
    LOOSE_PREFIXES: ['SLAM STATION', 'KTW3-SHIPPINGSORTER1'],
    rebuild(elements) {
        this._exactName.clear(); this._exactChute.clear(); this._chuteSuffix.clear();
        this._wildcards = []; this._looseElements = []; this._allChuteEntries = [];
        for (const el of elements) {
            if (el.name) { const nu = el.name.toUpperCase().trim(); if (nu.endsWith('*')) { this._wildcards.push({ el, prefix: nu.slice(0, -1) }); } else { this._addToMap(this._exactName, nu, el); } if (this.LOOSE_PREFIXES.some(p => nu.startsWith(p))) { this._looseElements.push({ el, nameUpper: nu }); } }
            if (el.chute) { const cu = el.chute.toUpperCase().trim(); this._addToMap(this._exactChute, cu, el); this._allChuteEntries.push({ el, chuteUpper: cu }); const parts = el.chute.split('-'); const suffix = parts[parts.length - 1]?.toUpperCase(); if (suffix && suffix !== cu) { this._addToMap(this._chuteSuffix, suffix, el); } }
        }
    },
    _addToMap(map, key, el) { let arr = map.get(key); if (!arr) { arr = []; map.set(key, arr); } arr.push(el); },
    getMatching(label) {
        if (!label) return [];
        const lu = label.toUpperCase().trim(); const resultSet = new Set();
        const nameHits = this._exactName.get(lu); if (nameHits) for (const el of nameHits) resultSet.add(el);
        for (const { el, prefix } of this._wildcards) { if (lu.startsWith(prefix)) resultSet.add(el); }
        for (const { el, nameUpper } of this._looseElements) { if (lu.startsWith(nameUpper) && lu.length > nameUpper.length) resultSet.add(el); if (nameUpper.startsWith(lu) && nameUpper.length > lu.length) resultSet.add(el); }
        if (this.LOOSE_PREFIXES.some(p => lu.startsWith(p))) { for (const [nu, els] of this._exactName) { if (nu.startsWith(lu) && nu.length > lu.length) for (const el of els) resultSet.add(el); if (lu.startsWith(nu) && lu.length > nu.length) for (const el of els) resultSet.add(el); } }
        const chuteHits = this._exactChute.get(lu); if (chuteHits) for (const el of chuteHits) resultSet.add(el);
        const suffHits = this._chuteSuffix.get(lu); if (suffHits) for (const el of suffHits) resultSet.add(el);
        for (const { el, chuteUpper } of this._allChuteEntries) { if (resultSet.has(el)) continue; if (chuteUpper.endsWith(lu) || lu.endsWith(chuteUpper)) resultSet.add(el); }
        return [...resultSet];
    }
};

// ============================================================
// SHARED UTILITIES
// ============================================================
function formatDuration(ms) { if (ms <= 0) return ''; const mins = Math.floor(ms / 60000); if (mins < 60) return `${mins}m`; const hrs = Math.floor(mins / 60), rm = mins % 60; if (hrs < 24) return `${hrs}h${rm > 0 ? rm + 'm' : ''}`; const days = Math.floor(hrs / 24), rh = hrs % 24; return `${days}d${rh > 0 ? rh + 'h' : ''}`; }
function dwellTimeStr(isoStr) { if (!isoStr) return ''; try { const t = new Date(isoStr); if (isNaN(t.getTime())) return ''; const diff = Date.now() - t.getTime(); if (diff < 0) return ''; return formatDuration(diff); } catch { return ''; } }
function dwellTimeMinutes(isoStr) { if (!isoStr) return 0; try { const t = new Date(isoStr); if (isNaN(t.getTime())) return 0; const diff = Date.now() - t.getTime(); return diff > 0 ? Math.floor(diff / 60000) : 0; } catch { return 0; } }
function dwellFromEpoch(epochSec) { if (!epochSec) return ''; const diff = Date.now() - epochSec * 1000; if (diff < 0) return ''; return formatDuration(diff); }
function locSortPriority(label) { const u = label.toUpperCase(); if (/^(?:OB|IB)[-\s]?/.test(u)) return -1; if (/STAGE|HOT|GENERAL/.test(u)) return 0; if (/\bBG\b|BOX|^F(?:ST)?-/.test(u)) return 1; if (/SHIPPING|SLAM/.test(u)) return 3; return 2; }

const YMS_RED_REASONS = new Set(['DAMAGED_MODERATE', 'DAMAGED_SEVERE', 'MISSING_DOCUMENTS', 'DAMAGED_LIGHT']);
const YMS_YELLOW_REASONS = new Set(['PREVENTATIVE_MAINTENANCE', 'ADMINISTRATIVE_HOLD', 'PARTS_STORAGE']);
function ymsGateStatus(ymsLoc) {
    if (!ymsLoc || !ymsLoc.yardAssets?.length) return 'empty';
    let hasRed = false, hasYellow = false;
    for (const a of ymsLoc.yardAssets) { if (a.type === 'TRACTOR') continue; if (a.unavailable) { if (YMS_RED_REASONS.has(a.unavailableReason)) hasRed = true; else if (YMS_YELLOW_REASONS.has(a.unavailableReason)) hasYellow = true; } if (a.annotation && a.annotation.trim()) { if (!/\b\d{2,3}[A-Z0-9]{5,}\b/i.test(a.annotation)) hasYellow = true; } }
    if (hasRed) return 'red'; if (hasYellow) return 'yellow';
    if (ymsLoc.yardAssets.some(a => a.type !== 'TRACTOR')) return 'occupied'; return 'empty';
}
function ymsGetVrIds(asset) { const ids = []; if (asset.load?.identifiers) { for (const id of asset.load.identifiers) { if (id.type === 'VR_ID') ids.push(id.identifier.toUpperCase()); } } return ids; }
function ymsGetNonInvAssets() {
    const NONINV_SHIPPERS = new Set([
        'TRANSFERSCARTS', 'TRANSFERSCARTSPALLETSMIXED', 'TRANSFERSDAMAGEDCARTS',
        'TRANSFERSEMPTYBAGS', 'TRANSFERSEMPTYCARTS', 'TRANSFERSEMPTYCARTSINJECTION',
        'TRANSFERSEMPTYSORTATIONBAGS'
    ]);
    const results = [];
    const fmcNonInvVrIds = new Set();
    for (const t of FMC.getNonInvTours()) {
        if (t.vrId) fmcNonInvVrIds.add(t.vrId.toUpperCase());
    }
    for (const loc of State.ymsLocations) {
        for (const asset of (loc.yardAssets || [])) {
            if (asset.type === 'TRACTOR') continue;
            const shippers = asset.load?.shipperAccounts || [];
            if (!Array.isArray(shippers) || !shippers.length) continue;
            const isNonInv = shippers.some(s => NONINV_SHIPPERS.has((s || '').toUpperCase().replace(/[^A-Z]/g, '')));
            if (!isNonInv) continue;
            const vrIds = ymsGetVrIds(asset);
            const vrId = vrIds[0] || '';
            // Skip if already in FMC NonInv list
            if (vrId && fmcNonInvVrIds.has(vrId)) continue;
            // Skip if RELAT completed
            if (vrId && RELAT.isCompleted(vrId)) continue;
            results.push({
                vrId,
                locationCode: loc.code,
                asset,
                plate: asset.licensePlateIdentifier?.registrationIdentifier || asset.vehicleNumber || '',
                owner: asset.owner?.code || asset.broker?.code || '',
                equipType: asset.type || '',
                status: asset.status || '',
                shippers,
                shipperLabel: shippers.join(', '),
                annotation: asset.annotation || '',
                arrivalEpoch: asset.datetimeOfArrivalAtLocation || null,
                routes: asset.load?.routes || [],
                lane: asset.load?.lane || ''
            });
        }
    }
    return results;
}

const TRAILER_LABELS = { 'TRAILER':'🚛', 'SWAP_BODY':'🔀', 'TRAILER_REFRIGERATED':'❄️', 'TRAILER_SOFT':'📦', 'TRAILER_SKIRTED':'🚛', 'BOX_TRUCK':'📦', 'SPRINTER_VAN':'🚐', 'THREE_WHEELER':'🛺', 'TRACTOR':'🚜', 'SEVEN_HALF_TON_TRUCK':'🚚' };
const TRAILER_ICONS = { 'TRAILER':{ symbol:'🚛', label:'TRL' }, 'SWAP_BODY':{ symbol:'🔀', label:'SWAP' }, 'TRAILER_REFRIGERATED':{ symbol:'❄️', label:'REF' }, 'TRAILER_SOFT':{ symbol:'📦', label:'SOFT' }, 'TRAILER_SKIRTED':{ symbol:'🚛', label:'SKRT' }, 'BOX_TRUCK':{ symbol:'📦', label:'BOX' }, 'SPRINTER_VAN':{ symbol:'🚐', label:'SPR' }, 'THREE_WHEELER':{ symbol:'🛺', label:'3WH' }, 'TRACTOR':{ symbol:'🚜', label:'TRC' }, 'SEVEN_HALF_TON_TRUCK':{ symbol:'🚚', label:'7.5t' } };
// ── FOCUS MODE PALETTE ──────────────────────────────
const FOCUS_PALETTE = [
    '#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#FF8A5C',
    '#6C5CE7', '#81ECEC', '#FDCB6E', '#E17055', '#00B894',
];

function routeGroupKey(rawRoute) { let s = parseRoute(rawRoute, { stripSuffix: false }); s = s.replace(/-(?:VCRI|DDU|ND)$/i, ''); return s.toUpperCase(); }
function routeSubLabel(rawRoute) { const s = parseRoute(rawRoute, { stripSuffix: false }); const group = routeGroupKey(rawRoute); if (s.toUpperCase() === group) return null; const diff = s.toUpperCase().replace(group, '').replace(/^-/, ''); return diff || null; }
function simplifyStackingFilter(sf) { let s = parseRoute(sf); if (/BAG/i.test(s)) s = s.replace(/^(.*BAG).*$/i, '$1'); return s; }

function getVistaRouteContainers(loadRoute, loadRawRoute, sspExclude) {
    const lr = loadRoute.toUpperCase(); const lrr = (loadRawRoute || '').toUpperCase(); const byLoc = {};
    for (const vc of State.vistaContainers) {
        if (!vc.route) continue; if (!vc.childCount || vc.childCount <= 0) continue;
        const vcr = vc.route.toUpperCase(); const vcrParsed = parseRoute(vc.route).toUpperCase();
        if (vcrParsed !== lr && vcr !== lrr) continue;
        const loc = vc.location || 'UNKNOWN'; if (!/STAGE|HOT[-_\s]?PICK|GENERAL/i.test(loc)) continue;
        if (!byLoc[loc]) byLoc[loc] = { types: {}, total: 0, totalPkgs: 0, maxDwell: 0, cpts: {} };
        const g = byLoc[loc]; g.types[vc.type] = (g.types[vc.type] || 0) + 1; g.total++; g.totalPkgs += vc.childCount || 0; if (vc.dwellTimeInMinutes > g.maxDwell) g.maxDwell = vc.dwellTimeInMinutes;
        const cptVal = vc.cpt || null; let cptLabel = '—';
        if (cptVal) { try { const cptDate = typeof cptVal === 'number' ? new Date(cptVal) : new Date(cptVal); if (!isNaN(cptDate.getTime())) { cptLabel = `${cptDate.getDate().toString().padStart(2,'0')}/${(cptDate.getMonth()+1).toString().padStart(2,'0')} ${cptDate.getHours().toString().padStart(2,'0')}:${cptDate.getMinutes().toString().padStart(2,'0')}`; } } catch (e) { console.debug('[ShipMap] CPT parse:', e.message); } }
        if (!g.cpts[cptLabel]) g.cpts[cptLabel] = { types: {}, total: 0, totalPkgs: 0 };
        const cp = g.cpts[cptLabel]; cp.types[vc.type] = (cp.types[vc.type] || 0) + 1; cp.total++; cp.totalPkgs += vc.childCount || 0;
    }
    if (sspExclude) { for (const [loc, excl] of Object.entries(sspExclude)) { const g = byLoc[loc]; if (!g) continue; for (const [type, count] of Object.entries(excl.types)) { if (g.types[type]) { const sub = Math.min(g.types[type], count); g.types[type] -= sub; g.total -= sub; if (g.types[type] <= 0) delete g.types[type]; } } g.totalPkgs = Math.max(0, g.totalPkgs - (excl.totalPkgs || 0)); if (g.total <= 0) delete byLoc[loc]; } }
    return byLoc;
}

// ── CPT / SDT helpers (KEEP THESE) ──
function cptCountdown(cptStr) {
    if (!cptStr || cptStr === '—') return null;
    try { const cptDate = new Date(cptStr); if (isNaN(cptDate.getTime())) return null; const diff = cptDate.getTime() - Date.now(); const absDiff = Math.abs(diff); const mins = Math.floor(absDiff / 60000); const hrs = Math.floor(mins / 60); const rm = mins % 60; let text, level; if (diff < 0) { text = hrs > 0 ? `-${hrs}h${rm}m` : `-${mins}m`; level = 'past'; } else if (mins <= 10) { text = `${mins}m`; level = 'critical'; } else { text = hrs > 0 ? `${hrs}h${rm > 0 ? rm + 'm' : ''}` : `${mins}m`; level = 'normal'; } return { text, level, diff, mins: Math.floor(diff / 60000) }; } catch { return null; }
}
function isCptEqualsSdt(load) { if (!load.sdt || load.sdt === '—' || !load.cpt || load.cpt === '—') return false; try { const s = new Date(load.sdt), c = new Date(load.cpt); if (isNaN(s.getTime()) || isNaN(c.getTime())) return false; return Math.abs(s.getTime() - c.getTime()) <= 300000; } catch { return false; } }
function isSdtOverdue(load, minutes) { if (!load.sdt || load.sdt === '—') return false; try { const sdtDate = new Date(load.sdt); if (isNaN(sdtDate.getTime())) return false; return (Date.now() - sdtDate.getTime()) > minutes * 60000; } catch { return false; } }
function isOldDeparted(load, minutes) { if (load.status !== 'DEPARTED' && load.status !== 'SCHEDULED') return false; if (!load.sdt || load.sdt === '—') return false; try { const sdtDate = new Date(load.sdt); if (isNaN(sdtDate.getTime())) return false; return (Date.now() - sdtDate.getTime()) > minutes * 60000; } catch { return false; } }

// ============================================================
// AUTO MAX CONTAINERS
// ============================================================
function getEffectiveMaxContainers(elKey) {
    const el = State.elements.find(e => (e.name || e.id) === elKey);
    if (el?.maxContainers > 0) return { max: el.maxContainers, source: 'manual' };
    if (!el) return { max: 0, source: 'none' };
    const ymsLoc = State.getYmsForElement(el);
    if (!ymsLoc?.yardAssets?.length) return { max: 0, source: 'none' };
    const trailers = ymsLoc.yardAssets.filter(a => a.type !== 'TRACTOR');
    if (!trailers.length) return { max: 0, source: 'empty' };
    const hasTractor = ymsLoc.yardAssets.some(a => a.type === 'TRACTOR');
    const primary = trailers[0]; const eqType = (primary.type || '').toUpperCase();
    if (eqType === 'THREE_WHEELER') return { max: 4, source: 'auto', label: 'Van' };
    if (eqType === 'SPRINTER_VAN') return { max: 4, source: 'auto', label: 'Sprinter' };
    if (eqType === 'BOX_TRUCK') return { max: 6, source: 'auto', label: 'Box Van' };
    if (eqType === 'SEVEN_HALF_TON_TRUCK' || eqType === 'SEVEN_HALF_TON') return { max: 12, source: 'auto', label: '7.5t' };
    if (eqType === 'SWAP_BODY') { const swapCount = trailers.filter(a => (a.type || '').toUpperCase() === 'SWAP_BODY').length; if (swapCount >= 2) return { max: 34, source: 'auto', label: '2SW' }; return { max: 17, source: 'auto', label: '1SW' }; }
    if (eqType.startsWith('TRAILER')) { const vistaMax = _getVistaMax(elKey); if (vistaMax) return { max: vistaMax.max, source: 'auto', label: vistaMax.label }; if (hasTractor) return { max: 15, source: 'auto', label: 'Attached' }; return { max: 30, source: 'auto', label: 'Detach' }; }
    return { max: 0, source: 'unknown' };
}
function _getVistaMax(elKey) { const vd = State.vistaElementMap?.[elKey]; if (!vd || vd.totalContainers === 0) return null; const types = vd.types || {}; const cartCount = types['CART'] || 0; const gaylordCount = types['GAYLORD'] || 0; const palletCount = types['PALLET'] || 0; if (cartCount === 0 && (gaylordCount > 0 || palletCount > 0)) return { max: 33, label: 'GL' }; if (gaylordCount === 0 && palletCount === 0 && cartCount > 0) return { max: 30, label: 'Cart' }; return { max: 30, label: 'Mix' }; }
// ============================================================
// STATE
// ============================================================
const State = {
    mode: MODE.SELECT, editMode: false, selectedType: 'stage',
    elements: [], selectedIds: new Set(), hoveredElement: null, clipboard: [],
    scale: 1, offsetX: 0, offsetY: 0,
    isPanning: false, panStart: { x:0, y:0 },
    isDrawing: false, drawStart: null, drawPreview: null,
    isMoving: false, moveStart: null, moveSnapshots: [], ctrlDragCopied: false,
    isResizing: false, resizeHandle: null, resizeSnapshot: null,
    isBoxSelecting: false, boxStart: null, boxEnd: null,
    sspLoads: [], dataLastUpdated: null, dataLoading: false, autoRefreshTimer: null,
    highlightData: {}, highlightedLoadIdx: -1, highlightedVrId: null,
    highlightPulse: 0, _pulseRAF: null,
    mouseScreenX: 0, mouseScreenY: 0, drawerOpen: false, drawerLoadIdx: -1,
    swapFilteredCount: 0, routeFilter: '',
    bgEditMode: false, isBgDragging: false, bgDragStart: null,
    legendCollapsed: false, elementsCollapsed: false,
    undoStack: [], drawerSort: 'name',
    ymsLocations: [], ymsLocMap: {}, ymsVrIdMap: {}, ymsAnnotationVrIds: {},
    ymsLastUpdated: null, ymsLoading: false, ymsAutoTimer: null,
    activeTab: 'loads',
    loadsSubTab: 'ob',  // 'ob' | 'noninv' | 'ib'
    vistaContainers: [], vistaLocMap: {}, vistaElementMap: {},
    vistaLastUpdated: null, vistaLoading: false, vistaAutoTimer: null, vistaEnabled: true,
    mapSearch: '', mapSearchMatches: new Set(),
    hideOldDeparted: true, oldDepartedMinutes: 60,
    dashboardMode: false,
    // ── Focus Mode ──
    focusRoutes: new Map(),   // routeGroupKey → { color }
    _focusColorIdx: 0,

    toggleFocusRoute(rawRoute) {
        const gKey = routeGroupKey(rawRoute);
        if (this.focusRoutes.has(gKey)) {
            this.focusRoutes.delete(gKey);
        } else {
            const color = FOCUS_PALETTE[this._focusColorIdx % FOCUS_PALETTE.length];
            this._focusColorIdx++;
            this.focusRoutes.set(gKey, { color });
        }
    },

    clearFocus() {
        this.focusRoutes.clear();
        this._focusColorIdx = 0;
    },

    isFocusRoute(rawRoute) {
        return this.focusRoutes.has(routeGroupKey(rawRoute));
    },

    getFocusForElement(el) {
        if (!this.focusRoutes.size) return null;
        const elKey = el.name || el.id;
        const vd = this.vistaElementMap?.[elKey];
        if (!vd?.routes) return null;

        const matches = {};
        for (const [vRoute, vData] of Object.entries(vd.routes)) {
            const gKey = routeGroupKey(vRoute);
            if (this.focusRoutes.has(gKey)) {
                const fr = this.focusRoutes.get(gKey);
                if (!matches[gKey]) matches[gKey] = { color: fr.color, count: 0, pkgs: 0 };
                matches[gKey].count += vData.count;
                matches[gKey].pkgs += vData.pkgs;
            }
        }

        return Object.keys(matches).length ? matches : null;
    },

    get selectedElements() { return this.elements.filter(el => this.selectedIds.has(el.id)); },
    get primarySelected() { const a = this.selectedElements; return a.length ? a[a.length - 1] : null; },
    isSelected(el) { return this.selectedIds.has(el.id); },
    selectOnly(el) { this.selectedIds.clear(); if (el) this.selectedIds.add(el.id); },
    toggleSelect(el) { this.selectedIds.has(el.id) ? this.selectedIds.delete(el.id) : this.selectedIds.add(el.id); },
    addToSelection(el) { this.selectedIds.add(el.id); },
    clearSelection() { this.selectedIds.clear(); },
    selectAll() { this.elements.forEach(el => this.selectedIds.add(el.id)); },
    pushUndo() { this.undoStack.push(JSON.stringify(this.elements)); if (this.undoStack.length > CONFIG.maxUndoSteps) this.undoStack.shift(); },
    undo() { if (!this.undoStack.length) return false; const snapshot = this.undoStack.pop(); try { this.elements = JSON.parse(snapshot); for (const el of this.elements) { if (!el.hasOwnProperty('chute')) el.chute = ''; if (!el.hasOwnProperty('maxContainers')) el.maxContainers = 0; } this.clearSelection(); this._persistSave(); MatchIndex.rebuild(this.elements); return true; } catch { return false; } },
    getNextId(type) { const prefix = ELEMENT_TYPES[type]?.label?.split(' ')[0]?.replace(/[^a-zA-Z0-9]/g, '') || type; const rx = new RegExp(`^${prefix}-(\\d+)$`, 'i'); const used = new Set(); for (const el of this.elements) { const m = el.id.match(rx); if (m) used.add(parseInt(m[1], 10)); } let n = 1; while (used.has(n)) n++; return `${prefix}-${String(n).padStart(3, '0')}`; },
    copySelection() { const sel = this.selectedElements; if (!sel.length) return 0; const ax = sel[0].x, ay = sel[0].y; this.clipboard = sel.map(el => ({ type:el.type, chute:el.chute||'', maxContainers:el.maxContainers||0, _relX:el.x-ax, _relY:el.y-ay, w:el.w, h:el.h })); return this.clipboard.length; },
    paste(wx, wy) { if (!this.clipboard.length) return []; this.pushUndo(); this.clearSelection(); const ids = []; for (const t of this.clipboard) { const id = this.getNextId(t.type); this.elements.push({ id, name:id, type:t.type, chute:t.chute||'', maxContainers:t.maxContainers||0, x:snap(wx+t._relX), y:snap(wy+t._relY), w:t.w, h:t.h }); this.selectedIds.add(id); ids.push(id); } this.save(); return ids; },
    duplicateSelected(dx, dy) { const sel = [...this.selectedElements]; if (!sel.length) return []; this.pushUndo(); this.clearSelection(); const ids = []; for (const o of sel) { const id = this.getNextId(o.type); this.elements.push({ id, name:id, type:o.type, chute:'', maxContainers:o.maxContainers||0, x:snap(o.x+dx), y:snap(o.y+dy), w:o.w, h:o.h }); this.selectedIds.add(id); ids.push(id); } this.save(); return ids; },

    setHighlight(loadIdx) {
        const load = this.sspLoads[loadIdx]; if (!load?._containers) { this.clearHighlight(); return; }
        const data = load._containers, hd = {}, processedPairs = new Set();
        for (const loc of data.locations) {
            const dc = data.flat.filter(c => c.parentLabel === loc.label && c.depth === 1);
            const containers = {}; let loosePkgs = 0, totalPkgs = 0, totalWeight = 0;
            for (const c of dc) { if (c.contType === 'PACKAGE') { loosePkgs++; totalPkgs++; totalWeight += c.weight; } else { containers[c.contType] = (containers[c.contType] || 0) + 1; totalPkgs += c.descPkgs; totalWeight += c.descWeight; } }
            const matchedEls = MatchIndex.getMatching(loc.label);
            for (const el of matchedEls) { const elKey = el.name || el.id; const pairKey = `${elKey}::${loc.label}`; if (processedPairs.has(pairKey)) continue; processedPairs.add(pairKey); if (!hd[elKey]) hd[elKey] = { containers:{}, loosePkgs:0, totalPkgs:0, totalWeight:0, matchedLocs:[], ymsMatch:false }; const h = hd[elKey]; for (const [type, count] of Object.entries(containers)) h.containers[type] = (h.containers[type] || 0) + count; h.loosePkgs += loosePkgs; h.totalPkgs += totalPkgs; h.totalWeight += totalWeight; h.matchedLocs.push(loc.label); }
        }
        for (const key of Object.keys(hd)) { hd[key].totalWeight = Math.round(hd[key].totalWeight * 100) / 100; hd[key].onlyLoose = Object.keys(hd[key].containers).length === 0 && hd[key].loosePkgs > 0; }
        const vrId = load.vrId?.toUpperCase();
        if (vrId) {
            const direct = this.ymsVrIdMap[vrId] || []; const ann = this.ymsAnnotationVrIds[vrId] || [];
            const directCodes = new Set(direct.map(h => h.locationCode));
            const allHits = [...direct.map(h => ({ ...h, source: 'vrId' })), ...ann.filter(a => !directCodes.has(a.locationCode)).map(a => ({ ...a, source: 'annotation' }))];
            for (const ymsHit of allHits) {
                const locCode = (ymsHit.locationCode || '').toUpperCase(); if (!locCode) continue;
                const matchedEls = MatchIndex.getMatching(locCode);
                for (const el of matchedEls) {
                    const elKey = el.name || el.id;
                    if (!hd[elKey]) hd[elKey] = { containers: {}, loosePkgs: 0, totalPkgs: 0, totalWeight: 0, matchedLocs: [], ymsMatch: true, ymsLocCode: locCode, ymsSource: ymsHit.source, ymsAllLocations: [], onlyLoose: false };
                    else { hd[elKey].ymsMatch = true; if (!hd[elKey].ymsLocCode) hd[elKey].ymsLocCode = locCode; if (!hd[elKey].ymsSource) hd[elKey].ymsSource = ymsHit.source; }
                    if (!hd[elKey].matchedLocs.includes(locCode)) hd[elKey].matchedLocs.push(locCode);
                    if (!hd[elKey].ymsAllLocations) hd[elKey].ymsAllLocations = [];
                    if (!hd[elKey].ymsAllLocations.find(l => l.code === locCode)) { hd[elKey].ymsAllLocations.push({ code: locCode, source: ymsHit.source }); }
                }
            }
            for (const loc of this.ymsLocations) {
                const locCode = (loc.code || '').toUpperCase(); if (!locCode) continue;
                let found = false, source = '';
                for (const asset of (loc.yardAssets || [])) { if (ymsGetVrIds(asset).includes(vrId)) { found = true; source = 'vrId'; break; } if (asset.annotation && asset.annotation.toUpperCase().includes(vrId)) { found = true; source = 'annotation'; break; } }
                if (!found) continue;
                const matchedEls = MatchIndex.getMatching(locCode);
                for (const el of matchedEls) {
                    const elKey = el.name || el.id;
                    if (!hd[elKey]) hd[elKey] = { containers: {}, loosePkgs: 0, totalPkgs: 0, totalWeight: 0, matchedLocs: [], ymsMatch: true, ymsLocCode: locCode, ymsSource: source, ymsAllLocations: [], onlyLoose: false };
                    else { hd[elKey].ymsMatch = true; hd[elKey].ymsLocCode = hd[elKey].ymsLocCode || locCode; hd[elKey].ymsSource = hd[elKey].ymsSource || source; }
                    if (!hd[elKey].matchedLocs.includes(locCode)) hd[elKey].matchedLocs.push(locCode);
                    if (!hd[elKey].ymsAllLocations) hd[elKey].ymsAllLocations = [];
                    if (!hd[elKey].ymsAllLocations.find(l => l.code === locCode)) { hd[elKey].ymsAllLocations.push({ code: locCode, source }); }
                }
            }
        }
        this.highlightData = hd; this.highlightedLoadIdx = loadIdx; this.highlightedVrId = load.vrId?.toUpperCase() || null; this._startPulse();
    },
    clearHighlight() { this.highlightData = {}; this.highlightedLoadIdx = -1; this.highlightedVrId = null; this._stopPulse(); },
    isHighlighted(el) { return !!(this.highlightData[el.name || el.id]); },
    getHighlight(el) { return this.highlightData[el.name || el.id] || null; },
    resyncHighlightAfterRefresh() { if (!this.highlightedVrId) return; const vrId = this.highlightedVrId; const newIdx = this.sspLoads.findIndex(l => l.vrId && l.vrId.toUpperCase() === vrId); if (newIdx >= 0) { const load = this.sspLoads[newIdx]; if (load._containers) { this.setHighlight(newIdx); } else { this.highlightedLoadIdx = newIdx; } } else { this.clearHighlight(); } },
    _startPulse() { if (this._pulseRAF) return; let lastFrame = 0; const PULSE_FPS = 20; const interval = 1000 / PULSE_FPS; const a = (timestamp) => { if (timestamp - lastFrame >= interval) { this.highlightPulse = (Date.now() % 2000) / 2000; R.render(); lastFrame = timestamp; } if (Object.keys(this.highlightData).length) this._pulseRAF = requestAnimationFrame(a); }; this._pulseRAF = requestAnimationFrame(a); },
    _stopPulse() { if (this._pulseRAF) { cancelAnimationFrame(this._pulseRAF); this._pulseRAF = null; } },
    getYmsForElement(el) { const name = (el.name || '').toUpperCase().trim(); if (!name) return null; if (this.ymsLocMap[name]) return this.ymsLocMap[name]; const cn = name.endsWith('*') ? name.slice(0,-1) : name; for (const [code, loc] of Object.entries(this.ymsLocMap)) { if (code.startsWith(cn) || cn.startsWith(code)) return loc; } return null; },
    findYmsForVrId(vrId) { if (!vrId) return null; const vu = vrId.toUpperCase(); const direct = this.ymsVrIdMap[vu] || []; const ann = this.ymsAnnotationVrIds[vu] || []; const directCodes = new Set(direct.map(h => h.locationCode)); const merged = [...direct, ...ann.filter(a => !directCodes.has(a.locationCode))]; return merged.length ? merged : null; },
    updateMapSearch(query) {
        this.mapSearch = query; this.mapSearchMatches.clear(); if (!query) { R.render(); return; }
        const q = query.toUpperCase().trim();
        for (const el of this.elements) {
            const elKey = (el.name || el.id).toUpperCase(); if (elKey.includes(q)) { this.mapSearchMatches.add(el.id); continue; }
            const ymsLoc = this.getYmsForElement(el);
            if (ymsLoc?.yardAssets?.length) { let found = false; for (const asset of ymsLoc.yardAssets) { if (asset.type === 'TRACTOR') continue; const owner = (asset.owner?.code || asset.owner?.shortName || asset.broker?.code || '').toUpperCase(); const plate = (asset.licensePlateIdentifier?.registrationIdentifier || asset.vehicleNumber || '').toUpperCase(); const atype = (asset.type || '').toUpperCase().replace(/_/g, ' '); const ann = (asset.annotation || '').toUpperCase(); const vrIds = ymsGetVrIds(asset); const lane = (asset.load?.lane || asset.load?.routes?.[0] || '').toUpperCase(); if (owner.includes(q) || plate.includes(q) || atype.includes(q) || ann.includes(q) || lane.includes(q) || vrIds.some(v => v.includes(q))) { found = true; break; } } if (found) { this.mapSearchMatches.add(el.id); continue; } }
            const vd = this.vistaElementMap?.[el.name || el.id]; if (vd?.routes) { let found = false; for (const route of Object.keys(vd.routes)) { const routeShort = parseRoute(route).toUpperCase(); if (routeShort.includes(q) || route.toUpperCase().includes(q)) { found = true; break; } } if (found) { this.mapSearchMatches.add(el.id); continue; } }
        }
        R.render();
    },
    save() { this._persistSave(); MatchIndex.rebuild(this.elements); GitSync.schedulePush(); },
    _persistSave() { GM_setValue(CONFIG.storage.key, JSON.stringify({ elements: this.elements })); },
    load() { silentCatch('State.load', () => { const r = GM_getValue(CONFIG.storage.key, null); if (r) this.elements = JSON.parse(r).elements || []; }); for (const el of this.elements) { if (!el.hasOwnProperty('chute')) el.chute = ''; if (!el.hasOwnProperty('maxContainers')) el.maxContainers = 0; } this.editMode = GM_getValue(CONFIG.storage.editModeKey, false); this.legendCollapsed = GM_getValue(CONFIG.storage.legendCollapsedKey, false); this.elementsCollapsed = GM_getValue(CONFIG.storage.elementsCollapsedKey, false); this.loadViewport(); MatchIndex.rebuild(this.elements); },
    _vpSaveTimer: null,
    saveViewport() { clearTimeout(this._vpSaveTimer); this._vpSaveTimer = setTimeout(() => { GM_setValue(CONFIG.storage.viewportKey, JSON.stringify({ scale:this.scale, offsetX:this.offsetX, offsetY:this.offsetY })); }, 300); },
    loadViewport() { silentCatch('State.loadViewport', () => { const r = GM_getValue(CONFIG.storage.viewportKey, null); if (r) { const v = JSON.parse(r); this.scale = v.scale||1; this.offsetX = v.offsetX||0; this.offsetY = v.offsetY||0; } }); },
    saveEditMode() { GM_setValue(CONFIG.storage.editModeKey, this.editMode); },
    focusElement(el, zoomLevel) { if (!el) return; const cx = el.x + el.w / 2, cy = el.y + el.h / 2; const ts = zoomLevel || Math.max(State.scale, 2.5); const cw = R.canvas?.width || 800, ch = R.canvas?.height || 600; State.scale = ts; State.offsetX = cw / 2 - cx * ts; State.offsetY = ch / 2 - cy * ts; State.saveViewport(); },
    exportJSON() { const te = {}; for (const [k, v] of Object.entries(ELEMENT_TYPES)) te[k] = { label:v.label, color:v.color, border:v.border, builtIn:!!v.builtIn }; return JSON.stringify({ warehouse:CONFIG.warehouseId, elements:this.elements, types:te, siteSettings:{...SiteSettings}, bgUrl:BgImage.bgUrl||null, exportedAt:new Date().toISOString(), version:'3.3.1' }, null, 2); },
    importJSON(json) { try { const data = JSON.parse(json); this.pushUndo(); this.elements = (data.elements||[]).map(el => ({...el, chute:el.chute||''})); this.clearSelection(); if (data.types) { for (const [k, v] of Object.entries(data.types)) { if (ELEMENT_TYPES[k]) { ELEMENT_TYPES[k].label = v.label||ELEMENT_TYPES[k].label; ELEMENT_TYPES[k].color = v.color||ELEMENT_TYPES[k].color; ELEMENT_TYPES[k].border = v.border||darkenColor(v.color||ELEMENT_TYPES[k].color); } else { ELEMENT_TYPES[k] = { label:v.label||k, color:v.color||'#888', border:v.border||darkenColor(v.color||'#888'), builtIn:false }; } } saveTypeOverrides(); } if (data.siteSettings) { Object.assign(SiteSettings, data.siteSettings); saveSiteSettingsImmediate(); } if (data.bgUrl) { BgImage.setUrl(data.bgUrl); } this.save(); return true; } catch { return false; } },
    mergeJSON(json) { try { const data = JSON.parse(json); const incoming = (data.elements||[]).map(el => ({...el, chute:el.chute||''})); if (!incoming.length) return { added:0, skipped:0, types:0 }; this.pushUndo(); const existingNames = new Set(this.elements.map(el => el.name).filter(Boolean)); const existingIds = new Set(this.elements.map(el => el.id)); let added = 0, skipped = 0; for (const el of incoming) { if (el.name && existingNames.has(el.name)) { skipped++; continue; } let newId = el.id; if (existingIds.has(newId)) { let c = 1; while (existingIds.has(`${newId}_${c}`)) c++; newId = `${newId}_${c}`; } this.elements.push({...el, id:newId}); existingIds.add(newId); if (el.name) existingNames.add(el.name); added++; } let typesAdded = 0; if (data.types) { for (const [k, v] of Object.entries(data.types)) { if (!ELEMENT_TYPES[k]) { ELEMENT_TYPES[k] = { label:v.label||k, color:v.color||'#888', border:v.border||darkenColor(v.color||'#888'), builtIn:false }; typesAdded++; } } if (typesAdded > 0) saveTypeOverrides(); } this.save(); return { added, skipped, types:typesAdded }; } catch { return null; } },
    clearAll() { this.pushUndo(); this.elements = []; this.clearSelection(); this.clipboard = []; this.save(); },
};

// ============================================================
// SSP
// ============================================================
const SSP = {
    _fetchJSON(url) { return new Promise((resolve, reject) => { GM_xmlhttpRequest({ method:'GET', url, headers:{'Accept':'application/json'}, withCredentials:true, onload(r) { if (r.status >= 200 && r.status < 300) { try { resolve(JSON.parse(r.responseText)); } catch { reject({message:'JSON parse error'}); } } else reject({message:`HTTP ${r.status}`}); }, onerror() { reject({message:'Network error'}); } }); }); },
    _postJSON(url, body) { return new Promise((resolve, reject) => { GM_xmlhttpRequest({ method:'POST', url, headers:{'Accept':'application/json','Content-Type':'application/json'}, data:JSON.stringify(body), withCredentials:true, onload(r) { if (r.status >= 200 && r.status < 300) { try { resolve(JSON.parse(r.responseText)); } catch { reject({message:'JSON parse error'}); } } else reject({message:`HTTP ${r.status}`}); }, onerror() { reject({message:'Network error'}); } }); }); },
    _parseRoute(raw) { return parseRoute(raw) || '—'; },
    _statusColor(s) { return { 'LOADING_IN_PROGRESS':'#69f0ae','FINISHED_LOADING':'#ffd600','TRAILER_ATTACHED':'#4fc3f7','READY_TO_DEPART':'#ff9800','READY_FOR_LOADING':'#80cbc4','DEPARTED':'#9e9e9e','SCHEDULED':'#5a6a7a','CANCELLED':'#ff5252' }[s]||'#5a6a7a'; },
    _statusShort(s) { return { 'LOADING_IN_PROGRESS':'L','FINISHED_LOADING':'C','TRAILER_ATTACHED':'ATT','READY_TO_DEPART':'RTD','READY_FOR_LOADING':'RFL','DEPARTED':'DEP','SCHEDULED':'S','CANCELLED':'X' }[s]||s; },
    _statusLabel(s) { return { 'LOADING_IN_PROGRESS':'🔄 Loading','FINISHED_LOADING':'✅ Finished','TRAILER_ATTACHED':'🔗 Attached','READY_TO_DEPART':'🚛 Ready','READY_FOR_LOADING':'📋 Ready for Load','DEPARTED':'✈️ Departed','SCHEDULED':'📋 Scheduled','CANCELLED':'❌ Cancelled' }[s]||s; },
    _facilityStatus(s) { return { 'LOADING_IN_PROGRESS':'inFaciltiy','FINISHED_LOADING':'inFaciltiy','TRAILER_ATTACHED':'inFaciltiy','READY_TO_DEPART':'inFaciltiy','READY_FOR_LOADING':'inFaciltiy','SCHEDULED':'inFaciltiy','DEPARTED':'departed','CANCELLED':'cancelled' }[s]||'inFaciltiy'; },

    async fetchData() {
        State.dataLoading = true; UI.updateDataPanel();
        try {
            const now = Date.now(), startDate = now - 24 * 3600000, endDate = now + 3 * 24 * 3600000;
            const url = `${CONFIG.baseUrl}/ssp/dock/hrz/ob/fetchdata?entity=getOutboundDockView&nodeId=${CONFIG.warehouseId}&startDate=${startDate}&endDate=${endDate}&loadCategories=outboundScheduled,outboundInProgress,outboundReadyToDepart&shippingPurposeType=TRANSSHIPMENT,NON-TRANSSHIPMENT,SHIP_WITH_AMAZON`;
            const data = await this._fetchJSON(url);
            const aaData = data?.ret?.aaData || [], allRows = [];
            for (const item of aaData) { const ld = item.load; if (!ld || !ld.route) continue; allRows.push({ route:this._parseRoute(ld.route), rawRoute:ld.route, vrId:ld.vrId, status:ld.status, statusLabel:this._statusLabel(ld.status), statusShort:this._statusShort(ld.status), statusColor:this._statusColor(ld.status), carrier:ld.carrier, cpt:ld.criticalPullTime||'—', sdt:ld.scheduledDepartureTime||'—', dockDoor:item.resource?.[0]?.label||'—', trailer:item.trailer?.trailerNumber||'—', equipmentType:ld.equipmentType||'', loadGroupId:ld.loadGroupId, planId:ld.planId, trailerId:item.trailer?.trailerId||'', trailerNumber:item.trailer?.trailerNumber||'', facilityStatus:this._facilityStatus(ld.status), _expanded:false, _containers:null, _containersLoading:false }); }
            const vrIdCount = new Map(); for (const row of allRows) { if (!row.vrId) continue; vrIdCount.set(row.vrId, (vrIdCount.get(row.vrId)||0)+1); }
            const seen = new Set(), preLoads = []; let swapFiltered = 0;
            for (const row of allRows) { if (seen.has(row.planId)) continue; seen.add(row.planId); if (SiteSettings.filterSwapBefore && isSwapBody(row.equipmentType) && !isOneSwapBody(row.equipmentType)) { if ((vrIdCount.get(row.vrId)||0) < 2) { swapFiltered++; continue; } } preLoads.push(row); }
            const swapGroups = new Map(), loads = [];
            for (const row of preLoads) { if (row.vrId && isSwapBody(row.equipmentType) && !isOneSwapBody(row.equipmentType) && (vrIdCount.get(row.vrId)||0) >= 2) { if (!swapGroups.has(row.vrId)) swapGroups.set(row.vrId, []); swapGroups.get(row.vrId).push(row); } else { loads.push(row); } }
            for (const [, group] of swapGroups) {
                if (group.length < 2) { loads.push(group[0]); continue; }
                group.sort((a,b) => { const sa = a.sdt==='—'?'zzz':a.sdt, sb = b.sdt==='—'?'zzz':b.sdt; return sa.localeCompare(sb); });
                const primary = group[0], routes = [...new Set(group.map(g => g.route))], planIds = group.map(g => g.planId), dockDoors = [...new Set(group.map(g => g.dockDoor).filter(d => d !== '—'))];
                const statusPrio = ['LOADING_IN_PROGRESS','FINISHED_LOADING','TRAILER_ATTACHED','READY_TO_DEPART','READY_FOR_LOADING','SCHEDULED','DEPARTED','CANCELLED'];
                const bestStatus = group.reduce((best, g) => { const bi = statusPrio.indexOf(best.status), gi = statusPrio.indexOf(g.status); return gi < bi && gi >= 0 ? g : best; }, primary);
                loads.push({ ...primary, route: routes.length > 1 ? routes.join(' + ') : routes[0], status: bestStatus.status, statusLabel: SSP._statusLabel(bestStatus.status), statusShort: SSP._statusShort(bestStatus.status), statusColor: SSP._statusColor(bestStatus.status), dockDoor: dockDoors.length ? dockDoors.join('+') : '—', _swapCount: group.length, _swapPlanIds: planIds, _swapGroup: group });
            }
            loads.sort((a, b) => { const sa = a.sdt === '—' ? 'zzz' : a.sdt, sb = b.sdt === '—' ? 'zzz' : b.sdt; const cmp = sa.localeCompare(sb); if (cmp !== 0) return cmp; return a.route.localeCompare(b.route); });
            State.sspLoads = loads; State.swapFilteredCount = swapFiltered; State.dataLastUpdated = new Date(); State.dataLoading = false;
            if (State.highlightedVrId) { State.resyncHighlightAfterRefresh(); } else { if (State.highlightedLoadIdx >= 0 && State.highlightedLoadIdx >= loads.length) State.clearHighlight(); }
            if (State.drawerOpen && State.highlightedVrId) { const newDrawerIdx = loads.findIndex(l => l.vrId && l.vrId.toUpperCase() === State.highlightedVrId); if (newDrawerIdx >= 0 && loads[newDrawerIdx]._containers) { State.drawerLoadIdx = newDrawerIdx; } else if (newDrawerIdx < 0) { UI.closeDrawer(); } } else if (State.drawerOpen && State.drawerLoadIdx >= loads.length) { UI.closeDrawer(); }
            UI.updateDataPanel(); UI.setStatus(`📡 ${loads.length} loads | ${swapFiltered} swap-filtered`);
            UI.updateDashKpi();
        } catch (err) { State.dataLoading = false; UI.updateDataPanel(); UI.setStatus(`❌ SSP: ${err.message}`); }
    },

    async fetchContainerDetails(load, loadIdx) {
        if (!load.loadGroupId || !load.planId) { UI.setStatus('❌ No loadGroupId'); return null; }
        load._containersLoading = true; UI.updateDataPanel();
        try {
            const params = new URLSearchParams({ entity:'getContainerDetailsForLoadGroupId', nodeId:CONFIG.warehouseId, loadGroupId:load.loadGroupId, planId:load.planId, vrId:load.vrId, status:load.facilityStatus, trailerId:load.trailerId, trailerNumber:load.trailerNumber });
            const data = await this._fetchJSON(`${CONFIG.baseUrl}/ssp/dock/hrz/ob/fetchdata?${params}`);
            const rootNodes = data?.ret?.aaData?.ROOT_NODE || [], flat = [];
            const walk = (nodes, depth, parentLabel) => { for (const node of nodes) { const c = node.container, children = node.childNodes || []; let descPkgs = 0, descWeight = 0; const countDesc = (arr) => { for (const ch of arr) { if (ch.container.contType === 'PACKAGE') { descPkgs++; descWeight += ch.container.weightSpec?.weight?.value ?? 0; } if (ch.childNodes?.length) countDesc(ch.childNodes); } }; countDesc(children); flat.push({ label:c.label||'—', contType:c.contType||'—', containerId:c.containerId, weight:c.weightSpec?.weight?.value??0, assocTime:c.parentChildAssTime||'', depth, parentLabel, childCount:children.length, descPkgs, descWeight:Math.round(descWeight*100)/100, stackingFilter:c.stackingFilter||c.sortDestination||c.stackFilter||c.route||c.sortAttributes?.stackingFilter||'' }); if (children.length) walk(children, depth+1, c.label); } };
            walk(rootNodes, 0, null);
            const packages = flat.filter(c => c.contType === 'PACKAGE'), pallets = flat.filter(c => c.contType === 'PALLET'), locations = flat.filter(c => c.depth === 0);
            const totalWeight = packages.reduce((s, c) => s + c.weight, 0);
            const parsed = { flat, packages, pallets, locations, stats:{ totalContainers:flat.length, packageCount:packages.length, palletCount:pallets.length, locationCount:locations.length, totalWeightKg:Math.round(totalWeight*100)/100 } };
            load._containers = parsed; load._containersLoading = false; load._expanded = true;
            State.setHighlight(loadIdx); UI.openDrawer(loadIdx); UI.updateDataPanel();
            UI.setStatus(`📦 ${parsed.stats.packageCount} pkgs — ${load.vrId}`); return parsed;
        } catch (err) { load._containersLoading = false; load._expanded = false; UI.updateDataPanel(); UI.setStatus(`❌ ${err.message}`); return null; }
    },
    startAutoRefresh() { this.stopAutoRefresh(); this.fetchData(); State.autoRefreshTimer = setInterval(() => this.fetchData(), CONFIG.data.refreshInterval); },
    stopAutoRefresh() { if (State.autoRefreshTimer) { clearInterval(State.autoRefreshTimer); State.autoRefreshTimer = null; } },
};

// ============================================================
// YMS
// ============================================================
const YMS = {
    _token: null, _tokenExpiry: 0, _refreshing: false, _refreshPromise: null,
    _setToken(tok) { this._token = tok; GM_setValue('yms_token', tok); try { const b64 = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); const payload = JSON.parse(atob(b64)); this._tokenExpiry = (payload.exp || 0) * 1000 - 60000; } catch { this._tokenExpiry = Date.now() + 3600000; } },
    async _ensureToken() { if (this._token && Date.now() < this._tokenExpiry) return true; if (this._refreshing) return this._refreshPromise; this._refreshing = true; this._refreshPromise = this.autoFetchToken().finally(() => { this._refreshing = false; this._refreshPromise = null; }); return this._refreshPromise; },
    async autoFetchToken() {
        const wh = CONFIG.warehouseId.toUpperCase();
        UI.setStatus('🔑 YMS: auto-fetching token...');

        try {
            const html = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'https://trans-logistics-eu.amazon.com/yms/shipclerk/',
                    headers: { 'Accept': 'text/html' },
                    withCredentials: true,
                    onload(r) {
                        if (r.status >= 200 && r.status < 400) resolve(r.responseText);
                        else reject({ message: `HTTP ${r.status}` });
                    },
                    onerror() { reject({ message: 'Network error' }); }
                });
            });

            let token = null;

            // Priority 1: window.ymsSecurityToken assignment
            const m1 = html.match(/ymsSecurityToken\s*=\s*["']?(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']?/);
            if (m1) token = m1[1];

            // Priority 2: token property in JSON
            if (!token) {
                const m2 = html.match(/["']token["']\s*:\s*["'](eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']/);
                if (m2) token = m2[1];
            }

            // Priority 3: any JWT starting with eyJhbGciOi
            if (!token) {
                const m3 = html.match(/eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
                if (m3) token = m3[0];
            }

            if (token) {
                try {
                    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
                    const payload = JSON.parse(atob(b64));

                    if (payload.exp * 1000 >= Date.now()) {
                        const tokenYard = payload.context?.yard?.toUpperCase();

                        // Store for all yards
                        if (tokenYard) {
                            GM_setValue(`yms_token_${tokenYard}`, token);
                            GM_setValue('yms_token', token);
                        }

                        if (!tokenYard || tokenYard === wh) {
                            this._setToken(token);
                            UI.setStatus('✅ YMS token fetched!');
                            this.startAutoRefresh();
                            return true;
                        } else {
                            UI.setStatus(`⚠️ YMS token for ${tokenYard}, need ${wh}`);
                        }
                    } else {
                        UI.setStatus('⚠️ YMS token expired in HTML');
                    }
                } catch (e) {
                    console.warn('[ShipMap:YMS] Token decode error:', e.message);
                }
            }
        } catch (e) {
            console.warn('[ShipMap:YMS] Auto-fetch failed:', e.message);
        }

        UI.setStatus(`🔑 Open YMS tab for ${wh}`);
        UI.showYmsHint(wh);
        return false;
    },

    setManualToken(tok) { if (tok && tok.startsWith('eyJ')) { this._setToken(tok); UI.setStatus('✅ YMS token set — loading...'); this.startAutoRefresh(); } else UI.setStatus('❌ Invalid token'); },
    async _postJSON(url, body) {
        const ok = await this._ensureToken();
        if (!ok) throw { message: 'No YMS token' };

        const maxRetries = 3;
        const retryDelays = [0, 2000, 5000];

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            if (attempt > 0) {
                console.log(`[ShipMap:YMS] Retry ${attempt}/${maxRetries} in ${retryDelays[attempt]}ms...`);
                await new Promise(r => setTimeout(r, retryDelays[attempt]));
            }

            try {
                const result = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url,
                        headers: {
                            'Content-Type': 'application/json;charset=utf-8',
                            'Accept': 'application/json, text/plain, */*',
                            'api': 'getYardStateWithPendingMoves',
                            'method': 'POST',
                            'token': this._token,
                            'Origin': 'https://trans-logistics-eu.amazon.com',
                            'Referer': 'https://trans-logistics-eu.amazon.com/'
                        },
                        data: JSON.stringify(body),
                        withCredentials: true,
                        anonymous: false,
                        onload(r) {
                            if (r.status === 401 || r.status === 403) {
                                YMS._token = null;
                                YMS._tokenExpiry = 0;
                                reject({ message: `HTTP ${r.status} — token expired`, retry: false });
                                return;
                            }
                            if (r.status === 500) {
                                console.warn(`[ShipMap:YMS] HTTP 500 — server error (attempt ${attempt + 1})`);
                                reject({ message: `HTTP 500`, retry: true });
                                return;
                            }
                            if (r.status >= 200 && r.status < 300) {
                                try { resolve(JSON.parse(r.responseText)); }
                                catch { reject({ message: 'JSON parse', retry: false }); }
                            } else {
                                reject({ message: `HTTP ${r.status}`, retry: true });
                            }
                        },
                        onerror() { reject({ message: 'Network error', retry: true }); }
                    });
                });

                return result; // Success — exit loop

            } catch (err) {
                if (!err.retry || attempt === maxRetries - 1) {
                    // Last attempt or non-retryable — try token refresh then throw
                    if (err.retry) {
                        console.warn('[ShipMap:YMS] All retries failed — refreshing token...');
                        this._token = null;
                        this._tokenExpiry = 0;
                        const refreshed = await this.autoFetchToken();
                        if (refreshed) {
                            // One final attempt with fresh token
                            try {
                                return await new Promise((resolve, reject) => {
                                    GM_xmlhttpRequest({
                                        method: 'POST', url,
                                        headers: {
                                            'Content-Type': 'application/json;charset=utf-8',
                                            'Accept': 'application/json, text/plain, */*',
                                            'api': 'getYardStateWithPendingMoves',
                                            'method': 'POST',
                                            'token': this._token,
                                            'Origin': 'https://trans-logistics-eu.amazon.com',
                                            'Referer': 'https://trans-logistics-eu.amazon.com/'
                                        },
                                        data: JSON.stringify(body),
                                        withCredentials: true, anonymous: false,
                                        onload(r) {
                                            if (r.status >= 200 && r.status < 300) {
                                                try { resolve(JSON.parse(r.responseText)); }
                                                catch { reject({ message: 'JSON parse' }); }
                                            } else reject({ message: `HTTP ${r.status} after refresh` });
                                        },
                                        onerror() { reject({ message: 'Network error after refresh' }); }
                                    });
                                });
                            } catch (finalErr) {
                                throw finalErr;
                            }
                        }
                    }
                    throw err;
                }
                // Otherwise continue to next retry
            }
        }
    },

    async fetchData() {
        const ok = await this._ensureToken(); if (!ok) return;
        State.ymsLoading = true; UI.updateYmsPanel();
        try {
            const data = await this._postJSON(CONFIG.ymsUrl, { requester: { system: 'YMSWebApp' } });
            const allLocs = data?.locationsSummaries?.[0]?.locations || [];
            const locMap = {}, vrIdMap = {}, annotationVrIds = {};
            for (const loc of allLocs) {
                const code = loc.code?.toUpperCase(); if (code) locMap[code] = loc;
                for (const asset of (loc.yardAssets || [])) {
                    const vrIds = ymsGetVrIds(asset);
                    for (const vr of vrIds) { if (!vrIdMap[vr]) vrIdMap[vr] = []; if (!vrIdMap[vr].some(h => h.locationCode === loc.code)) vrIdMap[vr].push({ asset, locationCode: loc.code, location: loc }); }
                    if (asset.annotation) { const matches = asset.annotation.match(/\b\d{2,3}[A-Z0-9]{5,}\b/gi) || []; for (const m of matches) { const mu = m.toUpperCase(); const alreadyDirect = vrIdMap[mu]?.some(h => h.locationCode === loc.code); if (!alreadyDirect) { if (!annotationVrIds[mu]) annotationVrIds[mu] = []; if (!annotationVrIds[mu].some(h => h.locationCode === loc.code)) annotationVrIds[mu].push({ asset, locationCode: loc.code, location: loc, fromAnnotation: true }); } } }
                }
            }
            State.ymsLocations = allLocs; State.ymsLocMap = locMap; State.ymsVrIdMap = vrIdMap; State.ymsAnnotationVrIds = annotationVrIds; State.ymsLastUpdated = new Date(); State.ymsLoading = false;
            UI.updateYmsPanel(); R.requestRender();
            const occupied = allLocs.filter(l => l.yardAssets?.length > 0).length;
            UI.setStatus(`🏗️ YMS: ${allLocs.length} loc / ${occupied} occupied / ${Object.keys(vrIdMap).length} VRs`);
            UI.updateDashKpi();
        } catch (err) {
            State.ymsLoading = false;
            UI.updateYmsPanel();
            const msg = err.message || 'Unknown error';
            console.error(`[ShipMap:YMS] ❌ ${msg}`);
            if (msg.includes('500')) {
                UI.setStatus(`⚠️ YMS: server error — will retry next cycle`);
            } else if (msg.includes('401') || msg.includes('403') || msg.includes('token')) {
                UI.setStatus(`🔑 YMS: token issue — refreshing...`);
                this.autoFetchToken();
            } else {
                UI.setStatus(`❌ YMS: ${msg}`);
            }
        }

    },
    buildReport() {
        const owners = {}, vrIdPattern = /\b\d{2,3}[A-Z0-9]{5,}\b/i;
        for (const loc of State.ymsLocations) { for (const asset of (loc.yardAssets || [])) { if (asset.type === 'TRACTOR') continue; const oc = asset.owner?.code || asset.broker?.code || 'UNKNOWN'; if (!owners[oc]) owners[oc] = { total:0, unavailable:0, empty:0, full:0, types:{} }; const o = owners[oc]; o.total++; if (asset.unavailable) o.unavailable++; const hasAnyVrId = ymsGetVrIds(asset).length > 0 || (asset.annotation && vrIdPattern.test(asset.annotation)); if (asset.status === 'FULL' || asset.status === 'IN_PROGRESS' || hasAnyVrId) { o.full++; } else if (asset.status === 'EMPTY' && !asset.unavailable) { o.empty++; } const t = asset.type || 'OTHER'; o.types[t] = (o.types[t] || 0) + 1; } }
        const prio = ['ATSEU', 'ATPST', 'DHLTS'];
        return Object.entries(owners).sort(([a], [b]) => { const ai = prio.indexOf(a), bi = prio.indexOf(b); if (ai >= 0 && bi >= 0) return ai - bi; if (ai >= 0) return -1; if (bi >= 0) return 1; return a.localeCompare(b); });
    },
    startAutoRefresh() { this.stopAutoRefresh(); this.fetchData(); State.ymsAutoTimer = setInterval(() => this.fetchData(), CONFIG.data.ymsRefreshInterval); },
    stopAutoRefresh() { if (State.ymsAutoTimer) { clearInterval(State.ymsAutoTimer); State.ymsAutoTimer = null; } },
};

// ============================================================
// VISTA
// ============================================================
const VISTA = {
    _csrfToken: null,
    async _fetchCsrf() {
        try {
            const resp = await new Promise((resolve, reject) => { GM_xmlhttpRequest({ method:'GET', url:`${CONFIG.baseUrl}/sortcenter/vista`, headers:{'Accept':'text/html'}, withCredentials:true, onload(r) { if (r.status >= 200 && r.status < 400) resolve(r); else reject({message:`HTTP ${r.status}`}); }, onerror() { reject({message:'Network error'}); } }); });
            const html = resp.responseText;
            const patterns = [ /name="anti-csrftoken-a2z"\s+value="([^"]+)"/, /value="([^"]+)"\s+name="anti-csrftoken-a2z"/, /anti-csrftoken-a2z[^>]+value="([^"]+)"/, /name="csrf-token"\s+content="([^"]+)"/, /content="([^"]+)"\s+name="csrf-token"/, /csrf-token[^>]+content="([^"]+)"/ ];
            for (const p of patterns) { const m = html.match(p); if (m) { this._csrfToken = m[1]; return true; } }
            const nuclear = html.match(/csrf[^"]{0,30}"([A-Za-z0-9+/=]{30,})"/i); if (nuclear) { this._csrfToken = nuclear[1]; return true; }
            const cookieMatch = (resp.responseHeaders || '').match(/anti-csrftoken-a2z=([^;\s]+)/); if (cookieMatch) { this._csrfToken = decodeURIComponent(cookieMatch[1]); return true; }
            return false;
        } catch { return false; }
    },
    _buildBody(state, isMissing = false) {
        const now = Date.now();
        const payload = { entity:'getContainersDetailByCriteria', nodeId:CONFIG.warehouseId, timeBucket:{ fieldName:'physicalLocationMoveTimestamp', startTime:now - 128*3600000, endTime:now }, filterBy: isMissing ? { isMissing:[true] } : { state:[state], isMissing:[false] }, containerTypes:['PALLET','GAYLORD','CART'], fetchCompoundContainerDetails:true, includeCriticalCptEnclosingContainers:false };
        if (isMissing) payload.fetchMissingContainerDetails = true;
        let body = 'jsonObj=' + encodeURIComponent(JSON.stringify(payload));
        if (this._csrfToken) body = 'anti-csrftoken-a2z=' + encodeURIComponent(this._csrfToken) + '&' + body;
        return body;
    },
    _postForm(url, body) { return new Promise((resolve, reject) => { GM_xmlhttpRequest({ method:'POST', url, headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'}, data:body, withCredentials:true, onload(r) { if (r.status >= 200 && r.status < 300) { try { resolve(JSON.parse(r.responseText)); } catch { reject({message:'JSON parse error'}); }             } else { console.error(`[ShipMap:YMS] HTTP ${r.status}:`, r.responseText?.substring(0, 200)); reject({message:`HTTP ${r.status}`}); }
 }, onerror() { reject({message:'Network error'}); } }); }); },
    async fetchData(retryCount = 0) {
        State.vistaLoading = true; UI.updateVistaPanel();
        if (!this._csrfToken) { const ok = await this._fetchCsrf(); if (!ok) { State.vistaLoading = false; UI.updateVistaPanel(); UI.setStatus('❌ Vista: CSRF not found'); return; } }
        try {
            const [stacked, staged, loaded] = await Promise.all([ this._postForm(CONFIG.vistaUrl, this._buildBody('Stacked')), this._postForm(CONFIG.vistaUrl, this._buildBody('Staged')), this._postForm(CONFIG.vistaUrl, this._buildBody('Loaded')) ]);
            const extract = (resp) => { const groups = resp?.ret?.getContainersDetailByCriteriaOutput?.containerDetails || []; const all = []; for (const group of groups) { if (group?.containerDetails) { all.push(...group.containerDetails); } } return all; };
            const all = [ ...extract(stacked).map(c => ({...c, _state:'Stacked'})), ...extract(staged).map(c => ({...c, _state:'Staged'})), ...extract(loaded).map(c => ({...c, _state:'Loaded'})) ];
            const locMap = {};
            for (const c of all) { const loc = c.location || 'UNKNOWN'; if (!locMap[loc]) locMap[loc] = { location:loc, locationType:c.locationType, containers:[], totalPkgs:0, totalContainers:0, types:{}, states:{}, routes:{}, maxDwell:0, totalDwell:0, criticalCpt:null, criticalCount:0 }; const g = locMap[loc]; g.containers.push(c); g.totalContainers++; g.totalPkgs += c.childCount || 0; g.types[c.type] = (g.types[c.type] || 0) + 1; g.states[c._state] = (g.states[c._state] || 0) + 1; const route = c.route || 'unknown'; if (!g.routes[route]) g.routes[route] = {count:0,pkgs:0}; g.routes[route].count++; g.routes[route].pkgs += c.childCount || 0; if (c.dwellTimeInMinutes > g.maxDwell) g.maxDwell = c.dwellTimeInMinutes; g.totalDwell += c.dwellTimeInMinutes || 0; if (c.criticalPackages > 0) g.criticalCount += c.criticalPackages; if (c.cpt) { if (!g.criticalCpt || c.cpt < g.criticalCpt) g.criticalCpt = c.cpt; } }
            State.vistaContainers = all; State.vistaLocMap = locMap; State.vistaLastUpdated = new Date(); State.vistaLoading = false;
            State.vistaElementMap = {}; const processedPairs = new Set();
            for (const [locName, locData] of Object.entries(locMap)) {
                const matchedEls = MatchIndex.getMatching(locName);
                for (const el of matchedEls) { const elKey = el.name || el.id; const pairKey = `${elKey}::${locName}`; if (processedPairs.has(pairKey)) continue; processedPairs.add(pairKey); if (!State.vistaElementMap[elKey]) State.vistaElementMap[elKey] = { totalContainers:0, totalPkgs:0, types:{}, states:{}, routes:{}, maxDwell:0, totalDwell:0, criticalCpt:null, criticalCount:0, locations:[] }; const em = State.vistaElementMap[elKey]; em.totalContainers += locData.totalContainers; em.totalPkgs += locData.totalPkgs; em.maxDwell = Math.max(em.maxDwell, locData.maxDwell); em.totalDwell += locData.totalDwell; em.criticalCount += locData.criticalCount; if (locData.criticalCpt && (!em.criticalCpt || locData.criticalCpt < em.criticalCpt)) em.criticalCpt = locData.criticalCpt; for (const [t, n] of Object.entries(locData.types)) em.types[t] = (em.types[t]||0)+n; for (const [s, n] of Object.entries(locData.states)) em.states[s] = (em.states[s]||0)+n; for (const [r, d] of Object.entries(locData.routes)) { if (!em.routes[r]) em.routes[r] = {count:0,pkgs:0}; em.routes[r].count += d.count; em.routes[r].pkgs += d.pkgs; } em.locations.push(locName); }
            }
            UI.updateVistaPanel(); R.requestRender();
            UI.setStatus(`📦 Vista: ${all.length} containers / ${Object.keys(locMap).length} locations`);
            UI.updateDashKpi();
        } catch (err) {
            if (err.message?.includes('403') && this._csrfToken && retryCount < 1) { this._csrfToken = null; State.vistaLoading = false; return this.fetchData(retryCount + 1); }
            State.vistaLoading = false; UI.updateVistaPanel(); UI.setStatus(`❌ Vista: ${err.message}`);
        }
    },
    getCongestionLevel(elKey) { const data = State.vistaElementMap?.[elKey]; if (!data) return null; const n = data.totalContainers; if (n === 0) return null; const { max } = getEffectiveMaxContainers(elKey); if (max > 0) { const pct = n / max; if (pct <= 0.4) return 'low'; if (pct <= 0.7) return 'medium'; if (pct <= 1.0) return 'high'; return 'critical'; } if (n <= 3) return 'low'; if (n <= 8) return 'medium'; if (n <= 15) return 'high'; return 'critical'; },
    getCongestionColor(level) { return { low:{fill:'#69f0ae',border:'#00c853',glow:'#69f0ae'}, medium:{fill:'#ffd600',border:'#c7a500',glow:'#ffd600'}, high:{fill:'#ff9100',border:'#e65100',glow:'#ff9100'}, critical:{fill:'#ff1744',border:'#d50000',glow:'#ff1744'} }[level] || null; },
    buildRouteCongestion() {
        const groups = {};
        for (const c of State.vistaContainers) {
            if (c._state === 'Loaded') continue; if (!c.isClosed && !c.closed) continue;
            if (!c.route || c.route === 'UNKNOWN' || c.route === 'unknown') continue;
            const rawRoute = c.route; const gKey = routeGroupKey(rawRoute); const subLabel = routeSubLabel(rawRoute); const fullRoute = parseRoute(rawRoute, { stripSuffix: false }).toUpperCase();
            if (!groups[gKey]) groups[gKey] = { key: gKey, totalContainers: 0, totalPkgs: 0, types: {}, states: {}, locations: {}, maxDwell: 0, totalDwell: 0, subRoutes: {} };
            const g = groups[gKey]; g.totalContainers++; g.totalPkgs += c.childCount || 0; g.types[c.type] = (g.types[c.type] || 0) + 1; g.states[c._state] = (g.states[c._state] || 0) + 1; if (c.dwellTimeInMinutes > g.maxDwell) g.maxDwell = c.dwellTimeInMinutes; g.totalDwell += c.dwellTimeInMinutes || 0;
            const loc = c.location || 'UNKNOWN'; if (!g.locations[loc]) g.locations[loc] = { count: 0, pkgs: 0 }; g.locations[loc].count++; g.locations[loc].pkgs += c.childCount || 0;
            if (!g.subRoutes[fullRoute]) g.subRoutes[fullRoute] = { label: fullRoute, subLabel, totalContainers: 0, totalPkgs: 0, types: {}, maxDwell: 0 };
            const sr = g.subRoutes[fullRoute]; sr.totalContainers++; sr.totalPkgs += c.childCount || 0; sr.types[c.type] = (sr.types[c.type] || 0) + 1; if (c.dwellTimeInMinutes > sr.maxDwell) sr.maxDwell = c.dwellTimeInMinutes;
        }
        return Object.values(groups).sort((a, b) => b.totalContainers - a.totalContainers);
    },
    startAutoRefresh() { this.stopAutoRefresh(); this.fetchData(); State.vistaAutoTimer = setInterval(() => this.fetchData(), CONFIG.data.vistaRefreshInterval); },
    stopAutoRefresh() { if (State.vistaAutoTimer) { clearInterval(State.vistaAutoTimer); State.vistaAutoTimer = null; } },
};

// ============================================================
// FMC — Direct HTML/CSV fetch + Classification
// ============================================================
const FMC = {
    tours: [], summary: null, lastUpdated: null, loading: false,
    _autoTimer: null, _rawRows: [],

    _resolveSiteCode() {
        // Blocklist — these are FMC page paths, not site codes
        const INVALID = new Set(['search', 'execution', 'dashboard', 'planning', 'excel', 'api', 'controller']);

        const validate = (code) => {
            if (!code || code.length < 3) return false;
            if (INVALID.has(code.toLowerCase())) return false;
            return true;
        };

        // 1. Check CONFIG
        if (validate(CONFIG.fmcSiteCode)) return CONFIG.fmcSiteCode;

        // 2. Check stored value
        const saved = GM_getValue('shipmap_fmc_site_code', '');
        if (validate(saved)) { CONFIG.fmcSiteCode = saved; return saved; }

        // 3. Bad value stored — overwrite with default
        const fallback = 'AT1hgc';
        CONFIG.fmcSiteCode = fallback;
        GM_setValue('shipmap_fmc_site_code', fallback);
        console.log(`[ShipMap:FMC] ⚠ Bad site code cleared → using ${fallback}`);
        return fallback;
    },


    async fetchData() {
        const siteCode = this._resolveSiteCode();
        if (!siteCode || siteCode.length < 3) {
            console.log('[ShipMap:FMC] ⚠ No FMC site code — skipping');
            this.loading = false; UI.updateFmcPanel(); return;
        }
        this.loading = true; UI.updateFmcPanel();
        const csvUrl = `${CONFIG.baseUrl}/fmc/excel/execution/${encodeURIComponent(siteCode)}?view=vrs`;
        console.log(`[ShipMap:FMC] 📡 Fetching: ${csvUrl}`);
        try {
            const csvText = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({ method: 'GET', url: csvUrl, headers: { 'Accept': 'text/csv,application/vnd.ms-excel,*/*' }, withCredentials: true,
                    onload(r) { console.log(`[ShipMap:FMC] HTTP ${r.status} | ${(r.responseText||'').length}B`); if (r.status >= 200 && r.status < 300) resolve(r.responseText); else reject({ message: `HTTP ${r.status}` }); },
                    onerror() { reject({ message: 'Network error' }); }
                });
            });
            if (!csvText || csvText.length < 50) throw { message: 'Empty response' };
            if (csvText.trim().startsWith('<!') || csvText.trim().startsWith('<html')) {
                // Check if it's a real table or error page
                if (!csvText.includes('<table')) throw { message: 'Got login/error page' };
            }
            const rows = this._parseResponse(csvText);
            if (!rows.length) throw { message: 'No data rows' };
            this._rawRows = rows;
            const tours = this._normalizeRows(rows);
            const summary = this._buildSummary(tours);
            this.tours = tours; this.summary = summary; this.lastUpdated = new Date();
            this._buildVrIdMap();
            console.log(`[ShipMap:FMC] ✅ ${tours.length} tours | IB:${summary.inbound.total} OB:${summary.outbound.total} yard:${summary.yardNow}`);
        } catch (err) { console.error(`[ShipMap:FMC] ❌ ${err.message || err}`); }
        this.loading = false;
        UI.updateFmcPanel(); UI.updateDashKpi(); R.requestRender();
        if (this.tours.length) { UI.setStatus(`🚛 FMC: ${this.tours.length} tours`); }
        // Refresh loads panel — classification may have changed
        if (State.activeTab === 'loads') UI.updateDataPanel();
    },

    _parseResponse(text) {
        const trimmed = text.trim();
        if (trimmed.startsWith('<') && trimmed.includes('<table')) return this._parseHTMLTable(trimmed);
        return this._parseCSVText(trimmed);
    },

    _parseHTMLTable(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const table = doc.querySelector('table');
        if (!table) return [];
        const headerRow = table.querySelector('tr');
        if (!headerRow) return [];
        const headerCells = headerRow.querySelectorAll('th, td');
        const headers = [], normalizedHeaders = [];
        headerCells.forEach(cell => {
            const text = cell.textContent.trim(); headers.push(text);
            normalizedHeaders.push(text.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''));
        });
        console.log(`[ShipMap:FMC] HTML headers (${headers.length}):`, headers.slice(0, 15).join(' | '));
        const dataRows = table.querySelectorAll('tr');
        const rows = [];
        for (let i = 1; i < dataRows.length; i++) {
            const cells = dataRows[i].querySelectorAll('td');
            if (cells.length < 3) continue;
            const row = {};
            cells.forEach((cell, j) => { const value = cell.textContent.trim(); if (j < normalizedHeaders.length) { row[normalizedHeaders[j]] = value; row[headers[j]] = value; } });
            rows.push(row);
        }
        return rows;
    },

    _parseCSVText(text) {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return [];
        const parseRow = (line) => { const fields = []; let current = '', inQuotes = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; } else if ((ch === ',' || ch === '\t' || ch === ';') && !inQuotes) { fields.push(current.trim()); current = ''; } else { current += ch; } } fields.push(current.trim()); return fields; };
        const firstLine = lines[0]; const tabCount = (firstLine.match(/\t/g) || []).length; const commaCount = (firstLine.match(/,/g) || []).length; const useTab = tabCount > commaCount;
        const headers = useTab ? firstLine.split('\t').map(h => h.trim().replace(/^"|"$/g, '')) : parseRow(firstLine);
        const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''));
        const rows = [];
        for (let i = 1; i < lines.length; i++) { const values = useTab ? lines[i].split('\t').map(v => v.trim().replace(/^"|"$/g, '')) : parseRow(lines[i]); if (values.length < 3) continue; const row = {}; for (let j = 0; j < normalizedHeaders.length; j++) { row[normalizedHeaders[j]] = values[j] || ''; row[headers[j]] = values[j] || ''; } rows.push(row); }
        return rows;
    },

    _getField(row, ...names) {
        for (const name of names) {
            const lower = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
            if (row[lower] !== undefined && row[lower] !== '') return row[lower];
            if (row[name] !== undefined && row[name] !== '') return row[name];
            for (const key of Object.keys(row)) { if (key.includes(lower) || lower.includes(key)) { if (row[key] !== '') return row[key]; } }
        }
        return '';
    },

    _parseTime(val) {
        if (!val) return null;
        if (/^\d{12,13}$/.test(val)) return parseInt(val);
        try { const d = new Date(val); if (!isNaN(d.getTime())) return d.getTime(); } catch (e) { console.debug('[ShipMap:FMC] date parse:', e.message); }
const m = val.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\s+(\d{1,2}):(\d{2})/);

        if (m) { const y = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]); const d = new Date(y, parseInt(m[2]) - 1, parseInt(m[1]), parseInt(m[4]), parseInt(m[5])); if (!isNaN(d.getTime())) return d.getTime(); }
        return null;
    },

    _normalizeRows(rows) {
        const tours = []; const site = CONFIG.warehouseId.toUpperCase();
        for (const row of rows) {
            try {
                const tourId = row.tour_id || '';
                const vrId = row.vr_id || '';
                const status = row.status || '';
                const planId = row.plan_id || '';
                const facilitySeq = row.facility_sequence || '';
                const carrier = row.carrier || '';
                const carrierGroup = row.carrier_group || '';
                const subcarrier = row.subcarrier || '';
                const shipperAccounts = row.shipper_accounts || '';
                const equipmentType = row.equipment_type || '';
                const isCptTruck = (row.is_cpt_truck || '').toLowerCase() === 'true';
                const crId = row.cr_id || '';
                const businessTypes = this._getField(row, 'business_types', 'Business Types', 'businessTypes', 'business_type') || '';

                // ── Direction from facility_sequence ──
                let direction = 'UNKNOWN';
                const seqUpper = facilitySeq.toUpperCase();
                const seqParts = seqUpper.split('->');
                if (seqParts.length >= 2) {
                    const firstStop = seqParts[0].split('-')[0].trim();
                    const allStops = seqUpper.replace(/->/g, '-').split('-')
                        .map(s => s.trim()).filter(s => s && s !== 'ND');
                    const lastStop = allStops[allStops.length - 1] || '';

                    if (firstStop === site || firstStop.startsWith(site)) {
                        direction = 'OB';
                    } else if (lastStop === site) {
                        direction = 'IB';
                    } else if (allStops.includes(site)) {
                        direction = 'OB';
                    }
                }

                // ── Route from facility_sequence ──
                const route = facilitySeq.replace(/^[A-Z0-9]+->/i, '').replace(/-ND$/i, '');

                // ── Times — raw columns ──
                const firstDockArr = this._parseTime(row.first_dock_arrival);
                const firstDockDep = this._parseTime(row.first_dock_departure);
                const firstYardArr = this._parseTime(row.first_yard_arrival);
                const firstYardDep = this._parseTime(row.first_yard_departure);
                const lastDockArr  = this._parseTime(row.last_dock_arrival);
                const lastYardArr  = this._parseTime(row.last_yard_arrival);
                const cpt = this._parseTime(row.cpt);

                // ── Pick times for OUR site based on position in sequence ──
                // OB (we're first stop)  → use first_* columns
                // IB (we're last stop)   → use last_* columns
                let plannedDockArrival, plannedDockDeparture, plannedYardArrival, plannedYardDeparture;

                if (direction === 'OB') {
                    plannedDockArrival   = firstDockArr;
                    plannedDockDeparture = firstDockDep;
                    plannedYardArrival   = firstYardArr;
                    plannedYardDeparture = firstYardDep;
                } else {
                    plannedDockArrival   = lastDockArr  || firstDockArr;
                    plannedYardArrival   = lastYardArr  || firstYardArr;
                    plannedDockDeparture = firstDockDep;
                    plannedYardDeparture = firstYardDep;
                }

                // ── Status inference ──
                const statusUpper = status.toUpperCase();
                const hasArrived = ['ARRIVED_AT_FINAL_DESTINATION', 'COMPLETED', 'IN_TRANSIT'].includes(statusUpper)
                    || statusUpper.includes('ARRIVED');
                const hasDeparted = statusUpper === 'COMPLETED';

                const actualYardArrival = hasArrived ? (plannedYardArrival || plannedDockArrival) : null;
                const actualYardDeparture = hasDeparted ? (plannedYardDeparture || plannedDockDeparture) : null;

                // ── Dwell ──
                let yardDwellMin = 0;
                if (hasArrived && !hasDeparted && actualYardArrival) {
                    yardDwellMin = Math.round((Date.now() - actualYardArrival) / 60000);
                } else if (hasArrived && hasDeparted && actualYardArrival && actualYardDeparture) {
                    yardDwellMin = Math.round((actualYardDeparture - actualYardArrival) / 60000);
                }

                // ── Delays ──
                let arrivalDelayMin = 0, departureDelayMin = 0;
                if (hasArrived && plannedYardArrival && actualYardArrival) {
                    arrivalDelayMin = Math.max(0, Math.round((actualYardArrival - plannedYardArrival) / 60000));
                } else if (!hasArrived && plannedYardArrival && Date.now() > plannedYardArrival) {
                    arrivalDelayMin = Math.round((Date.now() - plannedYardArrival) / 60000);
                }
                if (hasDeparted && plannedYardDeparture && actualYardDeparture) {
                    departureDelayMin = Math.max(0, Math.round((actualYardDeparture - plannedYardDeparture) / 60000));
                }

                // ── Tour status ──
                let tourStatus = 'PLANNED';
                if (hasDeparted) tourStatus = 'DEPARTED';
                else if (statusUpper === 'ARRIVED_AT_FINAL_DESTINATION') tourStatus = 'AT_YARD';
                else if (statusUpper === 'IN_TRANSIT') tourStatus = 'IN_TRANSIT';
                else if (statusUpper === 'EXECUTION_STARTED') tourStatus = 'ASSIGNED';
                else if (hasArrived) tourStatus = 'AT_YARD';

                tours.push({
                    tourId, vrId, planId, direction, route, facilitySeq,
                    businessTypes,
                    businessTypesList: businessTypes
                        ? businessTypes.split(/[,;|]/).map(s => s.trim()).filter(Boolean)
                        : [],
                    shipperCategory: this._classifyShipper(shipperAccounts),
                    shippers: shipperAccounts
                        ? shipperAccounts.split(/[,;|]/).map(s => s.trim()).filter(Boolean)
                        : [],
                    carrier, carrierGroup, subcarrier, equipmentType,
                    plannedDockArrival, plannedDockDeparture,
                    plannedYardArrival, plannedYardDeparture,
                    lastDockArrival: lastDockArr, lastYardArrival: lastYardArr,
                    trailerReadyTime: plannedDockDeparture,
                    actualYardArrival, actualYardDeparture,
                    cpt, isCptTruck,
                    arrivalDelayMin, departureDelayMin,
                    operationType: equipmentType,
                    actionType: direction === 'OB' ? 'PICKUP' : 'DELIVERY',
                    actionStatus: status,
                    trailerId: '', trailerOwner: '',
                    crId, bidId: row.bid_id || '',
                    hasArrived, hasDeparted, yardDwellMin, tourStatus,
                    _ts: Date.now()
                });
            } catch (rowErr) {
                console.warn('[ShipMap:FMC] Row parse error:', rowErr.message);
            }
        }
        console.log(`[ShipMap:FMC] Normalized ${tours.length}/${rows.length} tours`);
        return tours;
    },


    _classifyShipper(raw) {
        if (!raw) return 'OTHER'; const u = raw.toUpperCase();
        if (/INBOUND|VENDOR|IMPORT/.test(u)) return 'IB'; if (/OUTBOUND|TRANSFERS?$/.test(u)) return 'OB';
        if (/REPOSITIONING|EMPTY/.test(u)) return 'EMPTY'; if (/AMZL|MISSORT|STANDBY/.test(u)) return 'AMZL';
        if (/AMXL/.test(u)) return 'AMXL'; if (/RETURNS/.test(u)) return 'RETURNS';
        if (/ADHOC|SAVE/.test(u)) return 'ADHOC'; if (/WAREHOUSE.?TRANSFER/.test(u)) return 'OB';
        if (/AIR/.test(u)) return 'OB'; return 'OTHER';
    },

    _buildSummary(tours) {
        const now = Date.now();
        const s = { total: tours.length, byDirection: {}, byStatus: {}, byShipper: {}, byCarrier: {}, byOperation: {}, delayed: { arrival: 0, departure: 0, critical: 0 }, inbound: { total: 0, arrived: 0, planned: 0, delayed: 0 }, outbound: { total: 0, departed: 0, atYard: 0, planned: 0, delayed: 0 }, yardNow: 0, avgYardDwell: 0, maxYardDwell: 0, nextArrivals: [], nextDepartures: [] };
        let td = 0, dc = 0;
        for (const t of tours) {
            s.byDirection[t.direction] = (s.byDirection[t.direction] || 0) + 1;
            s.byStatus[t.tourStatus] = (s.byStatus[t.tourStatus] || 0) + 1;
            s.byShipper[t.shipperCategory] = (s.byShipper[t.shipperCategory] || 0) + 1;
            s.byCarrier[t.carrier || 'UNKNOWN'] = (s.byCarrier[t.carrier || 'UNKNOWN'] || 0) + 1;
            if (t.arrivalDelayMin > 15) s.delayed.arrival++;
            if (t.departureDelayMin > 15) s.delayed.departure++;
            if (t.arrivalDelayMin > 60 || t.departureDelayMin > 60) s.delayed.critical++;
            if (t.direction === 'IB') { s.inbound.total++; if (t.hasArrived) s.inbound.arrived++; else s.inbound.planned++; if (t.arrivalDelayMin > 15) s.inbound.delayed++; }
            if (t.direction === 'OB') { s.outbound.total++; if (t.hasDeparted) s.outbound.departed++; else if (t.hasArrived) s.outbound.atYard++; else s.outbound.planned++; if (t.departureDelayMin > 15) s.outbound.delayed++; }
            if (t.hasArrived && !t.hasDeparted) { s.yardNow++; if (t.yardDwellMin > 0) { td += t.yardDwellMin; dc++; if (t.yardDwellMin > s.maxYardDwell) s.maxYardDwell = t.yardDwellMin; } }
            if (!t.hasArrived && t.plannedYardArrival) { const diff = t.plannedYardArrival - now; if (diff > -3600000 && diff < 14400000) s.nextArrivals.push({ trailerId: t.trailerId, carrier: t.carrier, direction: t.direction, shipper: t.shipperCategory, eta: t.plannedYardArrival, delayMin: t.arrivalDelayMin }); }
            if (t.hasArrived && !t.hasDeparted && t.plannedYardDeparture) { const diff = t.plannedYardDeparture - now; if (diff > -3600000 && diff < 14400000) s.nextDepartures.push({ trailerId: t.trailerId, carrier: t.carrier, direction: t.direction, shipper: t.shipperCategory, etd: t.plannedYardDeparture, delayMin: t.departureDelayMin, yardDwellMin: t.yardDwellMin }); }
        }
        s.avgYardDwell = dc > 0 ? Math.round(td / dc) : 0;
        s.nextArrivals.sort((a, b) => a.eta - b.eta); s.nextDepartures.sort((a, b) => a.etd - b.etd);
        s.nextArrivals = s.nextArrivals.slice(0, 20); s.nextDepartures = s.nextDepartures.slice(0, 20);
        return s;
    },

    // ── Classification ──────────────────────────────────────
    _vrIdClassMap: new Map(),

    _buildVrIdMap() {
        this._vrIdClassMap.clear();
        for (const t of this.tours) {
            if (!t.vrId) continue;
            const vid = t.vrId.toUpperCase();
            if (this._vrIdClassMap.has(vid)) continue;
            const isTT = this._isTourTransferTotes(t);
            const cls = this._classifyTour(t);
            this._vrIdClassMap.set(vid, { isTransferTotes: isTT, classification: cls, tour: t });
        }
    },

    _isTourTransferTotes(tour) {
        const check = (arr) => arr.some(s => {
            const u = s.toUpperCase().trim();
            return u === 'TRANSFERSTOTE' || u === 'TRANSFERTOTES' || u === 'TRANSFERS TOTE' || u === 'TRANSFERS_TOTE' || u.includes('TRANSFERSTOTE');
        });
        return check(tour.businessTypesList) || check(tour.shippers);
    },

_classifyTour(tour) {

    const site = CONFIG.warehouseId.toUpperCase();
    const allTypes = [...tour.businessTypesList, ...tour.shippers];

    // ── IB: TransfersInventoryCorrection → always IB  (NEW v3.4.0a)
    const isInvCorrection = allTypes.some(s => {
        const u = s.toUpperCase().trim();
        return u.startsWith('TRANSFERSINVENTORYCORRECTION')
            || u.startsWith('TRANSFERS_INVENTORY_CORRECTION')
            || u.startsWith('TRANSFERS_INVENTORYCORRECTION');
    });
    if (isInvCorrection) return 'IB';

    // ── NonInv: Transfers (not InitialPlacement, not Tote) + lane ends at our site
    const isTransfersNonInit = allTypes.some(s => {
        const u = s.toUpperCase().trim();
        return u.startsWith('TRANSFERS')
            && !u.startsWith('TRANSFERSINITIALPLACEMENT')
            && !u.startsWith('TRANSFERS_INITIAL')
            && !u.includes('TRANSFERSTOTE');
    });

    if (isTransfersNonInit) {
        const seq = tour.facilitySeq.toUpperCase().replace(/-ND$/i, '');
        const allStops = seq.replace(/->/g, '-').split('-')
            .map(s => s.trim()).filter(s => s && s !== 'ND');
        const lastStop = allStops[allStops.length - 1] || '';
        if (lastStop === site) return 'NONINV';
    }

    // ── OB/IB from direction (already correctly set in _normalizeRows)
    return tour.direction === 'OB' ? 'OB' : 'IB';
},


    isTransferTotes(vrId) {
        if (!vrId || !this._vrIdClassMap.size) return false;
        return this._vrIdClassMap.get(vrId.toUpperCase())?.isTransferTotes || false;
    },
    getClassification(vrId) {
        if (!vrId) return null;
        return this._vrIdClassMap.get(vrId.toUpperCase()) || null;
    },
    getTourForVrId(vrId) {
        if (!vrId) return null;
        return this._vrIdClassMap.get(vrId.toUpperCase())?.tour || null;
    },
    getNonInvTours() { return this.tours.filter(t => this._classifyTour(t) === 'NONINV'); },
    getIBTours() { return this.tours.filter(t => { const cls = this._classifyTour(t); return cls === 'IB' && !this._isTourTransferTotes(t); }); },

    // ── Query helpers ──
    findByTrailer(trailerId) { if (!trailerId) return null; const tid = trailerId.toUpperCase(); return this.tours.find(t => t.trailerId && t.trailerId.toUpperCase() === tid) || null; },
    findByVrId(vrId) { if (!vrId) return []; const vid = vrId.toUpperCase(); return this.tours.filter(t => t.vrId && t.vrId.toUpperCase() === vid); },
    getAtYard() { return this.tours.filter(t => t.hasArrived && !t.hasDeparted); },
    getDelayed(min = 15) { return this.tours.filter(t => t.arrivalDelayMin > min || t.departureDelayMin > min); },
    getUpcoming(hours = 4) { const now = Date.now(), cutoff = now + hours * 3600000; return this.tours.filter(t => !t.hasArrived && t.plannedYardArrival && t.plannedYardArrival > now - 3600000 && t.plannedYardArrival < cutoff).sort((a, b) => a.plannedYardArrival - b.plannedYardArrival); },

    // ── Lifecycle ──
    start() { this.stopAutoRefresh(); this.fetchData(); this._autoTimer = setInterval(() => this.fetchData(), CONFIG.data.fmcRefreshInterval); },
    stopAutoRefresh() { if (this._autoTimer) { clearInterval(this._autoTimer); this._autoTimer = null; } },
};
    // ============================================================
// DOCKMASTER — IB appointments from fc-inbound-dock-hub
// ============================================================
const Dockmaster = {
    appointments: [], lastUpdated: null, loading: false,
    _autoTimer: null,

    _baseUrl: CONFIG.urls.dockmaster,

    async fetchData(daysBack = 0, daysForward = 0) {
        if (this.loading) return; // prevent double fetch
        this.loading = true;

        try {
            const now = new Date();
            const startDate = new Date(now);
            startDate.setDate(startDate.getDate() - daysBack);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(now);
            endDate.setDate(endDate.getDate() + daysForward);
            endDate.setHours(23, 59, 59, 0);

            const fmt = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const ss = String(d.getSeconds()).padStart(2, '0');
                return `${y}-${m}-${dd}T${hh}:${mm}:${ss}`;
            };

            const url = `${this._baseUrl}/appointment/bySearchParams`
                + `?warehouseId=${CONFIG.warehouseId}`
                + `&clientId=dockmaster`
                + `&searchResultLevel=FULL`
                + `&searchCriteriaName=DROPOFF_DATE`
                + `&localStartDate=${fmt(startDate)}`
                + `&localEndDate=${fmt(endDate)}`
                + `&isStartInRange=true`;

            console.log(`[ShipMap:DM] 📡 Fetching...`);

            const responseText = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: { 'Accept': 'application/json' },
                    withCredentials: true,
                    onload(r) {
                        if (r.status >= 200 && r.status < 300) resolve(r.responseText);
                        else reject({ message: `HTTP ${r.status}` });
                    },
                    onerror() { reject({ message: 'Network error' }); }
                });
            });

            // Parse JSON in next tick to not block UI
            await new Promise(resolve => setTimeout(resolve, 0));

            const data = JSON.parse(responseText);
            const rawList = data?.AppointmentList || [];

            // Normalize in next tick
            await new Promise(resolve => setTimeout(resolve, 0));

            const appointments = this._normalize(rawList);
            this.appointments = appointments;
            this.lastUpdated = new Date();

            console.log(`[ShipMap:DM] ✅ ${appointments.length} apt (from ${rawList.length} raw)`);

        } catch (err) {
            console.error(`[ShipMap:DM] ❌ ${err.message}`);
        }

        this.loading = false;
        setTimeout(() => UI.updateDataPanel(), 100);
    },

    _parseDate(dateObj) {
        if (!dateObj) return null;
        if (dateObj.utcMillis) return dateObj.utcMillis;
        if (dateObj.date && dateObj.time) {
            try {
                const d = new Date(`${dateObj.date.replace(/\//g, '-')}T${dateObj.time}`);
                if (!isNaN(d.getTime())) return d.getTime();
            } catch (e) { console.debug('[ShipMap:DM] date parse:', e.message); }
        }
        return null;
    },

     _normalize(rawList) {
        const appointments = [];
        const now = Date.now();
        const cutoff2h = now - 2 * 3600000;
        const cutoff6h = now - 6 * 3600000;

        for (const apt of rawList) {
            try {
                const status = (apt.status || '').toUpperCase();

                // ── Skip cancelled immediately ──
                if (status === 'CANCELLED') continue;

                const appointmentId = apt.appointmentId || '';
                const carrierName = apt.carrierName || '';
                const trailerNumber = apt.trailerNumber || apt.vehicleId || '';

                const schedStart = this._parseDate(apt.appointmentScheduleDates?.localStartDate);
                const schedEnd = this._parseDate(apt.appointmentScheduleDates?.localEndDate);
                const checkInStart = this._parseDate(apt.checkInDates?.localStartDate);
                const arrivalDate = this._parseDate(apt.arrivalDate);
                const closeDate = this._parseDate(apt.closeDate);

                // ── Status mapping ──
                let dmStatus = 'SCHEDULED';
                if (status === 'CHECKED_IN' || status === 'ARRIVED') dmStatus = 'ARRIVED';
                else if (status === 'RECEIVING' || status === 'IN_PROGRESS') dmStatus = 'RECEIVING';
                else if (status === 'CLOSED' || status === 'COMPLETED') dmStatus = 'COMPLETED';
                else if (status === 'DEFECT' || status === 'NO_SHOW') dmStatus = 'DEFECT';
                else if (status.includes('ARRIVAL')) dmStatus = 'SCHEDULED';

                // ── Skip old completed (>2h) and old defects (>6h) ──
                if (dmStatus === 'COMPLETED' && closeDate && closeDate < cutoff2h) continue;
                if (dmStatus === 'DEFECT' && schedStart && schedStart < cutoff6h) continue;

                // ── Skip past scheduled that are >4h overdue (probably ghost) ──
                if (dmStatus === 'SCHEDULED' && schedEnd && schedEnd < cutoff2h) continue;

                const attrs = apt.attributes || {};
                const carrierLoadType = attrs.CARRIER_LOAD_TYPE?.value || '';
                const appointmentType = attrs.AppointmentType?.value || apt.appointmentType || '';
                const defectType = attrs.DEFECT_TYPE?.value || '';

                const dockDoor = apt.dockDoorId || apt.dockDoor || '';
                const shipmentIds = apt.shipmentIds || [];
                const cartonCount = apt.cartonCount || 0;
                const palletCount = apt.palletCount || 0;
                const comments = apt.comments || [];

                const carrierUpper = carrierName.toUpperCase();
                const isNonInv = carrierUpper.includes('NONIN')
                    || carrierUpper.includes('NON IN')
                    || carrierUpper.includes('NON-IN')
                    || carrierUpper.includes('NON_IN')
                    || carrierUpper.includes('NONINV')
                    || carrierUpper.includes('NON INV')
                    || carrierUpper.includes('NON-INV')
                    || carrierUpper.includes('NON_INV');

                // ── Delay ──
                let delayMin = 0;
                if (schedStart && !arrivalDate && !checkInStart && now > schedStart) {
                    delayMin = Math.round((now - schedStart) / 60000);
                } else if (schedStart && (arrivalDate || checkInStart)) {
                    const actual = arrivalDate || checkInStart;
                    delayMin = Math.max(0, Math.round((actual - schedStart) / 60000));
                }

                // ── Dwell ──
                let dwellMin = 0;
                const actualArrival = arrivalDate || checkInStart;
                if (actualArrival && !closeDate) dwellMin = Math.round((now - actualArrival) / 60000);
                else if (actualArrival && closeDate) dwellMin = Math.round((closeDate - actualArrival) / 60000);

                appointments.push({
                    appointmentId, trailerNumber, carrierName,
                    status: dmStatus, rawStatus: status, isNonInv,
                    appointmentType, carrierLoadType, defectType,
                    schedStart, schedEnd, checkInStart,
                    arrivalDate, closeDate, dockDoor,
                    shipmentIds, cartonCount, palletCount,
                    comments, delayMin, dwellMin
                });

            } catch (err) {
                // skip silently
            }
        }

        appointments.sort((a, b) => {
            const statusPrio = { 'ARRIVED': 0, 'RECEIVING': 1, 'SCHEDULED': 2, 'COMPLETED': 3, 'DEFECT': 4 };
            const ap = statusPrio[a.status] ?? 3, bp = statusPrio[b.status] ?? 3;
            if (ap !== bp) return ap - bp;
            return (a.schedStart || Infinity) - (b.schedStart || Infinity);
        });

        return appointments;
    },


    // ── Query helpers ──
    getNonInv() { return this.appointments.filter(a => a.isNonInv && a.status !== 'CANCELLED'); },
    getIB() { return this.appointments.filter(a => !a.isNonInv && a.status !== 'CANCELLED'); },
    getActive() { return this.appointments.filter(a => a.status === 'ARRIVED' || a.status === 'RECEIVING'); },
    getScheduled() { return this.appointments.filter(a => a.status === 'SCHEDULED'); },
    getDefects() { return this.appointments.filter(a => a.status === 'DEFECT'); },
    getDelayed(min = 15) { return this.appointments.filter(a => a.delayMin > min && a.status !== 'COMPLETED' && a.status !== 'CANCELLED'); },

    findByTrailer(trailerNum) {
        if (!trailerNum) return null;
        const tn = trailerNum.toUpperCase();
        return this.appointments.find(a => a.trailerNumber && a.trailerNumber.toUpperCase() === tn) || null;
    },

    // ── Lifecycle ──
    start() {
        this.stopAutoRefresh();
        // Delay first fetch to let other modules load first
        setTimeout(() => this.fetchData(0, 0), 2000);
        this._autoTimer = setInterval(() => this.fetchData(0, 1), CONFIG.data.dockmasterRefreshInterval); // 2 min
    },


    stopAutoRefresh() {
        if (this._autoTimer) { clearInterval(this._autoTimer); this._autoTimer = null; }
    },
};
// ============================================================
// RELAT — Asset Return Tasks (completed VR ID filter for NonInv)
// ============================================================
const RELAT = {
    tasks: [], lastUpdated: null, loading: false,
    _autoTimer: null,
    _baseUrl: CONFIG.urls.relat,
    completedVrIds: new Set(),

    async fetchData(daysBack = 3, daysForward = 0) {
        if (this.loading) return;
        this.loading = true;

        try {
            const now = Date.now();
            const fromDate = now - daysBack * 86400000;
            const toDate = now + daysForward * 86400000;

            const url = `${this._baseUrl}/api/asset-return/tasks/assets/${CONFIG.warehouseId}?from_date=${fromDate}&to_date=${toDate}`;

            console.log(`[ShipMap:RELAT] 📡 Fetching...`);

            const responseText = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: { 'Accept': 'application/json' },
                    withCredentials: true,
                    onload(r) {
                        if (r.status >= 200 && r.status < 300) resolve(r.responseText);
                        else reject({ message: `HTTP ${r.status}` });
                    },
                    onerror() { reject({ message: 'Network error' }); }
                });
            });

            const data = JSON.parse(responseText);
            const rawList = data?.assetCount || [];

            this.tasks = rawList;
            this._buildCompletedSet(rawList);
            this.lastUpdated = new Date();

            console.log(`[ShipMap:RELAT] ✅ ${rawList.length} tasks | ${this.completedVrIds.size} completed VRs`);

        } catch (err) {
            console.error(`[ShipMap:RELAT] ❌ ${err.message}`);
        }

        this.loading = false;

        // Refresh NonInv list — completed VRs may now be filtered
        if (State.activeTab === 'loads' && State.loadsSubTab === 'noninv') {
            UI.updateDataPanel();
        }

        UI._updateLoadsSubCounts();
    },

_buildCompletedSet(rawList) {
    this.completedVrIds.clear();
    // Only these statuses mean "truck still expected / not yet unloaded"
    // 🟡 PENDING        → "Truck arrived, pending input"
    // 🟠 PENDING_LATE   → "Truck at dock door, input is due"
    // 🔵 SCHEDULED      → "Truck is scheduled"
    // 🔵 SCHEDULED_LATE → "Truck is scheduled" (overdue)
    const STILL_PENDING = new Set([
        'PENDING', 'PENDING_LATE',
        'SCHEDULED', 'SCHEDULED_LATE'
    ]);
    for (const raw of rawList) {
        const status = (raw.task_status || '').toUpperCase();
        if (STILL_PENDING.has(status)) continue; // still awaiting — keep in NonInv
        const vrId = (raw.vrid || '').toUpperCase();
        if (vrId) this.completedVrIds.add(vrId);
    }
},


    isCompleted(vrId) {
        if (!vrId) return false;
        return this.completedVrIds.has(vrId.toUpperCase());
    },

    // ── Lifecycle ──
    start() {
        this.stopAutoRefresh();
        this.fetchData(3, 0);
        this._autoTimer = setInterval(() => this.fetchData(3, 0), CONFIG.data.relatRefreshInterval);
    },

    stopAutoRefresh() {
        if (this._autoTimer) { clearInterval(this._autoTimer); this._autoTimer = null; }
    },
};
// ============================================================
// MAP MANAGER — GitHub maps + local snapshots
// ============================================================
const MapManager = {
    _ghBase: 'https://raw.githubusercontent.com/homziukl/Ship-Map-Builder/main/',
    _listKey: 'shipmap_map_list_v1',

    getGhUrl(site) {
        return `${this._ghBase}shipmap_${site.toUpperCase()}.json`;
    },

    async fetchFromGitHub(site) {
        const url = this.getGhUrl(site);
        console.log(`[ShipMap:Maps] 📥 Fetching: ${url}`);
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
                onload(r) {
                    if (r.status >= 200 && r.status < 300) {
                        try {
                            const data = JSON.parse(r.responseText);
                            resolve(data);
                        } catch { reject({ message: 'Invalid JSON in response' }); }
                    } else if (r.status === 404) {
                        reject({ message: `Not found: shipmap_${site.toUpperCase()}.json` });
                    } else {
                        reject({ message: `HTTP ${r.status}` });
                    }
                },
                onerror() { reject({ message: 'Network error' }); }
            });
        });
    },

    // ── Local snapshot management ──

    getList() {
        try {
            const raw = GM_getValue(this._listKey, null);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    },

    _saveList(list) {
        GM_setValue(this._listKey, JSON.stringify(list));
    },

    saveCurrent(label) {
        const list = this.getList();
        const key = `shipmap_snap_${Date.now()}`;
        const data = State.exportJSON();
        const meta = {
            key,
            label: label || `${CONFIG.warehouseId} — ${new Date().toLocaleString()}`,
            site: CONFIG.warehouseId,
            elementCount: State.elements.length,
            savedAt: new Date().toISOString()
        };
        GM_setValue(key, data);
        list.unshift(meta);
        if (list.length > 20) {
            const removed = list.splice(20);
            for (const old of removed) GM_setValue(old.key, '');
        }
        this._saveList(list);
        return meta;
    },

    loadSaved(key) {
        const raw = GM_getValue(key, null);
        if (!raw) return false;
        return State.importJSON(raw);
    },

    deleteSaved(key) {
        const list = this.getList().filter(m => m.key !== key);
        this._saveList(list);
        GM_setValue(key, '');
    },

    renameSaved(key, newLabel) {
        const list = this.getList();
        const item = list.find(m => m.key === key);
        if (item) { item.label = newLabel; this._saveList(list); }
    },

    applyGitHubMap(data, mode) {
        if (mode === 'merge') {
            return State.mergeJSON(JSON.stringify(data));
        } else {
            return State.importJSON(JSON.stringify(data));
        }
    }
};

// ============================================================
// SUMMARY
// ============================================================
const Summary = {
    build() {
        const shift = getCurrentShift(); const now = new Date();
        const remaining = Math.max(0, shift.endDate - now);
        const remH = Math.floor(remaining / 3600000), remM = Math.floor((remaining % 3600000) / 60000);
        const shiftProgress = Math.min(100, Math.max(0, ((now - shift.startDate) / (shift.endDate - shift.startDate)) * 100));
        const loads = State.sspLoads.filter(l => { if (!l.sdt || l.sdt === '—') { return l.status !== 'DEPARTED' && l.status !== 'CANCELLED'; } try { const sdtDate = new Date(l.sdt); if (isNaN(sdtDate.getTime())) return true; return sdtDate >= shift.startDate && sdtDate <= shift.endDate; } catch { return true; } });
        const departed=loads.filter(l=>l.status==='DEPARTED').length, loading=loads.filter(l=>l.status==='LOADING_IN_PROGRESS').length, finished=loads.filter(l=>l.status==='FINISHED_LOADING').length, attached=loads.filter(l=>l.status==='TRAILER_ATTACHED').length, ready=loads.filter(l=>l.status==='READY_TO_DEPART').length, readyForLoad=loads.filter(l=>l.status==='READY_FOR_LOADING').length, scheduled=loads.filter(l=>l.status==='SCHEDULED').length, cancelled=loads.filter(l=>l.status==='CANCELLED').length;
        const inProgress = loading + finished + attached + ready;
        const carriers = {}; for (const l of loads) { const c = l.carrier || 'Unknown'; if (!carriers[c]) carriers[c] = {total:0,departed:0,loading:0,scheduled:0}; carriers[c].total++; if (l.status === 'DEPARTED') carriers[c].departed++; else if (l.status === 'SCHEDULED') carriers[c].scheduled++; else carriers[c].loading++; }
        const activeDocks = new Set(loads.filter(l => l.dockDoor !== '—' && l.status !== 'DEPARTED' && l.status !== 'CANCELLED').map(l => l.dockDoor));
        const ymsReport = YMS.buildReport(); let ymsTotal = 0, ymsEmpty = 0, ymsFull = 0, ymsUnavail = 0;
        for (const [, data] of ymsReport) { ymsTotal += data.total; ymsEmpty += data.empty; ymsFull += data.full; ymsUnavail += data.unavailable; }
        const ymsOccupied = State.ymsLocations.filter(l => l.yardAssets?.some(a => a.type !== 'TRACTOR')).length;
        const ymsUtilization = State.ymsLocations.length > 0 ? Math.round((ymsOccupied / State.ymsLocations.length) * 100) : 0;
        const vc = State.vistaContainers;
        const vStacked=vc.filter(c=>c._state==='Stacked').length, vStaged=vc.filter(c=>c._state==='Staged').length, vLoaded=vc.filter(c=>c._state==='Loaded').length;
        const vTotalPkgs = vc.reduce((s, c) => s + (c.childCount || 0), 0);
        const congestionCounts = {low:0,medium:0,high:0,critical:0};
        for (const [, locData] of Object.entries(State.vistaLocMap)) { const n = locData.totalContainers; if (n <= 3) congestionCounts.low++; else if (n <= 8) congestionCounts.medium++; else if (n <= 15) congestionCounts.high++; else congestionCounts.critical++; }
        const topCongested = Object.entries(State.vistaLocMap).sort((a, b) => b[1].totalContainers - a[1].totalContainers).slice(0, 10);
        const topDwell = Object.entries(State.vistaLocMap).filter(([, d]) => d.maxDwell > 0).sort((a, b) => b[1].maxDwell - a[1].maxDwell).slice(0, 10);
        const avgDwell = vc.length > 0 ? Math.round(vc.reduce((s, c) => s + (c.dwellTimeInMinutes || 0), 0) / vc.length) : 0;
        const maxDwell = vc.length > 0 ? Math.max(...vc.map(c => c.dwellTimeInMinutes || 0)) : 0;
        return { shift, shiftProgress, remH, remM, now, loads:{total:loads.length,departed,loading,finished,attached,ready,readyForLoad,scheduled,cancelled,inProgress,carriers,activeDocks:activeDocks.size,swapFiltered:State.swapFilteredCount}, yms:{total:ymsTotal,empty:ymsEmpty,full:ymsFull,unavail:ymsUnavail,occupied:ymsOccupied,totalLocs:State.ymsLocations.length,utilization:ymsUtilization,report:ymsReport}, vista:{total:vc.length,stacked:vStacked,staged:vStaged,loaded:vLoaded,totalPkgs:vTotalPkgs,congestion:congestionCounts,topCongested,topDwell,avgDwell,maxDwell,totalLocs:Object.keys(State.vistaLocMap).length} };
    },
    render(d) {
        const fmtTime=(date)=>`${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
        const departedPct = d.loads.total > 0 ? Math.round((d.loads.departed / d.loads.total) * 100) : 0;

        const carrierRows=Object.entries(d.loads.carriers).sort((a,b)=>b[1].total-a[1].total).slice(0,8).map(([name,c])=>`<tr><td style="font-weight:bold;color:#e0e0e0">${name}</td><td class="val" style="color:#9e9e9e">${c.departed}</td><td class="val" style="color:#69f0ae">${c.loading}</td><td class="val" style="color:#5a6a7a">${c.scheduled}</td><td class="val" style="color:#ff9900">${c.total}</td></tr>`).join('');

        const ymsRows=d.yms.report.map(([owner,data2])=>`<tr><td style="font-weight:bold;font-family:monospace;color:#e0e0e0">${owner}</td><td class="val" style="color:#69f0ae">${data2.empty||'—'}</td><td class="val" style="color:#ffd600">${data2.full||'—'}</td><td class="cnt ${data2.unavailable>0?'cnt-warn':''}">${data2.unavailable||'—'}</td><td class="val" style="color:#ff9900">${data2.total}</td></tr>`).join('');

        const congestedRows=d.vista.topCongested.map(([loc,ld])=>{const lc=ld.totalContainers>15?'#ff1744':ld.totalContainers>8?'#ff9100':ld.totalContainers>3?'#ffd600':'#69f0ae';const types=Object.entries(ld.types).map(([t,n])=>`${n}${{PALLET:'🛒',GAYLORD:'📫',CART:'🛒'}[t]||''}`).join(' ');return`<tr><td style="font-family:monospace;font-weight:bold;color:${lc}">${loc}</td><td class="val" style="color:${lc}">${ld.totalContainers}</td><td class="val" style="color:#b0bec5">${ld.totalPkgs}</td><td style="font-size:10px;color:#78909C">${types}</td></tr>`;}).join('');

        const dwellRows=d.vista.topDwell.map(([loc,ld])=>{const dwC=ld.maxDwell>120?'#ff5252':ld.maxDwell>60?'#ff9100':'#69f0ae';return`<tr><td style="font-family:monospace;color:#e0e0e0">${loc}</td><td class="val" style="color:${dwC};font-weight:bold">${ld.maxDwell}m</td><td class="val" style="color:#b0bec5">${ld.totalContainers}</td></tr>`;}).join('');

        return `<div class="summary-hdr"><h2>📊 Shift Summary — <span class="shift-badge">${d.shift.label}</span> <span class="time-badge">${fmtTime(d.shift.startDate)} → ${fmtTime(d.shift.endDate)}</span></h2><div style="display:flex;align-items:center;gap:12px"><span style="font-size:11px;color:#8899aa">⏱ ${d.remH}h ${d.remM}m left</span><button class="summary-close" id="summary-close">✕</button></div></div><div class="summary-body"><div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:10px;color:#5a6a7a;margin-bottom:4px"><span>Shift progress</span><span>${Math.round(d.shiftProgress)}%</span></div><div class="summary-bar"><div class="summary-bar-fill" style="width:${d.shiftProgress}%;background:linear-gradient(90deg,#ff9900,#ff5722)"></div></div></div><div class="summary-grid"><div class="summary-card"><h3>📡 OB Loads</h3><div class="summary-kpi"><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#ff9900">${d.loads.total}</span><span class="summary-kpi-label">Total</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#9e9e9e">${d.loads.departed}</span><span class="summary-kpi-label">Departed</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#69f0ae">${d.loads.inProgress}</span><span class="summary-kpi-label">In Progress</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#5a6a7a">${d.loads.scheduled}</span><span class="summary-kpi-label">Scheduled</span></div></div><div style="margin-top:4px"><div style="display:flex;justify-content:space-between;font-size:10px;color:#5a6a7a;margin-bottom:3px"><span>Departed</span><span>${departedPct}%</span></div><div class="summary-bar"><div class="summary-bar-fill" style="width:${departedPct}%;background:#69f0ae"></div></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;font-size:10px;margin-top:4px"><span style="color:#69f0ae">🔄${d.loads.loading}L</span><span style="color:#ffd600">✅${d.loads.finished}C</span><span style="color:#4fc3f7">🔗${d.loads.attached}ATT</span><span style="color:#ff9800">🚛${d.loads.ready}RTD</span>${d.loads.readyForLoad?`<span style="color:#80cbc4">📋${d.loads.readyForLoad}RFL</span>`:''}</div><div style="font-size:10px;color:#e040fb;margin-top:2px">🚪 ${d.loads.activeDocks} active docks</div></div><div class="summary-card"><h3>🏗️ YMS Yard</h3><div class="summary-kpi"><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#ff9900">${d.yms.total}</span><span class="summary-kpi-label">Trailers</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#69f0ae">${d.yms.empty}</span><span class="summary-kpi-label">Empty</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#ffd600">${d.yms.full}</span><span class="summary-kpi-label">Full</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#ff5252">${d.yms.unavail}</span><span class="summary-kpi-label">Unavail</span></div></div><div style="margin-top:4px"><div style="display:flex;justify-content:space-between;font-size:10px;color:#5a6a7a;margin-bottom:3px"><span>Yard utilization</span><span>${d.yms.utilization}%</span></div><div class="summary-bar"><div class="summary-bar-fill" style="width:${d.yms.utilization}%;background:${d.yms.utilization>85?'#ff1744':d.yms.utilization>65?'#ff9100':'#69f0ae'}"></div></div></div><div style="font-size:10px;color:#78909C;margin-top:4px">${d.yms.occupied}/${d.yms.totalLocs} spots occupied</div></div><div class="summary-card" style="grid-column:1/-1"><h3>📦 Vista Congestion</h3><div class="summary-kpi"><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#ff9900">${d.vista.total}</span><span class="summary-kpi-label">Containers</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#b0bec5">${d.vista.totalPkgs}</span><span class="summary-kpi-label">Packages</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#4fc3f7">${d.vista.stacked}</span><span class="summary-kpi-label">📥Stacked</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#ffd600">${d.vista.staged}</span><span class="summary-kpi-label">📤Staged</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:#69f0ae">${d.vista.loaded}</span><span class="summary-kpi-label">🚛Loaded</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:${d.vista.avgDwell>120?'#ff5252':d.vista.avgDwell>60?'#ff9100':'#69f0ae'}">${d.vista.avgDwell}m</span><span class="summary-kpi-label">Avg Dwell</span></div><div class="summary-kpi-item"><span class="summary-kpi-val" style="color:${d.vista.maxDwell>120?'#ff5252':'#ff9100'}">${d.vista.maxDwell}m</span><span class="summary-kpi-label">Max Dwell</span></div></div><div style="display:flex;gap:12px;margin-top:8px;font-size:11px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#69f0ae;margin-right:4px"></span>Low:${d.vista.congestion.low}</span><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ffd600;margin-right:4px"></span>Med:${d.vista.congestion.medium}</span><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff9100;margin-right:4px"></span>High:${d.vista.congestion.high}</span><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff1744;margin-right:4px"></span>Crit:${d.vista.congestion.critical}</span></div></div><div class="summary-card"><h3>🚛 By Carrier</h3><table class="summary-table"><thead><tr><th>Carrier</th><th style="text-align:center">DEP</th><th style="text-align:center">Active</th><th style="text-align:center">Sched</th><th style="text-align:center">Total</th></tr></thead><tbody>${carrierRows||'<tr><td colspan="5" style="color:#5a6a7a;text-align:center">No data</td></tr>'}</tbody></table></div><div class="summary-card"><h3>🏗️ By Owner</h3><table class="summary-table"><thead><tr><th>Owner</th><th style="text-align:center">∅</th><th style="text-align:center">📦</th><th style="text-align:center">⚠️</th><th style="text-align:center">Tot</th></tr></thead><tbody>${ymsRows||'<tr><td colspan="5" style="color:#5a6a7a;text-align:center">No data</td></tr>'}</tbody></table></div><div class="summary-card"><h3>🔴 Top Congested</h3><table class="summary-table"><thead><tr><th>Location</th><th style="text-align:center">Cnt</th><th style="text-align:center">Pkg</th><th>Types</th></tr></thead><tbody>${congestedRows||'<tr><td colspan="4" style="color:#5a6a7a;text-align:center">No data</td></tr>'}</tbody></table></div><div class="summary-card"><h3>⏱ Longest Dwell</h3><table class="summary-table"><thead><tr><th>Location</th><th style="text-align:center">Max</th><th style="text-align:center">Cnt</th></tr></thead><tbody>${dwellRows||'<tr><td colspan="3" style="color:#5a6a7a;text-align:center">No data</td></tr>'}</tbody></table></div></div></div><div class="summary-footer"><span style="font-size:10px;color:#5a6a7a">📊 ${CONFIG.warehouseId} · ${d.shift.label} · ${d.now.toLocaleString()}</span><div style="display:flex;gap:6px"><button class="btn sm" id="summary-copy">📋 Copy</button><button class="btn sm" id="summary-refresh">🔄 Refresh</button></div></div>`;
    },

    toClipboard(d) {
        const fmtTime=(date)=>`${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
        let t = `📊 SHIFT SUMMARY — ${CONFIG.warehouseId} ${d.shift.label}\n${fmtTime(d.shift.startDate)} → ${fmtTime(d.shift.endDate)} | ${d.remH}h ${d.remM}m remaining\n${'═'.repeat(50)}\n\n`;
        t += `📡 OB LOADS: ${d.loads.total} total\n ✈️ Departed: ${d.loads.departed} 🔄 Loading: ${d.loads.loading} ✅ Finished: ${d.loads.finished}\n 🔗 Attached: ${d.loads.attached} 🚛 Ready: ${d.loads.ready} 📋 Scheduled: ${d.loads.scheduled}\n 🚪 Active docks: ${d.loads.activeDocks}\n\n`;
        t += `🏗️ YMS YARD: ${d.yms.total} trailers\n ∅ Empty: ${d.yms.empty} 📦 Full: ${d.yms.full} ⚠️ Unavail: ${d.yms.unavail}\n Utilization: ${d.yms.utilization}% (${d.yms.occupied}/${d.yms.totalLocs})\n`;
        for (const [owner, od] of d.yms.report) t += ` ${owner}: ${od.total} (∅${od.empty} 📦${od.full} ⚠${od.unavailable})\n`;
        t += `\n📦 VISTA: ${d.vista.total} containers / ${d.vista.totalPkgs} pkgs\n 📥 Stacked: ${d.vista.stacked} 📤 Staged: ${d.vista.staged} 🚛 Loaded: ${d.vista.loaded}\n ⏱ Avg dwell: ${d.vista.avgDwell}m Max: ${d.vista.maxDwell}m\n 🟢${d.vista.congestion.low} 🟡${d.vista.congestion.medium} 🟠${d.vista.congestion.high} 🔴${d.vista.congestion.critical}\n\n`;
        if (d.vista.topCongested.length) { t += `🔴 TOP CONGESTED:\n`; for (const [loc, ld] of d.vista.topCongested) t += ` ${loc}: ${ld.totalContainers} cnt / ${ld.totalPkgs} pkg / ${ld.maxDwell}m dwell\n`; t += '\n'; }
        if (d.vista.topDwell.length) { t += `⏱ LONGEST DWELL:\n`; for (const [loc, ld] of d.vista.topDwell) t += ` ${loc}: ${ld.maxDwell}m / ${ld.totalContainers} cnt\n`; }
        t += `\n${'═'.repeat(50)}\nGenerated: ${d.now.toLocaleString()} | Ship Map v3.4.0`; return t;
    },

};

// ============================================================
// TREND TRACKING
// ============================================================
const Trend = {
    _timer: null, _maxSnapshots: 288,

    takeSnapshot() {
        if (!State.sspLoads.length && !State.ymsLocations.length && !State.vistaContainers.length) return;
        const loads = State.sspLoads;
        const departed = loads.filter(l => l.status === 'DEPARTED').length;
        const loading = loads.filter(l => l.status === 'LOADING_IN_PROGRESS').length;
        const finished = loads.filter(l => l.status === 'FINISHED_LOADING').length;
        const attached = loads.filter(l => l.status === 'TRAILER_ATTACHED').length;
        const ready = loads.filter(l => l.status === 'READY_TO_DEPART').length;
        const active = loading + finished + attached + ready;
        const ymsOccupied = State.ymsLocations.filter(l => l.yardAssets?.some(a => a.type !== 'TRACTOR')).length;
        const ymsTotal = State.ymsLocations.length;
        const ymsUtil = ymsTotal > 0 ? Math.round(ymsOccupied / ymsTotal * 100) : 0;
        let ymsUnavail = 0;
        for (const loc of State.ymsLocations) { for (const a of (loc.yardAssets || [])) { if (a.type !== 'TRACTOR' && a.unavailable) ymsUnavail++; } }
        const vc = State.vistaContainers;
        const vStacked = vc.filter(c => c._state === 'Stacked').length;
        const vStaged = vc.filter(c => c._state === 'Staged').length;
        const vLoaded = vc.filter(c => c._state === 'Loaded').length;
        const vPkgs = vc.reduce((s, c) => s + (c.childCount || 0), 0);
        const criticalLocs = Object.entries(State.vistaLocMap).filter(([, d]) => d.totalContainers > 15).length;
        const avgDwell = vc.length > 0 ? Math.round(vc.reduce((s, c) => s + (c.dwellTimeInMinutes || 0), 0) / vc.length) : 0;
        const maxDwell = vc.length > 0 ? Math.max(...vc.map(c => c.dwellTimeInMinutes || 0)) : 0;
        const vTypes = {};
        const vTypesByState = { Stacked: {}, Staged: {}, Loaded: {} };
        for (const c of vc) { vTypes[c.type] = (vTypes[c.type] || 0) + 1; if (vTypesByState[c._state]) { vTypesByState[c._state][c.type] = (vTypesByState[c._state][c.type] || 0) + 1; } }
        const departedTypes = {};
        let departedPkgs = 0;
        for (const l of loads) { if (l.status !== 'DEPARTED' || !l._containers) continue; for (const c of l._containers.flat.filter(c2 => c2.depth === 1 && c2.contType !== 'PACKAGE')) { departedTypes[c.contType] = (departedTypes[c.contType] || 0) + 1; } departedPkgs += l._containers.stats.packageCount || 0; }
        const snapshot = { ts: Date.now(), loads: { total: loads.length, departed, active, scheduled: loads.filter(l=>l.status==='SCHEDULED').length, loading, finished }, yms: { occupied: ymsOccupied, total: ymsTotal, util: ymsUtil, unavail: ymsUnavail }, vista: { total: vc.length, stacked: vStacked, staged: vStaged, loaded: vLoaded, pkgs: vPkgs, criticalLocs, avgDwell, maxDwell, types: vTypes, typesByState: vTypesByState }, departedTypes, departedPkgs };
        const data = this._load(); data.push(snapshot); while (data.length > this._maxSnapshots) data.shift(); this._save(data);
    },

    _load() { return silentCatch('Trend.load', () => { const raw = GM_getValue(CONFIG.storage.trendKey, null); if (raw) return JSON.parse(raw); }) || []; },

    _save(data) { GM_setValue(CONFIG.storage.trendKey, JSON.stringify(data)); },

    clear() { GM_setValue(CONFIG.storage.trendKey, '[]'); },

    _renderSvgChart(opts) {
        const { data, width, height, series, yMin, yMax, showGrid } = opts;
        if (!data.length) return '<div style="padding:20px;text-align:center;color:#5a6a7a;font-size:11px">No data yet — snapshots every 10 min</div>';
        const pad = { top: 10, right: 12, bottom: 28, left: 40 };
        const cw = width - pad.left - pad.right;
        const ch = height - pad.top - pad.bottom;
        const tsMin = data[0].ts, tsMax = data[data.length - 1].ts, tsRange = Math.max(tsMax - tsMin, 60000);
        let autoMax = yMax;
        if (autoMax === undefined) { autoMax = 0; for (const s of series) { for (const d of data) { const v = s.getValue(d); if (v > autoMax) autoMax = v; } } autoMax = Math.ceil(autoMax * 1.15) || 10; }
        const actualMin = yMin || 0;
        const xScale = (ts) => pad.left + ((ts - tsMin) / tsRange) * cw;
        const yScale = (v) => pad.top + ch - ((v - actualMin) / (autoMax - actualMin)) * ch;
        let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:block">`;
        if (showGrid !== false) {
            for (let i = 0; i <= 4; i++) { const val = actualMin + (autoMax - actualMin) * (i / 4), y = yScale(val); svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#2a3a4a" stroke-width="1"/>`; svg += `<text x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#5a6a7a" font-family="monospace">${Math.round(val)}</text>`; }
            const hourMs = 3600000, firstHour = Math.ceil(tsMin / hourMs) * hourMs;
            for (let t = firstHour; t <= tsMax; t += hourMs) { const x = xScale(t); if (x < pad.left + 10 || x > width - pad.right - 10) continue; const d = new Date(t); svg += `<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + ch}" stroke="#2a3a4a" stroke-width="1" stroke-dasharray="4,4"/>`; svg += `<text x="${x}" y="${height - 4}" text-anchor="middle" font-size="9" fill="#5a6a7a" font-family="monospace">${d.getHours().toString().padStart(2,'0')}:00</text>`; }
        }
        for (const s of series) {
            const points = data.map(d => ({ x: xScale(d.ts), y: yScale(s.getValue(d)) }));
            if (points.length < 2) { svg += `<circle cx="${points[0].x}" cy="${points[0].y}" r="3" fill="${s.color}"/>`; continue; }
            const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
            svg += `<path d="${pathD}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.5}" stroke-linejoin="round" stroke-linecap="round" opacity="${s.opacity || 0.9}"/>`;
            const last = points[points.length - 1];
            svg += `<circle cx="${last.x}" cy="${last.y}" r="3" fill="${s.color}"/>`;
        }
        svg += `</svg>`; return svg;
    },

    buildCharts(hours) {
        const data = this.getData(hours), w = 500, h = 140;
        const loadsChart = this._renderSvgChart({ data, width: w, height: h, series: [
            { label: 'Total', color: '#ff9900', getValue: d => d.loads.total },
            { label: 'Departed', color: '#9e9e9e', getValue: d => d.loads.departed },
            { label: 'Active', color: '#69f0ae', getValue: d => d.loads.active },
            { label: 'Scheduled', color: '#5a6a7a', getValue: d => d.loads.scheduled, opacity: 0.5 }
        ]});
        const ymsChart = this._renderSvgChart({ data, width: w, height: h, yMin: 0, yMax: 100, series: [
            { label: 'Utilization %', color: '#4fc3f7', width: 2, getValue: d => d.yms.util },
            { label: 'Unavailable', color: '#ff5252', getValue: d => d.yms.unavail }
        ]});
        const vistaChart = this._renderSvgChart({ data, width: w, height: h, series: [
            { label: 'Stacked', color: '#4fc3f7', getValue: d => d.vista.stacked },
            { label: 'Staged', color: '#ffd600', getValue: d => d.vista.staged },
            { label: 'Loaded', color: '#69f0ae', getValue: d => d.vista.loaded },
            { label: 'Critical locs', color: '#ff1744', getValue: d => d.vista.criticalLocs }
        ]});
        const dwellChart = this._renderSvgChart({ data, width: w, height: h, series: [
            { label: 'Avg dwell', color: '#ff9900', width: 2, getValue: d => d.vista.avgDwell },
            { label: 'Max dwell', color: '#ff5252', getValue: d => d.vista.maxDwell, opacity: 0.5 }
        ]});
        return { loadsChart, ymsChart, vistaChart, dwellChart, snapshots: data.length };
    },

    start() { this.stop(); setTimeout(() => this.takeSnapshot(), 30000); this._timer = setInterval(() => this.takeSnapshot(), CONFIG.data.trendInterval); },

    stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },

    getData(hours) { const data = this._load(); if (!hours) return data; const cutoff = Date.now() - hours * 3600000; return data.filter(s => s.ts >= cutoff); },
};

// ============================================================
// MINIMAP
// ============================================================
const Minimap = {
    canvas: null, ctx: null, visible: true, _width: 200, _height: 140, _dragging: false,
    init() {
        this.canvas = document.createElement('canvas'); this.canvas.id = 'minimap'; this.canvas.className = 'minimap';
        this.canvas.width = this._width; this.canvas.height = this._height;
        document.querySelector('.main').appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d'); this.visible = GM_getValue(CONFIG.storage.minimapKey, true);
        if (!this.visible) this.canvas.classList.add('minimap-hidden'); this._bindEvents();
    },
    toggle() { this.visible = !this.visible; this.canvas.classList.toggle('minimap-hidden', !this.visible); GM_setValue(CONFIG.storage.minimapKey, this.visible); if (this.visible) this.render(); },
    _getBounds() {
        if (!State.elements.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 700 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const el of State.elements) { if (el.x < minX) minX = el.x; if (el.y < minY) minY = el.y; if (el.x + el.w > maxX) maxX = el.x + el.w; if (el.y + el.h > maxY) maxY = el.y + el.h; }
        const pad = 60; return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    },
    render() {
        if (!this.visible || !this.ctx || !this.canvas) return;
        const { ctx } = this; const w = this._width, h = this._height;
        ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, w, h);
        if (!State.elements.length) return;
        const bounds = this._getBounds(); const bw = bounds.maxX - bounds.minX; const bh = bounds.maxY - bounds.minY;
        const scale = Math.min(w / bw, h / bh); const offX = (w - bw * scale) / 2; const offY = (h - bh * scale) / 2;
        const tx = (x) => offX + (x - bounds.minX) * scale; const ty = (y) => offY + (y - bounds.minY) * scale;
        for (const el of State.elements) {
            const t = ELEMENT_TYPES[el.type]; if (!t) continue;
            const ex = tx(el.x), ey = ty(el.y); const ew = Math.max(1, el.w * scale); const eh = Math.max(1, el.h * scale);
            const elKey = el.name || el.id; let fillColor = t.color;
            if (State.vistaEnabled) { const level = VISTA.getCongestionLevel(elKey); if (level) { const vc = VISTA.getCongestionColor(level); if (vc) fillColor = vc.fill; } }
                    if (State.isHighlighted(el)) fillColor = '#FFD700';
        else if (State.focusRoutes.size > 0) {
            const fd = State.getFocusForElement(el);
            if (fd) {
                const dominant = Object.values(fd).sort((a, b) => b.count - a.count)[0];
                fillColor = dominant.color;
            }
        }

            ctx.fillStyle = fillColor; ctx.globalAlpha = State.isHighlighted(el) ? 0.95 : 0.7; ctx.fillRect(ex, ey, ew, eh);
        }
        ctx.globalAlpha = 1;
        const mainCanvas = R.canvas;
        if (mainCanvas) { const vpLeft = -State.offsetX / State.scale; const vpTop = -State.offsetY / State.scale; const vpW = mainCanvas.width / State.scale; const vpH = mainCanvas.height / State.scale; const rx = tx(vpLeft), ry = ty(vpTop); const rw = vpW * scale, rh = vpH * scale; ctx.strokeStyle = '#ff9900'; ctx.lineWidth = 1.5; ctx.strokeRect(rx, ry, rw, rh); ctx.fillStyle = 'rgba(255,153,0,0.06)'; ctx.fillRect(rx, ry, rw, rh); }
    },
    _worldFromMinimap(mx, my) { const bounds = this._getBounds(); const bw = bounds.maxX - bounds.minX; const bh = bounds.maxY - bounds.minY; const w = this._width, h = this._height; const scale = Math.min(w / bw, h / bh); const offX = (w - bw * scale) / 2; const offY = (h - bh * scale) / 2; return { x: bounds.minX + (mx - offX) / scale, y: bounds.minY + (my - offY) / scale }; },
    _panToWorld(worldX, worldY) { const mainCanvas = R.canvas; if (!mainCanvas) return; const vpW = mainCanvas.width / State.scale; const vpH = mainCanvas.height / State.scale; State.offsetX = -(worldX - vpW / 2) * State.scale; State.offsetY = -(worldY - vpH / 2) * State.scale; State.saveViewport(); R.render(); },
    _bindEvents() {
        if (!this.canvas) return; const c = this.canvas;
        const getPos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
        c.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this._dragging = true; const pos = getPos(e); const world = this._worldFromMinimap(pos.x, pos.y); this._panToWorld(world.x, world.y); });
        c.addEventListener('mousemove', (e) => { if (!this._dragging) return; e.preventDefault(); e.stopPropagation(); const pos = getPos(e); const world = this._worldFromMinimap(pos.x, pos.y); this._panToWorld(world.x, world.y); });
        c.addEventListener('mouseup', () => { this._dragging = false; });
        c.addEventListener('mouseleave', () => { this._dragging = false; });
        c.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    }
};
// ============================================================
// RENDERER
// ============================================================
const R = {
    canvas: null, ctx: null,
    _renderScheduled: false,
    requestRender() {
        if (this._renderScheduled) return;
        this._renderScheduled = true;
        requestAnimationFrame(() => { this._renderScheduled = false; this.render(); });
    },
    init(cid) { this.canvas = document.createElement('canvas'); document.getElementById(cid).appendChild(this.canvas); this.ctx = this.canvas.getContext('2d'); this.resize(); window.addEventListener('resize', () => this.resize()); this._bindEvents(); },
    resize() { const p = this.canvas.parentElement; this.canvas.width = p.clientWidth; this.canvas.height = p.clientHeight; this.render(); },
    render() {
        const { ctx, canvas: c } = this; if (!ctx) return;
        try { ctx.clearRect(0, 0, c.width, c.height); ctx.save(); ctx.translate(State.offsetX, State.offsetY); ctx.scale(State.scale, State.scale); this._drawGrid(); this._drawBgImage(); this._drawElements(); this._drawPreview(); this._drawBoxSel(); ctx.restore(); this._drawHUD(); this._drawTooltip(); try { Minimap.render(); } catch {} }
        catch (err) { try { ctx.restore(); } catch {} console.error('[ShipMap] Render error:', err); }
    },
    s2w(sx, sy) { return { x:(sx - State.offsetX)/State.scale, y:(sy - State.offsetY)/State.scale }; },
    _drawGrid() { const { ctx } = this, g = CONFIG.grid, vw = this.canvas.width/State.scale, vh = this.canvas.height/State.scale, ox = -State.offsetX/State.scale, oy = -State.offsetY/State.scale; ctx.fillStyle = g.bgColor; ctx.fillRect(ox, oy, vw, vh); ctx.strokeStyle = g.gridColor; ctx.lineWidth = 0.5; const sx = Math.floor(ox/g.size)*g.size, sy = Math.floor(oy/g.size)*g.size; for (let x = sx; x < ox+vw; x += g.size) { ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy+vh); ctx.stroke(); } for (let y = sy; y < oy+vh; y += g.size) { ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox+vw, y); ctx.stroke(); } },
    _drawBgImage() { if (!BgImage.loaded || !BgImage.img) return; const { ctx } = this; ctx.save(); ctx.globalAlpha = SiteSettings.bgOpacity; ctx.drawImage(BgImage.img, SiteSettings.bgOffsetX, SiteSettings.bgOffsetY, BgImage.img.naturalWidth*SiteSettings.bgScale, BgImage.img.naturalHeight*SiteSettings.bgScale); ctx.restore(); if (State.bgEditMode) { ctx.save(); ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2/State.scale; ctx.setLineDash([8/State.scale, 4/State.scale]); ctx.strokeRect(SiteSettings.bgOffsetX, SiteSettings.bgOffsetY, BgImage.img.naturalWidth*SiteSettings.bgScale, BgImage.img.naturalHeight*SiteSettings.bgScale); ctx.setLineDash([]); ctx.restore(); } },
    _getYmsColor(el) {
        const elKey = el.name || el.id;
        if (State.vistaEnabled && !Object.keys(State.highlightData).length) { const level = VISTA.getCongestionLevel(elKey); if (level) { const vc = VISTA.getCongestionColor(level); if (vc) return vc; } }
        const ymsLoc = State.getYmsForElement(el); if (!ymsLoc) return null;
        const status = ymsGateStatus(ymsLoc);
        if (status === 'red') return { fill:'#ff1744', border:'#d50000', glow:'#ff1744' }; if (status === 'yellow') return { fill:'#ffd600', border:'#c7a500', glow:'#ffd600' }; if (status === 'occupied') return { fill:'#4fc3f7', border:'#0288d1', glow:'#4fc3f7' }; return null;
    },
    _drawTrailerIcon(ctx, el, ymsLoc) {
        if (!ymsLoc?.yardAssets?.length) return; const trailers = ymsLoc.yardAssets.filter(a => a.type !== 'TRACTOR'); if (!trailers.length) return;
        const headerH = el.chute && el.h >= 32 ? 26 : 16, availH = el.h - headerH, availW = el.w; if (availH < 14 || availW < 30) return;
        const count = trailers.length, primary = trailers[0], iconInfo = TRAILER_ICONS[primary.type] || TRAILER_ICONS['TRAILER'];
        const cx = el.x + availW / 2, cy = el.y + headerH + availH / 2;
        ctx.save();
        if (count === 1) {
            const iconSize = Math.min(availW * 0.6, availH * 0.65, 48); ctx.font = `${Math.round(iconSize)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 0.85; ctx.fillText(iconInfo.symbol, cx, cy - 2);
            const labelSize = Math.min(Math.round(iconSize * 0.3), 10); if (labelSize >= 6) { ctx.font = `bold ${labelSize}px "Amazon Ember",Arial,sans-serif`; ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.7; ctx.fillText(iconInfo.label, cx, cy + iconSize / 2 + 2); }
        } else {
            const iconSize = Math.min(availW * 0.4, availH * 0.55, 36), spacing = Math.min(availW * 0.22, iconSize * 0.6);
            ctx.font = `${Math.round(iconSize)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 0.85; ctx.fillText(iconInfo.symbol, cx - spacing, cy - 2);
            const secondary = trailers[1], icon2 = TRAILER_ICONS[secondary.type] || TRAILER_ICONS['TRAILER']; ctx.globalAlpha = 0.6; ctx.fillText(icon2.symbol, cx + spacing, cy - 2);
            const badgeSize = Math.max(Math.round(iconSize * 0.4), 10), bx2 = cx + spacing + iconSize * 0.3, by2 = cy - iconSize * 0.4;
            ctx.globalAlpha = 0.95; ctx.fillStyle = '#ff9900'; ctx.beginPath(); ctx.arc(bx2, by2, badgeSize * 0.55, 0, Math.PI * 2); ctx.fill();
            ctx.font = `bold ${Math.round(badgeSize * 0.7)}px "Amazon Ember",Arial,sans-serif`; ctx.fillStyle = '#000'; ctx.fillText(`${count}`, bx2, by2 + 1);
        }
                           ctx.restore();

    },
_drawElements() {

    const { ctx } = this, hasHL = Object.keys(State.highlightData).length > 0, hasSearch = State.mapSearch && State.mapSearchMatches.size > 0;

    for (const el of State.elements) {

        const t = ELEMENT_TYPES[el.type]; if (!t) continue;

        const isSel = State.isSelected(el), isHov = State.hoveredElement?.id === el.id, isDel = State.mode === MODE.DELETE && State.editMode;

        const isHL = State.isHighlighted(el), hl = State.getHighlight(el);

        const isLoose = isHL && hl?.onlyLoose;

        // ── Focus mode ──
        const hasFocus = State.focusRoutes.size > 0;
        const focusData = (!isHL && hasFocus) ? State.getFocusForElement(el) : null;
        const focusEntries = focusData ? Object.entries(focusData).sort((a, b) => b[1].count - a[1].count) : null;
        const focusDominant = focusEntries ? focusEntries[0] : null;

        const dimmed = !isHL && (hasHL || (hasFocus && !focusData));

        const ymsOv = (!isHL && !dimmed && !focusData) ? this._getYmsColor(el) : null;

        const isYmsOnly = isHL && hl?.ymsMatch && !hl?.totalPkgs && !hl?.loosePkgs && Object.keys(hl?.containers || {}).length === 0;

        const hlFill = isLoose ? '#78909C' : (isYmsOnly ? '#4fc3f7' : '#FFD700'),
              hlBrd  = isLoose ? '#546E7A' : (isYmsOnly ? '#0288d1' : '#DAA520'),
              hlGlw  = isLoose ? '#78909C' : (isYmsOnly ? '#4fc3f7' : '#FFD700');

        const isSearchMatch = hasSearch && State.mapSearchMatches.has(el.id),
              searchDimmed  = hasSearch && !isSearchMatch;

        // ── Fill / border color ──
        let fillC, brdC;
        if (isHL) { fillC = hlFill; brdC = hlBrd; }
        else if (focusDominant) { fillC = focusDominant[1].color; brdC = darkenColor(focusDominant[1].color); }
        else if (ymsOv) { fillC = ymsOv.fill; brdC = ymsOv.border; }
        else { fillC = t.color; brdC = t.border; }

        // ── Focus glow ──
        if (focusDominant && !isHL) {
            ctx.shadowColor = focusDominant[1].color;
            ctx.shadowBlur = 12;
        }

        // ── Highlight / selection glow ──
        if (isSel || isHov || isHL || isSearchMatch) {
            ctx.shadowColor = isDel && isHov ? '#ff1744' : (isSearchMatch && !isHL ? '#42a5f5' : (isHL ? hlGlw : (ymsOv ? ymsOv.glow : t.color)));
            ctx.shadowBlur = isHL ? (isLoose ? 6 : (12 + Math.sin(State.highlightPulse * Math.PI * 2) * 8)) : (isSearchMatch ? 14 : (isSel ? 20 : 10));
        } else if (ymsOv && !focusDominant) {
            ctx.shadowColor = ymsOv.glow;
            ctx.shadowBlur = 8;
        }

        // ── Fill rect ──
        ctx.globalAlpha = (dimmed || searchDimmed) ? 0.12 : (isDel && isHov ? 0.5 : (isHL ? (isLoose ? 0.65 : 0.95) : (focusDominant ? 0.9 : (ymsOv ? 0.9 : 0.85))));
        if (isSearchMatch && !isHL) ctx.globalAlpha = 1;

        ctx.fillStyle = isDel && isHov ? 'rgba(255,23,68,0.4)' : fillC;
        ctx.fillRect(el.x, el.y, el.w, el.h);

        // ── Stroke ──
        ctx.globalAlpha = 1;
        ctx.strokeStyle = isSel ? '#ffffff' : ((dimmed || searchDimmed) ? 'rgba(255,255,255,0.1)' : (isSearchMatch ? '#42a5f5' : brdC));

        ctx.lineWidth = (isHL || ymsOv || isSearchMatch || focusDominant) ? 3 : (isSel ? 2.5 : 1);
        if (isSel && !isHL) ctx.setLineDash([6, 3]);

        ctx.strokeRect(el.x, el.y, el.w, el.h);
        ctx.setLineDash([]);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // ── Labels ──
        if (el.w >= 50 && el.h >= 18) {

            ctx.save();
            ctx.globalAlpha = (dimmed || searchDimmed) ? 0.3 : 1;

            const headerH = el.chute && el.h >= 32 ? 26 : 16;

            // Header bg
            ctx.fillStyle = isHL ? (isLoose ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.7)') : (focusDominant ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.5)');
            ctx.fillRect(el.x, el.y, el.w, headerH);

            // Name
            ctx.fillStyle = isHL ? (isLoose ? '#cfd8dc' : '#000') : '#fff';
            ctx.font = 'bold 10px "Amazon Ember",Arial,sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            let txt = el.name || el.id;
            const mw = el.w - 6;
            if (ctx.measureText(txt).width > mw) { while (txt.length > 1 && ctx.measureText(txt + '…').width > mw) txt = txt.slice(0, -1); txt += '…'; }
            ctx.fillText(txt, el.x + 4, el.y + 8);

            // Chute
            if (el.chute && el.h >= 32) {
                ctx.font = '8px "Amazon Ember",Arial,sans-serif';
                ctx.fillStyle = isHL ? '#90caf9' : '#82b1ff';
                let ct = el.chute;
                if (ctx.measureText(ct).width > mw) { const parts = ct.split('-'); ct = parts[parts.length - 1] || ct; }
                if (ctx.measureText(ct).width > mw) { while (ct.length > 1 && ctx.measureText(ct + '…').width > mw) ct = ct.slice(0, -1); ct += '…'; }
                ctx.fillText(ct, el.x + 4, el.y + 20);
            }

            // ── Trailer icon (no highlight, no dim, no focus) ──
            if (!isHL && !dimmed && !searchDimmed && !focusData && el.w >= 40 && el.h >= 40) {
                const ymsLoc = State.getYmsForElement(el);
                this._drawTrailerIcon(ctx, el, ymsLoc);
            }

            // ── Small trailer label (no highlight, no dim, no focus) ──
            else if (!isHL && !dimmed && !searchDimmed && !focusData && el.w >= 60 && el.h >= 32) {
                const ymsLoc = State.getYmsForElement(el);
                if (ymsLoc?.yardAssets?.length) {
                    const trailer = ymsLoc.yardAssets.find(a => a.type !== 'TRACTOR');
                    if (trailer) {
                        const icon = TRAILER_LABELS[trailer.type] || '🚛';
                        const sts = trailer.status === 'IN_PROGRESS' ? '⏳' : (trailer.status === 'FULL' ? '📦' : (trailer.status === 'EMPTY' ? '∅' : ''));
                        const yLine = el.chute ? (el.h >= 44 ? el.y + 36 : el.y + 20) : (el.h >= 30 ? el.y + 22 : null);
                        if (yLine) {
                            ctx.font = 'bold 8px "Amazon Ember",Arial,sans-serif';
                            ctx.fillStyle = ymsOv ? '#fff' : '#b0bec5';
                            ctx.fillText(`${icon}${sts}`, el.x + 4, yLine);
                        }
                    }
                }
            }

            // ── Vista badge (no highlight, no dim, no focus) ──
            if (!isHL && !dimmed && !searchDimmed && !focusData && el.w >= 60 && el.h >= 28) {
                const vd = State.vistaElementMap?.[el.name || el.id];
                if (vd && vd.totalContainers > 0) {
                    const TS2 = { 'PALLET': '🛒', 'GAYLORD': '📫', 'CART': '🛒', 'BAG': '👜' };
                    const summary = Object.entries(vd.types).map(([tp, n]) => `${n}${TS2[tp] || ''}`).join('');
                    const yBase = el.chute ? (el.h >= 52 ? el.y + 44 : el.y + 28) : (el.h >= 38 ? el.y + 28 : null);
                    if (yBase) {
                        ctx.font = 'bold 8px "Amazon Ember",Arial,sans-serif';
                        const level = VISTA.getCongestionLevel(el.name || el.id);
                        ctx.fillStyle = level === 'critical' ? '#ff1744' : level === 'high' ? '#ff9100' : level === 'medium' ? '#ffd600' : '#69f0ae';
                        const effMax = getEffectiveMaxContainers(el.name || el.id);
                        const ratioText = effMax.max > 0 ? `${vd.totalContainers}/${effMax.max}` : '';
                        ctx.fillText(`📦${summary}${ratioText ? ' ' + ratioText : ''}`, el.x + 4, yBase);
                    }
                }
            }

            // ── Focus mode badge ──
            if (focusData && !isHL && !dimmed && el.w >= 60 && el.h >= 28) {
                const focusBadge = focusEntries.map(([route, data]) => `${route}:${data.count}`).join(' ');
                const yBase = el.chute ? (el.h >= 52 ? el.y + 44 : el.y + 28) : (el.h >= 38 ? el.y + 28 : null);
                if (yBase) {
                    ctx.font = 'bold 8px "Amazon Ember",Arial,sans-serif';
                    ctx.fillStyle = focusDominant[1].color;
                    ctx.fillText(`🎯${focusBadge}`, el.x + 4, yBase);
                }
            }

            // ── Dwell text (loose highlight) ──
            if (isLoose && el.h >= (el.chute ? 44 : 30)) {
                ctx.font = 'bold 8px "Amazon Ember",Arial,sans-serif';
                ctx.fillStyle = '#90a4ae';
                ctx.fillText('📬 dwell', el.x + 4, el.y + (el.chute ? 36 : 24));
            }

            ctx.restore();
        }

        // ── Resize handles ──
        if (isSel && State.selectedIds.size === 1 && State.mode === MODE.SELECT && State.editMode) {
            for (const h of this._handles(el)) {
                ctx.fillStyle = '#fff';
                ctx.fillRect(h.x - 3, h.y - 3, 6, 6);
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.strokeRect(h.x - 3, h.y - 3, 6, 6);
            }
        }

    }

},

    _drawTooltip() {
        const el = State.hoveredElement; if (!el || State.bgEditMode) return;
        if (State.isMoving || State.isDrawing || State.isPanning || State.isBoxSelecting || State.isResizing) return;
        const { ctx } = this, mx = State.mouseScreenX, my = State.mouseScreenY, type = ELEMENT_TYPES[el.type], hl = State.getHighlight(el), lines = [];
        lines.push({ text:el.name||el.id, color:'#fff', font:'bold 13px "Amazon Ember",Arial,sans-serif' });
        if (el.chute) lines.push({ text:'🔗 '+el.chute, color:'#82b1ff', font:'11px "Amazon Ember",Arial,sans-serif' });
        if (type) lines.push({ text:type.label, color:type.color, font:'11px "Amazon Ember",Arial,sans-serif' });
        if (hl) {
            if (hl.ymsMatch && !hl.totalPkgs && !hl.loosePkgs && Object.keys(hl.containers).length === 0) { lines.push({ text:'── YMS MATCH ──', color:'#ff9900', font:'9px "Amazon Ember",Arial,sans-serif' }); lines.push({ text:`🚛 VR ID on ${hl.ymsLocCode || 'yard'}`, color:'#4fc3f7', font:'bold 11px "Amazon Ember",Arial,sans-serif' }); if (hl.ymsSource === 'annotation') lines.push({ text:'📝 found in annotation', color:'#ffd600', font:'10px "Amazon Ember",Arial,sans-serif' }); }
            else { lines.push({ text:'── SSP ──', color:'#ff9900', font:'9px "Amazon Ember",Arial,sans-serif' }); if (hl.ymsMatch) lines.push({ text:`🚛 VR on ${hl.ymsLocCode||'yard'}${hl.ymsSource==='annotation'?' 📝':''}`, color:'#4fc3f7', font:'10px "Amazon Ember",Arial,sans-serif' }); if (hl.onlyLoose) lines.push({ text:`📬 ${hl.loosePkgs} dwelling`, color:'#90a4ae', font:'bold 11px "Amazon Ember",Arial,sans-serif' }); else { const TS = {'PALLET':'🛒Pal','GAYLORD':'📫Gay','BAG':'👜Bag','CART':'🛒Cart'}; const cp = Object.entries(hl.containers).map(([t2,n])=>`${TS[t2]||t2}:${n}`); if (cp.length) lines.push({ text:cp.join(' '), color:'#ffd600', font:'bold 11px "Amazon Ember",Arial,sans-serif' }); } lines.push({ text:`Σ ${hl.totalPkgs}pkg · ${hl.totalWeight}kg`, color:hl.onlyLoose?'#90a4ae':'#ff9900', font:'bold 11px "Amazon Ember",Arial,sans-serif' }); }
        }
        const vistaData = State.vistaElementMap?.[el.name || el.id];
        if (vistaData && vistaData.totalContainers > 0) {
            const level = VISTA.getCongestionLevel(el.name || el.id);
            const levelIcon = {low:'🟢',medium:'🟡',high:'🟠',critical:'🔴'}[level]||'⚪';

            lines.push({ text:'── VISTA ──', color:'#5a6a7a', font:'9px "Amazon Ember",Arial,sans-serif' });

            const effMax = getEffectiveMaxContainers(el.name || el.id);
            let capText = '';
            if (effMax.max > 0) {
                const pct = Math.round(vistaData.totalContainers / effMax.max * 100);
                const sourceTag = effMax.source === 'manual' ? '' : `⚡${effMax.label}`;
                capText = `/ ${effMax.max} (${pct}%)${sourceTag}`;
            }

            lines.push({ text:`${levelIcon} ${vistaData.totalContainers}${capText} containers · ${vistaData.totalPkgs} pkgs`, color: VISTA.getCongestionColor(level)?.fill || '#69f0ae', font:'bold 11px "Amazon Ember",Arial,sans-serif' });

            const TS3 = {'PALLET':'🛒Pal','GAYLORD':'📫Gay','CART':'🛒Cart','BAG':'👜Bag'};
            const tp = Object.entries(vistaData.types).map(([t2,n]) => `${TS3[t2]||t2}:${n}`).join(' ');
            if (tp) lines.push({ text:tp, color:'#b0bec5', font:'10px "Amazon Ember",Arial,sans-serif' });

            const stS = Object.entries(vistaData.states).map(([s,n]) => `${s}:${n}`).join(' ');
            if (stS) lines.push({ text:stS, color:'#78909C', font:'9px "Amazon Ember",Arial,sans-serif' });

            if (vistaData.maxDwell > 0) {
                const dwC = vistaData.maxDwell > 120 ? '#ff5252' : (vistaData.maxDwell > 60 ? '#ff9100' : '#8899aa');
                lines.push({ text:`⏱ max dwell ${vistaData.maxDwell}m`, color:dwC, font:'10px "Amazon Ember",Arial,sans-serif' });
            }

            if (vistaData.criticalCount > 0) lines.push({ text:`🚨 ${vistaData.criticalCount} critical pkgs`, color:'#ff1744', font:'bold 10px "Amazon Ember",Arial,sans-serif' });

            if (vistaData.routes) {
                const routeEntries = Object.entries(vistaData.routes).sort((a, b) => b[1].count - a[1].count);
                for (const [r2, d2] of routeEntries) {
                    const rShort = parseRoute(r2);
                    lines.push({ text:`→ ${rShort} ×${d2.count} (${d2.pkgs}pkg)`, color:'#546E7A', font:'9px "Amazon Ember",Arial,sans-serif' });
                }
            }
        }
// ← koniec if (vistaData && vistaData.totalContainers > 0)        }
        // FMC cross-ref
        const ymsLoc2 = State.getYmsForElement(el);
        if (ymsLoc2?.yardAssets?.length && FMC.tours.length) {
            for (const asset of ymsLoc2.yardAssets) { if (asset.type === 'TRACTOR') continue; const trailerId = asset.licensePlateIdentifier?.registrationIdentifier || asset.vehicleNumber || asset.assetId || ''; if (trailerId) { const fmcTour = FMC.findByTrailer(trailerId); if (fmcTour) { lines.push({ text:'── FMC ──', color:'#e040fb', font:'9px "Amazon Ember",Arial,sans-serif' }); lines.push({ text:`${fmcTour.direction} · ${fmcTour.shipperCategory}`, color:'#e040fb', font:'10px "Amazon Ember",Arial,sans-serif' }); if (fmcTour.arrivalDelayMin > 15 || fmcTour.departureDelayMin > 15) lines.push({ text:`⚠ delay +${Math.max(fmcTour.arrivalDelayMin, fmcTour.departureDelayMin)}m`, color:'#ff5252', font:'bold 10px "Amazon Ember",Arial,sans-serif' }); break; } } }
        }
        // YMS assets
        const ymsLoc = State.getYmsForElement(el);
        if (ymsLoc?.yardAssets?.length) {
            lines.push({ text:'── YMS ──', color:'#5a6a7a', font:'9px "Amazon Ember",Arial,sans-serif' });
            for (const asset of ymsLoc.yardAssets) { if (asset.type === 'TRACTOR') continue; const icon = TRAILER_LABELS[asset.type] || '🚛'; const plate = asset.licensePlateIdentifier?.registrationIdentifier || asset.vehicleNumber || '—'; const owner = asset.owner?.shortName || asset.broker?.shortName || ''; lines.push({ text:`${icon} ${plate} · ${owner} · ${asset.status||''}`, color:'#b0bec5', font:'11px "Amazon Ember",Arial,sans-serif' }); const vrIds = ymsGetVrIds(asset); if (vrIds.length) { const lane = asset.load?.lane || asset.load?.routes?.[0] || ''; lines.push({ text:`🔗 ${vrIds[0]}${lane ? ' → '+lane : ''}`, color:'#4fc3f7', font:'10px "Amazon Ember",Arial,sans-serif' }); } const atLoc = asset.datetimeOfArrivalAtLocation?.parsedValue; if (atLoc) lines.push({ text:`⏱ ${dwellFromEpoch(atLoc)}`, color:'#8899aa', font:'10px "Amazon Ember",Arial,sans-serif' }); if (asset.unavailable && asset.unavailableReason) { const color = YMS_RED_REASONS.has(asset.unavailableReason) ? '#ff5252' : '#ffd600'; lines.push({ text:`⚠️ ${asset.unavailableReason.replace(/_/g,' ')}`, color, font:'bold 10px "Amazon Ember",Arial,sans-serif' }); } if (asset.annotation) { let ann = asset.annotation.replace(/\n/g,' ').trim(); if (ann.length > 55) ann = ann.substring(0,52)+'…'; lines.push({ text:`📝 ${ann}`, color:'#78909C', font:'9px "Amazon Ember",Arial,sans-serif' }); } }
        }
        // Draw tooltip box
        const lH = 16, pX = 12, pY = 8; let maxW = 0; for (const l of lines) { ctx.font = l.font; const w = ctx.measureText(l.text).width; if (w > maxW) maxW = w; }
        const tW = Math.min(maxW+pX*2, 360), tH = lines.length*lH+pY*2;
        const drawerW = State.drawerOpen ? 380 : 0; const rightBound = this.canvas.width - drawerW - 4;
        let ttx = mx+16, tty = my-10-tH; if (ttx+tW > rightBound) ttx = mx-16-tW; if (ttx < 4) ttx = 4; if (tty < 4) tty = my+20; if (tty+tH > this.canvas.height-4) tty = this.canvas.height-tH-4;
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12; ctx.fillStyle = 'rgba(22,33,62,0.95)'; ctx.beginPath(); ctx.roundRect(ttx, tty, tW, tH, 8); ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        const ymsOv = this._getYmsColor(el); const bc = ymsOv ? ymsOv.fill : (hl ? (hl.onlyLoose?'#78909C':'#ff9900') : (type?type.color:'#4a5a6a'));
        ctx.strokeStyle = bc; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(ttx, tty, tW, tH, 8); ctx.stroke();
        ctx.fillStyle = bc; ctx.beginPath(); ctx.roundRect(ttx, tty, 4, tH, [8,0,0,8]); ctx.fill();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (let i = 0; i < lines.length; i++) { ctx.font = lines[i].font; ctx.fillStyle = lines[i].color; ctx.fillText(lines[i].text, ttx+pX+4, tty+pY+i*lH+lH/2); }
        ctx.restore();
    },
    _handles(el) { return [{pos:'nw',x:el.x,y:el.y},{pos:'ne',x:el.x+el.w,y:el.y},{pos:'sw',x:el.x,y:el.y+el.h},{pos:'se',x:el.x+el.w,y:el.y+el.h},{pos:'n',x:el.x+el.w/2,y:el.y},{pos:'s',x:el.x+el.w/2,y:el.y+el.h},{pos:'w',x:el.x,y:el.y+el.h/2},{pos:'e',x:el.x+el.w,y:el.y+el.h/2}]; },
    _hitHandle(wx, wy) { if (State.selectedIds.size !== 1) return null; const el = State.primarySelected; if (!el) return null; const thr = 8/State.scale; return this._handles(el).find(h => Math.abs(wx-h.x)<thr && Math.abs(wy-h.y)<thr)||null; },
    _hit(wx, wy) { for (let i = State.elements.length-1; i >= 0; i--) { const el = State.elements[i]; if (wx >= el.x && wx <= el.x+el.w && wy >= el.y && wy <= el.y+el.h) return el; } return null; },
    _drawPreview() { if (!State.isDrawing||!State.drawPreview) return; const { ctx } = this, p = State.drawPreview, t = ELEMENT_TYPES[State.selectedType]; ctx.globalAlpha = 0.4; ctx.fillStyle = t.color; ctx.fillRect(p.x, p.y, p.w, p.h); ctx.globalAlpha = 1; ctx.strokeStyle = t.color; ctx.lineWidth = 2; ctx.setLineDash([8,4]); ctx.strokeRect(p.x, p.y, p.w, p.h); ctx.setLineDash([]); },
    _drawBoxSel() { if (!State.isBoxSelecting||!State.boxStart||!State.boxEnd) return; const { ctx } = this, x = Math.min(State.boxStart.x, State.boxEnd.x), y = Math.min(State.boxStart.y, State.boxEnd.y), w = Math.abs(State.boxEnd.x-State.boxStart.x), h = Math.abs(State.boxEnd.y-State.boxStart.y); ctx.fillStyle = 'rgba(66,165,245,0.15)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#42a5f5'; ctx.lineWidth = 1.5; ctx.setLineDash([6,3]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); },
    _resolveBoxSel() { if (!State.boxStart||!State.boxEnd) return; const x1 = Math.min(State.boxStart.x, State.boxEnd.x), y1 = Math.min(State.boxStart.y, State.boxEnd.y), x2 = Math.max(State.boxStart.x, State.boxEnd.x), y2 = Math.max(State.boxStart.y, State.boxEnd.y); for (const el of State.elements) { if (el.x+el.w>x1 && el.x<x2 && el.y+el.h>y1 && el.y<y2) State.addToSelection(el); } },
    _drawHUD() {
        const { ctx, canvas: c } = this; let cx = 10;
        ctx.font = 'bold 12px "Amazon Ember",Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

        const ml = {select:'🖱️ SELECT',add:'➕ ADD',delete:'🗑️ DELETE'}, mc = {select:'#4fc3f7',add:'#69f0ae',delete:'#ff5252'};

        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.roundRect(cx, c.height-42, 130, 28, 6); ctx.fill();
        ctx.fillStyle = mc[State.mode]; ctx.fillText(ml[State.mode], cx+10, c.height-28); cx += 140;

        if (State.selectedIds.size > 0) { const t = `${State.selectedIds.size} sel`, tw = ctx.measureText(t).width+20; ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.fill(); ctx.fillStyle = '#ff9900'; ctx.fillText(t, cx+10, c.height-28); cx += tw+10; }

        if (State.undoStack.length > 0) { const t = `↩${State.undoStack.length}`, tw = ctx.measureText(t).width+20; ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.fill(); ctx.fillStyle = '#80cbc4'; ctx.fillText(t, cx+10, c.height-28); cx += tw+10; }

        if (State.highlightedLoadIdx >= 0) {
            const ld = State.sspLoads[State.highlightedLoadIdx]; const vrId = ld?.vrId||''; const yiAll = State.findYmsForVrId(vrId);
            const yt = yiAll ? `✅${yiAll.length > 1 ? '×' + yiAll.length : ''}` : '❌';
            const mt = State.elements.filter(el2 => State.isHighlighted(el2)).length, tt = Object.keys(State.highlightData).length;
            const t = `🔦${ld?.route||'?'} ${yt} ${mt}/${tt}`, tw = ctx.measureText(t).width+20;
            ctx.fillStyle = 'rgba(255,153,0,0.2)'; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.fill();
            ctx.strokeStyle = '#ff9900'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.stroke();
            ctx.fillStyle = '#ff9900'; ctx.fillText(t, cx+10, c.height-28); cx += tw+10;
        }

        if (State.highlightedVrId && State.highlightedLoadIdx < 0) {
            const t = `🚛${State.highlightedVrId.substring(0,12)}`, tw = ctx.measureText(t).width+20;
            ctx.fillStyle = 'rgba(79,195,247,0.2)'; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.fill();
            ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.stroke();
            ctx.fillStyle = '#4fc3f7'; ctx.fillText(t, cx+10, c.height-28); cx += tw+10;
        }

        if (State.mapSearch) {
            const t = `🔍${State.mapSearchMatches.size}`, tw = ctx.measureText(t).width+20;
            ctx.fillStyle = 'rgba(66,165,245,0.2)'; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.fill();
            ctx.strokeStyle = '#42a5f5'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.stroke();
            ctx.fillStyle = '#42a5f5'; ctx.fillText(t, cx+10, c.height-28); cx += tw+10;
        }

        if (State.ymsLastUpdated) { const t = '🏗️YMS', tw = ctx.measureText(t).width+20; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.fill(); ctx.fillStyle = '#69f0ae'; ctx.fillText(t, cx+10, c.height-28); cx += tw+10; }

        if (State.vistaLastUpdated) { const t = '📦VIS', tw = ctx.measureText(t).width+20; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.fill(); ctx.fillStyle = '#ff9100'; ctx.fillText(t, cx+10, c.height-28); cx += tw+10; }

        if (FMC.lastUpdated) { const t = `🚛FMC:${FMC.tours.length}`, tw = ctx.measureText(t).width+20; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.roundRect(cx, c.height-42, tw, 28, 6); ctx.fill(); ctx.fillStyle = '#e040fb'; ctx.fillText(t, cx+10, c.height-28); cx += tw+10; }
        if (State.focusRoutes.size > 0) {
            let focusTotal = 0;
            for (const el2 of State.elements) {
                const fd = State.getFocusForElement(el2);
                if (fd) focusTotal += Object.values(fd).reduce((s, r) => s + r.count, 0);
            }
            const t = `🎯${State.focusRoutes.size}r ${focusTotal}cnt`, tw = ctx.measureText(t).width + 20;
            ctx.fillStyle = 'rgba(255,107,107,0.2)'; ctx.beginPath(); ctx.roundRect(cx, c.height - 42, tw, 28, 6); ctx.fill();
            ctx.strokeStyle = '#FF6B6B'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(cx, c.height - 42, tw, 28, 6); ctx.stroke();
            ctx.fillStyle = '#FF6B6B'; ctx.fillText(t, cx + 10, c.height - 28); cx += tw + 10;
        }

        const sh = getCurrentShiftLabel(), sht = `⏰${sh}`, shw = ctx.measureText(sht).width+20;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(c.width-shw-10, c.height-42, shw, 28, 6); ctx.fill();
        ctx.fillStyle = '#8899aa'; ctx.textAlign = 'right'; ctx.fillText(sht, c.width-20, c.height-28); ctx.textAlign = 'left';

        if (!State.editMode) { ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.roundRect(cx, c.height-42, 100, 28, 6); ctx.fill(); ctx.fillStyle = '#ff5252'; ctx.fillText('🔒 LOCKED', cx+10, c.height-28); }
    },

    _bindEvents() {
        const c = this.canvas;
        c.addEventListener('wheel', (e) => { e.preventDefault(); if (State.bgEditMode && BgImage.loaded) { const f = e.deltaY > 0 ? 0.95 : 1.05; SiteSettings.bgScale = Math.max(0.05, Math.min(10, SiteSettings.bgScale * f)); saveSiteSettings(); this.render(); return; } const f = e.deltaY > 0 ? 0.9 : 1.1, ns = Math.max(0.2, Math.min(8, State.scale * f)), r = c.getBoundingClientRect(), mx2 = e.clientX - r.left, my2 = e.clientY - r.top; State.offsetX = mx2 - (mx2 - State.offsetX) * (ns / State.scale); State.offsetY = my2 - (my2 - State.offsetY) * (ns / State.scale); State.scale = ns; this.render(); State.saveViewport(); }, { passive: false });
        c.addEventListener('mousedown', (e) => {
            if (e.button === 1) { e.preventDefault(); e.stopPropagation(); State.isPanning = true; State.panStart = { x: e.clientX - State.offsetX, y: e.clientY - State.offsetY }; c.style.cursor = 'grabbing'; return; }
            if (e.button !== 0) return;
            const r = c.getBoundingClientRect(), w = this.s2w(e.clientX - r.left, e.clientY - r.top);
            if (e.altKey) { State.isPanning = true; State.panStart = { x: e.clientX - State.offsetX, y: e.clientY - State.offsetY }; c.style.cursor = 'grabbing'; e.preventDefault(); return; }
            if (State.bgEditMode && BgImage.loaded) { State.isBgDragging = true; State.bgDragStart = { x: w.x - SiteSettings.bgOffsetX, y: w.y - SiteSettings.bgOffsetY }; c.style.cursor = 'grabbing'; e.preventDefault(); return; }
            if (!State.editMode) { const hit = this._hit(w.x, w.y); if (hit) { if (e.ctrlKey || e.metaKey) State.toggleSelect(hit); else if (e.shiftKey) State.addToSelection(hit); else State.selectOnly(hit); if (State.selectedIds.size === 1) UI.showInspector(State.primarySelected, true); else if (State.selectedIds.size > 1) UI.showMultiInspector(true); UI.refreshList(); } else { if (!e.ctrlKey && !e.metaKey && !e.shiftKey) State.clearSelection(); State.isBoxSelecting = true; State.boxStart = { x: w.x, y: w.y }; State.boxEnd = { x: w.x, y: w.y }; UI.clearInspector(); UI.refreshList(); } this.render(); e.preventDefault(); return; }
            if (State.mode === MODE.ADD) { State.isDrawing = true; State.drawStart = { x: snap(w.x), y: snap(w.y) }; State.drawPreview = { ...State.drawStart, w: 0, h: 0 }; e.preventDefault(); return; }
            if (State.mode === MODE.DELETE) { const hit = this._hit(w.x, w.y); if (hit) { State.pushUndo(); if (State.isSelected(hit) && State.selectedIds.size > 1) { State.elements = State.elements.filter(el => !State.selectedIds.has(el.id)); State.clearSelection(); } else { State.elements = State.elements.filter(el => el.id !== hit.id); State.selectedIds.delete(hit.id); } State.hoveredElement = null; State.save(); UI.clearInspector(); UI.refreshList(); this.render(); } e.preventDefault(); return; }
            if (State.mode === MODE.SELECT) {
                if (State.selectedIds.size === 1) { const rh = this._hitHandle(w.x, w.y); if (rh) { State.pushUndo(); State.isResizing = true; State.resizeHandle = rh; const el = State.primarySelected; State.resizeSnapshot = { x: el.x, y: el.y, w: el.w, h: el.h }; e.preventDefault(); return; } }
                const hit = this._hit(w.x, w.y);
                if (hit) { if (e.ctrlKey || e.metaKey) { if (!State.isSelected(hit)) State.addToSelection(hit); } else if (e.shiftKey) State.addToSelection(hit); else { if (!State.isSelected(hit)) State.selectOnly(hit); } State.pushUndo(); State.isMoving = true; State.ctrlDragCopied = false; State.moveStart = { x: w.x, y: w.y }; State.moveSnapshots = State.selectedElements.map(el => ({ id: el.id, x: el.x, y: el.y, w: el.w, h: el.h, type: el.type, name: el.name })); if (State.selectedIds.size === 1) UI.showInspector(State.primarySelected); else UI.showMultiInspector(); UI.refreshList(); this.render(); }
                else { if (!e.ctrlKey && !e.metaKey && !e.shiftKey) State.clearSelection(); State.isBoxSelecting = true; State.boxStart = { x: w.x, y: w.y }; State.boxEnd = { x: w.x, y: w.y }; UI.clearInspector(); UI.refreshList(); this.render(); }
                e.preventDefault();
                   // ── Touch events ──
        var _touches = { startDist: 0, startScale: 1, startMid: null, lastTap: 0, panning: false, panStart: null };
        function _getTouchDist(t1, t2) { return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY); }
        function _getTouchMid(t1, t2) { return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 }; }
        var rSelf = this;

        c.addEventListener('touchstart', function(e) {
            e.preventDefault();
            var r = c.getBoundingClientRect();
            if (e.touches.length === 2) {
                _touches.startDist = _getTouchDist(e.touches[0], e.touches[1]);
                _touches.startScale = State.scale;
                _touches.startMid = _getTouchMid(e.touches[0], e.touches[1]);
                _touches.panning = false;
                return;
            }
            if (e.touches.length === 1) {
                var touch = e.touches[0], now = Date.now();
                var mx = touch.clientX - r.left, my = touch.clientY - r.top;
                var w = rSelf.s2w(mx, my);
                // Double tap → zoom
                if (now - _touches.lastTap < 300) {
                    var ns = Math.min(8, State.scale * 1.8);
                    State.offsetX = mx - (mx - State.offsetX) * (ns / State.scale);
                    State.offsetY = my - (my - State.offsetY) * (ns / State.scale);
                    State.scale = ns;
                    State.saveViewport();
                    rSelf.render();
                    _touches.lastTap = 0;
                    return;
                }
                _touches.lastTap = now;
                var hit = rSelf._hit(w.x, w.y);
                if (hit) {
                    if (State.isSelected(hit)) { State.clearSelection(); UI.clearInspector(); }
                    else { State.selectOnly(hit); UI.showInspector(State.primarySelected, true); }
                    UI.refreshList(); rSelf.render();
                }
                _touches.panning = true;
                _touches.panStart = { x: touch.clientX - State.offsetX, y: touch.clientY - State.offsetY };
                State.mouseScreenX = mx;
                State.mouseScreenY = my;
            }
        }, { passive: false });

        c.addEventListener('touchmove', function(e) {
            e.preventDefault();
            var r = c.getBoundingClientRect();
            if (e.touches.length === 2) {
                var dist = _getTouchDist(e.touches[0], e.touches[1]);
                var mid = _getTouchMid(e.touches[0], e.touches[1]);
                var mx = mid.x - r.left, my = mid.y - r.top;
                var ratio = dist / _touches.startDist;
                var ns = Math.max(0.2, Math.min(8, _touches.startScale * ratio));
                State.offsetX = mx - (mx - State.offsetX) * (ns / State.scale);
                State.offsetY = my - (my - State.offsetY) * (ns / State.scale);
                State.scale = ns;
                rSelf.render();
                _touches.panning = false;
                return;
            }
            if (e.touches.length === 1 && _touches.panning) {
                var touch = e.touches[0];
                State.offsetX = touch.clientX - _touches.panStart.x;
                State.offsetY = touch.clientY - _touches.panStart.y;
                var mx2 = touch.clientX - r.left, my2 = touch.clientY - r.top;
                var w2 = rSelf.s2w(mx2, my2);
                State.mouseScreenX = mx2;
                State.mouseScreenY = my2;
                State.hoveredElement = rSelf._hit(w2.x, w2.y) || null;
                rSelf.render();
            }
        }, { passive: false });

        c.addEventListener('touchend', function(e) {
            if (e.touches.length === 0) {
                if (_touches.panning) { _touches.panning = false; State.saveViewport(); }
                setTimeout(function() { State.hoveredElement = null; rSelf.render(); }, 1500);
            }
            if (e.touches.length < 2) { _touches.startDist = 0; State.saveViewport(); }
        }, { passive: true });
 }
        });
        c.addEventListener('mousemove', (e) => {
            const r = c.getBoundingClientRect(); State.mouseScreenX = e.clientX - r.left; State.mouseScreenY = e.clientY - r.top;
            const w = this.s2w(State.mouseScreenX, State.mouseScreenY); UI.setCoords(Math.round(w.x), Math.round(w.y));
            if (State.isPanning) { State.offsetX = e.clientX - State.panStart.x; State.offsetY = e.clientY - State.panStart.y; this.render(); return; }
            if (State.isBgDragging && State.bgDragStart) { SiteSettings.bgOffsetX = Math.round(w.x - State.bgDragStart.x); SiteSettings.bgOffsetY = Math.round(w.y - State.bgDragStart.y); this.render(); return; }
            if (State.isDrawing && State.drawStart) { const sx2 = snap(w.x), sy2 = snap(w.y); State.drawPreview = { x: Math.min(State.drawStart.x, sx2), y: Math.min(State.drawStart.y, sy2), w: Math.abs(sx2 - State.drawStart.x), h: Math.abs(sy2 - State.drawStart.y) }; this.render(); return; }
            if (State.isBoxSelecting) { State.boxEnd = { x: w.x, y: w.y }; this.render(); return; }
            if (State.isMoving && State.moveStart && State.editMode) { const dx = snap(w.x - State.moveStart.x), dy = snap(w.y - State.moveStart.y); if ((e.ctrlKey || e.metaKey) && !State.ctrlDragCopied && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) { for (const s2 of State.moveSnapshots) { const nid = State.getNextId(s2.type); State.elements.push({ id: nid, name: nid, type: s2.type, chute: '', maxContainers: 0, x: s2.x, y: s2.y, w: s2.w, h: s2.h }); } State.ctrlDragCopied = true; } for (const s2 of State.moveSnapshots) { const el = State.elements.find(e2 => e2.id === s2.id); if (el) { el.x = s2.x + dx; el.y = s2.y + dy; } } this.render(); return; }
            if (State.isResizing && State.resizeHandle && State.resizeSnapshot && State.editMode) { const el = State.primarySelected, h = State.resizeHandle, sn = State.resizeSnapshot, sx2 = snap(w.x), sy2 = snap(w.y), min2 = CONFIG.grid.size; if (h.pos.includes('w')) { const nw = sn.x + sn.w - sx2; if (nw >= min2) { el.x = sx2; el.w = nw; } } if (h.pos.includes('e')) el.w = Math.max(min2, sx2 - sn.x); if (h.pos.includes('n')) { const nh = sn.y + sn.h - sy2; if (nh >= min2) { el.y = sy2; el.h = nh; } } if (h.pos.includes('s')) el.h = Math.max(min2, sy2 - sn.y); this.render(); return; }
            const hit = this._hit(w.x, w.y);
            if (hit?.id !== State.hoveredElement?.id) { State.hoveredElement = hit || null; if (!State.editMode) c.style.cursor = hit ? 'pointer' : 'default'; else if (State.mode === MODE.SELECT) c.style.cursor = hit ? 'move' : 'default'; else if (State.mode === MODE.DELETE) c.style.cursor = hit ? 'not-allowed' : 'default'; else c.style.cursor = 'crosshair'; this.render(); }
        });
        c.addEventListener('mouseup', (e) => {
            if (State.isPanning) { State.isPanning = false; c.style.cursor = 'default'; State.saveViewport(); return; }
            if (State.isBgDragging) { State.isBgDragging = false; State.bgDragStart = null; saveSiteSettingsImmediate(); }
            if (State.isDrawing) { State.isDrawing = false; const p = State.drawPreview; if (p && p.w >= CONFIG.grid.size && p.h >= CONFIG.grid.size) { State.pushUndo(); const id = State.getNextId(State.selectedType); const el = { id, name: id, type: State.selectedType, chute: '', maxContainers: 0, x: p.x, y: p.y, w: p.w, h: p.h }; State.elements.push(el); State.selectOnly(el); State.save(); UI.showInspector(el); } State.drawPreview = null; UI.refreshList(); this.render(); }
            if (State.isBoxSelecting) { State.isBoxSelecting = false; this._resolveBoxSel(); State.boxStart = null; State.boxEnd = null; const n = State.selectedIds.size; if (n > 0) { const ro = !State.editMode; n === 1 ? UI.showInspector(State.primarySelected, ro) : UI.showMultiInspector(ro); } UI.refreshList(); this.render(); }
            if (State.isMoving) { State.isMoving = false; State.moveStart = null; State.moveSnapshots = []; State.ctrlDragCopied = false; State.save(); State.saveViewport(); const n = State.selectedIds.size; if (n === 1) UI.showInspector(State.primarySelected); else if (n > 1) UI.showMultiInspector(); UI.refreshList(); this.render(); }
            if (State.isResizing) { State.isResizing = false; State.resizeHandle = null; State.resizeSnapshot = null; State.save(); UI.showInspector(State.primarySelected); this.render(); }
        });
        c.addEventListener('mouseleave', () => { State.hoveredElement = null; this.render(); });
        c.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!State.editMode) return;
            var r = c.getBoundingClientRect(), w = this.s2w(e.clientX - r.left, e.clientY - r.top), hit = this._hit(w.x, w.y);
            document.getElementById('ctx-menu')?.remove();
            if (!hit && State.selectedIds.size === 0) return;
            if (hit && !State.isSelected(hit)) State.selectOnly(hit);
            var sel = State.selectedElements; if (!sel.length) return;
            var count = sel.length, label = count === 1 ? (sel[0].name || sel[0].id) : count + ' el';
            var menu = document.createElement('div'); menu.id = 'ctx-menu';
            menu.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;z-index:9999;background:#1e2a3a;border:1px solid #4a5a6a;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,0.5);min-width:140px;padding:4px 0;font-size:12px;color:#e0e0e0';
            var items = [
                { icon:'\uD83D\uDDD1', text:'Del ' + label, color:'#ff5252', action:'delete' },
                { icon:'\uD83D\uDCCB', text:'Copy', color:'#4fc3f7', action:'copy' },
                { icon:'\uD83D\uDCCB', text:'Duplicate', color:'#69f0ae', action:'dup' }
            ];
            for (var i = 0; i < items.length; i++) {
                (function(item) {
                    var row = document.createElement('div');
                    row.style.cssText = 'padding:6px 14px;cursor:pointer;display:flex;align-items:center;gap:8px';
                    row.innerHTML = '<span>' + item.icon + '</span><span style="color:' + item.color + '">' + item.text + '</span>';
                    row.addEventListener('mouseenter', function() { row.style.background = 'rgba(255,255,255,0.05)'; });
                    row.addEventListener('mouseleave', function() { row.style.background = 'none'; });
                    row.addEventListener('click', function() {
                        menu.remove();
                        if (item.action === 'delete') { State.pushUndo(); var ids = new Set(sel.map(function(el) { return el.id; })); State.elements = State.elements.filter(function(el) { return !ids.has(el.id); }); ids.forEach(function(id) { State.selectedIds.delete(id); }); State.save(); UI.clearInspector(); UI.refreshList(); R.render(); }
                        else if (item.action === 'copy') { State.copySelection(); R.render(); }
                        else if (item.action === 'dup') { State.duplicateSelected(CONFIG.grid.size, CONFIG.grid.size); UI.refreshList(); R.render(); }
                    });
                    menu.appendChild(row);
                })(items[i]);
            }
            document.body.appendChild(menu);
            var closeMenu = function(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', closeMenu); } };
            setTimeout(function() { document.addEventListener('mousedown', closeMenu); }, 10);
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            const ctrl = e.ctrlKey || e.metaKey;
            if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (State.undo()) { UI.clearInspector(); UI.refreshList(); this.render(); } return; }
            if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); UI.openQuickNav(); return; }
            if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); State.selectAll(); UI.showMultiInspector(!State.editMode); UI.refreshList(); this.render(); return; }
            if (State.editMode) {
                if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); State.copySelection(); return; }
                if (ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); if (State.clipboard.length) { const cx2 = (this.canvas.width / 2 - State.offsetX) / State.scale, cy2 = (this.canvas.height / 2 - State.offsetY) / State.scale; State.paste(cx2, cy2); UI.refreshList(); this.render(); } return; }
                if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); if (State.selectedElements.length) { State.duplicateSelected(CONFIG.grid.size, CONFIG.grid.size); UI.refreshList(); this.render(); } return; }
            }
            if (!State.editMode) { if (e.key === 'Escape') { State.clearSelection(); State.clearHighlight(); State.updateMapSearch(''); const si = document.getElementById('map-search-input'); if (si) si.value = ''; UI.closeDrawer(); UI.clearInspector(); UI.refreshList(); UI.updateDataPanel();State.clearFocus();UI._renderFocusBar();
 this.render(); } return; }
            switch (e.key.toLowerCase()) {
                case 's': if (!ctrl) State.mode = MODE.SELECT; break;
                case 'a': if (!ctrl) State.mode = MODE.ADD; break;
                case 'd': if (!ctrl) State.mode = MODE.DELETE; break;
                case 'delete': case 'backspace': if (State.selectedIds.size > 0) { State.pushUndo(); State.elements = State.elements.filter(el => !State.selectedIds.has(el.id)); State.clearSelection(); State.save(); UI.clearInspector(); UI.refreshList(); } break;
                case 'escape': State.clearSelection(); State.clearHighlight(); State.updateMapSearch(''); { const si = document.getElementById('map-search-input'); if (si) si.value = ''; } UI.closeDrawer(); State.isDrawing = false; State.drawPreview = null; State.isBoxSelecting = false; UI.clearInspector(); UI.refreshList(); UI.updateDataPanel();State.clearFocus();UI._renderFocusBar(); break;
                default: return;
            }
            c.style.cursor = State.mode === MODE.ADD ? 'crosshair' : State.mode === MODE.DELETE ? 'not-allowed' : 'default';
            UI.updateToolbar(); this.render();
        });
    },
};
// ============================================================
// UI
// ============================================================
const UI = {

    _typeEditorOpen: false, _settingsOpen: false, _dashKpiTimer: null,
    _isUpdating: false,

    _sbWidth: GM_getValue('shipmap_sidebar_width', 320),
    _sbMinWidth: 260, _sbMaxWidth: 700, _sbDefaultWidth: 320,
    _vistaSubTab: 'locations', _vistaSearch: '', _drawerSearch: '',

    init() {
        GM_addStyle(`
*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;overflow:hidden}
#app{font-family:'Amazon Ember',Arial,sans-serif;color:#e0e0e0;height:100vh;display:flex;flex-direction:column}
.hdr{background:#232f3e;padding:6px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #ff9900}
.hdr h1{font-size:15px;color:#fff;display:flex;align-items:center;gap:6px}
#node-input{background:transparent;border:1px solid transparent;color:#ff9900;font-size:15px;font-weight:bold;font-family:'Amazon Ember',Arial,sans-serif;width:70px;padding:1px 4px;border-radius:4px;text-transform:uppercase;cursor:default}
#node-input:not([readonly]){border-color:#ff9900;background:#0d1b2a;cursor:text}#node-input:focus{outline:none;border-color:#ff9900;background:#0d1b2a}
.tb{background:#1e2a3a;padding:5px 16px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #2a3a4a}
.tb-edit-group{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.tb.locked .tb-edit-group{opacity:.4;pointer-events:none}
.tb.locked{opacity:1;pointer-events:auto}
.tb.locked .map-search-inline{pointer-events:auto;opacity:1}
.tb.locked .btn#b-minimap{pointer-events:auto;opacity:1}

.btn{background:#37475a;color:#e0e0e0;border:1px solid #4a5a6a;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;transition:.15s}.btn:hover{background:#4a5a6a}.btn.on{background:#ff9900;color:#000;border-color:#ff9900;font-weight:bold}.btn.del{border-color:#ff5252}.btn.del.on{background:#ff5252;color:#fff}.btn.sm{padding:2px 6px;font-size:10px}.btn.green{background:#1b5e20;border-color:#4caf50;color:#69f0ae}.btn.cyan{background:#0d47a1;border-color:#4fc3f7;color:#4fc3f7}
select.tsel{background:#37475a;color:#e0e0e0;border:1px solid #4a5a6a;padding:4px 8px;border-radius:4px;font-size:11px}
.main{flex:1;display:flex;overflow:hidden;position:relative}.cvs{flex:1;position:relative}
.eli-del{background:none;border:none;color:#ff5252;cursor:pointer;font-size:11px;padding:2px 4px;border-radius:3px;opacity:0;transition:.15s;flex-shrink:0}.eli:hover .eli-del{opacity:.6}.eli-del:hover{opacity:1!important}
.sb{position:absolute;right:0;top:0;bottom:0;width:320px;background:#16213e;border-left:1px solid #2a3a4a;display:flex;flex-direction:column;overflow:hidden;z-index:60}
.sb-scroll{flex:1;overflow-y:auto;overflow-x:hidden}.sb-scroll::-webkit-scrollbar{width:6px}.sb-scroll::-webkit-scrollbar-track{background:#16213e}.sb-scroll::-webkit-scrollbar-thumb{background:#3a4a5a;border-radius:3px}
.sbs{padding:10px 12px;border-bottom:1px solid #2a3a4a}.sbs h3{font-size:12px;color:#ff9900;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;justify-content:space-between}
.leg{display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:11px}.lsw{width:14px;height:14px;border-radius:2px;border:1px solid rgba(255,255,255,.15);flex-shrink:0}.ie{color:#5a6a7a;font-size:11px;font-style:italic}
.fld{margin-bottom:8px}.fld label{display:block;font-size:10px;color:#8899aa;margin-bottom:3px;text-transform:uppercase}.fld input,.fld select{width:100%;background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:5px 8px;border-radius:4px;font-size:12px}.fld input:focus,.fld select:focus{outline:none;border-color:#ff9900}.fld input:read-only{opacity:.6;cursor:not-allowed}
.fr{display:flex;gap:6px}.fr .fld{flex:1}.elist{padding:8px 12px}.eli{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:11px;margin-bottom:2px}.eli:hover{background:rgba(255,255,255,.05)}.eli.sel{background:rgba(255,153,0,.15)}.esw{width:10px;height:10px;border-radius:2px;flex-shrink:0}
.sbar{background:#232f3e;padding:3px 16px;font-size:10px;color:#6a7a8a;display:flex;justify-content:space-between;border-top:1px solid #2a3a4a}
.keys{font-size:9px;color:#4a5a6a;padding:6px 12px;border-top:1px solid #2a3a4a}.keys kbd{background:#2a3a4a;padding:1px 4px;border-radius:3px;font-family:monospace;color:#8899aa}
.edit-toggle{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;padding:4px 12px;border-radius:6px;transition:.2s}.edit-toggle:hover{background:rgba(255,255,255,.05)}.edit-toggle .lock-icon{font-size:18px}.edit-toggle .lock-label{font-size:11px;font-weight:bold;letter-spacing:.5px}.edit-toggle.locked .lock-icon,.edit-toggle.locked .lock-label{color:#ff5252}.edit-toggle.unlocked .lock-icon,.edit-toggle.unlocked .lock-label{color:#69f0ae}.edit-toggle .switch{width:36px;height:18px;border-radius:9px;position:relative;transition:.2s}.edit-toggle.locked .switch{background:#4a2020}.edit-toggle.unlocked .switch{background:#1b5e20}.edit-toggle .switch::after{content:'';position:absolute;width:14px;height:14px;border-radius:50%;top:2px;transition:.2s}.edit-toggle.locked .switch::after{left:2px;background:#ff5252}.edit-toggle.unlocked .switch::after{left:20px;background:#69f0ae}
.dp{border-bottom:1px solid #2a3a4a;display:flex;flex-direction:column;max-height:50vh;min-height:0}.dp-tabs{display:flex;border-bottom:1px solid #1a2a3a}.dp-tab{flex:1;padding:6px 8px;font-size:11px;font-weight:bold;text-align:center;cursor:pointer;color:#5a6a7a;border-bottom:2px solid transparent;transition:.15s;text-transform:uppercase;letter-spacing:.3px}.dp-tab:hover{color:#8899aa;background:rgba(255,255,255,.02)}.dp-tab.active{color:#ff9900;border-bottom-color:#ff9900}
#tab-loads,#tab-yms,#tab-vista,#tab-fmc{display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden}#tab-loads.collapsed,#tab-yms.collapsed,#tab-vista.collapsed,#tab-fmc.collapsed{display:none!important}
.dp-hdr{padding:6px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1a2a3a;gap:6px}.dp-hdr h3{font-size:11px;color:#8899aa;margin:0}.dp-list{flex:1;overflow-y:auto;padding:4px 0}.dp-empty{padding:20px 12px;text-align:center;color:#5a6a7a;font-size:11px;font-style:italic}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}.pulse{animation:pulse 1.5s ease-in-out infinite}
.load-item{padding:2px 8px;border-bottom:1px solid #0d1b2a;cursor:default;transition:.1s}.load-item:hover{background:rgba(255,255,255,.03)}.load-item.hl-active{background:rgba(255,153,0,.08);border-left:3px solid #ff9900}.load-item.expanded{background:rgba(255,153,0,.03);border-left:2px solid #ff9900}
.load-header{cursor:pointer;transition:.1s;display:flex;align-items:center;gap:6px;min-height:18px}.load-header:hover{background:rgba(255,153,0,.05)}.load-expand-icon{font-size:8px;color:#5a6a7a;flex-shrink:0;width:10px}.load-route{font-size:10px;font-weight:bold;color:#e0e0e0;font-family:'Amazon Ember',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.load-status{font-size:9px;font-weight:bold;padding:1px 4px;border-radius:3px;display:inline-block;white-space:nowrap;flex-shrink:0;min-width:18px;text-align:center;letter-spacing:.3px}.load-sdt{font-size:10px;color:#8899aa;white-space:nowrap;flex-shrink:0;font-family:monospace}.load-sdt.cpt-load{color:#ff9900}
.load-dock{color:#e040fb;font-weight:bold;font-size:10px;flex-shrink:0}.load-swap-badge{color:#e040fb;font-size:8px;flex-shrink:0}.load-match-info{font-size:9px;color:#ff9900;padding-left:16px;margin-top:1px}
.load-equip-badge{font-size:8px;font-weight:bold;padding:1px 4px;border-radius:3px;flex-shrink:0;white-space:nowrap}
.load-yms-badge{font-size:8px;flex-shrink:0;padding:1px 4px;border-radius:3px;font-weight:bold}.load-yms-found{background:rgba(105,240,174,.15);color:#69f0ae}.load-yms-annotation{background:rgba(255,214,0,.15);color:#ffd600}.load-yms-missing{background:rgba(255,82,82,.15);color:#ff5252}
.load-filters-bar{display:flex;align-items:center;gap:8px;padding:3px 10px;border-bottom:1px solid #1a2a3a;background:rgba(0,0,0,.15);font-size:10px}.load-filter-toggle{display:flex;align-items:center;gap:3px;color:#8899aa;cursor:pointer;white-space:nowrap;user-select:none}.load-filter-toggle input{accent-color:#ff9900;margin:0}.load-filter-toggle:hover{color:#e0e0e0}.load-filter-counts{color:#5a6a7a;font-size:9px;margin-left:auto;white-space:nowrap}
.route-filter-wrap{padding:4px 10px;border-bottom:1px solid #1a2a3a;display:flex;gap:4px;align-items:center}.route-filter{flex:1;background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:4px 8px;border-radius:4px;font-size:11px;font-family:'Amazon Ember',Arial,sans-serif}.route-filter:focus{outline:none;border-color:#ff9900}.route-filter::placeholder{color:#3a4a5a}.route-filter-clear{background:none;border:none;color:#5a6a7a;cursor:pointer;font-size:14px;padding:2px 4px}.route-filter-clear:hover{color:#fff}
.hidden-count{padding:4px 10px;font-size:10px;color:#5a6a7a;font-style:italic;background:rgba(0,0,0,.15);border-bottom:1px solid #1a2a3a;text-align:center}
.cnt-loading{padding:6px 14px;font-size:11px;color:#5a6a7a}
.drawer-wrap{position:absolute;top:0;right:320px;bottom:0;width:0;overflow:hidden;transition:width .25s ease;z-index:55;pointer-events:none;background:#111827}.drawer-wrap.open{width:380px;pointer-events:auto}
.drawer{display:flex;flex-direction:column;height:100%;overflow:hidden}
.drawer-hdr{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-bottom:1px solid #1a2a3a;background:#1a2236;flex-shrink:0}.drawer-hdr h3{margin:0;font-size:12px;color:#ff9900}
.drawer-close{background:none;border:none;color:#5a6a7a;font-size:16px;cursor:pointer;padding:4px 8px;border-radius:4px}.drawer-close:hover{background:rgba(255,255,255,.1);color:#fff}
.drawer-route{font-size:14px;font-weight:bold;color:#e0e0e0;font-family:'Amazon Ember',monospace;padding:6px 12px;border-bottom:1px solid #1a2a3a;display:flex;align-items:center;gap:8px;background:#0d1b2a;flex-wrap:wrap}
.drawer-summary{font-size:10px;color:#8899aa;padding:4px 12px;background:rgba(0,0,0,.3);border-bottom:1px solid #1a2a3a}
.drawer-summary strong{color:#ff9900}
.drawer-sort{display:flex;align-items:center;gap:4px;padding:4px 10px;border-bottom:1px solid #1a2a3a;background:rgba(0,0,0,.2)}.drawer-sort label{font-size:9px;color:#5a6a7a;text-transform:uppercase;letter-spacing:.3px;margin-right:2px}
.drawer-body{flex:1;overflow-y:auto;padding:0}
.dtable{width:100%;border-collapse:collapse}.dtable th{text-align:left;font-size:9px;color:#5a6a7a;text-transform:uppercase;letter-spacing:.5px;padding:4px 8px;border-bottom:1px solid #2a3a4a;background:#0d1b2a;position:sticky;top:0;z-index:1;cursor:pointer;user-select:none;white-space:nowrap}.dtable th:hover{color:#ff9900}.dtable th.sort-active{color:#ff9900}.dtable td{padding:3px 8px;border-bottom:1px solid rgba(255,255,255,.03);font-size:11px;vertical-align:middle}.dtable tr:hover{background:rgba(255,255,255,.03)}.dtable tr.dr-matched{border-left:3px solid #ff9900}.dtable tr.dr-unmatched{opacity:.45}.dtable tr.dr-dwell{border-left:3px solid #78909C}.dtable tr[data-loc]{cursor:pointer}.dtable tr[data-loc]:hover{background:rgba(255,153,0,.1)!important}
.dr-loc{font-family:'Amazon Ember',monospace;font-weight:bold;color:#e0e0e0;white-space:nowrap;font-size:10px}.dr-content{color:#b0bec5;display:flex;align-items:center;gap:3px;flex-wrap:nowrap;white-space:nowrap}.dr-badge{display:inline-block;padding:0px 4px;border-radius:3px;font-size:9px;font-weight:bold;white-space:nowrap}.dr-pal{background:rgba(255,214,0,.15);color:#ffd600}.dr-cart{background:rgba(0,200,83,.15);color:#69f0ae}.dr-gaylord{background:rgba(224,64,251,.15);color:#e040fb}.dr-bag{background:rgba(79,195,247,.15);color:#4fc3f7}.dr-pkg{background:rgba(120,144,156,.2);color:#90a4ae}.dr-other{background:rgba(158,158,158,.15);color:#bdbdbd}.dr-empty{background:rgba(255,82,82,.2);color:#ff5252}
.dr-sf-row{display:flex;flex-wrap:wrap;gap:2px;margin-top:1px}.dr-sf-badge{display:inline-block;padding:0 3px;border-radius:2px;font-size:8px;font-weight:bold;font-family:'Amazon Ember',monospace;background:rgba(41,98,255,.15);color:#82b1ff;white-space:nowrap}
.dr-dwell-cell{font-size:10px;color:#ffb74d;white-space:nowrap;font-weight:bold;font-family:monospace}.dr-dwell-cell.long{color:#ff5252}
.yms-report{padding:0}.yms-rtable{width:100%;border-collapse:collapse}.yms-rtable th{text-align:left;font-size:9px;color:#5a6a7a;text-transform:uppercase;padding:5px 10px;border-bottom:1px solid #2a3a4a;background:#0d1b2a;position:sticky;top:0;z-index:1}.yms-rtable td{padding:4px 10px;border-bottom:1px solid rgba(255,255,255,.03);font-size:11px}.yms-rtable tr:hover{background:rgba(255,255,255,.03)}.yms-rtable .owner-code{font-weight:bold;font-family:'Amazon Ember',monospace;color:#e0e0e0}.yms-rtable .cnt{text-align:center;font-weight:bold;font-family:monospace}.yms-rtable .cnt-warn{color:#ff5252}.yms-rtable .cnt-ok{color:#69f0ae}.yms-rtable .priority-row{background:rgba(255,153,0,.05)}.yms-rtable .total-row{background:rgba(255,153,0,.1);font-weight:bold}.yms-rtable .total-row td{border-top:2px solid #ff9900;color:#ff9900}
.summary-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px)}.summary-panel{background:#111827;border:2px solid #ff9900;border-radius:12px;width:90vw;max-width:900px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.8)}.summary-hdr{padding:12px 20px;display:flex;justify-content:space-between;align-items:center;background:#1a2236;border-bottom:2px solid #ff9900}.summary-hdr h2{font-size:16px;color:#ff9900;margin:0;display:flex;align-items:center;gap:8px}.summary-hdr .shift-badge{background:#ff9900;color:#000;padding:2px 10px;border-radius:10px;font-size:13px;font-weight:bold}.summary-hdr .time-badge{color:#8899aa;font-size:12px;font-family:monospace}.summary-close{background:none;border:none;color:#5a6a7a;font-size:20px;cursor:pointer;padding:4px 8px;border-radius:4px}.summary-close:hover{background:rgba(255,255,255,.1);color:#fff}.summary-body{flex:1;overflow-y:auto;padding:16px 20px}.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.summary-card{background:#1a2236;border:1px solid #2a3a4a;border-radius:8px;padding:12px 16px;display:flex;flex-direction:column;gap:8px}.summary-card h3{font-size:11px;color:#ff9900;text-transform:uppercase;letter-spacing:.5px;margin:0}.summary-kpi{display:flex;gap:12px;flex-wrap:wrap}.summary-kpi-item{display:flex;flex-direction:column;align-items:center;min-width:60px}.summary-kpi-val{font-size:24px;font-weight:bold;font-family:'Amazon Ember',monospace;line-height:1.1}.summary-kpi-label{font-size:9px;color:#5a6a7a;text-transform:uppercase}.summary-bar{height:6px;border-radius:3px;background:#2a3a4a;overflow:hidden;width:100%}.summary-bar-fill{height:100%;border-radius:3px}.summary-table{width:100%;border-collapse:collapse;font-size:11px}.summary-table th{text-align:left;font-size:9px;color:#5a6a7a;text-transform:uppercase;padding:4px 8px;border-bottom:1px solid #2a3a4a}.summary-table td{padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.03)}.summary-table .val{font-family:monospace;font-weight:bold;text-align:center}.summary-footer{padding:8px 20px;border-top:1px solid #2a3a4a;display:flex;justify-content:space-between;align-items:center;background:#0d1b2a}
.map-search-inline{display:flex;align-items:center;gap:6px;background:#0d1b2a;border:1px solid #2a3a4a;border-radius:4px;padding:2px 10px;margin-left:auto;pointer-events:auto;opacity:1}.map-search-inline:focus-within{border-color:#42a5f5}.map-search-input{background:transparent;border:none;color:#e0e0e0;font-size:11px;font-family:'Amazon Ember',Arial,sans-serif;width:200px;padding:3px 0;outline:none}.map-search-input::placeholder{color:#4a5a6a}.map-search-count{font-size:10px;color:#42a5f5;font-weight:bold;min-width:20px;text-align:center}.map-search-clear{background:none;border:none;color:#5a6a7a;cursor:pointer;font-size:12px;padding:2px 4px}.map-search-clear:hover{color:#fff}
.cvs{margin-right:320px;transition:margin-right .25s ease}
.cpt-countdown{font-size:9px;font-weight:bold;font-family:monospace;padding:1px 5px;border-radius:3px;white-space:nowrap;flex-shrink:0}.cpt-past{background:rgba(255,23,68,.2);color:#ff1744}.cpt-critical{background:rgba(255,23,68,.15);color:#ff5252;animation:pulse 1.5s ease-in-out infinite}.cpt-normal{background:rgba(255,153,0,.12);color:#ff9900}
.quicknav-overlay{position:fixed;inset:0;z-index:10001;display:flex;align-items:flex-start;justify-content:center;padding-top:20vh;background:rgba(0,0,0,0.5);backdrop-filter:blur(2px)}.quicknav-box{background:#111827;border:2px solid #ff9900;border-radius:10px;padding:16px 20px;width:360px;box-shadow:0 12px 40px rgba(0,0,0,0.7)}.quicknav-input{width:100%;background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:10px 14px;border-radius:6px;font-size:14px;font-family:'Amazon Ember',monospace;outline:none;text-transform:uppercase}.quicknav-input:focus{border-color:#ff9900}.quicknav-input::placeholder{color:#3a4a5a;text-transform:none}.quicknav-results{margin-top:8px;max-height:200px;overflow-y:auto}.quicknav-item{padding:6px 10px;border-radius:4px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px;color:#e0e0e0;transition:.1s}.quicknav-item:hover,.quicknav-item.active{background:rgba(255,153,0,.15)}.quicknav-item .qn-type{width:10px;height:10px;border-radius:2px;flex-shrink:0}.quicknav-item .qn-name{font-family:monospace;font-weight:bold;flex:1}.quicknav-hint{font-size:9px;color:#4a5a6a;margin-top:8px;text-align:center}
.minimap{position:absolute;bottom:52px;left:12px;border:1px solid #3a4a5a;border-radius:6px;overflow:hidden;background:#1a1a2e;box-shadow:0 4px 16px rgba(0,0,0,0.5);cursor:pointer;z-index:70;opacity:0.85;transition:opacity .2s}.minimap:hover{opacity:1;border-color:#ff9900}.minimap-hidden{display:none!important}
.sb-resize-handle{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:col-resize;z-index:61;background:transparent}.sb-resize-handle:hover,.sb-resize-handle.active{background:rgba(255,153,0,0.4)}
.sb-toggle-btn{position:absolute;z-index:91;cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;padding:0;background:#232f3e;color:#ff9900;border:1px solid #3a4a5a}
.dash-kpi-bar{display:none;position:absolute;top:0;left:0;right:0;z-index:80;background:rgba(22,33,62,0.92);backdrop-filter:blur(6px);border-bottom:1px solid #2a3a4a;padding:6px 16px}#app.dashboard-mode .dash-kpi-bar{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.dash-kpi{display:flex;flex-direction:column;align-items:center;min-width:50px}.dash-kpi-val{font-size:18px;font-weight:bold;font-family:'Amazon Ember',monospace;line-height:1.1}.dash-kpi-label{font-size:8px;color:#5a6a7a;text-transform:uppercase}.dash-kpi-sep{width:1px;height:28px;background:#2a3a4a;flex-shrink:0}.dash-shift-badge{background:#ff9900;color:#000;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:bold;margin-right:8px}.dash-time{font-size:10px;color:#5a6a7a;font-family:monospace;margin-left:auto}
.dash-fab-group{display:none}#app.dashboard-mode .dash-fab-group{display:block}
.dash-fab{position:absolute;z-index:90;border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;border:2px solid rgba(255,255,255,0.15);box-shadow:0 2px 12px rgba(0,0,0,0.5);transition:.2s;user-select:none}#dash-refresh{right:12px;top:64px;background:#1b5e20;color:#69f0ae}#dash-summary-fab{right:12px;top:116px;background:#0d47a1;color:#4fc3f7}#dash-zoom-fit{left:12px;bottom:54px;background:#232f3e;color:#8899aa}
.loads-sub-tabs{display:flex;border-bottom:1px solid #1a2a3a;background:rgba(0,0,0,.15)}
.loads-sub-tabs .dp-tab{flex:1;padding:5px 8px;font-size:10px;font-weight:bold;text-align:center;cursor:pointer;color:#5a6a7a;border-bottom:2px solid transparent;transition:.15s;display:flex;align-items:center;justify-content:center;gap:4px}
.loads-sub-tabs .dp-tab:hover{color:#8899aa;background:rgba(255,255,255,.02)}
.loads-sub-tabs .dp-tab.active{color:#ff9900;border-bottom-color:#ff9900}
.loads-sub-count{font-size:9px;font-weight:normal;opacity:.7;background:rgba(255,255,255,.08);padding:1px 5px;border-radius:8px;min-width:16px;text-align:center}
.loads-sub-count.has{background:rgba(255,153,0,.15);color:#ff9900}
.fmc-tour-item{padding:3px 8px;border-bottom:1px solid #0d1b2a;transition:.1s}
.fmc-tour-item:hover{background:rgba(255,255,255,.03)}
.fmc-tour-header{display:flex;align-items:center;gap:6px;min-height:20px;cursor:pointer}
.fmc-tour-header:hover{background:rgba(255,153,0,.05)}
.fmc-tour-route{font-size:10px;font-weight:bold;color:#e0e0e0;font-family:'Amazon Ember',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.fmc-tour-status{font-size:8px;font-weight:bold;padding:1px 5px;border-radius:3px;display:inline-block;white-space:nowrap;flex-shrink:0}
.fmc-tour-time{font-size:10px;color:#8899aa;white-space:nowrap;flex-shrink:0;font-family:monospace}
.fmc-tour-carrier{font-size:9px;color:#546E7A;flex-shrink:0;max-width:50px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fmc-tour-delay{font-size:9px;font-weight:bold;color:#ff5252;flex-shrink:0}
.fmc-tour-dwell{font-size:9px;font-family:monospace;flex-shrink:0}
.fmc-tour-detail{padding:4px 8px 6px 16px;font-size:10px;color:#78909C;border-bottom:1px solid rgba(255,255,255,.02);display:none}
.fmc-tour-item.expanded .fmc-tour-detail{display:block}
.fmc-tour-detail-row{display:flex;gap:8px;margin-bottom:2px}
.fmc-tour-detail-label{color:#5a6a7a;min-width:60px;text-align:right}
.fmc-tour-detail-val{color:#b0bec5;font-family:monospace}
.summary-card.full-width{grid-column:1/-1}
.congestion-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.other-cpt-section{border-top:2px solid #2a3a4a;margin-top:4px}
.other-cpt-header{padding:8px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,.2);transition:.15s;font-size:11px;color:#8899aa}
.other-cpt-header:hover{background:rgba(255,153,0,.08);color:#e0e0e0}
.other-cpt-header b{color:#ff9900}
.other-cpt-count{background:#ff9900;color:#000;font-size:10px;font-weight:bold;padding:1px 8px;border-radius:10px}
.other-cpt-body{background:rgba(0,0,0,.1)}
.vista-total-row td{border-top:2px solid #ff9900;font-weight:bold;color:#ff9900;padding:6px 8px}
.dr-cpt-row{display:flex;flex-wrap:wrap;gap:2px;margin-top:2px}
.dr-cpt-badge{display:inline-flex;align-items:center;gap:3px;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:bold;font-family:'Amazon Ember',monospace;background:rgba(255,153,0,.12);color:#ff9900;white-space:nowrap;letter-spacing:.2px}
.dr-cpt-cnt{color:#8899aa;font-weight:normal}
.collapse-icon{font-size:10px;color:#5a6a7a;margin-right:4px;display:inline-block;width:12px}
.section-toggle{cursor:pointer;user-select:none}
.section-toggle:hover{opacity:.8}
.handover-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px)}
.handover-panel{background:#111827;border:2px solid #ff9900;border-radius:12px;width:90vw;max-width:800px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.8)}
.handover-hdr{padding:12px 20px;display:flex;justify-content:space-between;align-items:center;background:#1a2236;border-bottom:2px solid #ff9900}
.handover-hdr h2{font-size:16px;color:#ff9900;margin:0}
.handover-body{flex:1;overflow-y:auto;padding:16px 20px}
.handover-section{margin-bottom:20px}
.handover-section h3{font-size:12px;color:#ff9900;text-transform:uppercase;letter-spacing:.5px;margin:0 0 10px 0;padding-bottom:6px;border-bottom:1px solid #2a3a4a;display:flex;align-items:center;gap:8px}
.handover-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;margin-bottom:12px}
.handover-card{background:#1a2236;border:1px solid #2a3a4a;border-radius:8px;padding:10px;text-align:center}
.handover-card-val{font-size:24px;font-weight:bold;font-family:monospace;line-height:1.2}
.handover-card-label{font-size:9px;color:#5a6a7a;text-transform:uppercase;letter-spacing:.3px}
.handover-loc-table{width:100%;border-collapse:collapse;font-size:11px}
.handover-loc-table th{text-align:left;font-size:9px;color:#5a6a7a;text-transform:uppercase;padding:6px 10px;border-bottom:2px solid #2a3a4a;background:#0d1b2a;position:sticky;top:0}
.handover-loc-table td{padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.03)}
.handover-loc-table tr:hover{background:rgba(255,255,255,.03)}
.handover-type-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold;margin:2px}
.handover-footer{padding:8px 20px;border-top:1px solid #2a3a4a;display:flex;justify-content:space-between;align-items:center;background:#0d1b2a}
.maps-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding-top:60px;background:rgba(0,0,0,0.5);backdrop-filter:blur(2px)}
.maps-panel{background:#111827;border:2px solid #ff9900;border-radius:12px;width:480px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.7)}
.maps-hdr{padding:10px 16px;display:flex;justify-content:space-between;align-items:center;background:#1a2236;border-bottom:2px solid #ff9900}
.maps-hdr h2{font-size:14px;color:#ff9900;margin:0;display:flex;align-items:center;gap:8px}
.maps-body{flex:1;overflow-y:auto;padding:0}
.maps-section{padding:12px 16px;border-bottom:1px solid #2a3a4a}
.maps-section h3{font-size:11px;color:#ff9900;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px 0;display:flex;align-items:center;gap:6px}
.maps-current{display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(255,153,0,.08);border-radius:6px;margin-bottom:8px}
.maps-current-site{font-size:18px;font-weight:bold;color:#ff9900;font-family:'Amazon Ember',monospace}
.maps-current-info{font-size:11px;color:#8899aa}
.maps-gh-row{display:flex;gap:6px;align-items:center;margin-bottom:8px}
.maps-gh-input{flex:1;background:#0d1b2a;color:#ff9900;border:1px solid #2a3a4a;padding:6px 10px;border-radius:6px;font-size:13px;font-family:'Amazon Ember',monospace;text-transform:uppercase;font-weight:bold}
.maps-gh-input:focus{outline:none;border-color:#ff9900}
.maps-gh-input::placeholder{color:#3a4a5a;text-transform:none;font-weight:normal}
.maps-status{font-size:11px;padding:6px 10px;border-radius:6px;margin-top:6px;display:none}
.maps-status.show{display:block}
.maps-status.ok{background:rgba(105,240,174,.1);color:#69f0ae;border:1px solid rgba(105,240,174,.2)}
.maps-status.err{background:rgba(255,82,82,.1);color:#ff5252;border:1px solid rgba(255,82,82,.2)}
.maps-status.info{background:rgba(79,195,247,.1);color:#4fc3f7;border:1px solid rgba(79,195,247,.2)}
.maps-status.loading{background:rgba(255,153,0,.1);color:#ff9900;border:1px solid rgba(255,153,0,.2)}
.maps-preview{background:#0d1b2a;border:1px solid #2a3a4a;border-radius:6px;padding:10px 12px;margin-top:8px;display:none}
.maps-preview.show{display:block}
.maps-preview-row{display:flex;justify-content:space-between;font-size:11px;color:#8899aa;padding:2px 0}
.maps-preview-row b{color:#e0e0e0}
.maps-preview-actions{display:flex;gap:6px;margin-top:8px}
.maps-snap-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;margin-bottom:4px;background:rgba(0,0,0,.2);transition:.15s}
.maps-snap-item:hover{background:rgba(255,153,0,.08)}
.maps-snap-icon{font-size:16px;flex-shrink:0}
.maps-snap-info{flex:1;min-width:0}
.maps-snap-label{font-size:12px;font-weight:bold;color:#e0e0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.maps-snap-meta{font-size:9px;color:#5a6a7a;display:flex;gap:8px}
.maps-snap-actions{display:flex;gap:4px;flex-shrink:0}
.maps-save-row{display:flex;gap:6px;margin-top:8px}
.maps-save-input{flex:1;background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:5px 8px;border-radius:4px;font-size:11px}
.maps-save-input:focus{outline:none;border-color:#ff9900}
.maps-save-input::placeholder{color:#3a4a5a}
.maps-empty{font-size:11px;color:#5a6a7a;font-style:italic;text-align:center;padding:12px}
.maps-footer{padding:8px 16px;border-top:1px solid #2a3a4a;display:flex;justify-content:space-between;align-items:center;background:#0d1b2a;font-size:9px;color:#5a6a7a}
.focus-bar{display:none;padding:4px 10px;border-bottom:1px solid #1a2a3a;background:rgba(255,107,107,.06);gap:6px;flex-wrap:wrap;align-items:center}
.focus-bar.active{display:flex}
.focus-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:bold;font-family:'Amazon Ember',monospace;cursor:default;white-space:nowrap;transition:.15s}
.focus-chip .fc-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.focus-chip .fc-cnt{font-weight:normal;opacity:.7;font-size:9px}
.focus-chip .fc-close{cursor:pointer;opacity:.5;font-size:11px;margin-left:2px;padding:0 2px;border-radius:2px}.focus-chip .fc-close:hover{opacity:1;background:rgba(255,255,255,.15)}
.focus-clear{background:none;border:1px solid #5a6a7a;color:#8899aa;padding:2px 8px;border-radius:12px;font-size:10px;cursor:pointer;white-space:nowrap;transition:.15s}.focus-clear:hover{border-color:#ff5252;color:#ff5252}
.focus-label{font-size:10px;color:#ff9900;font-weight:bold;flex-shrink:0}
.load-focus-btn{background:none;border:none;font-size:11px;cursor:pointer;padding:1px 4px;border-radius:3px;flex-shrink:0;opacity:.3;transition:.15s;line-height:1}.load-focus-btn:hover{opacity:.8}.load-focus-btn.focused{opacity:1}

        `);

        document.body.innerHTML = `<div id="app"><div class="hdr"><h1>🚢 Ship Map — <input id="node-input" value="${CONFIG.warehouseId}" readonly maxlength="6" spellcheck="false"></h1><div style="display:flex;align-items:center;gap:12px"><button class="btn" id="b-maps" style="background:#0d47a1;border-color:#42a5f5;color:#42a5f5">🗺️ Maps</button>
<button class="btn" id="b-dashboard">📺 Dashboard</button><button class="btn" id="b-summary" style="background:#0d47a1;border-color:#4fc3f7;color:#4fc3f7">📊 Summary</button><button class="btn" id="b-trend">📈 Trend</button><button class="btn" id="b-handover" style="background:#1b5e20;border-color:#4caf50;color:#69f0ae">📋 Handover</button><button class="btn" id="b-debug" title="Debug">\uD83D\uDC1B Debug</button>

<button class="btn" id="b-exp">📤 Export</button><button class="btn" id="b-imp">📥 Import</button><button class="btn green" id="b-merge">📥+ Merge</button><button class="btn del" id="b-clr">🧹 Clear</button><div class="edit-toggle locked" id="edit-toggle"><span class="lock-icon">🔒</span><div class="switch"></div><span class="lock-label">LOCKED</span></div></div></div>

<div class="tb locked" id="toolbar"><div class="tb-edit-group"><button class="btn on" data-m="select">🖱️</button><button class="btn" data-m="add">➕</button><button class="btn del" data-m="delete">🗑️</button><div class="sep"></div><label style="font-size:11px;color:#8899aa">Type:</label><select class="tsel" id="sel-type"></select><div class="sep"></div><button class="btn" id="b-zi">🔍+</button><button class="btn" id="b-zo">🔍−</button><button class="btn" id="b-rv">↻</button><div class="sep"></div><label style="font-size:11px;color:#8899aa"><input type="checkbox" id="chk-snap" checked> Snap</label></div><button class="btn" id="b-minimap">🗺️</button><div class="map-search-inline"><span style="font-size:12px">🔍</span><input class="map-search-input" id="map-search-input" placeholder="Search map..." spellcheck="false"><span class="map-search-count" id="map-search-count"></span><button class="map-search-clear" id="map-search-clear">✕</button></div></div>
<div class="main"><div class="cvs" id="cvs"></div>
<div class="dash-kpi-bar" id="dash-kpi-bar"></div>
<div class="dash-fab-group"><div class="dash-fab" id="dash-refresh">🔄</div><div class="dash-fab" id="dash-summary-fab">📊</div><div class="dash-fab" id="dash-zoom-fit">🔲</div></div>
<button class="sb-toggle-btn" id="sb-toggle">◀</button>
<div class="drawer-wrap" id="drawer-wrap"><div class="drawer"><div class="drawer-hdr"><h3>📦 Containers</h3><div style="display:flex;gap:4px"><button class="btn sm" id="drawer-print" title="Print">\uD83D\uDDA8</button><button class="drawer-close" id="drawer-close">✕</button></div></div>

<div class="drawer-route" id="drawer-route"></div><div class="drawer-summary" id="drawer-summary"></div><div class="drawer-sort" id="drawer-sort"></div><div class="route-filter-wrap"><span style="font-size:11px;color:#5a6a7a">🔍</span><input class="route-filter" id="drawer-search" placeholder="Search locations..." spellcheck="false"><button class="route-filter-clear" id="drawer-search-clear">✕</button></div><div class="drawer-body" id="drawer-body"></div></div></div>
<div class="sb"><div class="sb-resize-handle" id="sb-resize"></div><div class="dp" id="dp">
<div class="dp-tabs"><div class="dp-tab active" data-tab="loads">📡 Loads</div><div class="dp-tab" data-tab="yms">🏗️ YMS</div><div class="dp-tab" data-tab="vista">📦 Vista</div><div class="dp-tab" data-tab="fmc">🚛 FMC</div></div>
<div id="tab-loads">
    <div class="dp-hdr"><h3 id="dp-meta">Click 🔄</h3><div style="display:flex;gap:4px"><button class="btn sm" id="b-settings">⚙️</button><button class="btn sm" id="b-refresh">🔄</button></div></div>
    <div class="loads-sub-tabs" id="loads-sub-tabs">
        <div class="dp-tab active" data-ltab="ob">📤 OB <span class="loads-sub-count" id="lsc-ob">0</span></div>
        <div class="dp-tab" data-ltab="noninv">🔀 NonInv <span class="loads-sub-count" id="lsc-noninv">0</span></div>
        <div class="dp-tab" data-ltab="ib">📥 IB <span class="loads-sub-count" id="lsc-ib">0</span></div>
</div>
<div class="focus-bar" id="focus-bar"></div>
<div id="loads-ob-filters" class="load-filters-bar">
        <label class="load-filter-toggle"><input type="checkbox" id="chk-hide-old" checked>⏰ Hide old DEP 1h+</label>
        <span class="load-filter-counts" id="load-filter-counts"></span>
    </div>
    <div id="settings-wrap"></div>
    <div class="route-filter-wrap"><span style="font-size:11px;color:#5a6a7a">🔍</span><input class="route-filter" id="route-filter" placeholder="Filter..." spellcheck="false"><button class="route-filter-clear" id="route-filter-clear">✕</button></div>
    <div class="dp-list" id="dp-list"><div class="dp-empty">No data</div></div>
</div>
<div id="tab-yms" class="collapsed"><div class="dp-hdr"><h3 id="yms-meta">YMS</h3><div style="display:flex;gap:4px"><button class="btn sm cyan" id="b-yms-token">🔑</button><button class="btn sm" id="b-yms-refresh">🔄</button></div></div><div id="yms-token-bar" class="collapsed" style="padding:4px 10px;border-bottom:1px solid #1a2a3a;background:rgba(0,0,0,.2)"><div style="display:flex;gap:4px"><input id="yms-token-input" style="flex:1;background:#0d1b2a;color:#69f0ae;border:1px solid #2a3a4a;padding:4px 8px;border-radius:4px;font-size:10px;font-family:monospace" placeholder="eyJhbGci..." spellcheck="false"><button class="btn sm green" id="b-yms-token-apply">✓</button></div></div><div class="dp-list" id="yms-report-list"><div class="dp-empty">🔑 Paste YMS token to start</div></div></div>
<div id="tab-vista" class="collapsed"><div class="dp-hdr"><h3 id="vista-meta">Vista</h3><div style="display:flex;gap:4px;align-items:center"><label style="font-size:9px;color:#5a6a7a;display:flex;align-items:center;gap:3px"><input type="checkbox" id="vista-toggle" checked style="accent-color:#ff9900"> Overlay</label><button class="btn sm" id="b-vista-refresh">🔄</button></div></div><div style="display:flex;border-bottom:1px solid #1a2a3a"><div class="dp-tab active" data-vtab="locations" style="flex:1;padding:4px 8px;font-size:10px">📍 Locations</div><div class="dp-tab" data-vtab="routes" style="flex:1;padding:4px 8px;font-size:10px">🚛 Routes</div></div><div class="route-filter-wrap" style="border-bottom:1px solid #1a2a3a"><span style="font-size:11px;color:#5a6a7a">🔍</span><input class="route-filter" id="vista-search" placeholder="Search locations / routes..." spellcheck="false"><button class="route-filter-clear" id="vista-search-clear">✕</button></div><div class="dp-list" id="vista-list"><div class="dp-empty">Click 🔄</div></div><div class="dp-list" id="vista-routes-list" style="display:none"><div class="dp-empty">Click 🔄</div></div></div>
<div id="tab-fmc" class="collapsed"><div class="dp-hdr"><h3 id="fmc-meta">FMC</h3><button class="btn sm" id="b-fmc-refresh">🔄</button></div><div class="dp-list" id="fmc-list"><div class="dp-empty">🚛 FMC loading...</div></div></div>
</div>
<div class="sb-scroll"><div class="sbs" id="legend-section"><h3 class="section-toggle" id="legend-toggle"><span><span class="collapse-icon" id="legend-chevron">▼</span>Legend</span><button class="btn sm" id="b-type-edit" style="display:none">✏️</button></h3><div id="legend-body"><div id="legend"></div><div id="type-editor-wrap"></div></div></div><div class="sbs"><h3>Inspector</h3><div id="insp"><div class="ie">Select element(s)...</div></div></div><div class="sbs" style="flex-shrink:0"><h3 class="section-toggle" id="elements-toggle"><span><span class="collapse-icon" id="elements-chevron">▼</span>Elements (<span id="elcnt">0</span>)</span><button class="btn sm del" id="b-del-selected" style="display:none">🗑️</button></h3></div><div id="elist-body"><div class="elist" id="elist"></div></div><div class="keys"><kbd>S</kbd>Sel <kbd>A</kbd>Add <kbd>D</kbd>Del <kbd>Ctrl+G</kbd>GoTo <kbd>Alt+Drag</kbd>Pan</div>
</div></div></div>
<div class="sbar"><span id="status">Ready</span><span id="coords">x:0 y:0</span></div></div>`;

        this._initLegend(); this._initType(); this._initToolbar(); this._initEditToggle();
        this._initNodeInput(); this._initDataPanel(); this._initFavicon();
                this._initTypeEditor(); this._initSettings();
        this._initRouteFilter(); this._initCollapsible(); this._initTabs();
        this._initLoadsSubTabs();
                this._initVistaSubTabs();
        this._initMapSearch(); this._initSidebarResize(); this._initDashboard();
        this._initDrawerSearch();
    },

    _initFavicon() { const link = document.querySelector("link[rel*='icon']") || document.createElement('link'); link.type='image/svg+xml'; link.rel='icon'; link.href='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🚢</text></svg>'; document.head.appendChild(link); document.title = `Ship Map — ${CONFIG.warehouseId}`; },
    _initNodeInput() { const inp=document.getElementById('node-input'); inp.addEventListener('change',()=>{const val=inp.value.trim().toUpperCase();if(!val){inp.value=CONFIG.warehouseId;return;}CONFIG.warehouseId=val;GM_setValue(CONFIG.storage.nodeIdKey,val);inp.value=val;document.title=`Ship Map — ${val}`;State.sspLoads=[];State.clearHighlight();this.closeDrawer();this.updateDataPanel();SSP.startAutoRefresh();if(YMS._token)YMS.startAutoRefresh();VISTA.startAutoRefresh();}); inp.addEventListener('keydown',(e)=>{if(e.key==='Enter')inp.blur();e.stopPropagation();}); },
    _initLegend() { document.getElementById('legend').innerHTML = Object.entries(ELEMENT_TYPES).map(([k, t]) => `<div class="leg"><div class="lsw" style="background:${t.color}"></div><span>${t.label}</span></div>`).join(''); },
    _initCollapsible() {
        const setup = (tid, cid, bid, sk, stk) => {
            const t = document.getElementById(tid);
            const ch = document.getElementById(cid);
            const b = document.getElementById(bid);
            if (!t || !ch || !b) return;
            if (State[sk]) {
                b.style.display = 'none';
                ch.textContent = '▶';
            }
            t.style.cursor = 'pointer';
            t.style.userSelect = 'none';
            t.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                State[sk] = !State[sk];
                b.style.display = State[sk] ? 'none' : '';
                ch.textContent = State[sk] ? '▶' : '▼';
                GM_setValue(stk, State[sk]);
            });
        };
        setup('legend-toggle', 'legend-chevron', 'legend-body', 'legendCollapsed', CONFIG.storage.legendCollapsedKey);
        setup('elements-toggle', 'elements-chevron', 'elist-body', 'elementsCollapsed', CONFIG.storage.elementsCollapsedKey);
    },


    _initTabs() { document.querySelectorAll('.dp-tab[data-tab]').forEach(tab => { tab.addEventListener('click', () => { State.activeTab = tab.dataset.tab; document.querySelectorAll('.dp-tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === State.activeTab)); document.getElementById('tab-loads').classList.toggle('collapsed', State.activeTab !== 'loads'); document.getElementById('tab-yms').classList.toggle('collapsed', State.activeTab !== 'yms'); document.getElementById('tab-vista').classList.toggle('collapsed', State.activeTab !== 'vista'); document.getElementById('tab-fmc').classList.toggle('collapsed', State.activeTab !== 'fmc'); }); }); },
    _initLoadsSubTabs() {
        document.querySelectorAll('[data-ltab]').forEach(tab => {
            tab.addEventListener('click', () => {
                State.loadsSubTab = tab.dataset.ltab;
                document.querySelectorAll('[data-ltab]').forEach(t => t.classList.toggle('active', t.dataset.ltab === State.loadsSubTab));
                const obFilters = document.getElementById('loads-ob-filters');
                if (obFilters) obFilters.style.display = State.loadsSubTab === 'ob' ? '' : 'none';
                this.updateDataPanel();
            });
        });
    },
    _initMapSearch() { const inp = document.getElementById('map-search-input'), count = document.getElementById('map-search-count'), clear = document.getElementById('map-search-clear'); let db = null; inp.addEventListener('input', () => { clearTimeout(db); db = setTimeout(() => { State.updateMapSearch(inp.value); count.textContent = State.mapSearch ? `${State.mapSearchMatches.size}` : ''; }, 200); }); inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { inp.value = ''; State.updateMapSearch(''); count.textContent = ''; inp.blur(); } }); clear.onclick = () => { inp.value = ''; State.updateMapSearch(''); count.textContent = ''; }; },
    _initDrawerSearch() { const inp = document.getElementById('drawer-search'); const clear = document.getElementById('drawer-search-clear'); let db = null; inp.addEventListener('input', () => { clearTimeout(db); db = setTimeout(() => { this._drawerSearch = inp.value.trim().toUpperCase(); const load = State.sspLoads[State.drawerLoadIdx]; if (load) this._renderDrawer(load); }, 150); }); inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { inp.value = ''; this._drawerSearch = ''; const load = State.sspLoads[State.drawerLoadIdx]; if (load) this._renderDrawer(load); inp.blur(); } }); clear.onclick = () => { inp.value = ''; this._drawerSearch = ''; const load = State.sspLoads[State.drawerLoadIdx]; if (load) this._renderDrawer(load); }; },
    _initRouteFilter() { const inp=document.getElementById('route-filter'),clear=document.getElementById('route-filter-clear'); let db=null; inp.addEventListener('input',()=>{clearTimeout(db);db=setTimeout(()=>{State.routeFilter=inp.value.trim().toUpperCase();this.updateDataPanel();},150);}); inp.addEventListener('keydown',(e)=>{e.stopPropagation();if(e.key==='Escape'){inp.value='';State.routeFilter='';this.updateDataPanel();inp.blur();}}); clear.onclick=()=>{inp.value='';State.routeFilter='';this.updateDataPanel();}; },
    _initType() { const s=document.getElementById('sel-type'),prev=s.value; s.innerHTML=Object.entries(ELEMENT_TYPES).map(([k,t])=>`<option value="${k}" ${k===State.selectedType?'selected':''}>${t.label}</option>`).join(''); if(ELEMENT_TYPES[prev])s.value=prev; s.onchange=e=>{State.selectedType=e.target.value;}; },
    _initEditToggle() { document.getElementById('edit-toggle').onclick=()=>{State.editMode=!State.editMode;State.saveEditMode();this._updateEditMode();R.render();}; this._updateEditMode(); },
    _updateEditMode() { const t=document.getElementById('edit-toggle'),tb=document.getElementById('toolbar'),ni=document.getElementById('node-input'),te=document.getElementById('b-type-edit'); if(State.editMode){t.className='edit-toggle unlocked';t.querySelector('.lock-icon').textContent='🔓';t.querySelector('.lock-label').textContent='EDIT';tb.classList.remove('locked');ni.removeAttribute('readonly');te.style.display='inline-block';}else{t.className='edit-toggle locked';t.querySelector('.lock-icon').textContent='🔒';t.querySelector('.lock-label').textContent='LOCKED';tb.classList.add('locked');ni.setAttribute('readonly',true);te.style.display='none';State.bgEditMode=false;State.mode=MODE.SELECT;this.updateToolbar();} },
    updateToolbar() { document.querySelectorAll('[data-m]').forEach(b=>b.classList.toggle('on',b.dataset.m===State.mode)); },
    setStatus(m) { const e=document.getElementById('status'); if(e)e.textContent=m; },
    setCoords(x,y) { const e=document.getElementById('coords'); if(e)e.textContent=`x:${x} y:${y} | ${Math.round(State.scale*100)}%`; },

    _initToolbar() {
        document.querySelectorAll('[data-m]').forEach(b=>{b.onclick=()=>{if(!State.editMode)return;State.mode=b.dataset.m;this.updateToolbar();R.canvas.style.cursor=State.mode===MODE.ADD?'crosshair':State.mode===MODE.DELETE?'not-allowed':'default';R.render();};});
        document.getElementById('b-zi').onclick=()=>{State.scale=Math.min(8,State.scale*1.25);State.saveViewport();R.render();};
        document.getElementById('b-zo').onclick=()=>{State.scale=Math.max(0.2,State.scale*0.8);State.saveViewport();R.render();};
        document.getElementById('b-rv').onclick=()=>{State.scale=1;State.offsetX=0;State.offsetY=0;State.saveViewport();R.render();};
                document.getElementById('b-debug')?.addEventListener('click', () => this.openDebug());

        document.getElementById('b-minimap')?.addEventListener('click',()=>{Minimap.toggle();});
        document.getElementById('chk-snap').onchange=e=>{CONFIG.grid.snapToGrid=e.target.checked;};
        document.getElementById('b-exp').onclick=()=>{const b=new Blob([State.exportJSON()],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`shipmap_${CONFIG.warehouseId}_${new Date().toISOString().slice(0,10)}.json`;a.click();};
        document.getElementById('b-imp').onclick=()=>{if(!State.editMode)return;const inp=document.createElement('input');inp.type='file';inp.accept='.json';inp.onchange=e=>{const r=new FileReader();r.onload=ev=>{if(State.importJSON(ev.target.result)){this.refreshList();R.render();}};r.readAsText(e.target.files[0]);};inp.click();};
        document.getElementById('b-merge').onclick=()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.json';inp.onchange=e=>{const r=new FileReader();r.onload=ev=>{const result=State.mergeJSON(ev.target.result);if(result){UI._initLegend();UI._initType();UI.refreshList();R.render();}};r.readAsText(e.target.files[0]);};inp.click();};
        document.getElementById('b-clr').onclick=()=>{if(!State.editMode)return;if(confirm('Clear all?')){State.clearAll();this.clearInspector();this.refreshList();R.render();}};
        document.getElementById('b-summary').onclick = () => this.openSummary();
        document.getElementById('b-dashboard').onclick = () => this.toggleDashboard();
                document.getElementById('b-trend')?.addEventListener('click', () => this.openTrend());
        document.getElementById('b-handover')?.addEventListener('click', () => this.openHandover());
        document.getElementById('b-maps')?.addEventListener('click', () => this.openMapsMenu());

    },
    _initVistaSubTabs() {
        document.querySelectorAll('[data-vtab]').forEach(tab => {
            tab.addEventListener('click', () => {
                this._vistaSubTab = tab.dataset.vtab;
                document.querySelectorAll('[data-vtab]').forEach(t => t.classList.toggle('active', t.dataset.vtab === this._vistaSubTab));
                document.getElementById('vista-list').style.display = this._vistaSubTab === 'locations' ? '' : 'none';
                document.getElementById('vista-routes-list').style.display = this._vistaSubTab === 'routes' ? '' : 'none';
            });
        });
        var inp = document.getElementById('vista-search');
        var clear = document.getElementById('vista-search-clear');
        var self = this;
        var db = null;
        inp.addEventListener('input', function() { clearTimeout(db); db = setTimeout(function() { self._vistaSearch = inp.value.trim().toUpperCase(); self.updateVistaPanel(); self.updateVistaRoutesPanel(); }, 150); });
        inp.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Escape') { inp.value = ''; self._vistaSearch = ''; self.updateVistaPanel(); self.updateVistaRoutesPanel(); inp.blur(); } });
        clear.onclick = function() { inp.value = ''; self._vistaSearch = ''; self.updateVistaPanel(); self.updateVistaRoutesPanel(); };
    },
    _renderFocusBar() {
        const bar = document.getElementById('focus-bar');
        if (!bar) return;

        if (!State.focusRoutes.size) {
            bar.classList.remove('active');
            bar.innerHTML = '';
            return;
        }

        bar.classList.add('active');

        // Count Vista containers per focused route
        const routeStats = {};
        for (const [gKey, fr] of State.focusRoutes) {
            routeStats[gKey] = { color: fr.color, count: 0, pkgs: 0 };
        }
        for (const c of State.vistaContainers) {
            if (c._state === 'Loaded') continue;
            if (!c.route) continue;
            const gKey = routeGroupKey(c.route);
            if (routeStats[gKey]) {
                routeStats[gKey].count++;
                routeStats[gKey].pkgs += c.childCount || 0;
            }
        }

        const chips = [];
        for (const [gKey, st] of Object.entries(routeStats)) {
            chips.push(
                `<span class="focus-chip" style="background:${st.color}18;border:1px solid ${st.color}55;color:${st.color}" data-focus-route="${gKey}">`
                + `<span class="fc-dot" style="background:${st.color}"></span>`
                + `${gKey}`
                + `<span class="fc-cnt">×${st.count}</span>`
                + `<span class="fc-close" data-focus-remove="${gKey}">✕</span>`
                + `</span>`
            );
        }

        const totalCnt = Object.values(routeStats).reduce((s, r) => s + r.count, 0);

        bar.innerHTML = `<span class="focus-label">🎯 FOCUS</span>`
            + chips.join('')
            + `<span style="font-size:9px;color:#5a6a7a;margin-left:auto">${totalCnt} cnt</span>`
            + `<button class="focus-clear" id="focus-clear-all">✕ Clear</button>`;

        // Bind chip remove
        bar.querySelectorAll('[data-focus-remove]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                State.toggleFocusRoute(btn.dataset.focusRemove);
                this._renderFocusBar();
                this.updateDataPanel();
                R.render();
            });
        });

        // Bind clear all
        document.getElementById('focus-clear-all')?.addEventListener('click', () => {
            State.clearFocus();
            this._renderFocusBar();
            this.updateDataPanel();
            R.render();
        });
    },

    _initDataPanel() {
        document.getElementById('b-refresh').onclick=()=>{ SSP.fetchData(); if(YMS._token) YMS.fetchData(); VISTA.fetchData(); FMC.fetchData(); };
        document.getElementById('b-yms-refresh').onclick=()=>{ if(YMS._token) YMS.fetchData(); };
        document.getElementById('drawer-close').onclick=()=>this.closeDrawer();
                document.getElementById('drawer-print')?.addEventListener('click', () => this.printStages());

        document.getElementById('b-yms-token').onclick=()=>{ document.getElementById('yms-token-bar').classList.toggle('collapsed'); };
        document.getElementById('b-yms-token-apply').onclick=()=>{ const inp=document.getElementById('yms-token-input'); const tok=inp.value.trim(); if(tok){ YMS.setManualToken(tok); inp.value=''; document.getElementById('yms-token-bar').classList.add('collapsed'); } };
        document.getElementById('yms-token-input').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') document.getElementById('b-yms-token-apply').click(); });
        document.getElementById('chk-hide-old').onchange=(e)=>{State.hideOldDeparted=e.target.checked;this.updateDataPanel();};
        document.getElementById('b-vista-refresh').onclick = () => VISTA.fetchData();
        document.getElementById('vista-toggle').onchange = (e) => { State.vistaEnabled = e.target.checked; R.render(); };
        document.getElementById('b-fmc-refresh')?.addEventListener('click', () => FMC.fetchData());

        // SSP load item clicks (OB tab only)
        document.getElementById('dp-list').addEventListener('click', (e) => {
            if (State.loadsSubTab !== 'ob') return;
            const hdr = e.target.closest('.load-header');
            if (!hdr) return;
            const item = hdr.closest('.load-item');
            if (!item || !item.dataset.loadIdx) return;
            const idx = parseInt(item.dataset.loadIdx);
            const load = State.sspLoads[idx];
            if (!load) return;
            if (load._expanded) {
                load._expanded = false; State.clearHighlight(); this.closeDrawer(); this.updateDataPanel(); R.render();
            } else {
                State.sspLoads.forEach((l, i) => { if (i !== idx && l._expanded) l._expanded = false; });
                State.clearHighlight();
                if (!load._containers) SSP.fetchContainerDetails(load, idx);
                else { load._expanded = true; State.setHighlight(idx); this.openDrawer(idx); this.updateDataPanel(); R.render(); }
            }
        });

        // YMS token pickup
        const decodeJwtPayload = (tok) => { const b64 = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(b64)); };
        const pickupToken = () => {
            const wh = CONFIG.warehouseId.toUpperCase(); const siteKey = `yms_token_${wh}`;
            const tok = GM_getValue(siteKey, null) || GM_getValue('yms_token', null);
            if (!tok) return false;
            try { const p = decodeJwtPayload(tok); if (p.iss !== 'YMS-1.0') return false; if (!p.exp || p.exp < Date.now() / 1000 + 60) return false; const tokenYard = p.context?.yard?.toUpperCase(); if (tokenYard && tokenYard !== wh) return false; if (YMS._token !== tok) { YMS._setToken(tok); if (!State.ymsAutoTimer) YMS.startAutoRefresh(); } return true; } catch { return false; }
        };
        if (!pickupToken()) YMS.autoFetchToken();
        Lifecycle.register('yms-token-pickup', pickupToken, CONFIG.data.ymsTokenPickupInterval);
        SSP.startAutoRefresh();
        if (YMS._token) YMS.startAutoRefresh();
        VISTA.startAutoRefresh();
        setTimeout(() => FMC.start(), 8000);
        setTimeout(() => Dockmaster.start(), 8000);
              setTimeout(() => RELAT.start(), 10000);
        Lifecycle.register('ui-panel-refresh', () => { if (State.sspLoads.length) this.updateDataPanel(); }, CONFIG.data.uiRefreshInterval);
        Trend.start();
    },  // ← ZAMKNIĘCIE _initDataPanel — PRZECINEK

    // ═══════════════════════════════════════════════════
    //  DM APPOINTMENT RENDERER
    // ═══════════════════════════════════════════════════
    _renderYmsOrphanItem(yo) {
        var dwellStr = yo.arrivalEpoch ? dwellFromEpoch(yo.arrivalEpoch) : '';
        var dwMin = yo.arrivalEpoch ? Math.round((Date.now() / 1000 - yo.arrivalEpoch) / 60) : 0;
        var dwColor = dwMin > 1440 ? '#ff1744' : (dwMin > 480 ? '#ff5252' : (dwMin > 120 ? '#ff9100' : '#ffd600'));

        var eqShort = equipTypeShort(yo.equipType);
        var eqColor = equipTypeColor(yo.equipType);

        var statusColor = yo.status === 'FULL' ? '#ffd600' : (yo.status === 'IN_PROGRESS' ? '#69f0ae' : '#4fc3f7');

        var routeStr = yo.routes.length ? yo.routes.join(', ') : yo.lane || '';

        // Parse cart count from annotation if available
        var cartCount = '';
        if (yo.annotation) {
            var cm = yo.annotation.match(/(\d+)\s*szt/i);
            if (cm) cartCount = cm[1] + ' szt';
        }

        var detailRows = '';
        detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Location</span><span class="fmc-tour-detail-val" style="color:#e040fb;font-weight:bold">' + yo.locationCode + '</span></div>';
        if (yo.vrId) detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">VR ID</span><span class="fmc-tour-detail-val" style="color:#4fc3f7;cursor:pointer" data-copy="' + yo.vrId + '">' + yo.vrId + '</span></div>';
        detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Plate</span><span class="fmc-tour-detail-val">' + yo.plate + '</span></div>';
        detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Owner</span><span class="fmc-tour-detail-val">' + yo.owner + '</span></div>';
        detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Shipper</span><span class="fmc-tour-detail-val" style="color:#ff9900">' + yo.shipperLabel + '</span></div>';
        detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Equipment</span><span class="fmc-tour-detail-val">' + yo.equipType + '</span></div>';
        if (routeStr) detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Route</span><span class="fmc-tour-detail-val">' + routeStr + '</span></div>';
        if (yo.annotation) detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Note</span><span class="fmc-tour-detail-val" style="color:#78909C">' + yo.annotation + '</span></div>';
        if (dwellStr) detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">On yard</span><span class="fmc-tour-detail-val" style="color:' + dwColor + ';font-weight:bold">' + dwellStr + '</span></div>';
        detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Source</span><span class="fmc-tour-detail-val" style="color:#ff1744">\u26A0 Not in FMC — YMS only</span></div>';

        var displayName = yo.shipperLabel.replace(/Transfers/g, '').replace(/Empty/g, '∅');
        if (cartCount) displayName += ' · ' + cartCount;

        return '<div class="fmc-tour-item yms-orphan-item" data-orphan-loc="' + yo.locationCode + '" data-orphan-vrid="' + (yo.vrId || '') + '" style="border-left:3px solid #ff1744">'
            + '<div class="fmc-tour-header">'
            + '<span class="load-expand-icon">\u25B6</span>'
            + '<span class="fmc-tour-route" style="color:#ff1744">\uD83D\uDEA8 ' + displayName + '</span>'
            + '<span class="load-equip-badge" style="background:' + eqColor + '20;color:' + eqColor + '">' + eqShort + '</span>'
            + '<span class="fmc-tour-status" style="background:' + statusColor + ';color:#000">' + (yo.status || '?').substring(0, 4) + '</span>'
            + '<span style="font-size:10px;font-family:monospace;color:' + dwColor + ';font-weight:bold">' + (dwellStr || '') + '</span>'
            + '<span style="font-size:8px;color:#e040fb;font-weight:bold;flex-shrink:0">' + yo.locationCode + '</span>'
            + '</div>'
            + '<div class="fmc-tour-detail">' + detailRows + '</div>'
            + '</div>';
    },

    _renderDmAppointment(apt) {
        const fmtDt = (epoch) => {
            if (!epoch) return '—';
            const d = new Date(epoch);
            return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
        };

        const SC = { 'SCHEDULED':'#ffd600', 'ARRIVED':'#69f0ae', 'RECEIVING':'#4fc3f7', 'COMPLETED':'#9e9e9e', 'DEFECT':'#ff5252', 'CANCELLED':'#5a6a7a' };
        const SS = { 'SCHEDULED':'SCHED', 'ARRIVED':'HERE', 'RECEIVING':'RECV', 'COMPLETED':'DONE', 'DEFECT':'DEFCT', 'CANCELLED':'X' };

        var sc = SC[apt.status] || '#5a6a7a';
        var ss = SS[apt.status] || (apt.status ? apt.status.substring(0, 5) : '?');
        var displayName = apt.trailerNumber || apt.carrierName || apt.appointmentId || '—';
        var schedTime = fmtDt(apt.schedStart);
        var carrierText = apt.carrierName || '';
        var loadTypeText = apt.carrierLoadType || '';

        var delayHtml = '';
        if (apt.delayMin > 15) {
            var delayText = apt.delayMin > 60 ? Math.floor(apt.delayMin/60) + 'h' + (apt.delayMin%60) + 'm' : apt.delayMin + 'm';
            delayHtml = '<span class="fmc-tour-delay">\u26A0+' + delayText + '</span>';
        }

        var dwellHtml = '';
        if (apt.dwellMin > 0 && (apt.status === 'ARRIVED' || apt.status === 'RECEIVING')) {
            var dwColor = apt.dwellMin > 120 ? '#ff5252' : (apt.dwellMin > 60 ? '#ff9100' : '#69f0ae');
            dwellHtml = '<span class="fmc-tour-dwell" style="color:' + dwColor + '">\u23F1' + apt.dwellMin + 'm</span>';
        }

        var loadTypeHtml = '';
        if (loadTypeText) {
            var ltBg = loadTypeText === 'LIVE' ? 'rgba(105,240,174,.15)' : 'rgba(79,195,247,.15)';
            var ltColor = loadTypeText === 'LIVE' ? '#69f0ae' : '#4fc3f7';
            loadTypeHtml = '<span class="load-equip-badge" style="background:' + ltBg + ';color:' + ltColor + '">' + loadTypeText + '</span>';
        }

        var defectHtml = '';
        if (apt.defectType) {
            defectHtml = '<span style="font-size:8px;color:#ff5252;font-weight:bold;flex-shrink:0">\u26A0' + apt.defectType.replace(/_/g,' ') + '</span>';
        }

        // Detail rows
        var detailRows = '';
        detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Trailer</span><span class="fmc-tour-detail-val" style="color:#4fc3f7">' + (apt.trailerNumber || '—') + '</span></div>';
        detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Carrier</span><span class="fmc-tour-detail-val">' + carrierText + '</span></div>';
        detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Type</span><span class="fmc-tour-detail-val">' + (apt.appointmentType || '') + ' / ' + loadTypeText + '</span></div>';
        detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Sched</span><span class="fmc-tour-detail-val">' + fmtDt(apt.schedStart) + ' \u2192 ' + fmtDt(apt.schedEnd) + '</span></div>';

        if (apt.checkInStart) {
            detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Check-in</span><span class="fmc-tour-detail-val" style="color:#69f0ae">' + fmtDt(apt.checkInStart) + '</span></div>';
        }
        if (apt.dockDoor) {
            detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Door</span><span class="fmc-tour-detail-val" style="color:#e040fb">' + apt.dockDoor + '</span></div>';
        }
        if (apt.cartonCount || apt.palletCount) {
            detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Count</span><span class="fmc-tour-detail-val">' + (apt.cartonCount ? apt.cartonCount + ' ctns ' : '') + (apt.palletCount ? apt.palletCount + ' pals' : '') + '</span></div>';
        }
        if (apt.shipmentIds && apt.shipmentIds.length) {
            detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Shipments</span><span class="fmc-tour-detail-val" style="font-size:9px">' + apt.shipmentIds.slice(0,5).join(', ') + (apt.shipmentIds.length > 5 ? '...' : '') + '</span></div>';
        }
        if (apt.defectType) {
            detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Defect</span><span class="fmc-tour-detail-val" style="color:#ff5252">' + apt.defectType.replace(/_/g,' ') + '</span></div>';
        }
        if (apt.comments && apt.comments.length) {
            detailRows += '<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Notes</span><span class="fmc-tour-detail-val" style="font-size:9px;color:#78909C">' + apt.comments[apt.comments.length-1] + '</span></div>';
        }

        var trailerUpper = (apt.trailerNumber || '').toUpperCase();

        return '<div class="fmc-tour-item dm-item" data-dm-trailer="' + trailerUpper + '" data-dm-id="' + apt.appointmentId + '">'
            + '<div class="fmc-tour-header">'
            + '<span class="load-expand-icon">\u25B6</span>'
            + '<span class="fmc-tour-route">' + displayName + '</span>'
            + loadTypeHtml
            + '<span class="fmc-tour-status" style="background:' + sc + ';color:#000">' + ss + '</span>'
            + '<span class="fmc-tour-time">\uD83D\uDCE5' + schedTime + '</span>'
            + delayHtml + dwellHtml + defectHtml
            + '<span class="fmc-tour-carrier">' + carrierText + '</span>'
            + '</div>'
            + '<div class="fmc-tour-detail">' + detailRows + '</div>'
            + '</div>';
    },


    // ═══════════════════════════════════════════════════
    //  DATA PANEL DISPATCHER
    // ═══════════════════════════════════════════════════
    _isUpdating: false,
    updateVistaRoutesPanel() {
        var list = document.getElementById('vista-routes-list');
        if (!list) return;
        if (!State.vistaContainers.length) { list.innerHTML = '<div class="dp-empty">No data</div>'; return; }

        var routes = VISTA.buildRouteCongestion();
        var filter = this._vistaSearch;
        var maxCnt = routes.length ? routes[0].totalContainers : 1;
        var html = '';
        var filteredOut = 0;

        for (var ri = 0; ri < routes.length; ri++) {
            var g = routes[ri];
            if (filter) {
                var matchesRoute = g.key.includes(filter);
                var matchesLoc = false;
                var locKeys = Object.keys(g.locations);
                for (var li = 0; li < locKeys.length; li++) {
                    if (locKeys[li].toUpperCase().includes(filter)) { matchesLoc = true; break; }
                }
                if (!matchesRoute && !matchesLoc) { filteredOut++; continue; }
            }

            var barPct = Math.round((g.totalContainers / maxCnt) * 100);
            var dwC = g.maxDwell > 120 ? '#ff5252' : (g.maxDwell > 60 ? '#ff9100' : '#69f0ae');
            var congC = g.totalContainers > 30 ? '#ff1744' : (g.totalContainers > 15 ? '#ff9100' : (g.totalContainers > 5 ? '#ffd600' : '#69f0ae'));

            var types = '';
            var typeEntries = Object.entries(g.types);
            var TS2 = {'PALLET':'Pal','GAYLORD':'Gay','CART':'Cart','BAG':'Bag'};
            var TC2 = {'PALLET':'dr-pal','GAYLORD':'dr-gaylord','CART':'dr-cart','BAG':'dr-bag'};
            for (var ti = 0; ti < typeEntries.length; ti++) {
                types += '<span class="dr-badge ' + (TC2[typeEntries[ti][0]] || 'dr-other') + '">' + typeEntries[ti][1] + (TS2[typeEntries[ti][0]] || typeEntries[ti][0]) + '</span>';
            }

            var locs = Object.entries(g.locations).sort(function(a, b) { return b[1].count - a[1].count; });
            var locsHtml = '';
            for (var lli = 0; lli < locs.length; lli++) {
                var matched = State.elements.some(function(el) { return matchElement(el, locs[lli][0]); });
                locsHtml += '<div style="padding:2px 10px 2px 20px;font-size:9px;color:#78909C;cursor:pointer" data-vloc="' + locs[lli][0] + '">' + (matched ? '\u2705' : '\u274C') + ' ' + locs[lli][0] + ' \u00B7 ' + locs[lli][1].count + ' cnt \u00B7 ' + locs[lli][1].pkgs + ' pkg</div>';
            }

            html += '<div class="fmc-tour-item" data-vrkey="' + g.key + '">'
                + '<div class="fmc-tour-header">'
                + '<span class="load-expand-icon">\u25B6</span>'
                + '<span class="fmc-tour-route">' + g.key + '</span>'
                + '<span style="font-family:monospace;font-weight:bold;color:' + congC + ';min-width:28px;text-align:right">' + g.totalContainers + '</span>'
                + '<span style="font-size:9px;color:#8899aa;min-width:40px;text-align:right">' + g.totalPkgs + 'pkg</span>'
                + (g.maxDwell > 0 ? '<span style="font-size:9px;font-family:monospace;color:' + dwC + '">' + g.maxDwell + 'm</span>' : '')
                + '</div>'
                + '<div style="display:flex;gap:2px;flex-wrap:wrap;margin:2px 8px;font-size:9px">' + types + '</div>'
                + '<div style="height:4px;border-radius:2px;background:#2a3a4a;margin:3px 8px;overflow:hidden"><div style="height:100%;width:' + barPct + '%;background:' + congC + ';border-radius:2px"></div></div>'
                + '<div class="fmc-tour-detail">' + locsHtml + '</div>'
                + '</div>';
        }

        if (filteredOut > 0) {
            html += '<div class="hidden-count">\uD83D\uDD0D ' + filteredOut + ' routes hidden</div>';
        }

        list.innerHTML = html || '<div class="dp-empty">No routes found</div>';

        // Expand/collapse
        list.querySelectorAll('.fmc-tour-item').forEach(function(item) {
            var header = item.querySelector('.fmc-tour-header');
            var icon = item.querySelector('.load-expand-icon');
            if (!header) return;
            header.addEventListener('click', function() {
                var wasOpen = item.classList.contains('expanded');
                item.classList.toggle('expanded', !wasOpen);
                if (icon) icon.textContent = wasOpen ? '\u25B6' : '\u25BC';
            });
        });

        // Click location → focus on map
        list.querySelectorAll('[data-vloc]').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var mapEl = State.elements.find(function(e2) { return matchElement(e2, el.dataset.vloc); });
                if (mapEl) { State.selectOnly(mapEl); State.focusElement(mapEl); R.render(); UI.refreshList(); UI.showInspector(State.primarySelected, !State.editMode); }
            });
        });
    },

    updateDataPanel() {
        if (this._isUpdating) return;
        this._isUpdating = true;
        try {
            this._updateLoadsSubCounts();
            switch (State.loadsSubTab) {
                case 'ob': this._renderOBList(); break;
                case 'noninv': this._renderNonInvList(); break;
                case 'ib': this._renderIBList(); break;
            }
        } finally {
            this._isUpdating = false;
        }
    },


    _updateLoadsSubCounts() {
        const obCount = State.sspLoads.filter(l => !FMC.isTransferTotes(l.vrId)).length;
        const fmcNonInvRaw = FMC.getNonInvTours();
        const fmcNonInvFiltered = fmcNonInvRaw.filter(t => !t.vrId || !RELAT.isCompleted(t.vrId));
        var ymsOrphanCount = 0;
        try { ymsOrphanCount = ymsGetNonInvAssets().length; } catch(e) {}
        const nonInvCount = fmcNonInvFiltered.length + Dockmaster.getNonInv().length + ymsOrphanCount;


        const ibCount = FMC.getIBTours().length + Dockmaster.getIB().length;
        const set = (id, n) => { const el = document.getElementById(id); if (!el) return; el.textContent = n; el.classList.toggle('has', n > 0); };
        set('lsc-ob', obCount); set('lsc-noninv', nonInvCount); set('lsc-ib', ibCount);
    },


    // ═══════════════════════════════════════════════════
    //  OB LIST (SSP minus TransferTotes)
    // ═══════════════════════════════════════════════════
    _renderOBList() {
        const meta = document.getElementById('dp-meta'), list = document.getElementById('dp-list'), filterCounts = document.getElementById('load-filter-counts');
        if (State.dataLoading) { meta.textContent = '⏳ Loading...'; list.innerHTML = '<div class="dp-empty pulse">Fetching SSP...</div>'; return; }
        if (State.dataLastUpdated) { const t = State.dataLastUpdated; const fmcTag = FMC.tours.length ? ' · FMC✅' : ''; meta.textContent = `${State.sspLoads.length} loads · ${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}${fmcTag}`; }
        if (!State.sspLoads.length) { list.innerHTML = '<div class="dp-empty">No loads — click 🔄</div>'; if (filterCounts) filterCounts.textContent = ''; return; }
        const rf = State.routeFilter;
        let html = '', oldDepN = 0, ttN = 0;
        for (let i = 0; i < State.sspLoads.length; i++) {
            const l = State.sspLoads[i];
            if (FMC.isTransferTotes(l.vrId)) { ttN++; continue; }
            if (rf) { const match = l.route.toUpperCase().includes(rf) || l.rawRoute.toUpperCase().includes(rf) || l.carrier.toUpperCase().includes(rf) || (l.dockDoor !== '—' && l.dockDoor.toUpperCase().includes(rf)) || (l.vrId && l.vrId.toUpperCase().includes(rf)); if (!match) continue; }
            if (State.hideOldDeparted && isOldDeparted(l, State.oldDepartedMinutes)) { oldDepN++; continue; }
            html += this._renderSSPLoadItem(l, i);
        }
        const parts = []; if (ttN > 0) parts.push(`🔀${ttN} TT`); if (oldDepN > 0) parts.push(`⏰${oldDepN} old`);
        if (parts.length) html += `<div class="hidden-count">${parts.join(' · ')} hidden</div>`;
        if (filterCounts) filterCounts.textContent = oldDepN > 0 ? `⏰${oldDepN}` : '';
        list.innerHTML = html || '<div class="dp-empty">No matching OB loads</div>';
                // ── Focus Mode: bind eye buttons ──
        list.querySelectorAll('.load-focus-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();  // don't trigger load expand
                const rawRoute = btn.dataset.focusRaw;
                if (!rawRoute) return;
                State.toggleFocusRoute(rawRoute);
                this._renderFocusBar();
                this.updateDataPanel();  // re-renders list to update eye states
                R.render();
            });
        });

        // Render focus bar
        this._renderFocusBar();

    },

    _renderSSPLoadItem(l, idx) {
        const isHL = State.highlightedLoadIdx === idx;
        const sdtShort = l.sdt !== '—' ? (l.sdt.split(' ')[1] || l.sdt) : '—';
        const isSwap = isSwapBody(l.equipmentType);
        const isCptLoad = isCptEqualsSdt(l);
        const cpt = (l.status !== 'DEPARTED' && l.status !== 'CANCELLED') ? cptCountdown(l.cpt) : null;
        const cptBadge = cpt ? `<span class="cpt-countdown cpt-${cpt.level}">⏰${cpt.text}</span>` : '';
        const eqBadge = l.equipmentType ? `<span class="load-equip-badge" style="background:${equipTypeColor(l.equipmentType)}20;color:${equipTypeColor(l.equipmentType)}">${equipTypeShort(l.equipmentType)}</span>` : '';
        const vrId2 = l.vrId?.toUpperCase() || '';
        const yiAll = vrId2 ? State.findYmsForVrId(vrId2) : null;
        let yb = '';
        if (yiAll) { const allAnn = yiAll.every(yi => yi.fromAnnotation); yb = allAnn ? `<span class="load-yms-badge load-yms-annotation">📝</span>` : `<span class="load-yms-badge load-yms-found">✅${yiAll.length > 1 ? yiAll.length : ''}</span>`; }
        let ml = '';
        if (l._containers) { const locs = l._containers.locations.map(lc => lc.label); const mt = locs.filter(ll => State.elements.some(el => matchElement(el, ll))).length; const um = locs.length - mt; ml = `<div class="load-match-info">🔦${mt}/${locs.length}${um ? ` ⚠️${um}` : ''}</div>`; }
        const isFocused = State.isFocusRoute(l.rawRoute);
const focusColor = isFocused ? State.focusRoutes.get(routeGroupKey(l.rawRoute))?.color || '#ff9900' : '';
const eyeBtn = `<button class="load-focus-btn ${isFocused ? 'focused' : ''}" data-focus-raw="${l.rawRoute}" title="Toggle focus" style="${isFocused ? 'color:' + focusColor : ''}">👁</button>`;

        return `<div class="load-item ${l._expanded ? 'expanded' : ''} ${isHL ? 'hl-active' : ''}" data-load-idx="${idx}">
<div class="load-header">
<span class="load-expand-icon">${l._expanded ? '▼' : '▶'}</span>
<span class="load-route" title="${l.rawRoute}">${l.route}</span>
${eqBadge}
<span class="load-status" style="background:${l.statusColor};color:#000">${l.statusShort}</span>
${l.dockDoor !== '—' ? `<span class="load-dock">${l.dockDoor}</span>` : ''}
<span class="load-sdt ${isCptLoad ? 'cpt-load' : ''}">${isCptLoad ? '⭐' : ''}${sdtShort}</span>
${cptBadge}${yb}
${l._swapCount > 1 ? `<span class="load-swap-badge">🔀${l._swapCount}</span>` : (isSwap ? '<span class="load-swap-badge">🔀</span>' : '')}
${eyeBtn}
</div>${ml}${l._containersLoading ? '<div class="cnt-loading pulse">⏳</div>' : ''}</div>`;

    },

    // ═══════════════════════════════════════════════════
    //  NONINV LIST (FMC Transfers → our site)
    // ═══════════════════════════════════════════════════
    _renderNonInvList() {
        const meta = document.getElementById('dp-meta'), list = document.getElementById('dp-list');
        if (FMC.loading && Dockmaster.loading) { meta.textContent = '⏳ Loading...'; list.innerHTML = '<div class="dp-empty pulse">Fetching...</div>'; return; }

        const fmcToursRaw = FMC.getNonInvTours();
        const relatFilteredCount = fmcToursRaw.filter(t => t.vrId && RELAT.isCompleted(t.vrId)).length;
        const fmcTours = fmcToursRaw.filter(t => !t.vrId || !RELAT.isCompleted(t.vrId));

        const dmNonInv = Dockmaster.getNonInv();
        const rf = State.routeFilter;

        const filteredFmc = rf ? fmcTours.filter(function(t) { return t.route.toUpperCase().includes(rf) || t.facilitySeq.toUpperCase().includes(rf) || t.carrier.toUpperCase().includes(rf) || (t.vrId && t.vrId.toUpperCase().includes(rf)); }) : fmcTours;
        const filteredDm = rf ? dmNonInv.filter(function(a) { return a.trailerNumber.toUpperCase().includes(rf) || a.carrierName.toUpperCase().includes(rf) || a.shipmentIds.some(function(s) { return s.toUpperCase().includes(rf); }); }) : dmNonInv;

        var ymsOrphans = [];
        try { ymsOrphans = ymsGetNonInvAssets(); } catch(e) {}

        var total = filteredFmc.length + filteredDm.length + ymsOrphans.length;
        var fmcTime = FMC.lastUpdated;
        var dmTime = Dockmaster.lastUpdated;

        meta.textContent = total + ' NonInv'
            + (fmcTime ? ' · FMC:' + String(fmcTime.getHours()).padStart(2,'0') + ':' + String(fmcTime.getMinutes()).padStart(2,'0') : '')
            + (dmTime ? ' · DM:' + String(dmTime.getHours()).padStart(2,'0') + ':' + String(dmTime.getMinutes()).padStart(2,'0') : '')
            + (RELAT.lastUpdated ? ' · RELAT✅' : '');

        if (!total) { list.innerHTML = '<div class="dp-empty">No NonInv data</div>'; return; }

        // ── Merge into single sorted list ──

        var merged = [];

        for (var fi = 0; fi < filteredFmc.length; fi++) {
            var t = filteredFmc[fi];
            merged.push({
                type: 'fmc',
                sortTime: t.plannedYardArrival || t.plannedDockArrival || Infinity,
                isActive: t.hasArrived && !t.hasDeparted,
                fmcTour: t,
                dmApt: null,
                ymsOrphan: null
            });
        }

        for (var di = 0; di < filteredDm.length; di++) {
            var a = filteredDm[di];
            merged.push({
                type: 'dm',
                sortTime: a.schedStart || Infinity,
                isActive: a.status === 'ARRIVED' || a.status === 'RECEIVING',
                fmcTour: null,
                dmApt: a,
                ymsOrphan: null
            });
        }

        for (var yi = 0; yi < ymsOrphans.length; yi++) {
            var yo = ymsOrphans[yi];
            merged.push({
                type: 'yms-orphan',
                sortTime: yo.arrivalEpoch ? yo.arrivalEpoch * 1000 : 0,
                isActive: true,
                fmcTour: null,
                dmApt: null,
                ymsOrphan: yo
            });
        }

        // Sort: YMS orphans first (oldest), then by time
        merged.sort(function(a, b) {
            // yms-orphans float to top
            if (a.type === 'yms-orphan' && b.type !== 'yms-orphan') return -1;
            if (b.type === 'yms-orphan' && a.type !== 'yms-orphan') return 1;
            return (a.sortTime || Infinity) - (b.sortTime || Infinity);
        });

        // ── KPI bar ──

        var dmActive = filteredDm.filter(function(a) { return a.status === 'ARRIVED' || a.status === 'RECEIVING'; }).length;
        var dmSched = filteredDm.filter(function(a) { return a.status === 'SCHEDULED'; }).length;
        var dmDone = filteredDm.filter(function(a) { return a.status === 'COMPLETED'; }).length;
        var fmcAtYard = filteredFmc.filter(function(t) { return t.hasArrived && !t.hasDeparted; }).length;

        var html = '<div style="padding:5px 10px;border-bottom:1px solid #1a2a3a;font-size:10px;color:#8899aa;display:flex;gap:10px;flex-wrap:wrap">'
            + '<span>\uD83D\uDCCB FMC:<strong style="color:#e040fb">' + filteredFmc.length + '</strong></span>'
            + '<span>\uD83C\uDFD7 DM:<strong style="color:#4fc3f7">' + filteredDm.length + '</strong></span>'
            + (ymsOrphans.length ? '<span>\uD83D\uDEA8 <strong style="color:#ff1744">' + ymsOrphans.length + '</strong> YMS orphan</span>' : '')
            + (fmcAtYard ? '<span>\uD83D\uDE9A <strong style="color:#e040fb">' + fmcAtYard + '</strong> fmc yard</span>' : '')
            + (dmActive ? '<span>\uD83D\uDFE2 <strong style="color:#69f0ae">' + dmActive + '</strong> active</span>' : '')
            + (dmSched ? '<span>\uD83D\uDCC5 <strong style="color:#ffd600">' + dmSched + '</strong> sched</span>' : '')
            + (dmDone ? '<span>\u2705 <strong style="color:#9e9e9e">' + dmDone + '</strong> done</span>' : '')
            + (relatFilteredCount ? '<span>\u2705 <strong style="color:#69f0ae">' + relatFilteredCount + '</strong> RELAT done</span>' : '')
            + '</div>';

        // ── Render merged list ──
        var renderCount = 0;
        for (var mi = 0; mi < merged.length && renderCount < 80; mi++) {
            var item = merged[mi];
            if (item.type === 'dm') {
                html += this._renderDmAppointment(item.dmApt);
            } else if (item.type === 'yms-orphan') {
                html += this._renderYmsOrphanItem(item.ymsOrphan);
            } else {
                html += this._renderFmcTourItem(item.fmcTour, true);
            }
            renderCount++;
        }


        if (merged.length > 80) {
            html += '<div class="hidden-count">' + (merged.length - 80) + ' more hidden</div>';
        }

        list.innerHTML = html;
        this._bindFmcTourClicks(list);

        // DM click handlers
        var self = this;
        list.querySelectorAll('.dm-item').forEach(function(item) {
            var header = item.querySelector('.fmc-tour-header');
            var icon = item.querySelector('.load-expand-icon');
            if (!header) return;
            header.addEventListener('click', function() {
                var wasOpen = item.classList.contains('expanded');
                list.querySelectorAll('.dm-item.expanded').forEach(function(other) {
                    if (other !== item) { other.classList.remove('expanded'); var oi = other.querySelector('.load-expand-icon'); if (oi) oi.textContent = '\u25B6'; }
                });
                item.classList.toggle('expanded', !wasOpen);
                if (icon) icon.textContent = wasOpen ? '\u25B6' : '\u25BC';
                if (!wasOpen) {
                    var trailer = item.dataset.dmTrailer;
                    if (trailer) {
                        for (var li = 0; li < State.ymsLocations.length; li++) {
                            var loc = State.ymsLocations[li];
                            for (var ai = 0; ai < (loc.yardAssets || []).length; ai++) {
                                var asset = loc.yardAssets[ai];
                                var plate = (asset.licensePlateIdentifier && asset.licensePlateIdentifier.registrationIdentifier || asset.vehicleNumber || '').toUpperCase();
                                if (plate === trailer) { self._highlightFmcOnMap(ymsGetVrIds(asset)[0] || ''); return; }
                            }
                        }
                    }
                    State.clearHighlight(); R.render();
                } else { State.clearHighlight(); R.render(); }
            });
        });
        // YMS orphan click handlers
        list.querySelectorAll('.yms-orphan-item').forEach(function(item) {
            var header = item.querySelector('.fmc-tour-header');
            var icon = item.querySelector('.load-expand-icon');
            if (!header) return;
            header.addEventListener('click', function() {
                var wasOpen = item.classList.contains('expanded');
                list.querySelectorAll('.yms-orphan-item.expanded').forEach(function(other) {
                    if (other !== item) { other.classList.remove('expanded'); var oi = other.querySelector('.load-expand-icon'); if (oi) oi.textContent = '\u25B6'; }
                });
                item.classList.toggle('expanded', !wasOpen);
                if (icon) icon.textContent = wasOpen ? '\u25B6' : '\u25BC';

                if (!wasOpen) {
                    var locCode = item.dataset.orphanLoc;
                    if (locCode) {
                        var hd = {};
                        var matchedEls = S.MatchIndex ? MatchIndex.getMatching(locCode) : [];
                        for (var ei = 0; ei < matchedEls.length; ei++) {
                            var elKey = matchedEls[ei].name || matchedEls[ei].id;
                            hd[elKey] = { containers:{}, loosePkgs:0, totalPkgs:0, totalWeight:0, matchedLocs:[locCode], ymsMatch:true, ymsLocCode:locCode, ymsSource:'orphan', ymsAllLocations:[{code:locCode,source:'orphan'}], onlyLoose:false };
                        }
                        State.highlightData = hd;
                        State.highlightedLoadIdx = -1;
                        State.highlightedVrId = item.dataset.orphanVrid || null;
                        State._startPulse();
                        R.render();
                    }
                } else {
                    State.clearHighlight(); R.render();
                }
            });

            item.querySelectorAll('[data-copy]').forEach(function(el) {
                el.addEventListener('click', function(e) {
                    e.stopPropagation();
                    navigator.clipboard.writeText(el.dataset.copy).then(function() { el.textContent = '\u2705'; setTimeout(function() { el.textContent = el.dataset.copy; }, 1500); });
                });
            });
        });
    },



    // ═══════════════════════════════════════════════════
    //  IB LIST (FMC — everything else inbound)
    // ═══════════════════════════════════════════════════
    _renderIBList() {
        const meta = document.getElementById('dp-meta'), list = document.getElementById('dp-list');
        if (FMC.loading && Dockmaster.loading) { meta.textContent = '⏳ Loading...'; list.innerHTML = '<div class="dp-empty pulse">Fetching...</div>'; return; }

        const fmcTours = FMC.getIBTours();
        const dmIB = Dockmaster.getIB();
        const rf = State.routeFilter;

        const filteredFmc = rf ? fmcTours.filter(function(t) { return t.route.toUpperCase().includes(rf) || t.facilitySeq.toUpperCase().includes(rf) || t.carrier.toUpperCase().includes(rf) || (t.vrId && t.vrId.toUpperCase().includes(rf)); }) : fmcTours;
        const filteredDm = rf ? dmIB.filter(function(a) { return a.trailerNumber.toUpperCase().includes(rf) || a.carrierName.toUpperCase().includes(rf) || a.shipmentIds.some(function(s) { return s.toUpperCase().includes(rf); }); }) : dmIB;

        var total = filteredFmc.length + filteredDm.length;
        var fmcTime = FMC.lastUpdated, dmTime = Dockmaster.lastUpdated;
        meta.textContent = total + ' IB' + (fmcTime ? ' · FMC:' + String(fmcTime.getHours()).padStart(2,'0') + ':' + String(fmcTime.getMinutes()).padStart(2,'0') : '') + (dmTime ? ' · DM:' + String(dmTime.getHours()).padStart(2,'0') + ':' + String(dmTime.getMinutes()).padStart(2,'0') : '');

        if (!total) { list.innerHTML = '<div class="dp-empty">No IB data</div>'; return; }

        // ── Merge into single sorted list ──
        var merged = [];

        for (var fi = 0; fi < filteredFmc.length; fi++) {
            var t = filteredFmc[fi];
            merged.push({
                type: 'fmc',
                sortTime: t.plannedYardArrival || t.plannedDockArrival || Infinity,
                isActive: t.hasArrived && !t.hasDeparted,
                fmcTour: t,
                dmApt: null
            });
        }

        for (var di = 0; di < filteredDm.length; di++) {
            var a = filteredDm[di];
            merged.push({
                type: 'dm',
                sortTime: a.schedStart || Infinity,
                isActive: a.status === 'ARRIVED' || a.status === 'RECEIVING',
                fmcTour: null,
                dmApt: a
            });
        }

        merged.sort(function(a, b) {
            return (a.sortTime || Infinity) - (b.sortTime || Infinity);
        });

        // ── KPI bar ──
        var dmActive = filteredDm.filter(function(a) { return a.status === 'ARRIVED' || a.status === 'RECEIVING'; }).length;
        var dmSched = filteredDm.filter(function(a) { return a.status === 'SCHEDULED'; }).length;

        var html = '<div style="padding:5px 10px;border-bottom:1px solid #1a2a3a;font-size:10px;color:#8899aa;display:flex;gap:10px;flex-wrap:wrap">'
            + '<span>\uD83D\uDCCB FMC:<strong style="color:#e040fb">' + filteredFmc.length + '</strong></span>'
            + '<span>\uD83C\uDFD7 DM:<strong style="color:#4fc3f7">' + filteredDm.length + '</strong></span>'
            + (dmActive ? '<span>\uD83D\uDFE2 <strong style="color:#69f0ae">' + dmActive + '</strong> active</span>' : '')
            + (dmSched ? '<span>\uD83D\uDCC5 <strong style="color:#ffd600">' + dmSched + '</strong> sched</span>' : '')
            + '</div>';

        // ── Render merged list ──
        var renderCount = 0;
        for (var mi = 0; mi < merged.length && renderCount < 80; mi++) {
            var item = merged[mi];
            if (item.type === 'dm') {
                html += this._renderDmAppointment(item.dmApt);
            } else {
                html += this._renderFmcTourItem(item.fmcTour, true);
            }
            renderCount++;
        }

        if (merged.length > 80) {
            html += '<div class="hidden-count">' + (merged.length - 80) + ' more hidden</div>';
        }

        list.innerHTML = html;
        this._bindFmcTourClicks(list);

        // DM click handlers
        var self = this;
        list.querySelectorAll('.dm-item').forEach(function(item) {
            var header = item.querySelector('.fmc-tour-header');
            var icon = item.querySelector('.load-expand-icon');
            if (!header) return;
            header.addEventListener('click', function() {
                var wasOpen = item.classList.contains('expanded');
                list.querySelectorAll('.dm-item.expanded').forEach(function(other) {
                    if (other !== item) { other.classList.remove('expanded'); var oi = other.querySelector('.load-expand-icon'); if (oi) oi.textContent = '\u25B6'; }
                });
                item.classList.toggle('expanded', !wasOpen);
                if (icon) icon.textContent = wasOpen ? '\u25B6' : '\u25BC';
                if (!wasOpen) {
                    var trailer = item.dataset.dmTrailer;
                    if (trailer) {
                        for (var li = 0; li < State.ymsLocations.length; li++) {
                            var loc = State.ymsLocations[li];
                            for (var ai = 0; ai < (loc.yardAssets || []).length; ai++) {
                                var asset = loc.yardAssets[ai];
                                var plate = (asset.licensePlateIdentifier && asset.licensePlateIdentifier.registrationIdentifier || asset.vehicleNumber || '').toUpperCase();
                                if (plate === trailer) { self._highlightFmcOnMap(ymsGetVrIds(asset)[0] || ''); return; }
                            }
                        }
                    }
                    State.clearHighlight(); R.render();
                } else { State.clearHighlight(); R.render(); }
            });
        });
    },

    // ═══════════════════════════════════════════════════
    //  SHARED: FMC tour renderer
    // ═══════════════════════════════════════════════════
    _renderFmcTourItem(tour, showShipper = false) {
                const fmtTime = (epoch) => { if (!epoch) return '—'; const d = new Date(epoch); return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; };
        const fmtDateTime = (epoch) => {
            if (!epoch) return '—';
            const d = new Date(epoch);
            return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        };

        const SC = { 'DEPARTED':'#9e9e9e', 'AT_YARD':'#4fc3f7', 'IN_TRANSIT':'#e040fb', 'ASSIGNED':'#ff9800', 'PLANNED':'#5a6a7a' };
        const SS = { 'DEPARTED':'DEP', 'AT_YARD':'YRD', 'IN_TRANSIT':'TRN', 'ASSIGNED':'ASG', 'PLANNED':'PLN' };
        const sc = SC[tour.tourStatus] || '#5a6a7a', ss = SS[tour.tourStatus] || tour.tourStatus?.substring(0, 3) || '?';
        const timeLabel = tour.direction === 'IB'
            ? `📥${fmtDateTime(tour.plannedYardArrival)}`
            : `📤${fmtDateTime(tour.plannedYardDeparture)}`;

        const maxDelay = Math.max(tour.arrivalDelayMin || 0, tour.departureDelayMin || 0);
        const delayBadge = maxDelay > 15 ? `<span class="fmc-tour-delay">⚠+${maxDelay}m</span>` : '';
        const isAtYard = tour.hasArrived && !tour.hasDeparted;
        const dwellBadge = isAtYard && tour.yardDwellMin > 0 ? `<span class="fmc-tour-dwell" style="color:${tour.yardDwellMin > 120 ? '#ff5252' : tour.yardDwellMin > 60 ? '#ff9100' : '#69f0ae'}">⏱${tour.yardDwellMin}m</span>` : '';
        const eqBadge = tour.equipmentType ? `<span class="load-equip-badge" style="background:${equipTypeColor(tour.equipmentType)}20;color:${equipTypeColor(tour.equipmentType)}">${equipTypeShort(tour.equipmentType)}</span>` : '';
        const vrId = tour.vrId?.toUpperCase() || '';
        const ymsHits = vrId ? State.findYmsForVrId(vrId) : null;
        const ymsBadge = ymsHits ? `<span class="load-yms-badge load-yms-found">✅</span>` : '';

        // ── Display name: shipper for NonInv/IB, route for OB
        const displayName = showShipper
            ? (tour.shippers.join(', ') || tour.businessTypesList.join(', ') || tour.route || '—')
            : (tour.route || tour.facilitySeq);

        const detail = `<div class="fmc-tour-detail">
            ${tour.vrId ? `<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">VR ID</span><span class="fmc-tour-detail-val" style="color:#4fc3f7;cursor:pointer" data-copy="${tour.vrId}">${tour.vrId}</span></div>` : ''}
            <div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Lane</span><span class="fmc-tour-detail-val">${tour.facilitySeq}</span></div>
            <div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Route</span><span class="fmc-tour-detail-val">${tour.route}</span></div>
            <div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Shipper</span><span class="fmc-tour-detail-val">${tour.shippers.join(', ') || '—'}</span></div>
            <div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Carrier</span><span class="fmc-tour-detail-val">${tour.carrier}</span></div>
            <div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Type</span><span class="fmc-tour-detail-val">${tour.businessTypesList.join(', ') || tour.shipperCategory}</span></div>
            <div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Equipment</span><span class="fmc-tour-detail-val">${tour.equipmentType || '—'}</span></div>
            <div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Plan Arr</span><span class="fmc-tour-detail-val">${fmtDateTime(tour.plannedYardArrival)}</span></div>
            <div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">Plan Dep</span><span class="fmc-tour-detail-val">${fmtDateTime(tour.plannedYardDeparture)}</span></div>

            ${ymsHits ? `<div class="fmc-tour-detail-row"><span class="fmc-tour-detail-label">YMS</span><span class="fmc-tour-detail-val" style="color:#69f0ae">${ymsHits.map(h => h.locationCode).join(', ')}</span></div>` : ''}
        </div>`;
        return `<div class="fmc-tour-item" data-fmc-vrid="${vrId}"><div class="fmc-tour-header"><span class="load-expand-icon">▶</span><span class="fmc-tour-route" title="${tour.facilitySeq}">${displayName}</span>${eqBadge}<span class="fmc-tour-status" style="background:${sc};color:#000">${ss}</span><span class="fmc-tour-time">${timeLabel}</span>${delayBadge}${dwellBadge}${ymsBadge}<span class="fmc-tour-carrier">${tour.carrier || ''}</span></div>${detail}</div>`;
    },


    _bindFmcTourClicks(container) {
        container.querySelectorAll('.fmc-tour-item').forEach(item => {
            const header = item.querySelector('.fmc-tour-header');
            const icon = item.querySelector('.load-expand-icon');
            header?.addEventListener('click', () => {
                const wasOpen = item.classList.contains('expanded');
                container.querySelectorAll('.fmc-tour-item.expanded').forEach(other => { if (other !== item) { other.classList.remove('expanded'); const oi = other.querySelector('.load-expand-icon'); if (oi) oi.textContent = '▶'; } });
                item.classList.toggle('expanded', !wasOpen);
                if (icon) icon.textContent = wasOpen ? '▶' : '▼';
                const vrId = item.dataset.fmcVrid;
                if (!wasOpen && vrId) this._highlightFmcOnMap(vrId);
                else { State.clearHighlight(); R.render(); }
            });
            item.querySelectorAll('[data-copy]').forEach(el => { el.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard.writeText(el.dataset.copy).then(() => { el.textContent = '✅'; setTimeout(() => { el.textContent = el.dataset.copy; }, 1500); }); }); });
        });
    },

    _highlightFmcOnMap(vrId) {
        if (!vrId) return;
        const vu = vrId.toUpperCase();
        const ymsHits = State.findYmsForVrId(vu);
        if (!ymsHits?.length) { State.clearHighlight(); R.render(); return; }
        const hd = {};
        for (const hit of ymsHits) {
            const locCode = (hit.locationCode || '').toUpperCase(); if (!locCode) continue;
            const matchedEls = MatchIndex.getMatching(locCode);
            for (const el of matchedEls) {
                const elKey = el.name || el.id;
                if (!hd[elKey]) hd[elKey] = { containers: {}, loosePkgs: 0, totalPkgs: 0, totalWeight: 0, matchedLocs: [], ymsMatch: true, ymsLocCode: locCode, ymsSource: hit.fromAnnotation ? 'annotation' : 'vrId', ymsAllLocations: [], onlyLoose: false };
                if (!hd[elKey].matchedLocs.includes(locCode)) hd[elKey].matchedLocs.push(locCode);
            }
        }
        State.highlightData = hd; State.highlightedLoadIdx = -1; State.highlightedVrId = vu; State._startPulse(); R.render();
    },

    // ═══════════════════════════════════════════════════
    //  YMS / VISTA / FMC PANELS
    // ═══════════════════════════════════════════════════
    updateYmsPanel() {
        const meta = document.getElementById('yms-meta'), list = document.getElementById('yms-report-list');
        if (State.ymsLoading) { meta.textContent = '⏳ Loading...'; list.innerHTML = '<div class="dp-empty pulse">Fetching...</div>'; return; }
        if (State.ymsLastUpdated) { const t = State.ymsLastUpdated; meta.textContent = `${State.ymsLocations.length} loc · ${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`; }
        if (!State.ymsLocations.length) { list.innerHTML = YMS._token ? '<div class="dp-empty">Click 🔄</div>' : `<div class="dp-empty">🔑 Open <a href="https://trans-logistics-eu.amazon.com/yms/shipclerk" target="_blank" style="color:#4fc3f7">YMS tab</a> for ${CONFIG.warehouseId}</div>`; return; }
        const report = YMS.buildReport(); let totalAll = 0, totalUnavail = 0, totalEmpty = 0, totalFull = 0, rows = '';
        for (const [owner, data] of report) { const isPrio = ['ATSEU','ATPST','DHLTS'].includes(owner); totalAll += data.total; totalUnavail += data.unavailable; totalEmpty += data.empty; totalFull += data.full; const tl = Object.entries(data.types).map(([t2,n])=>`${n}${(TRAILER_LABELS[t2]||'').trim()}`).join(' '); rows += `<tr class="${isPrio?'priority-row':''}"><td class="owner-code">${owner}</td><td class="cnt cnt-ok">${data.total}</td><td class="cnt" style="color:#69f0ae">${data.empty||'—'}</td><td class="cnt" style="color:#ffd600">${data.full||'—'}</td><td class="cnt ${data.unavailable>0?'cnt-warn':''}">${data.unavailable||'—'}</td><td style="font-size:10px;color:#78909C">${tl}</td></tr>`; }
        rows += `<tr class="total-row"><td>TOTAL</td><td class="cnt">${totalAll}</td><td class="cnt">${totalEmpty}</td><td class="cnt">${totalFull}</td><td class="cnt">${totalUnavail}</td><td></td></tr>`;
        list.innerHTML = `<div class="yms-report"><table class="yms-rtable"><thead><tr><th>Owner</th><th style="text-align:center">Total</th><th style="text-align:center">∅</th><th style="text-align:center">📦</th><th style="text-align:center">⚠️</th><th>Types</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    },
    updateVistaPanel() {
        const meta = document.getElementById('vista-meta'), list = document.getElementById('vista-list');
        if (State.vistaLoading) { meta.textContent = '⏳ Loading...'; list.innerHTML = '<div class="dp-empty pulse">Fetching...</div>'; return; }
        if (State.vistaLastUpdated) { const t = State.vistaLastUpdated; meta.textContent = `${State.vistaContainers.length} cnt · ${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`; }
        if (!State.vistaContainers.length) { list.innerHTML = '<div class="dp-empty">No data — click 🔄</div>'; return; }
        const locs = Object.entries(State.vistaLocMap).sort((a, b) => b[1].totalContainers - a[1].totalContainers);
        let html = '<table class="yms-rtable"><thead><tr><th>Location</th><th style="text-align:center">Cnt</th><th style="text-align:center">Pkg</th><th>Dwell</th></tr></thead><tbody>';
        for (const [locName, d] of locs) { const lc = d.totalContainers > 15 ? '#ff1744' : d.totalContainers > 8 ? '#ff9100' : d.totalContainers > 3 ? '#ffd600' : '#69f0ae'; const dwC = d.maxDwell > 120 ? 'color:#ff5252' : d.maxDwell > 60 ? 'color:#ff9100' : 'color:#78909C'; html += `<tr><td><span style="font-family:monospace;font-weight:bold;color:${lc};font-size:10px">${locName}</span></td><td class="cnt" style="color:${lc}">${d.totalContainers}</td><td class="cnt" style="color:#b0bec5">${d.totalPkgs}</td><td style="${dwC};font-size:10px;font-family:monospace">${d.maxDwell}m</td></tr>`; }
        html += '</tbody></table>'; list.innerHTML = html;
                this.updateVistaRoutesPanel();
    },
    updateFmcPanel() {
        const meta = document.getElementById('fmc-meta'), list = document.getElementById('fmc-list');
        const siteCode = CONFIG.fmcSiteCode || GM_getValue('shipmap_fmc_site_code', 'AT1hgc');
        if (FMC.loading) { meta.textContent = '⏳ Loading FMC...'; list.innerHTML = '<div class="dp-empty pulse">Fetching...</div>'; return; }
        if (!FMC.tours.length) { meta.textContent = 'FMC'; list.innerHTML = `<div class="dp-empty">🚛 FMC: <strong>${siteCode}</strong><br><span style="font-size:9px;color:#5a6a7a">Open FMC tab or click 🔄</span></div>`; return; }
        const s = FMC.summary, t = FMC.lastUpdated;
        meta.textContent = `${FMC.tours.length} tours · ${t ? t.getHours().toString().padStart(2,'0')+':'+t.getMinutes().toString().padStart(2,'0') : '?'}`;
        let html = '';
        if (s) html += `<div style="padding:8px 12px;border-bottom:1px solid #1a2a3a;font-size:10px;color:#8899aa;display:flex;gap:12px;flex-wrap:wrap"><span>📥 IB:<strong style="color:#4fc3f7">${s.inbound.total}</strong></span><span>📤 OB:<strong style="color:#ff9900">${s.outbound.total}</strong></span><span>🏗 Yard:<strong style="color:#69f0ae">${s.yardNow}</strong></span>${s.delayed.arrival + s.delayed.departure > 0 ? `<span>⚠️ <strong style="color:#ff5252">${s.delayed.arrival + s.delayed.departure}</strong> delayed</span>` : ''}</div>`;
        if (s?.byCarrier) { const carriers = Object.entries(s.byCarrier).sort((a,b)=>b[1]-a[1]).slice(0,8); html += '<div style="padding:6px 12px">'; for (const [carrier, count] of carriers) { const pct = Math.round(count / FMC.tours.length * 100); html += `<div style="display:flex;gap:6px;align-items:center;padding:2px 0;font-size:10px"><span style="color:#e0e0e0;font-weight:bold;font-family:monospace;min-width:60px">${carrier}</span><div style="flex:1;height:4px;background:#2a3a4a;border-radius:2px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#ff9900;border-radius:2px"></div></div><span style="color:#ff9900;font-weight:bold;min-width:24px;text-align:right">${count}</span></div>`; } html += '</div>'; }
        list.innerHTML = html || '<div class="dp-empty">No data</div>';
    },

    // ═══════════════════════════════════════════════════
    //  DRAWER
    // ═══════════════════════════════════════════════════
    openDrawer(loadIdx) { const load=State.sspLoads[loadIdx];if(!load?._containers)return;State.drawerOpen=true;State.drawerLoadIdx=loadIdx;document.getElementById('drawer-wrap').classList.add('open');this._renderDrawerSort();this._renderDrawer(load);setTimeout(()=>R.resize(),260); },
    closeDrawer() { if (State.drawerLoadIdx >= 0 && State.sspLoads[State.drawerLoadIdx]) { State.sspLoads[State.drawerLoadIdx]._expanded = false; } State.drawerOpen = false; State.drawerLoadIdx = -1; State.clearHighlight(); document.getElementById('drawer-wrap').classList.remove('open'); UI.updateDataPanel(); setTimeout(() => { R.resize(); R.render(); }, 260); },
    _renderDrawerSort() { const sortBar=document.getElementById('drawer-sort'); const sorts=[{key:'name',label:'📍Name'},{key:'content',label:'📦Content'},{key:'dwell',label:'⏱Dwell'}]; sortBar.innerHTML=`<label>Sort:</label>`+sorts.map(s=>`<button class="btn sm ${State.drawerSort===s.key?'on':''}" data-dsort="${s.key}">${s.label}</button>`).join(''); sortBar.querySelectorAll('[data-dsort]').forEach(btn=>{btn.addEventListener('click',()=>{State.drawerSort=btn.dataset.dsort;this._renderDrawerSort();const load=State.sspLoads[State.drawerLoadIdx];if(load)this._renderDrawer(load);});}); },
    _renderDrawer(load) {

        const data = load._containers; if (!data) return;

        const vrId = load.vrId?.toUpperCase() || '';
        const yiAll = State.findYmsForVrId(vrId);

        const yb = yiAll
            ? yiAll.map(yi => yi.fromAnnotation
                ? `<span class="load-yms-badge load-yms-annotation">📝${yi.locationCode}</span>`
                : `<span class="load-yms-badge load-yms-found">✅${yi.locationCode}</span>`
            ).join('')
            : `<span class="load-yms-badge load-yms-missing">❌YMS</span>`;

        const drawerCpt = (load.status !== 'DEPARTED' && load.status !== 'CANCELLED') ? cptCountdown(load.cpt) : null;
        const drawerCptBadge = drawerCpt ? `<span class="cpt-countdown cpt-${drawerCpt.level}" title="CPT: ${load.cpt}">⏰${drawerCpt.text}</span>` : '';

        document.getElementById('drawer-route').innerHTML = `<span>${load.route}</span>`
            + (load.vrId ? `<span style="font-size:11px;font-family:monospace;color:#4fc3f7;cursor:pointer" title="Click to copy" id="drawer-vrid">${load.vrId}</span>` : '')
            + `<span class="load-status" style="background:${load.statusColor};color:#000">${load.statusLabel}</span>`
            + (load.dockDoor !== '—' ? `<span style="color:#e040fb;font-weight:bold">${load.dockDoor}</span>` : '')
            + `<span class="load-equip-badge" style="background:${equipTypeColor(load.equipmentType)}20;color:${equipTypeColor(load.equipmentType)}">${load._swapCount > 1 ? `${load._swapCount}× ` : ''}${equipTypeShort(load.equipmentType)}</span>`
            + drawerCptBadge
            + yb;

        document.getElementById('drawer-vrid')?.addEventListener('click', () => {
            navigator.clipboard.writeText(load.vrId).then(() => {
                const el = document.getElementById('drawer-vrid');
                if (el) { el.textContent = '✅ copied'; setTimeout(() => { el.textContent = load.vrId; }, 1500); }
            });
        });

        const s = data.stats;
        document.getElementById('drawer-summary').innerHTML = `📦<strong>${s.packageCount}</strong>pkg · 🛒<strong>${s.palletCount}</strong>pal · 📍<strong>${s.locationCount}</strong>loc · ⚖️<strong>${s.totalWeightKg}</strong>kg`;

        const TS = { 'PALLET': 'Pal', 'GAYLORD': 'Gay', 'BAG': 'Bag', 'CART': 'Cart', 'CAGE': 'Cage', 'ROLL_CONTAINER': 'Roll' };
        const TC = { 'PALLET': 'dr-pal', 'GAYLORD': 'dr-gaylord', 'BAG': 'dr-bag', 'CART': 'dr-cart', 'CAGE': 'dr-cage', 'ROLL_CONTAINER': 'dr-roll' };

        const rowData = [];

        for (const loc of data.locations) {
            const dc = data.flat.filter(c2 => c2.parentLabel === loc.label && c2.depth === 1);
            const matched = State.elements.some(el => matchElement(el, loc.label));
            const isGate = /^(?:OB|IB)[-\s]?/i.test(loc.label);

            let loosePkgs = 0, totalW = 0, emptyCount = 0, contentCount = 0, earliestAssoc = null;
            const groups = {};

            for (const c2 of dc) {
                if (c2.contType === 'PACKAGE') { loosePkgs++; totalW += c2.weight; contentCount++; }
                else {
                    groups[c2.contType] = (groups[c2.contType] || 0) + 1;
                    totalW += c2.descWeight;
                    if (c2.descPkgs === 0 && c2.childCount === 0) emptyCount++;
                    contentCount += c2.descPkgs || c2.childCount;
                }
                if (c2.assocTime) { try { const t2 = new Date(c2.assocTime); if (!isNaN(t2.getTime()) && (!earliestAssoc || t2 < earliestAssoc)) earliestAssoc = t2; } catch (e) { console.debug('[ShipMap] assocTime parse:', e.message); } }
            }

            const hasCont = Object.keys(groups).length > 0, isDwell = !hasCont && loosePkgs > 0;
            const rc = isDwell ? 'dr-dwell' : (matched ? 'dr-matched' : 'dr-unmatched');

            let content = '';

            if (isGate) {
                const gg = {}; let gp = 0;
                for (const child of dc) {
                    if (child.contType === 'TRAILER') {
                        const inside = data.flat.filter(c2 => c2.parentLabel === child.label && c2.depth === 2);
                        for (const tc of inside) { if (tc.contType === 'PACKAGE') gp++; else gg[tc.contType] = (gg[tc.contType] || 0) + 1; }
                    } else if (child.contType !== 'PACKAGE') gg[child.contType] = (gg[child.contType] || 0) + 1;
                    else gp++;
                }
                for (const [t2, n] of Object.entries(gg)) content += `<span class="dr-badge ${TC[t2] || 'dr-other'}">${n}${TS[t2] || t2}</span>`;
                const tl = Object.values(gg).reduce((s2, n) => s2 + n, 0);
                if (tl === 0 && gp === 0 && dc.length > 0) content += `<span style="font-size:9px;color:#5a6a7a">🚛attached</span>`;
                if (gp > 0) content += `<span class="dr-badge dr-pkg">${gp}pkg</span>`;
                contentCount = tl + gp;
            } else {
                for (const [t2, n] of Object.entries(groups)) content += `<span class="dr-badge ${TC[t2] || 'dr-other'}">${n}${TS[t2] || t2}</span>`;
                if (loosePkgs > 0) content += `<span class="dr-badge dr-pkg">${loosePkgs}pkg${isDwell ? '📬' : ''}</span>`;
                if (emptyCount > 0) content += `<span class="dr-badge dr-empty">⚠${emptyCount}∅</span>`;
            }

            if (!dc.length) content = `<span style="color:#5a6a7a;font-size:9px">∅</span>`;
            if (totalW > 0) content += `<span style="font-size:9px;color:#5a6a7a;margin-left:2px">${Math.round(totalW)}kg</span>`;
            if (!isGate && contentCount > 0 && contentCount < 20) content += `<span style="font-size:8px;color:#ff9800;margin-left:2px">⚠${contentCount}pkg</span>`;

            const sfMap = {};
            for (const c2 of dc) {
                if (c2.contType === 'PACKAGE') continue;
                const sf = c2.stackingFilter;
                if (sf) { const sfShort = simplifyStackingFilter(sf); sfMap[sfShort] = (sfMap[sfShort] || 0) + 1; }
                const children = data.flat.filter(ch => ch.parentLabel === c2.label && ch.depth === c2.depth + 1 && ch.contType !== 'PACKAGE');
                for (const ch of children) { const sf2 = ch.stackingFilter; if (sf2) { const sfShort2 = simplifyStackingFilter(sf2); sfMap[sfShort2] = (sfMap[sfShort2] || 0) + 1; } }
            }

            const sfEntries = Object.entries(sfMap).sort((a, b) => b[1] - a[1]);
            let sfHtml = '';
            if (sfEntries.length) { sfHtml = sfEntries.map(([sf, n]) => `<span class="dr-sf-badge">${sf}${n > 1 ? ` ×${n}` : ''}</span>`).join(''); }

            const mi = matched ? '✅' : '❌';
            const dwellMs = earliestAssoc ? (Date.now() - earliestAssoc.getTime()) : 0;
            const dwellStr = earliestAssoc ? dwellTimeStr(earliestAssoc.toISOString()) : '';
            const dwellMins = earliestAssoc ? dwellTimeMinutes(earliestAssoc.toISOString()) : 0;
            const prio = locSortPriority(loc.label);

            rowData.push({ label: loc.label, rc, mi, content, sfHtml, dwellStr, dwellMins, dwellMs, contentCount, isLongDwell: dwellMins > 120, matched, prio });
        }

        const flatNum = (label2) => { const u = label2.toUpperCase(); if (/^F(?:ST)?-/.test(u)) { const parts = u.split('-'); const n = parts.length >= 3 ? parseInt(parts[2]) : NaN; return isNaN(n) ? null : n; } return null; };

        const sort = State.drawerSort;
        if (sort === 'name') rowData.sort((a, b) => { if (a.prio !== b.prio) return a.prio - b.prio; const fa = flatNum(a.label), fb = flatNum(b.label); if (fa !== null && fb !== null) return fa - fb || a.label.localeCompare(b.label); if (fa !== null) return -1; if (fb !== null) return 1; return a.label.localeCompare(b.label); });
        else if (sort === 'content') rowData.sort((a, b) => b.contentCount - a.contentCount);
        else if (sort === 'dwell') rowData.sort((a, b) => b.dwellMs - a.dwellMs);

        const dFilter = this._drawerSearch;
        const filteredRowData = dFilter ? rowData.filter(r => {
            if (r.label.toUpperCase().includes(dFilter)) return true;
            if (r.sfHtml && r.sfHtml.toUpperCase().includes(dFilter)) return true;
            if (r.content && r.content.toUpperCase().includes(dFilter)) return true;
            return false;
        }) : rowData;

        let rows = '';
        let drawerFilteredOut = rowData.length - filteredRowData.length;

        for (const r2 of filteredRowData) rows += `<tr class="${r2.rc}" data-loc="${r2.label}"><td><span class="dr-loc">${r2.label}</span><span class="dr-match-icon">${r2.mi}</span>${r2.sfHtml ? `<div class="dr-sf-row">${r2.sfHtml}</div>` : ''}</td><td><div class="dr-content">${r2.content}</div></td><td class="dr-dwell-cell ${r2.isLongDwell ? 'long' : ''}">${r2.dwellStr ? `⏱${r2.dwellStr}` : '—'}</td></tr>`;

        if (drawerFilteredOut > 0) rows += `<tr><td colspan="3" style="text-align:center;font-size:10px;color:#5a6a7a;font-style:italic;padding:6px">🔍 ${drawerFilteredOut} locations hidden</td></tr>`;

        // ── Vista Other CPTs (RESTORED from v3.2.2) ──
        const sspExclude = {};
        for (const loc of data.locations) {
            if (!/STAGE|HOT[-_\s]?PICK|GENERAL/i.test(loc.label)) continue;
            const dc = data.flat.filter(c2 => c2.parentLabel === loc.label && c2.depth === 1);
            const types = {}; let totalPkgs = 0;
            for (const c2 of dc) { if (c2.contType === 'PACKAGE') totalPkgs++; else { types[c2.contType] = (types[c2.contType] || 0) + 1; totalPkgs += c2.descPkgs; } }
            if (Object.keys(types).length) sspExclude[loc.label] = { types, totalPkgs };
        }

        const vistaByLoc = getVistaRouteContainers(load.route, load.rawRoute, sspExclude);
        const vistaLocs = Object.entries(vistaByLoc).sort((a, b) => {
            const pr = (l) => { const u = l.toUpperCase(); if (/HOT[-_\s]?PICK/.test(u)) return 0; if (/GENERAL/.test(u)) return 1; return 2; };
            return pr(a[0]) - pr(b[0]) || a[0].localeCompare(b[0]);
        });

        const vistaGrandTotal = {}; let vistaGrandCnt = 0, vistaGrandPkgs = 0;
        for (const [, vd] of vistaLocs) { vistaGrandCnt += vd.total; vistaGrandPkgs += vd.totalPkgs; for (const [t, n] of Object.entries(vd.types)) vistaGrandTotal[t] = (vistaGrandTotal[t] || 0) + n; }

        let vistaHtml = '';
        if (vistaLocs.length) {
            const vistaTableRows = vistaLocs.map(([loc, vd]) => {
                const matched = State.elements.some(el => matchElement(el, loc));
                const typeBadges = Object.entries(vd.types).map(([t, n]) => `<span class="dr-badge ${TC[t] || 'dr-other'}">${n}${TS[t] || t}</span>`).join('');
                const dwC = vd.maxDwell > 120 ? 'long' : '';
                const dwStr = vd.maxDwell > 0 ? `⏱${formatDuration(vd.maxDwell * 60000)}` : '—';
                const cptBadges = Object.entries(vd.cpts).sort((a, b) => a[0].localeCompare(b[0])).map(([cpt, cd]) => {
                    const cTypes = Object.entries(cd.types).map(([t, n]) => `${n}${TS[t] || t}`).join('+');
                    return `<span class="dr-cpt-badge">${cpt} <span class="dr-cpt-cnt">${cTypes}</span></span>`;
                }).join('');
                return `<tr class="${matched ? 'dr-matched' : 'dr-unmatched'}" data-loc="${loc}"><td><span class="dr-loc">${loc}</span></td><td><div class="dr-content">${typeBadges}<span style="font-size:9px;color:#5a6a7a;margin-left:2px">${vd.totalPkgs}pkg</span></div><div class="dr-cpt-row">${cptBadges}</div></td><td class="dr-dwell-cell ${dwC}">${dwStr}</td></tr>`;
            }).join('');

            const grandTypesStr = Object.entries(vistaGrandTotal).map(([t, n]) => `<span class="dr-badge ${TC[t] || 'dr-other'}">${n}${TS[t] || t}</span>`).join('');

            vistaHtml = `<div class="other-cpt-section"><div class="other-cpt-header" id="other-cpt-toggle"><span>📦 Other CPTs on stages for <b>${load.route}</b> · ${vistaGrandCnt} cnt</span><span class="other-cpt-count">${vistaLocs.length}</span></div><div class="other-cpt-body" id="other-cpt-body" style="display:none"><table class="dtable"><thead><tr><th>Location</th><th>Content &amp; CPT</th><th>Dwell</th></tr></thead><tbody>${vistaTableRows}<tr class="vista-total-row"><td style="font-weight:bold;color:#ff9900">TOTAL</td><td><div class="dr-content">${grandTypesStr}<span style="font-size:9px;color:#ff9900;margin-left:4px">${vistaGrandPkgs}pkg</span></div></td><td></td></tr></tbody></table></div></div>`;
        }

        document.getElementById('drawer-body').innerHTML = `<table class="dtable"><thead><tr><th class="${sort === 'name' ? 'sort-active' : ''}" data-thsort="name">Loc</th><th class="${sort === 'content' ? 'sort-active' : ''}" data-thsort="content">Content</th><th class="${sort === 'dwell' ? 'sort-active' : ''}" data-thsort="dwell">Dwell</th></tr></thead><tbody>${rows}</tbody></table>${vistaHtml}`;

        document.getElementById('drawer-body').querySelectorAll('[data-thsort]').forEach(th => { th.addEventListener('click', () => { State.drawerSort = th.dataset.thsort; this._renderDrawerSort(); this._renderDrawer(load); }); });

        document.getElementById('drawer-body').querySelectorAll('tr[data-loc]').forEach(tr => { tr.addEventListener('click', () => { const el = State.elements.find(e2 => matchElement(e2, tr.dataset.loc)); if (el) { State.selectOnly(el); State.focusElement(el); R.render(); UI.refreshList(); UI.showInspector(State.primarySelected, !State.editMode); } }); });

        document.getElementById('other-cpt-toggle')?.addEventListener('click', () => { const body = document.getElementById('other-cpt-body'); if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none'; });
    },


    // ═══════════════════════════════════════════════════
    //  INSPECTOR
    // ═══════════════════════════════════════════════════
    showInspector(el, ro=false) {
        if (!el) { this.clearInspector(); return; } ro = ro || !State.editMode;

        const effMax = getEffectiveMaxContainers(el.name || el.id);
        const autoMaxInfo = effMax.source === 'auto'
            ? `<div style="font-size:9px;color:#4fc3f7;margin-top:-4px;margin-bottom:6px">⚡ Auto: ${effMax.max} (${effMax.label})</div>`
            : (effMax.source === 'none' && !el.maxContainers ? '<div style="font-size:9px;color:#5a6a7a;margin-top:-4px;margin-bottom:6px">No trailer detected</div>' : '');

        document.getElementById('insp').innerHTML = `<div class="fld"><label>ID</label><input value="${el.id}" readonly></div><div class="fld"><label>Name</label><input id="i-name" value="${el.name||''}" ${ro?'readonly':''}></div><div class="fld"><label>🔗 Chute</label><input id="i-chute" value="${el.chute||''}" ${ro?'readonly':''} spellcheck="false"></div><div class="fld"><label>Type</label><select id="i-type" ${ro?'disabled':''}>${Object.entries(ELEMENT_TYPES).map(([k,t])=>`<option value="${k}" ${k===el.type?'selected':''}>${t.label}</option>`).join('')}</select></div><div class="fr"><div class="fld"><label>X</label><input type="number" id="i-x" value="${el.x}" step="${CONFIG.grid.size}" ${ro?'readonly':''}></div><div class="fld"><label>Y</label><input type="number" id="i-y" value="${el.y}" step="${CONFIG.grid.size}" ${ro?'readonly':''}></div></div><div class="fr"><div class="fld"><label>W</label><input type="number" id="i-w" value="${el.w}" step="${CONFIG.grid.size}" min="${CONFIG.grid.size}" ${ro?'readonly':''}></div><div class="fld"><label>H</label><input type="number" id="i-h" value="${el.h}" step="${CONFIG.grid.size}" min="${CONFIG.grid.size}" ${ro?'readonly':''}></div></div><div class="fld"><label>📦 Max Containers</label><input type="number" id="i-maxc" value="${el.maxContainers||0}" min="0" placeholder="0 = auto" ${ro?'readonly':''}></div>${autoMaxInfo}${!ro?'<button class="btn del" id="i-del" style="width:100%;margin-top:6px">🗑️ Delete</button>':''}`;

        if (!ro) {
            const bind = (id, prop, fn=v=>v) => { document.getElementById(id)?.addEventListener('change', e => { State.pushUndo(); el[prop] = fn(e.target.value); State.save(); this.refreshList(); R.render(); }); };
            bind('i-name','name'); bind('i-chute','chute',v=>v.trim()); bind('i-type','type');
            bind('i-x','x',Number); bind('i-y','y',Number); bind('i-w','w',Number); bind('i-h','h',Number);
            bind('i-maxc','maxContainers',v=>Math.max(0,parseInt(v)||0));
            ['i-name','i-chute'].forEach(id=>document.getElementById(id)?.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter')e.target.blur();}));
            document.getElementById('i-maxc')?.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter')e.target.blur();});
            document.getElementById('i-del').onclick=()=>{State.pushUndo();State.elements=State.elements.filter(e2=>e2.id!==el.id);State.selectedIds.delete(el.id);State.save();this.clearInspector();this.refreshList();R.render();};
        }
    },

       showMultiInspector(ro=false) {
        ro = ro || !State.editMode;
        var sel = State.selectedElements;
        var ref = sel[0] || {};
        var html = '<div style="background:#ff9900;color:#000;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;display:inline-block;margin-bottom:8px">' + sel.length + ' selected</div>';
        if (!ro) {
            html += '<div class="fld"><label>Type</label><select id="mi-type"><option value="">\u2014 keep \u2014</option>';
            var te = Object.entries(ELEMENT_TYPES);
            for (var i = 0; i < te.length; i++) html += '<option value="' + te[i][0] + '">' + te[i][1].label + '</option>';
            html += '</select></div>';
            html += '<div class="fld"><label>\uD83D\uDD17 Chute prefix</label><input id="mi-chute-prefix" placeholder="prefix+num" spellcheck="false" style="font-family:monospace;background:#0d1b2a;color:#82b1ff;border:1px solid #2a3a4a;padding:5px 8px;border-radius:4px;width:100%"></div>';
            html += '<button class="btn cyan" id="mi-chute-apply" style="width:100%;margin-top:4px">\uD83D\uDD17 Apply Chute</button>';
            html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #2a3a4a"><label style="font-size:10px;color:#8899aa;text-transform:uppercase;display:block;margin-bottom:4px">\uD83D\uDCD0 Align</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px"><button class="btn sm" id="mi-align-x">X\u2192' + ref.x + '</button><button class="btn sm" id="mi-align-y">Y\u2192' + ref.y + '</button><button class="btn sm" id="mi-align-w">W\u2192' + ref.w + '</button><button class="btn sm" id="mi-align-h">H\u2192' + ref.h + '</button></div></div>';
            html += '<div class="fld" style="margin-top:6px"><label>\uD83D\uDCE6 Max Containers</label><div style="display:flex;gap:4px"><input type="number" id="mi-maxc" min="0" placeholder="0 = auto" style="flex:1;background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:5px 8px;border-radius:4px;font-size:12px"><button class="btn sm cyan" id="mi-maxc-apply">\u2713</button></div></div>';
            html += '<div style="display:flex;gap:6px;margin-top:6px"><button class="btn" id="mi-cp" style="flex:1">\uD83D\uDCCB Copy</button><button class="btn" id="mi-dp" style="flex:1">\uD83D\uDCCB Dup</button></div>';
            html += '<button class="btn del" id="mi-del" style="width:100%;margin-top:6px">\uD83D\uDDD1 Delete All</button>';
        } else {
            html += '<div class="ie">Unlock to edit</div>';
        }
        document.getElementById('insp').innerHTML = html;
        if (ro) return;
        var self = this;
        document.getElementById('mi-type').onchange = function(e) { if (!e.target.value) return; State.pushUndo(); for (var s of State.selectedElements) s.type = e.target.value; State.save(); self.refreshList(); R.render(); };
        document.getElementById('mi-chute-apply').onclick = function() {
            var raw = document.getElementById('mi-chute-prefix').value.trim(); if (!raw) return; State.pushUndo();
            var nm = raw.match(/^(.*?)(\d+)$/);
            if (!nm) { for (var s of State.selectedElements) s.chute = raw; }
            else { var p = nm[1], st = parseInt(nm[2], 10), pd = nm[2].length; var sorted = [...State.selectedElements].sort(function(a, b) { if (Math.abs(a.y - b.y) < 10) return a.x - b.x; return a.y - b.y; }); sorted.forEach(function(el, i) { el.chute = p + String(st + i).padStart(pd, '0'); }); }
            State.save(); self.refreshList(); R.render();
        };
        document.getElementById('mi-chute-prefix')?.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Enter') document.getElementById('mi-chute-apply').click(); });
        document.getElementById('mi-cp').onclick = function() { State.copySelection(); R.render(); };
        document.getElementById('mi-dp').onclick = function() { State.duplicateSelected(CONFIG.grid.size, CONFIG.grid.size); self.refreshList(); R.render(); };
        document.getElementById('mi-del').onclick = function() { State.pushUndo(); State.elements = State.elements.filter(function(el) { return !State.selectedIds.has(el.id); }); State.clearSelection(); State.save(); self.clearInspector(); self.refreshList(); R.render(); };
        document.getElementById('mi-align-x').onclick = function() { var v = sel[0]?.x; if (v == null) return; State.pushUndo(); for (var s of State.selectedElements) s.x = v; State.save(); R.render(); };
        document.getElementById('mi-align-y').onclick = function() { var v = sel[0]?.y; if (v == null) return; State.pushUndo(); for (var s of State.selectedElements) s.y = v; State.save(); R.render(); };
        document.getElementById('mi-align-w').onclick = function() { var v = sel[0]?.w; if (v == null) return; State.pushUndo(); for (var s of State.selectedElements) s.w = v; State.save(); R.render(); };
        document.getElementById('mi-align-h').onclick = function() { var v = sel[0]?.h; if (v == null) return; State.pushUndo(); for (var s of State.selectedElements) s.h = v; State.save(); R.render(); };
        document.getElementById('mi-maxc-apply').onclick = function() { var v = Math.max(0, parseInt(document.getElementById('mi-maxc').value) || 0); State.pushUndo(); for (var s of State.selectedElements) s.maxContainers = v; State.save(); R.render(); UI.setStatus('\uD83D\uDCE6 Max containers \u2192 ' + v); };
        document.getElementById('mi-maxc')?.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Enter') document.getElementById('mi-maxc-apply').click(); });
    },
 clearInspector() { document.getElementById('insp').innerHTML='<div class="ie">Select element(s)...</div>'; },
    refreshList() {
        const list = document.getElementById('elist');
        document.getElementById('elcnt').textContent = State.elements.length;
        const delBtn = document.getElementById('b-del-selected');
        if (delBtn) { delBtn.style.display = (State.editMode && State.selectedIds.size > 0) ? 'inline-block' : 'none'; }

        list.innerHTML = State.elements.map(el => {
            const t = ELEMENT_TYPES[el.type];
            const isHL = State.isHighlighted(el);
            const hl2 = State.getHighlight(el);
            const isDwell = isHL && hl2?.onlyLoose;
            const ct = el.chute ? `<span style="color:#5a7a9a;font-size:9px">🔗</span>` : '';
            const ht = isDwell ? '<span style="color:#78909C;font-size:9px">📬</span>' : (isHL ? '<span style="color:#ff9900;font-size:9px">🔦</span>' : '');
            const dt = State.editMode ? `<button class="eli-del" data-del-id="${el.id}">✕</button>` : '';
            return `<div class="eli ${State.isSelected(el)?'sel':''}" data-id="${el.id}"><div class="esw" style="background:${t?.color||'#888'}"></div><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${el.name||el.id}</span><span style="display:flex;align-items:center;gap:2px">${ct}${ht}${dt}</span></div>`;
        }).join('');

        list.querySelectorAll('.eli').forEach(item => {
            item.addEventListener('click', e => {
                if (e.target.closest('.eli-del')) return;
                const el = State.elements.find(x => x.id === item.dataset.id);
                if (!el) return;
                if (e.ctrlKey || e.metaKey) State.toggleSelect(el); else State.selectOnly(el);
                State.mode = MODE.SELECT; this.updateToolbar();
                const ro = !State.editMode;
                if (State.selectedIds.size === 1) this.showInspector(State.primarySelected, ro);
                else if (State.selectedIds.size > 1) this.showMultiInspector(ro);
                else this.clearInspector();
                this.refreshList(); R.render();
            });
        });

        list.querySelectorAll('.eli-del').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                State.pushUndo();
                State.elements = State.elements.filter(e2 => e2.id !== btn.dataset.delId);
                State.selectedIds.delete(btn.dataset.delId);
                State.save(); this.clearInspector(); this.refreshList(); R.render();
            });
        });
    },
    showYmsHint(wh) { const bar = document.getElementById('yms-token-bar'); if (bar) bar.classList.remove('collapsed'); },

    // ═══════════════════════════════════════════════════
    //  OVERLAYS
    // ═══════════════════════════════════════════════════
    openSummary() {
        document.getElementById('summary-overlay')?.remove(); const data = Summary.build();
        const overlay = document.createElement('div'); overlay.id = 'summary-overlay'; overlay.className = 'summary-overlay';
        overlay.innerHTML = `<div class="summary-panel">${Summary.render(data)}</div>`; document.body.appendChild(overlay);
        document.getElementById('summary-close').onclick = () => overlay.remove();
        document.getElementById('summary-copy').onclick = () => { navigator.clipboard.writeText(Summary.toClipboard(data)).then(() => { UI.setStatus('📋 Copied!'); }); };
        document.getElementById('summary-refresh').onclick = () => { const nd = Summary.build(); document.querySelector('.summary-panel').innerHTML = Summary.render(nd); document.getElementById('summary-close').onclick = () => overlay.remove(); document.getElementById('summary-copy').onclick = () => { navigator.clipboard.writeText(Summary.toClipboard(nd)); }; };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    },
    openQuickNav() {
        document.getElementById('quicknav-overlay')?.remove();
        const overlay = document.createElement('div'); overlay.id = 'quicknav-overlay'; overlay.className = 'quicknav-overlay';
        overlay.innerHTML = `<div class="quicknav-box"><div style="font-size:11px;color:#8899aa;margin-bottom:8px;text-transform:uppercase">⌨️ Quick Nav</div><input class="quicknav-input" id="quicknav-input" placeholder="Type location name..." spellcheck="false"><div class="quicknav-results" id="quicknav-results"></div><div class="quicknav-hint">↑↓ navigate · Enter select · Esc close</div></div>`;
        document.body.appendChild(overlay);
        const input = document.getElementById('quicknav-input'), resultsList = document.getElementById('quicknav-results'); let matches = [], activeIdx = 0;
        const updateResults = () => { const q = input.value.toUpperCase().trim(); if (!q) { matches = []; resultsList.innerHTML = ''; return; } matches = State.elements.filter(el => { const name = (el.name || el.id).toUpperCase(); const chute = (el.chute || '').toUpperCase(); return name.includes(q) || chute.includes(q); }).slice(0, 8); activeIdx = 0; renderResults(); };
        const renderResults = () => { if (!matches.length) { resultsList.innerHTML = input.value.trim() ? '<div style="padding:8px;font-size:11px;color:#5a6a7a">No matches</div>' : ''; return; } resultsList.innerHTML = matches.map((el, i) => { const t = ELEMENT_TYPES[el.type]; return `<div class="quicknav-item ${i === activeIdx ? 'active' : ''}" data-qn-idx="${i}"><div class="qn-type" style="background:${t?.color || '#888'}"></div><span class="qn-name">${el.name || el.id}</span></div>`; }).join(''); resultsList.querySelectorAll('.quicknav-item').forEach(item => { item.addEventListener('click', () => goTo(parseInt(item.dataset.qnIdx))); }); };
        const goTo = (idx) => { const el = matches[idx]; if (!el) return; overlay.remove(); State.selectOnly(el); State.focusElement(el); R.render(); UI.refreshList(); UI.showInspector(State.primarySelected, !State.editMode); };
        input.addEventListener('input', updateResults);
        input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { overlay.remove(); return; } if (e.key === 'ArrowDown') { e.preventDefault(); if (matches.length) { activeIdx = (activeIdx + 1) % matches.length; renderResults(); } return; } if (e.key === 'ArrowUp') { e.preventDefault(); if (matches.length) { activeIdx = (activeIdx - 1 + matches.length) % matches.length; renderResults(); } return; } if (e.key === 'Enter') { e.preventDefault(); if (matches.length) goTo(activeIdx); return; } });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => input.focus(), 50);
    },

    // ═══════════════════════════════════════════════════
    //  SIDEBAR + DASHBOARD
    // ═══════════════════════════════════════════════════
openTrend() {
        document.getElementById('trend-overlay')?.remove();
        var overlay = document.createElement('div');
        overlay.id = 'trend-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px)';

        var hours = 12;

        var buildContent = function(h) {
            var data = Trend.getData(h);
            if (!data.length) return '<div style="padding:40px;text-align:center;color:#5a6a7a">No trend data yet \u2014 snapshots every 10 min</div>';

            var renderChart = function(opts) {
                var d = opts.data, w = opts.width || 500, ht = opts.height || 130, series = opts.series;
                if (!d.length) return '';
                var pad = { top: 10, right: 12, bottom: 28, left: 40 };
                var cw = w - pad.left - pad.right, ch = ht - pad.top - pad.bottom;
                var tsMin = d[0].ts, tsMax = d[d.length - 1].ts, tsRange = Math.max(tsMax - tsMin, 60000);
                var autoMax = 0;
                for (var si = 0; si < series.length; si++) { for (var di = 0; di < d.length; di++) { var v = series[si].getValue(d[di]); if (v > autoMax) autoMax = v; } }
                autoMax = Math.ceil(autoMax * 1.15) || 10;
                var xScale = function(ts) { return pad.left + ((ts - tsMin) / tsRange) * cw; };
                var yScale = function(v) { return pad.top + ch - ((v) / autoMax) * ch; };
                var svg = '<svg width="' + w + '" height="' + ht + '" viewBox="0 0 ' + w + ' ' + ht + '" xmlns="http://www.w3.org/2000/svg" style="display:block">';
                // Grid
                for (var gi = 0; gi <= 4; gi++) {
                    var val = autoMax * (gi / 4), y = yScale(val);
                    svg += '<line x1="' + pad.left + '" y1="' + y + '" x2="' + (w - pad.right) + '" y2="' + y + '" stroke="#2a3a4a" stroke-width="1"/>';
                    svg += '<text x="' + (pad.left - 6) + '" y="' + (y + 3) + '" text-anchor="end" font-size="9" fill="#5a6a7a" font-family="monospace">' + Math.round(val) + '</text>';
                }
                // Hour markers
                var hourMs = 3600000, firstHour = Math.ceil(tsMin / hourMs) * hourMs;
                for (var t = firstHour; t <= tsMax; t += hourMs) {
                    var x = xScale(t);
                    if (x < pad.left + 10 || x > w - pad.right - 10) continue;
                    var dd = new Date(t);
                    svg += '<line x1="' + x + '" y1="' + pad.top + '" x2="' + x + '" y2="' + (pad.top + ch) + '" stroke="#2a3a4a" stroke-width="1" stroke-dasharray="4,4"/>';
                    svg += '<text x="' + x + '" y="' + (ht - 4) + '" text-anchor="middle" font-size="9" fill="#5a6a7a" font-family="monospace">' + String(dd.getHours()).padStart(2, '0') + ':00</text>';
                }
                // Series lines
                for (var s = 0; s < series.length; s++) {
                    var points = [];
                    for (var pi = 0; pi < d.length; pi++) points.push({ x: xScale(d[pi].ts), y: yScale(series[s].getValue(d[pi])) });
                    if (points.length < 2) { svg += '<circle cx="' + points[0].x + '" cy="' + points[0].y + '" r="3" fill="' + series[s].color + '"/>'; continue; }
                    var pathD = '';
                    for (var pp = 0; pp < points.length; pp++) pathD += (pp === 0 ? 'M' : 'L') + points[pp].x.toFixed(1) + ',' + points[pp].y.toFixed(1);
                    svg += '<path d="' + pathD + '" fill="none" stroke="' + series[s].color + '" stroke-width="' + (series[s].width || 1.5) + '" stroke-linejoin="round" opacity="' + (series[s].opacity || 0.9) + '"/>';
                    var last = points[points.length - 1];
                    svg += '<circle cx="' + last.x + '" cy="' + last.y + '" r="3" fill="' + series[s].color + '"/>';
                }
                svg += '</svg>';
                return svg;
            };

            var makeLegend = function(series) {
                var h2 = '';
                for (var i = 0; i < series.length; i++) h2 += '<span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:' + series[i].color + '"></span>' + series[i].label + '</span>';
                return '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px;font-size:10px;color:#8899aa">' + h2 + '</div>';
            };

            var loadsSeries = [
                { label: 'Total', color: '#ff9900', getValue: function(d2) { return d2.loads.total; } },
                { label: 'Departed', color: '#9e9e9e', getValue: function(d2) { return d2.loads.departed; } },
                { label: 'Active', color: '#69f0ae', getValue: function(d2) { return d2.loads.active; } },
                { label: 'Scheduled', color: '#5a6a7a', opacity: 0.5, getValue: function(d2) { return d2.loads.scheduled; } }
            ];
            var ymsSeries = [
                { label: 'Utilization %', color: '#4fc3f7', width: 2, getValue: function(d2) { return d2.yms.util; } },
                { label: 'Unavailable', color: '#ff5252', getValue: function(d2) { return d2.yms.unavail; } }
            ];
            var vistaSeries = [
                { label: 'Stacked', color: '#4fc3f7', getValue: function(d2) { return d2.vista.stacked; } },
                { label: 'Staged', color: '#ffd600', getValue: function(d2) { return d2.vista.staged; } },
                { label: 'Loaded', color: '#69f0ae', getValue: function(d2) { return d2.vista.loaded; } },
                { label: 'Critical locs', color: '#ff1744', getValue: function(d2) { return d2.vista.criticalLocs; } }
            ];
            var dwellSeries = [
                { label: 'Avg dwell', color: '#ff9900', width: 2, getValue: function(d2) { return d2.vista.avgDwell; } },
                { label: 'Max dwell', color: '#ff5252', opacity: 0.5, getValue: function(d2) { return d2.vista.maxDwell; } }
            ];

            var out = '';
            out += '<div style="background:#1a2236;border:1px solid #2a3a4a;border-radius:8px;padding:12px 16px;margin-bottom:16px"><h3 style="font-size:11px;color:#ff9900;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px 0">\uD83D\uDCE1 OB Loads</h3>' + renderChart({ data: data, series: loadsSeries }) + makeLegend(loadsSeries) + '</div>';
            out += '<div style="background:#1a2236;border:1px solid #2a3a4a;border-radius:8px;padding:12px 16px;margin-bottom:16px"><h3 style="font-size:11px;color:#ff9900;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px 0">\uD83C\uDFD7\uFE0F YMS Yard</h3>' + renderChart({ data: data, series: ymsSeries }) + makeLegend(ymsSeries) + '</div>';
            out += '<div style="background:#1a2236;border:1px solid #2a3a4a;border-radius:8px;padding:12px 16px;margin-bottom:16px"><h3 style="font-size:11px;color:#ff9900;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px 0">\uD83D\uDCE6 Vista Containers</h3>' + renderChart({ data: data, series: vistaSeries }) + makeLegend(vistaSeries) + '</div>';
            out += '<div style="background:#1a2236;border:1px solid #2a3a4a;border-radius:8px;padding:12px 16px;margin-bottom:16px"><h3 style="font-size:11px;color:#ff9900;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px 0">\u23F1 Dwell Time</h3>' + renderChart({ data: data, series: dwellSeries }) + makeLegend(dwellSeries) + '</div>';

            return out;
        };

        var renderOverlay = function() {
            overlay.innerHTML = '<div style="background:#111827;border:2px solid #ff9900;border-radius:12px;width:92vw;max-width:1100px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.8)">'
                + '<div style="padding:12px 20px;display:flex;justify-content:space-between;align-items:center;background:#1a2236;border-bottom:2px solid #ff9900">'
                + '<h2 style="font-size:16px;color:#ff9900;margin:0;display:flex;align-items:center;gap:8px">\uD83D\uDCC8 Trend Tracking</h2>'
                + '<div style="display:flex;gap:6px;align-items:center">'
                + '<button class="btn sm ' + (hours === 4 ? 'on' : '') + '" data-th="4">4h</button>'
                + '<button class="btn sm ' + (hours === 8 ? 'on' : '') + '" data-th="8">8h</button>'
                + '<button class="btn sm ' + (hours === 12 ? 'on' : '') + '" data-th="12">12h</button>'
                + '<button class="btn sm ' + (hours === 24 ? 'on' : '') + '" data-th="24">24h</button>'
                + '<button class="btn sm ' + (hours === 48 ? 'on' : '') + '" data-th="48">48h</button>'
                + '<button id="trend-close" style="background:none;border:none;color:#5a6a7a;font-size:20px;cursor:pointer;padding:4px 8px;margin-left:8px">\u2715</button>'
                + '</div></div>'
                + '<div style="flex:1;overflow-y:auto;padding:16px 20px">' + buildContent(hours) + '</div>'
                + '<div style="padding:8px 20px;border-top:1px solid #2a3a4a;display:flex;justify-content:space-between;align-items:center;background:#0d1b2a">'
                + '<span style="font-size:10px;color:#5a6a7a">' + Trend.getData().length + ' snapshots total | showing last ' + hours + 'h</span>'
                + '<div style="display:flex;gap:6px"><button class="btn sm del" id="trend-clear">\uD83D\uDDD1 Clear</button></div>'
                + '</div></div>';

            document.getElementById('trend-close').onclick = function() { overlay.remove(); };
            overlay.querySelectorAll('[data-th]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    hours = parseInt(btn.dataset.th);
                    renderOverlay();
                });
            });
            document.getElementById('trend-clear').onclick = function() {
                if (confirm('Clear all trend data?')) { Trend.clear(); renderOverlay(); }
            };
        };

        document.body.appendChild(overlay);
        renderOverlay();
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    },
    openHandover() {

        document.getElementById('handover-overlay')?.remove();

        const shift = getCurrentShift();
        const fmtTime = (d) => `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;

        // ── Shift start snapshot from trend data ──
        const trendData = Trend.getData();
        const shiftStart = shift.startDate.getTime();
        const startSnap = trendData.find(s => s.ts >= shiftStart) || trendData[0] || null;
        const nowSnap = trendData.length ? trendData[trendData.length - 1] : null;

        // ── Current Vista state ── remaining on stages/fields ──
        const TS = { 'PALLET': '🛒 Pallet', 'GAYLORD': '📫 Gaylord', 'CART': '🛒 Cart', 'BAG': '👜 Bag' };
        const TC = { 'PALLET': '#ffd600', 'GAYLORD': '#e040fb', 'CART': '#69f0ae', 'BAG': '#4fc3f7' };

        const remaining = State.vistaContainers.filter(c => c._state !== 'Loaded');
        const remainTypes = {};
        let remainPkgs = 0;
        for (const c of remaining) {
            remainTypes[c.type] = (remainTypes[c.type] || 0) + 1;
            remainPkgs += c.childCount || 0;
        }

        const remainByLoc = {};
        for (const c of remaining) {
            const loc = c.location || 'UNKNOWN';
            if (!remainByLoc[loc]) remainByLoc[loc] = { types: {}, total: 0, pkgs: 0, maxDwell: 0, routes: {} };
            const g = remainByLoc[loc];
            g.types[c.type] = (g.types[c.type] || 0) + 1;
            g.total++;
            g.pkgs += c.childCount || 0;
            if (c.dwellTimeInMinutes > g.maxDwell) g.maxDwell = c.dwellTimeInMinutes;
            const route = c.route ? routeGroupKey(c.route) : 'UNKNOWN';
            g.routes[route] = (g.routes[route] || 0) + 1;
        }

        const remainLocs = Object.entries(remainByLoc).sort((a, b) => b[1].total - a[1].total);

        // ── Delta calculation (shift processed) ──
        const processed = {};
        let processedTotal = 0;
        if (startSnap && nowSnap && startSnap.vista?.typesByState && nowSnap.vista?.typesByState) {
            const startLoaded = startSnap.vista.typesByState?.Loaded || {};
            const nowLoaded = nowSnap.vista.typesByState?.Loaded || {};
            const allTypes = new Set([...Object.keys(startLoaded), ...Object.keys(nowLoaded)]);
            for (const t of allTypes) {
                const delta = (nowLoaded[t] || 0) - (startLoaded[t] || 0);
                if (delta > 0) { processed[t] = delta; processedTotal += delta; }
            }
        }

        // ── SSP departed count ──
        const shiftLoads = State.sspLoads.filter(l => {
            if (l.status !== 'DEPARTED') return false;
            if (!l.sdt || l.sdt === '—') return false;
            try { const d = new Date(l.sdt); return d >= shift.startDate && d <= shift.endDate; } catch { return false; }
        });

        const departedByEquip = {};
        for (const l of shiftLoads) {
            const eq = equipTypeShort(l.equipmentType) || 'OTHER';
            departedByEquip[eq] = (departedByEquip[eq] || 0) + 1;
        }

        // ── YMS current snapshot ──
        const ymsTrailers = [];
        const fieldTrailers = [];
        for (const loc of State.ymsLocations) {
            const locCode = (loc.code || '').toUpperCase();
            const isField = !(/^(?:OB|IB)[-\s]?\d/i.test(locCode));
            for (const asset of (loc.yardAssets || [])) {
                if (asset.type === 'TRACTOR') continue;
                const vrIds = ymsGetVrIds(asset);
                const hasLoad = vrIds.length > 0 || (asset.status === 'FULL' || asset.status === 'IN_PROGRESS');
                if (!hasLoad || asset.unavailable) continue;
                const vrId = vrIds[0]?.toUpperCase() || '';
                const sspLoad = vrId ? State.sspLoads.find(l => l.vrId && l.vrId.toUpperCase() === vrId) : null;
                const route = sspLoad ? sspLoad.route : (asset.load?.lane || asset.load?.routes?.[0] || '');
                const sspStatus = sspLoad ? sspLoad.statusShort : '';
                const vistaLoc = State.vistaLocMap[locCode] || State.vistaLocMap[loc.code] || null;
                const vistaTypes = vistaLoc ? { ...vistaLoc.types } : {};
                const vistaPkgs = vistaLoc ? vistaLoc.totalPkgs : 0;
                const vistaTotal = vistaLoc ? vistaLoc.totalContainers : 0;
                const entry = { location: loc.code, type: equipTypeShort(asset.type), eqColor: equipTypeColor(asset.type), owner: asset.owner?.code || asset.broker?.code || '—', vrId, status: asset.status, route, sspStatus, vistaTypes, vistaPkgs, vistaTotal, isField };
                ymsTrailers.push(entry);
                if (isField && (asset.status === 'FULL' || asset.status === 'IN_PROGRESS' || vistaTotal > 0)) { fieldTrailers.push(entry); }
            }
        }

        const fieldByType = {};
        for (const ft of fieldTrailers) {
            let dominantType = 'UNKNOWN'; let maxCount = 0;
            for (const [t, n] of Object.entries(ft.vistaTypes)) { if (n > maxCount) { maxCount = n; dominantType = t; } }
            if (!fieldByType[dominantType]) fieldByType[dominantType] = [];
            fieldByType[dominantType].push(ft);
        }

        // ── SSP MISS TRACKER ──
        const sspMisses = [];
        for (const l of State.sspLoads) {
            if (l.status === 'DEPARTED' || l.status === 'CANCELLED') continue;
            if (!isCptEqualsSdt(l)) continue;
            if (!isSdtOverdue(l, 30)) continue;
            const sdtDate = new Date(l.sdt);
            const overdueMins = Math.floor((Date.now() - sdtDate.getTime()) / 60000);
            let pkgCount = 0, containerCount = 0;
            if (l._containers) { pkgCount = l._containers.stats.packageCount || 0; containerCount = l._containers.stats.locationCount || 0; }
            sspMisses.push({ route: l.route, rawRoute: l.rawRoute, vrId: l.vrId || '—', status: l.statusShort, statusColor: l.statusColor, sdt: l.sdt, dockDoor: l.dockDoor, equipType: equipTypeShort(l.equipmentType), overdueMins, pkgCount, containerCount });
        }
        sspMisses.sort((a, b) => b.overdueMins - a.overdueMins);

        // ── VISTA MISS TRACKER ──
        const now = Date.now();
        const vistaMissMap = {};
        for (const c of State.vistaContainers) {
            if (c._state === 'Loaded') continue;
            if (!c.cpt) continue;
            if (!c.childCount || c.childCount <= 1) continue;
            if (!c.isClosed && !c.closed) continue;
            let cptMs;
            try {
                cptMs = typeof c.cpt === 'number' ? c.cpt : new Date(c.cpt).getTime();
                if (isNaN(cptMs)) continue;
                if (cptMs < 1e12) cptMs = cptMs * 1000;
            } catch { continue; }
            if (now - cptMs < 30 * 60000) continue;
            const overdueMins = Math.floor((now - cptMs) / 60000);
            const route = c.route ? routeGroupKey(c.route) : 'UNKNOWN';
            const containerName = c.id || c.type || '—';
            if (!vistaMissMap[route]) vistaMissMap[route] = [];
            vistaMissMap[route].push({ containerName, type: c.type, childCount: c.childCount, location: c.location || '—', state: c._state, overdueMins, cptMs });
        }

        const vistaMisses = Object.entries(vistaMissMap)
            .sort((a, b) => b[1].length - a[1].length)
            .map(([route, containers]) => ({ route, containers: containers.sort((a, b) => b.overdueMins - a.overdueMins), totalPkgs: containers.reduce((s, c) => s + c.childCount, 0), totalContainers: containers.length }));
        const vistaMissTotal = vistaMisses.reduce((s, r) => s + r.totalContainers, 0);
        const vistaMissTotalPkgs = vistaMisses.reduce((s, r) => s + r.totalPkgs, 0);

        // ── Render ──
        const processedCards = Object.entries(processed).length
            ? Object.entries(processed).map(([t, n]) => `<div class="handover-card"><div class="handover-card-val" style="color:${TC[t] || '#ff9900'}">${n}</div><div class="handover-card-label">${TS[t] || t}</div></div>`).join('')
              + `<div class="handover-card"><div class="handover-card-val" style="color:#ff9900">${processedTotal}</div><div class="handover-card-label">Total loaded</div></div>`
            : '<div style="color:#5a6a7a;font-size:11px;font-style:italic;padding:8px">No trend data from shift start yet — snapshots every 10min</div>';

        const remainCards = Object.entries(remainTypes).length
            ? Object.entries(remainTypes).map(([t, n]) => `<div class="handover-card"><div class="handover-card-val" style="color:${TC[t] || '#ff9900'}">${n}</div><div class="handover-card-label">${TS[t] || t}</div></div>`).join('')
              + `<div class="handover-card"><div class="handover-card-val" style="color:#b0bec5">${remainPkgs}</div><div class="handover-card-label">Packages</div></div>`
            : '<div style="color:#5a6a7a;font-size:11px;font-style:italic;padding:8px">No remaining containers</div>';

        const locRows = remainLocs.map(([loc, d]) => {
            const types = Object.entries(d.types).map(([t, n]) => `<span class="handover-type-badge" style="background:${TC[t] || '#5a6a7a'}22;color:${TC[t] || '#8899aa'}">${n} ${(TS[t] || t).replace(/^[^\s]+\s/, '')}</span>`).join('');
            const topRoutes = Object.entries(d.routes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} ×${n}`).join(', ');
            const dwC = d.maxDwell > 120 ? '#ff5252' : d.maxDwell > 60 ? '#ff9100' : '#78909C';
            const matched = State.elements.some(el => matchElement(el, loc));
            return `<tr><td style="font-family:monospace;font-weight:bold;color:${matched ? '#e0e0e0' : '#ff5252'};white-space:nowrap">${loc} ${matched ? '' : '❌'}</td><td>${types}</td><td style="text-align:center;font-weight:bold;color:#ff9900">${d.total}</td><td style="text-align:center;color:#b0bec5">${d.pkgs}</td><td style="font-family:monospace;color:${dwC};font-size:10px">${d.maxDwell > 0 ? d.maxDwell + 'm' : '—'}</td><td style="font-size:9px;color:#78909C">${topRoutes}</td></tr>`;
        }).join('');

        const departedCards = Object.entries(departedByEquip).length
            ? Object.entries(departedByEquip).map(([eq, n]) => `<div class="handover-card"><div class="handover-card-val" style="color:#9e9e9e">${n}</div><div class="handover-card-label">${eq}</div></div>`).join('')
              + `<div class="handover-card"><div class="handover-card-val" style="color:#69f0ae">${shiftLoads.length}</div><div class="handover-card-label">Total DEP</div></div>`
            : '<div style="color:#5a6a7a;font-size:11px;font-style:italic;padding:8px">No departed loads this shift</div>';

        const overlay = document.createElement('div');
        overlay.id = 'handover-overlay';
        overlay.className = 'handover-overlay';

        overlay.innerHTML = `<div class="handover-panel">
<div class="handover-hdr">
<h2>📋 Shift Handover — <span style="background:#ff9900;color:#000;padding:2px 10px;border-radius:10px;font-size:13px">${shift.label}</span>
<span style="font-size:12px;color:#8899aa;font-weight:normal;font-family:monospace;margin-left:8px">${fmtTime(shift.startDate)} → ${fmtTime(shift.endDate)}</span>
</h2>
<button class="summary-close" id="handover-close">✕</button>
</div>
<div class="handover-body">

${sspMisses.length ? `<div class="handover-section">
<h3 style="color:#ff1744">🚨 SSP Missed CPT (${sspMisses.length} loads)
<span style="font-size:10px;color:#8899aa;font-weight:normal">SDT=CPT, 30+ min overdue, not departed</span>
</h3>
<div style="overflow-x:auto;border:2px solid rgba(255,23,68,0.3);border-radius:6px">
<table class="handover-loc-table">
<thead><tr><th>Route</th><th>Status</th><th>Door</th><th>VR ID</th><th>Equip</th><th style="text-align:center">Pkg</th><th style="text-align:center">Overdue</th></tr></thead>
<tbody>${sspMisses.map(m => `<tr style="background:rgba(255,23,68,0.05)">
<td style="font-family:monospace;font-weight:bold;color:#fff">${m.route}</td>
<td><span class="load-status" style="background:${m.statusColor};color:#000;font-size:9px">${m.status}</span></td>
<td style="color:#e040fb;font-weight:bold">${m.dockDoor !== '—' ? m.dockDoor : '—'}</td>
<td style="font-family:monospace;color:#4fc3f7;font-size:10px">${m.vrId}</td>
<td style="color:#e0e0e0;font-size:10px">${m.equipType}</td>
<td style="text-align:center;color:#ff9900;font-weight:bold">${m.pkgCount || '?'}</td>
<td style="text-align:center;font-family:monospace;color:#ff1744;font-weight:bold">${m.overdueMins}m</td>
</tr>`).join('')}</tbody>
</table></div></div>` : ''}

${vistaMisses.length ? `<div class="handover-section">
<h3 style="color:#ff1744">📦 Vista Missed CPT (${vistaMissTotal} containers · ${vistaMissTotalPkgs} pkg)
<span style="font-size:10px;color:#8899aa;font-weight:normal">CPT + 30min passed, not loaded</span>
</h3>
${vistaMisses.map(r => `<div style="margin-bottom:10px">
<div style="font-size:11px;font-weight:bold;color:#ff9900;margin-bottom:4px;display:flex;align-items:center;gap:8px">
→ ${r.route} <span style="color:#ff1744;font-size:10px">${r.totalContainers} cnt · ${r.totalPkgs} pkg</span>
</div>
<div style="overflow-x:auto;border:1px solid rgba(255,23,68,0.2);border-radius:6px">
<table class="handover-loc-table">
<thead><tr><th>Route</th><th>Container</th><th>Type</th><th>Location</th><th>State</th><th style="text-align:center">Pkg</th><th style="text-align:center">Overdue</th></tr></thead>
<tbody>${r.containers.map(c => {
    const dwC2 = c.overdueMins > 120 ? '#ff1744' : c.overdueMins > 60 ? '#ff5252' : '#ff9100';
    return `<tr style="background:rgba(255,23,68,0.03)">
<td style="font-family:monospace;color:#e0e0e0;font-size:10px">${r.route}</td>
<td style="font-family:monospace;font-weight:bold;color:#fff;font-size:10px">${c.containerName}</td>
<td style="color:#8899aa;font-size:10px">${c.type}</td>
<td style="font-family:monospace;color:#e0e0e0;font-size:10px">${c.location}</td>
<td style="color:${c.state === 'Stacked' ? '#4fc3f7' : '#ffd600'};font-size:10px">${c.state}</td>
<td style="text-align:center;color:#ff9900;font-weight:bold">${c.childCount}</td>
<td style="text-align:center;font-family:monospace;color:${dwC2};font-weight:bold">${c.overdueMins}m</td>
</tr>`;
}).join('')}</tbody>
</table></div></div>`).join('')}
</div>` : ''}

<div class="handover-section">
<h3>✅ Loaded this shift</h3>
<div class="handover-grid">${processedCards}</div>
</div>

<div class="handover-section">
<h3>✈️ Departed this shift (${shiftLoads.length} loads)</h3>
<div class="handover-grid">${departedCards}</div>
</div>

<div class="handover-section">
<h3>📦 Remaining to load <span style="font-size:11px;color:#8899aa;font-weight:normal">(${remaining.length} containers · ${remainLocs.length} locations)</span></h3>
<div class="handover-grid">${remainCards}</div>
</div>

<div class="handover-section">
<h3>📍 Remaining by location</h3>
${remainLocs.length ? `<div style="max-height:40vh;overflow-y:auto;border:1px solid #2a3a4a;border-radius:6px">
<table class="handover-loc-table">
<thead><tr><th>Location</th><th>Containers</th><th style="text-align:center">Cnt</th><th style="text-align:center">Pkg</th><th>Dwell</th><th>Routes</th></tr></thead>
<tbody>${locRows}</tbody>
</table></div>` : '<div style="color:#69f0ae;font-size:12px;padding:12px;text-align:center">🎉 All clear!</div>'}
</div>

${fieldTrailers.length ? `<div class="handover-section">
<h3>🏗️ Awaiting unload on fields (${fieldTrailers.length} trailers)</h3>
${Object.entries(fieldByType).sort((a, b) => b[1].length - a[1].length).map(([type, trailers]) => {
    const typeLabel = TS[type] || type;
    const typeColor = TC[type] || '#8899aa';
    return `<div style="margin-bottom:12px">
<div style="font-size:11px;font-weight:bold;color:${typeColor};margin-bottom:6px;display:flex;align-items:center;gap:6px">
<span class="handover-type-badge" style="background:${typeColor}22;color:${typeColor}">${typeLabel}</span>
<span style="color:#5a6a7a;font-weight:normal">${trailers.length} trailer${trailers.length > 1 ? 's' : ''}</span>
</div>
<div style="overflow-x:auto;border:1px solid #2a3a4a;border-radius:6px">
<table class="handover-loc-table">
<thead><tr><th>Field</th><th>Equip</th><th>Owner</th><th>VR ID</th><th>Route</th><th style="text-align:center">Cnt</th><th style="text-align:center">Pkg</th><th>Status</th></tr></thead>
<tbody>${trailers.map(ft => {
    const vtBadges = Object.entries(ft.vistaTypes).map(([t, n]) => `<span style="color:${TC[t] || '#8899aa'};font-size:10px;font-weight:bold">${n}${(TS[t] || t).replace(/^[^\s]+\s/, '')[0]}</span>`).join(' ');
    return `<tr>
<td style="font-family:monospace;font-weight:bold;color:#fff">${ft.location}</td>
<td><span style="color:${ft.eqColor};font-weight:bold;font-size:10px">${ft.type}</span></td>
<td style="color:#e0e0e0">${ft.owner}</td>
<td style="font-family:monospace;color:#4fc3f7;font-size:10px">${ft.vrId || '—'}</td>
<td style="font-size:10px;color:#e0e0e0">${ft.route || '—'}${ft.sspStatus ? `<span style="color:#5a6a7a">(${ft.sspStatus})</span>` : ''}</td>
<td style="text-align:center;color:#ff9900;font-weight:bold">${ft.vistaTotal || '—'}</td>
<td style="text-align:center;color:#b0bec5">${ft.vistaPkgs || '—'}</td>
<td style="color:${ft.status === 'FULL' ? '#ffd600' : ft.status === 'IN_PROGRESS' ? '#69f0ae' : '#e0e0e0'}">${ft.status || '—'}</td>
</tr>`;
}).join('')}</tbody>
</table></div></div>`;
}).join('')}
</div>` : ''}

${ymsTrailers.length ? `<div class="handover-section">
<h3>🚛 Trailers with loads in yard (${ymsTrailers.length})</h3>
<div style="max-height:30vh;overflow-y:auto;border:1px solid #2a3a4a;border-radius:6px">
<table class="handover-loc-table">
<thead><tr><th>Location</th><th>Type</th><th>Owner</th><th>VR ID</th><th>Status</th></tr></thead>
<tbody>${ymsTrailers.map(t => `<tr>
<td style="font-family:monospace;font-weight:bold;color:#fff">${t.location}</td>
<td style="color:#e0e0e0">${t.type}</td>
<td style="color:#e0e0e0">${t.owner}</td>
<td style="font-family:monospace;color:#4fc3f7;font-size:10px">${t.vrId || '—'}</td>
<td style="color:${t.status === 'FULL' ? '#ffd600' : t.status === 'IN_PROGRESS' ? '#69f0ae' : '#e0e0e0'}">${t.status || '—'}</td>
</tr>`).join('')}</tbody>
</table></div></div>` : ''}

</div>
<div class="handover-footer">
<span style="font-size:10px;color:#5a6a7a">📋 ${CONFIG.warehouseId} · ${shift.label} · ${new Date().toLocaleString()} · v3.4.0</span>
<div style="display:flex;gap:6px"><button class="btn sm" id="handover-copy">📋 Copy</button></div>
</div>
</div>`;

        document.body.appendChild(overlay);

        document.getElementById('handover-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        document.getElementById('handover-copy').onclick = () => {
            let text = `📋 SHIFT HANDOVER — ${CONFIG.warehouseId} ${shift.label}\n`;
            text += `${fmtTime(shift.startDate)} → ${fmtTime(shift.endDate)}\n${'═'.repeat(50)}\n\n`;

            if (sspMisses.length) {
                text += `🚨 SSP MISSED CPT (${sspMisses.length} loads):\n`;
                for (const m of sspMisses) { text += `  ${m.route} | ${m.status} | Door:${m.dockDoor} | ${m.vrId} | ${m.pkgCount || '?'}pkg | ${m.overdueMins}m overdue\n`; }
                text += '\n';
            }

            if (vistaMisses.length) {
                text += `📦 VISTA MISSED CPT (${vistaMissTotal} cnt · ${vistaMissTotalPkgs} pkg):\n`;
                for (const r of vistaMisses) {
                    text += `  → ${r.route} (${r.totalContainers} cnt · ${r.totalPkgs} pkg):\n`;
                    for (const c of r.containers) { text += `    ${c.containerName} | ${c.type} | ${c.location} | ${c.state} | ${c.childCount}pkg | ${c.overdueMins}m overdue\n`; }
                }
                text += '\n';
            }

            text += `✅ LOADED THIS SHIFT:\n`;
            if (Object.keys(processed).length) {
                for (const [t, n] of Object.entries(processed)) text += `  ${(TS[t] || t).replace(/^[^\s]+\s/, '')}: ${n}\n`;
                text += `  Total: ${processedTotal}\n`;
            } else text += `  No data yet\n`;

            text += `\n✈️ DEPARTED: ${shiftLoads.length} loads\n`;
            for (const [eq, n] of Object.entries(departedByEquip)) text += `  ${eq}: ${n}\n`;

            text += `\n📦 REMAINING: ${remaining.length} containers · ${remainPkgs} packages\n`;
            for (const [t, n] of Object.entries(remainTypes)) text += `  ${(TS[t] || t).replace(/^[^\s]+\s/, '')}: ${n}\n`;

            text += `\n📍 BY LOCATION:\n`;
            for (const [loc, d] of remainLocs) {
                const types = Object.entries(d.types).map(([t, n]) => `${n}${(TS[t] || t).replace(/^[^\s]+\s/, '')[0]}`).join(' ');
                const routes = Object.entries(d.routes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r).join(', ');
                text += `  ${loc}: ${d.total} cnt · ${d.pkgs} pkg · ${d.maxDwell}m dwell · ${routes}\n`;
            }

            if (fieldTrailers.length) {
                text += `\n🏗️ AWAITING UNLOAD ON FIELDS (${fieldTrailers.length}):\n`;
                for (const [type, trailers] of Object.entries(fieldByType).sort((a, b) => b[1].length - a[1].length)) {
                    const typeLabel = (TS[type] || type).replace(/^[^\s]+\s/, '');
                    text += `  ${typeLabel} (${trailers.length}):\n`;
                    for (const ft of trailers) {
                        const vtStr = Object.entries(ft.vistaTypes).map(([t, n]) => `${n}${(TS[t] || t).replace(/^[^\s]+\s/, '')[0]}`).join('+');
                        text += `    ${ft.location}: ${ft.type} · ${ft.owner} · ${ft.vrId || '—'} · ${ft.route || '—'} · ${vtStr || '—'} cnt · ${ft.status}\n`;
                    }
                }
            }

            if (ymsTrailers.length) {
                text += `\n🚛 TRAILERS WITH LOADS (${ymsTrailers.length}):\n`;
                for (const t of ymsTrailers) text += `  ${t.location}: ${t.type} · ${t.owner} · ${t.vrId || '—'} · ${t.status}\n`;
            }

            text += `\n${'═'.repeat(50)}\n${new Date().toLocaleString()} · Ship Map v3.4.0`;

            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('handover-copy');
                btn.textContent = '✅ Copied!';
                setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
            });
        };

        const escH = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escH); } };
        document.addEventListener('keydown', escH);
    },


     openDebug() {
        document.getElementById('debug-overlay')?.remove();

        const ymsRows = State.ymsLocations.map(loc => {
            const code = (loc.code || '').toUpperCase().trim();
            const els = MatchIndex.getMatching(code);
            const matched = els.length > 0;
            const elNames = els.map(e => e.name || e.id).join(', ');
            const assets = (loc.yardAssets || []).filter(a => a.type !== 'TRACTOR');
            const status = ymsGateStatus(loc);
            const vrIds = [];
            for (const a of assets) vrIds.push(...ymsGetVrIds(a));
            const owner = assets[0]?.owner?.code || assets[0]?.broker?.code || '';
            const eqType = assets[0]?.type || '';
            return { code, matched, elNames, assetCount: assets.length, status, vrIds: vrIds.slice(0, 2).join(', '), owner, eqType };
        }).sort((a, b) => {
            if (a.matched !== b.matched) return a.matched ? 1 : -1;
            return a.code.localeCompare(b.code);
        });

        const vistaRows = Object.entries(State.vistaLocMap).map(([locName, d]) => {
            const els = MatchIndex.getMatching(locName);
            const matched = els.length > 0;
            const elNames = els.map(e => e.name || e.id).join(', ');
            const level = (() => { const n = d.totalContainers; if (n <= 3) return 'low'; if (n <= 8) return 'medium'; if (n <= 15) return 'high'; return 'critical'; })();
            const types = Object.entries(d.types).map(([t, n]) => `${n}${t[0]}`).join(' ');
            return { code: locName, matched, elNames, containers: d.totalContainers, pkgs: d.totalPkgs, maxDwell: d.maxDwell, level, types };
        }).sort((a, b) => {
            if (a.matched !== b.matched) return a.matched ? 1 : -1;
            return b.containers - a.containers;
        });

        var ymsM = ymsRows.filter(r => r.matched).length;
        var ymsU = ymsRows.filter(r => !r.matched).length;
        var vistaM = vistaRows.filter(r => r.matched).length;
        var vistaU = vistaRows.filter(r => !r.matched).length;

        var stColor = { empty: '#5a6a7a', occupied: '#4fc3f7', yellow: '#ffd600', red: '#ff1744' };

        var ymsTableRows = '';
        for (var yi = 0; yi < ymsRows.length; yi++) {
            var r = ymsRows[yi];
            var sc = stColor[r.status] || '#5a6a7a';
            var eqShort = r.eqType ? equipTypeShort(r.eqType) : '';
            ymsTableRows += '<tr class="' + (r.matched ? 'debug-matched' : 'debug-unmatched') + '" style="' + (!r.matched ? 'background:rgba(255,82,82,0.08)' : '') + '">'
                + '<td style="font-family:monospace;font-weight:bold;font-size:11px;color:' + (r.matched ? '#e0e0e0' : '#ff5252') + ';white-space:nowrap">' + r.code + '</td>'
                + '<td>' + (r.matched ? '<span style="color:#69f0ae">\u2705</span> <span style="font-size:9px;color:#8899aa">' + r.elNames + '</span>' : '<span style="color:#ff5252">\u274C</span>') + '</td>'
                + '<td style="text-align:center;color:' + sc + ';font-size:10px">' + r.status + '</td>'
                + '<td style="text-align:center">' + (r.assetCount || '\u2014') + '</td>'
                + '<td style="font-size:10px;color:#78909C">' + r.owner + (eqShort ? ' \u00B7 ' + eqShort : '') + '</td>'
                + '<td style="font-size:10px;color:#4fc3f7;font-family:monospace">' + (r.vrIds || '') + '</td>'
                + '</tr>';
        }

        var lcMap = { low: '#69f0ae', medium: '#ffd600', high: '#ff9100', critical: '#ff1744' };

        var vistaTableRows = '';
        for (var vi = 0; vi < vistaRows.length; vi++) {
            var rv = vistaRows[vi];
            var lc = lcMap[rv.level] || '#69f0ae';
            var dwC = rv.maxDwell > 120 ? '#ff5252' : rv.maxDwell > 60 ? '#ff9100' : '#78909C';
            vistaTableRows += '<tr class="' + (rv.matched ? 'debug-matched' : 'debug-unmatched') + '" style="' + (!rv.matched ? 'background:rgba(255,82,82,0.08)' : '') + '">'
                + '<td style="font-family:monospace;font-weight:bold;font-size:11px;color:' + (rv.matched ? '#e0e0e0' : '#ff5252') + ';white-space:nowrap">' + rv.code + '</td>'
                + '<td>' + (rv.matched ? '<span style="color:#69f0ae">\u2705</span> <span style="font-size:9px;color:#8899aa">' + rv.elNames + '</span>' : '<span style="color:#ff5252">\u274C</span>') + '</td>'
                + '<td style="text-align:center;color:' + lc + ';font-weight:bold">' + rv.containers + '</td>'
                + '<td style="text-align:center;color:#b0bec5">' + rv.pkgs + '</td>'
                + '<td style="font-size:10px;color:#78909C">' + rv.types + '</td>'
                + '<td style="text-align:center;font-family:monospace;color:' + dwC + '">' + (rv.maxDwell > 0 ? rv.maxDwell + 'm' : '\u2014') + '</td>'
                + '</tr>';
        }

        var overlay = document.createElement('div');
        overlay.id = 'debug-overlay';
        overlay.className = 'summary-overlay';

        overlay.innerHTML = '<div class="summary-panel" style="max-width:1100px">'
            + '<div class="summary-hdr"><h2 style="font-size:16px;color:#ff9900;margin:0;display:flex;align-items:center;gap:8px">\uD83D\uDC1B Debug \u2014 Location Matching <span style="font-size:11px;color:#8899aa;font-weight:normal">Map: ' + State.elements.length + ' elements</span></h2>'
            + '<div style="display:flex;align-items:center;gap:12px"><label style="font-size:11px;color:#8899aa;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="debug-unmatched-only" style="accent-color:#ff5252"> Only \u274C unmatched</label>'
            + '<input id="debug-search" placeholder="Search..." style="background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:4px 8px;border-radius:4px;font-size:11px;width:140px" spellcheck="false">'
            + '<button class="summary-close" id="debug-close">\u2715</button></div></div>'
            + '<div style="display:flex;gap:12px;padding:12px 20px;background:#0d1b2a;border-bottom:1px solid #2a3a4a;flex-wrap:wrap">'
            + '<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="color:#ff9900;font-weight:bold">\uD83C\uDFD7\uFE0F YMS</span><span style="color:#69f0ae;font-weight:bold">' + ymsM + ' \u2705</span><span style="color:#ff5252;font-weight:bold">' + ymsU + ' \u274C</span><span style="color:#5a6a7a">/ ' + ymsRows.length + '</span>'
            + (ymsU > 0 ? '<span style="background:#ff5252;color:#fff;font-size:9px;padding:1px 6px;border-radius:8px;font-weight:bold">' + Math.round(ymsU / ymsRows.length * 100) + '% missing</span>' : '') + '</div>'
            + '<div style="width:1px;background:#2a3a4a"></div>'
            + '<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="color:#ff9900;font-weight:bold">\uD83D\uDCE6 Vista</span><span style="color:#69f0ae;font-weight:bold">' + vistaM + ' \u2705</span><span style="color:#ff5252;font-weight:bold">' + vistaU + ' \u274C</span><span style="color:#5a6a7a">/ ' + vistaRows.length + '</span>'
            + (vistaU > 0 ? '<span style="background:#ff5252;color:#fff;font-size:9px;padding:1px 6px;border-radius:8px;font-weight:bold">' + Math.round(vistaU / vistaRows.length * 100) + '% missing</span>' : '') + '</div></div>'
            + '<div class="summary-body" style="max-height:70vh;display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">'
            + '<div style="flex:1;min-width:420px"><h3 style="font-size:11px;color:#ff9900;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">\uD83C\uDFD7\uFE0F YMS Locations (' + ymsRows.length + ')</h3>'
            + '<div style="max-height:58vh;overflow-y:auto;border:1px solid #2a3a4a;border-radius:6px"><table class="summary-table" id="debug-yms-table" style="font-size:11px"><thead><tr><th>Location</th><th>Map</th><th style="text-align:center">Status</th><th style="text-align:center">\uD83D\uDE9B</th><th>Owner</th><th>VR ID</th></tr></thead><tbody>'
            + (ymsTableRows || '<tr><td colspan="6" style="color:#5a6a7a;text-align:center;padding:20px">No YMS data</td></tr>')
            + '</tbody></table></div></div>'
            + '<div style="flex:1;min-width:420px"><h3 style="font-size:11px;color:#ff9900;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">\uD83D\uDCE6 Vista Locations (' + vistaRows.length + ')</h3>'
            + '<div style="max-height:58vh;overflow-y:auto;border:1px solid #2a3a4a;border-radius:6px"><table class="summary-table" id="debug-vista-table" style="font-size:11px"><thead><tr><th>Location</th><th>Map</th><th style="text-align:center">Cnt</th><th style="text-align:center">Pkg</th><th>Types</th><th style="text-align:center">Dwell</th></tr></thead><tbody>'
            + (vistaTableRows || '<tr><td colspan="6" style="color:#5a6a7a;text-align:center;padding:20px">No Vista data</td></tr>')
            + '</tbody></table></div></div></div>'
            + '<div class="summary-footer"><span style="font-size:10px;color:#5a6a7a">\uD83D\uDC1B ' + CONFIG.warehouseId + ' \u00B7 ' + new Date().toLocaleString() + '</span>'
            + '<div style="display:flex;gap:6px"><button class="btn sm" id="debug-copy-yms">\uD83D\uDCCB YMS \u274C</button><button class="btn sm" id="debug-copy-vista">\uD83D\uDCCB Vista \u274C</button><button class="btn sm" id="debug-copy-all">\uD83D\uDCCB All \u274C</button></div></div></div>';

        document.body.appendChild(overlay);

        var applyFilters = function() {
            var unmatchedOnly = document.getElementById('debug-unmatched-only').checked;
            var search = (document.getElementById('debug-search').value || '').toUpperCase().trim();
            overlay.querySelectorAll('#debug-yms-table tbody tr, #debug-vista-table tbody tr').forEach(function(tr) {
                var isUnmatched = tr.classList.contains('debug-unmatched');
                var text = tr.textContent.toUpperCase();
                var matchFilter = !unmatchedOnly || isUnmatched;
                var matchSearch = !search || text.includes(search);
                tr.style.display = (matchFilter && matchSearch) ? '' : 'none';
            });
        };

        document.getElementById('debug-unmatched-only').onchange = applyFilters;
        var searchDb = null;
        document.getElementById('debug-search').addEventListener('input', function() { clearTimeout(searchDb); searchDb = setTimeout(applyFilters, 150); });
        document.getElementById('debug-search').addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Escape') { e.target.value = ''; applyFilters(); } });

        document.getElementById('debug-close').onclick = function() { overlay.remove(); };
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

        var copyList = function(rows, label) {
            var unmatched = rows.filter(function(r) { return !r.matched; }).map(function(r) { return r.code; });
            return '\uD83D\uDC1B ' + label + ' UNMATCHED \u2014 ' + CONFIG.warehouseId + ' (' + unmatched.length + ')\n' + (unmatched.join('\n') || '\u2014 all matched! \uD83C\uDF89');
        };

        document.getElementById('debug-copy-yms').onclick = function() { navigator.clipboard.writeText(copyList(ymsRows, 'YMS')).then(function() { var btn = document.getElementById('debug-copy-yms'); btn.textContent = '\u2705'; setTimeout(function() { btn.textContent = '\uD83D\uDCCB YMS \u274C'; }, 1500); }); };

        document.getElementById('debug-copy-vista').onclick = function() { navigator.clipboard.writeText(copyList(vistaRows, 'VISTA')).then(function() { var btn = document.getElementById('debug-copy-vista'); btn.textContent = '\u2705'; setTimeout(function() { btn.textContent = '\uD83D\uDCCB Vista \u274C'; }, 1500); }); };

        document.getElementById('debug-copy-all').onclick = function() { navigator.clipboard.writeText(copyList(ymsRows, 'YMS') + '\n\n' + copyList(vistaRows, 'VISTA')).then(function() { var btn = document.getElementById('debug-copy-all'); btn.textContent = '\u2705'; setTimeout(function() { btn.textContent = '\uD83D\uDCCB All \u274C'; }, 1500); }); };

        var escH = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escH); } };
        document.addEventListener('keydown', escH);
    },

    // ═══════════════════════════════════════════════════
    // MAP MANAGER OVERLAY
    // ═══════════════════════════════════════════════════

    openMapsMenu() {
        document.getElementById('maps-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'maps-overlay';
        overlay.className = 'maps-overlay';

        overlay.innerHTML = `<div class="maps-panel">
            <div class="maps-hdr">
                <h2>🗺️ Map Manager</h2>
                <button class="summary-close" id="maps-close">✕</button>
            </div>
            <div class="maps-body">

                <!-- Current map -->
                <div class="maps-section">
                    <div class="maps-current">
                        <span class="maps-current-site">${CONFIG.warehouseId}</span>
                        <div>
                            <div class="maps-current-info">📦 ${State.elements.length} elements</div>
                            <div class="maps-current-info">💾 Local storage</div>
                        </div>
                    </div>
                </div>

                <!-- GitHub download -->
                <div class="maps-section">
                    <h3>📥 Download from GitHub</h3>
                    <div style="font-size:10px;color:#5a6a7a;margin-bottom:8px">
                        Fetch <code style="color:#4fc3f7">shipmap_{SITE}.json</code> from
                        <a href="https://github.com/homziukl/Ship-Map-Builder" target="_blank" style="color:#42a5f5">repo</a>
                    </div>
                    <div class="maps-gh-row">
                        <span style="font-size:12px;color:#8899aa">shipmap_</span>
                        <input class="maps-gh-input" id="maps-gh-site" value="${CONFIG.warehouseId}"
                               maxlength="8" spellcheck="false" placeholder="SITE">
                        <span style="font-size:12px;color:#8899aa">.json</span>
                        <button class="btn" id="maps-gh-fetch" style="white-space:nowrap">📥 Fetch</button>
                    </div>
                    <div class="maps-status" id="maps-gh-status"></div>
                    <div class="maps-preview" id="maps-gh-preview">
                        <div style="font-size:10px;color:#ff9900;font-weight:bold;margin-bottom:6px">📋 Preview</div>
                        <div id="maps-gh-preview-info"></div>
                        <div class="maps-preview-actions">
                            <button class="btn green" id="maps-gh-apply-replace">🔄 Replace current</button>
                            <button class="btn cyan" id="maps-gh-apply-merge">📥+ Merge</button>
                        </div>
                    </div>
                </div>

                <!-- Saved snapshots -->
                <div class="maps-section">
                    <h3>💾 Saved Maps <span style="font-size:9px;color:#5a6a7a;font-weight:normal">(local snapshots)</span></h3>
                    <div id="maps-snap-list"></div>
                    <div class="maps-save-row">
                        <input class="maps-save-input" id="maps-save-label"
                               placeholder="${CONFIG.warehouseId} — ${new Date().toLocaleDateString()}" spellcheck="false">
                        <button class="btn green" id="maps-save-btn">💾 Save</button>
                    </div>
                </div>

            </div>
            <div class="maps-footer">
                <span>GitHub: homziukl/Ship-Map-Builder</span>
                <span>v3.4.0</span>
            </div>
        </div>`;

        document.body.appendChild(overlay);

        // ── State ──
        let fetchedData = null;

        // ── Close ──
        document.getElementById('maps-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // ── Prevent keyboard propagation ──
        overlay.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Escape') overlay.remove();
                if (e.key === 'Enter' && inp.id === 'maps-gh-site') document.getElementById('maps-gh-fetch').click();
                if (e.key === 'Enter' && inp.id === 'maps-save-label') document.getElementById('maps-save-btn').click();
            });
        });

        // ── GitHub Fetch ──
        const setStatus = (msg, cls) => {
            const el = document.getElementById('maps-gh-status');
            el.textContent = msg;
            el.className = `maps-status show ${cls}`;
        };

        const hideStatus = () => {
            document.getElementById('maps-gh-status').className = 'maps-status';
        };

        const showPreview = (data, site) => {
            const info = document.getElementById('maps-gh-preview-info');
            const elCount = data.elements?.length || 0;
            const typeCount = data.types ? Object.keys(data.types).length : 0;
            const hasBg = !!data.bgUrl;
            const exportedAt = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : '—';
            const version = data.version || '?';

            info.innerHTML = `
                <div class="maps-preview-row"><span>Site</span><b>${data.warehouse || site}</b></div>
                <div class="maps-preview-row"><span>Elements</span><b>${elCount}</b></div>
                <div class="maps-preview-row"><span>Types</span><b>${typeCount}</b></div>
                <div class="maps-preview-row"><span>BG image</span><b>${hasBg ? '✅ Yes' : '—'}</b></div>
                <div class="maps-preview-row"><span>Exported</span><b>${exportedAt}</b></div>
                <div class="maps-preview-row"><span>Version</span><b>${version}</b></div>
            `;
            document.getElementById('maps-gh-preview').classList.add('show');
        };

        const hidePreview = () => {
            document.getElementById('maps-gh-preview').classList.remove('show');
            fetchedData = null;
        };

        document.getElementById('maps-gh-fetch').addEventListener('click', async () => {
            const site = document.getElementById('maps-gh-site').value.trim().toUpperCase();
            if (!site || site.length < 2) { setStatus('⚠️ Enter a valid site code', 'err'); return; }

            hidePreview();
            setStatus('⏳ Fetching...', 'loading');
            document.getElementById('maps-gh-fetch').disabled = true;

            try {
                const data = await MapManager.fetchFromGitHub(site);
                fetchedData = data;

                const elCount = data.elements?.length || 0;
                if (!elCount) {
                    setStatus(`⚠️ File found but contains 0 elements`, 'err');
                    hidePreview();
                } else {
                    setStatus(`✅ Found: ${elCount} elements`, 'ok');
                    showPreview(data, site);
                }
            } catch (err) {
                setStatus(`❌ ${err.message}`, 'err');
                hidePreview();
            } finally {
                document.getElementById('maps-gh-fetch').disabled = false;
            }
        });

        // ── Apply: Replace ──
        document.getElementById('maps-gh-apply-replace').addEventListener('click', () => {
            if (!fetchedData) return;

            if (!confirm(`Replace current map (${State.elements.length} elements) with GitHub map (${fetchedData.elements?.length || 0} elements)?`)) return;

            // Auto-save before replacing
            MapManager.saveCurrent(`Auto-backup before GitHub replace`);

            const ok = MapManager.applyGitHubMap(fetchedData, 'replace');
            if (ok) {
                UI.setStatus(`✅ Map replaced: ${State.elements.length} elements from GitHub`);
                UI._initLegend();
                UI._initType();
                UI.refreshList();
                R.render();
                setStatus(`✅ Applied! ${State.elements.length} elements loaded`, 'ok');
                hidePreview();
                this._renderSnapList();
            } else {
                setStatus('❌ Failed to apply map', 'err');
            }
        });

        // ── Apply: Merge ──
        document.getElementById('maps-gh-apply-merge').addEventListener('click', () => {
            if (!fetchedData) return;

            const result = MapManager.applyGitHubMap(fetchedData, 'merge');
            if (result) {
                UI.setStatus(`✅ Merged: +${result.added} elements (${result.skipped} skipped)`);
                UI._initLegend();
                UI._initType();
                UI.refreshList();
                R.render();
                setStatus(`✅ Merged! +${result.added} new, ${result.skipped} skipped`, 'ok');
                hidePreview();
            } else {
                setStatus('❌ Failed to merge map', 'err');
            }
        });

        // ── Save current ──
        document.getElementById('maps-save-btn').addEventListener('click', () => {
            const label = document.getElementById('maps-save-label').value.trim() ||
                          `${CONFIG.warehouseId} — ${new Date().toLocaleString()}`;

            const meta = MapManager.saveCurrent(label);
            document.getElementById('maps-save-label').value = '';
            UI.setStatus(`💾 Map saved: "${meta.label}"`);
            this._renderSnapList();
        });

        // ── Render snapshot list ──
        this._renderSnapList();
    },

    _renderSnapList() {
        const container = document.getElementById('maps-snap-list');
        if (!container) return;

        const list = MapManager.getList();

        if (!list.length) {
            container.innerHTML = '<div class="maps-empty">No saved maps yet — click 💾 Save</div>';
            return;
        }

        container.innerHTML = list.map((m, idx) => {
            const date = m.savedAt ? new Date(m.savedAt) : null;
            const dateStr = date ? `${date.getDate().toString().padStart(2,'0')}/${(date.getMonth()+1).toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}` : '—';
            const isAutoBackup = m.label.startsWith('Auto-backup');

            return `<div class="maps-snap-item" data-snap-idx="${idx}">
                <span class="maps-snap-icon">${isAutoBackup ? '🔄' : '🗺️'}</span>
                <div class="maps-snap-info">
                    <div class="maps-snap-label" title="${m.label}">${m.label}</div>
                    <div class="maps-snap-meta">
                        <span>📦 ${m.elementCount || '?'} el</span>
                        <span>🏢 ${m.site || '?'}</span>
                        <span>📅 ${dateStr}</span>
                    </div>
                </div>
                <div class="maps-snap-actions">
                    <button class="btn sm green" data-snap-load="${m.key}" title="Load this map">📂</button>
                    <button class="btn sm" data-snap-export="${m.key}" title="Export as file">📤</button>
                    <button class="btn sm del" data-snap-del="${m.key}" title="Delete">✕</button>
                </div>
            </div>`;
        }).join('');

        // ── Load ──
        container.querySelectorAll('[data-snap-load]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.dataset.snapLoad;
                const meta = list.find(m => m.key === key);

                if (!confirm(`Load "${meta?.label}"?\nThis will replace current map (${State.elements.length} elements).`)) return;

                // Auto-save before loading
                MapManager.saveCurrent(`Auto-backup before loading "${meta?.label}"`);

                const ok = MapManager.loadSaved(key);
                if (ok) {
                    UI.setStatus(`✅ Loaded: "${meta?.label}"`);
                    UI._initLegend();
                    UI._initType();
                    UI.refreshList();
                    R.render();
                    this._renderSnapList();

                    // Update current map info
                    const currentSite = document.querySelector('.maps-current-site');
                    const currentInfo = document.querySelector('.maps-current-info');
                    if (currentSite) currentSite.textContent = CONFIG.warehouseId;
                    if (currentInfo) currentInfo.textContent = `📦 ${State.elements.length} elements`;
                } else {
                    UI.setStatus('❌ Failed to load map');
                }
            });
        });

        // ── Export ──
        container.querySelectorAll('[data-snap-export]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.dataset.snapExport;
                const raw = GM_getValue(key, null);
                if (!raw) return;
                const meta = list.find(m => m.key === key);
                const blob = new Blob([raw], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `shipmap_${meta?.site || CONFIG.warehouseId}.json`;
                a.click();
            });
        });

        // ── Delete ──
        container.querySelectorAll('[data-snap-del]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.dataset.snapDel;
                const meta = list.find(m => m.key === key);
                if (!confirm(`Delete "${meta?.label}"?`)) return;
                MapManager.deleteSaved(key);
                this._renderSnapList();
                UI.setStatus(`🗑️ Deleted: "${meta?.label}"`);
            });
        });
    },

printStages() {

    const load = State.sspLoads[State.drawerLoadIdx];
    if (!load?._containers) return;

    const data = load._containers;
    const TS = { 'PALLET': 'Pallet', 'GAYLORD': 'Gaylord', 'CART': 'Cart', 'BAG': 'Bag', 'CAGE': 'Cage', 'ROLL_CONTAINER': 'Roll' };
    const TC = { 'PALLET': '#ffd600', 'GAYLORD': '#e040fb', 'CART': '#69f0ae', 'BAG': '#4fc3f7' };

    const isStageLocation = (label) => /STAGE|HOT[-_\s]?PICK|GENERAL/i.test(label);

    const sortLocs = (a, b) => { const pr = (l) => { const u = l.toUpperCase(); if (/HOT[-_\s]?PICK/.test(u)) return 0; if (/GENERAL/.test(u)) return 1; return 2; }; return pr(a) - pr(b) || a.localeCompare(b); };

    const sspRows = [];
    const sspGrandTotal = {};

    for (const loc of data.locations) {
        if (!isStageLocation(loc.label)) continue;
        const dc = data.flat.filter(c => c.parentLabel === loc.label && c.depth === 1);
        const types = {}; let loosePkgs = 0;
        for (const c of dc) { if (c.contType === 'PACKAGE') loosePkgs++; else types[c.contType] = (types[c.contType] || 0) + 1; }
        const totalCnt = Object.values(types).reduce((s, n) => s + n, 0);
        if (totalCnt === 0 && loosePkgs === 0) continue;
        for (const [t, n] of Object.entries(types)) sspGrandTotal[t] = (sspGrandTotal[t] || 0) + n;
        const typeStr = Object.entries(types).map(([t, n]) => `${n}&times; ${TS[t] || t}`).join(', ');

        const sfMap = {};
        for (const c of dc) {
            if (c.contType === 'PACKAGE') continue;
            const sf = c.stackingFilter;
            if (sf) { const sfShort = simplifyStackingFilter(sf); sfMap[sfShort] = (sfMap[sfShort] || 0) + 1; }
            const children = data.flat.filter(ch => ch.parentLabel === c.label && ch.depth === c.depth + 1 && ch.contType !== 'PACKAGE');
            for (const ch of children) { const sf2 = ch.stackingFilter; if (sf2) { const sfShort2 = simplifyStackingFilter(sf2); sfMap[sfShort2] = (sfMap[sfShort2] || 0) + 1; } }
        }
        const sfStr = Object.entries(sfMap).sort((a, b) => b[1] - a[1]).map(([sf, n]) => `${sf}${n > 1 ? ' &times;' + n : ''}`).join(', ');
        sspRows.push({ label: loc.label, typeStr, loosePkgs, totalCnt, sfStr });
    }

    sspRows.sort((a, b) => sortLocs(a.label, b.label));

    const sspExclude = {};
    for (const loc of data.locations) {
        if (!isStageLocation(loc.label)) continue;
        const dc = data.flat.filter(c => c.parentLabel === loc.label && c.depth === 1);
        const types = {}; let totalPkgs = 0;
        for (const c of dc) { if (c.contType === 'PACKAGE') totalPkgs++; else { types[c.contType] = (types[c.contType] || 0) + 1; totalPkgs += c.descPkgs; } }
        if (Object.keys(types).length) sspExclude[loc.label] = { types, totalPkgs };
    }

    const vistaByLoc = getVistaRouteContainers(load.route, load.rawRoute, sspExclude);
    const vistaLocs = Object.entries(vistaByLoc).sort((a, b) => sortLocs(a[0], b[0]));
    const vistaGrandTotal = {}; let vistaGrandCnt = 0, vistaGrandPkgs = 0;
    for (const [, vd] of vistaLocs) { vistaGrandCnt += vd.total; vistaGrandPkgs += vd.totalPkgs; for (const [t, n] of Object.entries(vd.types)) vistaGrandTotal[t] = (vistaGrandTotal[t] || 0) + n; }

    if (!sspRows.length && !vistaLocs.length) { UI.setStatus('⚠️ No stage locations found'); return; }

    const sspGrandCnt = Object.values(sspGrandTotal).reduce((s, n) => s + n, 0);
    const sspGrandStr = Object.entries(sspGrandTotal).map(([t, n]) => `${n}&times; ${TS[t] || t}`).join(', ');
    const vistaGrandStr = Object.entries(vistaGrandTotal).map(([t, n]) => `${n}&times; ${TS[t] || t}`).join(', ');

    const shift = getCurrentShift(); const now = new Date();
    const fmtTime = (d) => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    const vrId = load.vrId?.toUpperCase() || '';
    const yiAll = State.findYmsForVrId(vrId);
    const ymsInfo = yiAll ? 'YMS: ' + yiAll.map(yi => `${yi.locationCode}${yi.fromAnnotation ? '(ann)' : ''}`).join(', ') : 'YMS: &mdash;';

    const sspTableRows = sspRows.map(r => `<tr><td class="loc">${r.label}</td><td>${r.typeStr || '&mdash;'}${r.loosePkgs ? ' + ' + r.loosePkgs + ' pkg' : ''}</td><td class="routes">${r.sfStr || ''}</td></tr>`).join('');

    const vistaTableRows = vistaLocs.map(([loc, vd]) => {
        const typeStr = Object.entries(vd.types).map(([t, n]) => `${n}&times; ${TS[t] || t}`).join(', ');
        const dwStr = vd.maxDwell > 0 ? `${vd.maxDwell}m` : '';
        const cptStr = Object.entries(vd.cpts).sort((a, b) => a[0].localeCompare(b[0])).map(([cpt, cd]) => {
            const ct = Object.entries(cd.types).map(([t, n]) => `${n}${TS[t] || t}`).join('+');
            return `<span class="cpt-tag">${cpt} (${ct})</span>`;
        }).join(' ');
        return `<tr><td class="loc">${loc}</td><td>${typeStr}</td><td class="pkg-count">${vd.totalPkgs}</td><td class="dwell${vd.maxDwell > 120 ? ' dwell-warn' : ''}">${dwStr}</td><td class="cpt-col">${cptStr}</td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Stages - ${load.route}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;padding:24px;color:#222;max-width:900px;margin:0 auto}h1{font-size:20px;margin-bottom:4px}h2{font-size:15px;margin:20px 0 8px;padding-top:12px;border-top:2px solid #333;display:flex;align-items:center;gap:8px}h2 .badge{background:#ff9900;color:#000;font-size:11px;padding:2px 8px;border-radius:10px}.meta{font-size:11px;color:#555;margin-bottom:16px;display:flex;gap:12px;flex-wrap:wrap}.meta span{white-space:nowrap}.meta b{color:#222}table{width:100%;border-collapse:collapse;margin-bottom:12px}th{text-align:left;padding:8px 12px;border-bottom:2px solid #333;font-size:11px;text-transform:uppercase;color:#555;letter-spacing:.5px}td{padding:6px 12px;border-bottom:1px solid #ddd;font-size:13px}.loc{font-weight:bold;font-family:'Consolas',monospace;white-space:nowrap}.routes{font-size:11px;color:#666}.pkg-count{text-align:center;color:#555}.dwell{font-family:monospace;font-size:11px;color:#888;text-align:center}.dwell-warn{color:#d32f2f;font-weight:bold}.total td{border-top:2px solid #333;font-weight:bold;padding:8px 12px}.cpt-tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:bold;background:#fff3e0;color:#e65100;margin:1px;white-space:nowrap}.cpt-col{font-size:10px}.vista-note{font-size:10px;color:#888;font-style:italic;margin-bottom:8px}.footer{font-size:9px;color:#999;margin-top:16px;border-top:1px solid #ddd;padding-top:6px;display:flex;justify-content:space-between}.no-print{margin-top:16px}@media print{.no-print{display:none!important}body{padding:12px}h2{page-break-before:avoid}}</style></head><body>
<h1>&#x1F4E6; ${load.route} &mdash; Stages</h1>
<div class="meta"><span>&#x1F69B; <b>${load.vrId || '&mdash;'}</b></span><span>${load.status.replace(/_/g, ' ')}</span><span>&#x1F6AA; <b>${load.dockDoor !== '—' ? load.dockDoor : '&mdash;'}</b></span><span>SDT: <b>${load.sdt !== '—' ? load.sdt : '&mdash;'}</b></span><span>${ymsInfo}</span><span>${shift.label} ${fmtTime(shift.startDate)}&rarr;${fmtTime(shift.endDate)}</span></div>
${sspRows.length ? `<h2>&#x1F4CB; This load (SSP)</h2><table><thead><tr><th>Location</th><th>Containers</th><th>Routes</th></tr></thead><tbody>${sspTableRows}<tr class="total"><td>TOTAL</td><td>${sspGrandCnt} (${sspGrandStr})</td><td>${sspRows.length} locations</td></tr></tbody></table>` : '<p style="color:#888;font-style:italic;margin:12px 0">No staged containers for this load</p>'}
${vistaLocs.length ? `<h2>&#x1F4E6; Other CPTs for ${load.route} (Vista) <span class="badge">${vistaGrandCnt} cnt</span></h2><div class="vista-note">Containers from other CPTs currently on stage locations (excluding this load)</div><table><thead><tr><th>Location</th><th>Containers</th><th>Packages</th><th>Max Dwell</th><th>CPTs</th></tr></thead><tbody>${vistaTableRows}<tr class="total"><td>TOTAL</td><td>${vistaGrandCnt} (${vistaGrandStr})</td><td class="pkg-count">${vistaGrandPkgs}</td><td></td><td></td></tr></tbody></table>` : ''}
<div class="footer"><span>${CONFIG.warehouseId} &middot; ${now.toLocaleString()} &middot; Ship Map v3.4.0</span></div>
<div class="no-print"><button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;background:#ff9900;border:none;color:#000;border-radius:6px;font-weight:bold">&#x1F5A8;&#xFE0F; Print</button></div>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
        win.addEventListener('afterprint', () => URL.revokeObjectURL(url));
        win.addEventListener('unload', () => URL.revokeObjectURL(url));
    }
},


    _sbVisible: true,
    _initSidebarResize() {
        const handle = document.getElementById('sb-resize'); if (!handle) return;
        let dragging = false, startX = 0, startWidth = 0;
        handle.addEventListener('mousedown', (e) => { e.preventDefault(); dragging = true; startX = e.clientX; startWidth = this._sbWidth; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
            const onMove = (e2) => { if (!dragging) return; this._sbWidth = Math.min(this._sbMaxWidth, Math.max(this._sbMinWidth, startWidth + (startX - e2.clientX))); this._applySbLayout(); };
            const onUp = () => { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); GM_setValue(CONFIG.storage.sidebarWidthKey, this._sbWidth); setTimeout(() => R.resize(), 50); };
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
    },
    _initDashboard() {
        document.getElementById('sb-toggle')?.addEventListener('click', () => { this._sbVisible = !this._sbVisible; this._applySbLayout(); setTimeout(() => R.resize(), 300); });
        document.getElementById('dash-refresh')?.addEventListener('click', () => { SSP.fetchData(); if (YMS._token) YMS.fetchData(); VISTA.fetchData(); FMC.fetchData(); });
        document.getElementById('dash-summary-fab')?.addEventListener('click', () => this.openSummary());
        document.getElementById('dash-zoom-fit')?.addEventListener('click', () => {
            if (!State.elements.length) return;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const el of State.elements) { minX = Math.min(minX, el.x); minY = Math.min(minY, el.y); maxX = Math.max(maxX, el.x + el.w); maxY = Math.max(maxY, el.y + el.h); }
            const cw = R.canvas.width, ch = R.canvas.height; const pw = maxX - minX + 80, ph = maxY - minY + 80;
            const scale = Math.min(cw / pw, ch / ph, 4);
            State.scale = scale; State.offsetX = (cw - pw * scale) / 2 - minX * scale + 40 * scale; State.offsetY = (ch - ph * scale) / 2 - minY * scale + 40 * scale;
            State.saveViewport(); R.render();
        });
        this._applySbLayout();
    },
    _applySbLayout() {
        const sb = document.querySelector('.sb'), cvs = document.querySelector('.cvs'),
            btn = document.getElementById('sb-toggle'), drawer = document.getElementById('drawer-wrap');
        if (!sb || !btn || !cvs) return;
        const w = this._sbWidth;
        const dw = State.dashboardMode ? w + 40 : w;

        if (State.dashboardMode && this._sbVisible) {
            sb.style.right = '0'; sb.style.width = dw + 'px'; sb.style.zIndex = '100';
            sb.style.boxShadow = '-4px 0 20px rgba(0,0,0,0.6)'; cvs.style.marginRight = '0';
            btn.textContent = '✕';
            btn.setAttribute('style', `position:absolute;z-index:101;right:12px;top:12px;width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,0.15);box-shadow:0 2px 12px rgba(0,0,0,0.5);font-size:20px;background:#ff9900;color:#000;cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;padding:0`);
            if (drawer) drawer.style.right = '0';
        } else if (State.dashboardMode && !this._sbVisible) {
            sb.style.right = -dw + 'px'; sb.style.width = dw + 'px'; sb.style.zIndex = '60';
            sb.style.boxShadow = 'none'; cvs.style.marginRight = '0';
            btn.textContent = '📋';
            btn.setAttribute('style', `position:absolute;z-index:91;right:12px;top:12px;width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,0.15);box-shadow:0 2px 12px rgba(0,0,0,0.5);font-size:20px;background:#232f3e;color:#ff9900;cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;padding:0`);
            if (drawer) drawer.style.right = '0';
        } else if (!State.dashboardMode && this._sbVisible) {
            sb.style.right = '0'; sb.style.width = w + 'px'; sb.style.zIndex = '60';
            sb.style.boxShadow = 'none'; cvs.style.marginRight = w + 'px';
            btn.textContent = '◀';
            btn.setAttribute('style', `position:absolute;z-index:91;right:${w}px;top:50%;transform:translateY(-50%);width:24px;height:52px;border-radius:6px 0 0 6px;border:1px solid #3a4a5a;border-right:none;background:#232f3e;color:#ff9900;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;padding:0`);
            if (drawer) drawer.style.right = w + 'px';
        } else {
            sb.style.right = -w + 'px'; sb.style.width = w + 'px'; sb.style.zIndex = '60';
            sb.style.boxShadow = 'none'; cvs.style.marginRight = '0';
            btn.textContent = '▶';
            btn.setAttribute('style', `position:absolute;z-index:91;right:0;top:50%;transform:translateY(-50%);width:24px;height:52px;border-radius:0 6px 6px 0;border:1px solid #3a4a5a;border-left:none;background:#232f3e;color:#ff9900;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;padding:0`);
            if (drawer) drawer.style.right = '0';
        }
    },

    toggleDashboard() {
        State.dashboardMode = !State.dashboardMode;
        const app = document.getElementById('app'), dashBtn = document.getElementById('b-dashboard');
        this._sbVisible = !State.dashboardMode;
        if (State.dashboardMode) {
            app.classList.add('dashboard-mode');
            dashBtn.classList.add('on');
            dashBtn.textContent = '📺 Exit';
            try { document.documentElement.requestFullscreen?.(); } catch (e) { console.debug('[ShipMap] fullscreen:', e.message); }
            this.updateDashKpi();
            this._dashKpiTimer = setInterval(() => this.updateDashKpi(), 10000);
        } else {
            app.classList.remove('dashboard-mode');
            dashBtn.classList.remove('on');
            dashBtn.textContent = '📺';
            try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch (e) { console.debug('[ShipMap] exitFullscreen:', e.message); }
            clearInterval(this._dashKpiTimer);
        }
        this._applySbLayout();
        setTimeout(() => R.resize(), 350);
    },
    updateDashKpi() {
        const bar = document.getElementById('dash-kpi-bar'); if (!bar || !State.dashboardMode) return;

        const shift = getCurrentShift(), now = new Date(), remaining = Math.max(0, shift.endDate - now);
        const remH = Math.floor(remaining / 3600000), remM = Math.floor((remaining % 3600000) / 60000);

        const loads = State.sspLoads;
        const departed = loads.filter(l => l.status === 'DEPARTED').length;
        const loading = loads.filter(l => l.status === 'LOADING_IN_PROGRESS').length, finished = loads.filter(l => l.status === 'FINISHED_LOADING').length, attached = loads.filter(l => l.status === 'TRAILER_ATTACHED').length, ready = loads.filter(l => l.status === 'READY_TO_DEPART').length;
        const inFacility = loading + finished + attached + ready;

        const ymsOccupied = State.ymsLocations.filter(l => l.yardAssets?.some(a => a.type !== 'TRACTOR')).length, ymsTotal = State.ymsLocations.length, ymsUtil = ymsTotal > 0 ? Math.round(ymsOccupied / ymsTotal * 100) : 0;

        const vc = State.vistaContainers, vStacked = vc.filter(c => c._state === 'Stacked').length, vStaged = vc.filter(c => c._state === 'Staged').length;
        const criticalLocs = Object.entries(State.vistaLocMap).filter(([, d]) => d.totalContainers > 15).length;

        const fmtTime = (d) => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

        bar.innerHTML = `<span class="dash-shift-badge">${shift.label}</span>
<div class="dash-kpi"><span class="dash-kpi-val" style="color:#ff9900">${loads.length}</span><span class="dash-kpi-label">Loads</span></div>
<div class="dash-kpi"><span class="dash-kpi-val" style="color:#9e9e9e">${departed}</span><span class="dash-kpi-label">Departed</span></div>
<div class="dash-kpi"><span class="dash-kpi-val" style="color:#69f0ae">${inFacility}</span><span class="dash-kpi-label">Active</span></div>
<div class="dash-kpi-sep"></div>
<div class="dash-kpi"><span class="dash-kpi-val" style="color:${ymsUtil>85?'#ff1744':ymsUtil>65?'#ff9100':'#69f0ae'}">${ymsUtil}%</span><span class="dash-kpi-label">Yard</span></div>
<div class="dash-kpi-sep"></div>
<div class="dash-kpi"><span class="dash-kpi-val" style="color:#4fc3f7">${vStacked}</span><span class="dash-kpi-label">📥Stack</span></div>
<div class="dash-kpi"><span class="dash-kpi-val" style="color:#ffd600">${vStaged}</span><span class="dash-kpi-label">📤Stage</span></div>
${criticalLocs > 0 ? `<div class="dash-kpi"><span class="dash-kpi-val" style="color:#ff1744">${criticalLocs}</span><span class="dash-kpi-label">🔴Crit</span></div>` : ''}
${(() => { const cptUrgent = loads.filter(l => l.status !== 'DEPARTED' && l.status !== 'CANCELLED' && (() => { const c = cptCountdown(l.cpt); return c && (c.level === 'critical' || c.level === 'past'); })()).length; return cptUrgent > 0 ? `<div class="dash-kpi"><span class="dash-kpi-val" style="color:#ff1744">${cptUrgent}</span><span class="dash-kpi-label">⏰CPT!</span></div>` : ''; })()}
<span class="dash-time">⏱ ${remH}h${remM}m · ${fmtTime(now)}</span>`;
    },


    _initSettings() {
        document.getElementById('b-settings').onclick = () => {
            this._settingsOpen = !this._settingsOpen;
            this._renderSettings();
        };
    },

    _renderSettings() {
        var wrap = document.getElementById('settings-wrap');
        if (!this._settingsOpen) { wrap.innerHTML = ''; return; }
        var sh = getCurrentShiftLabel();
        var hasBg = BgImage.loaded;
        wrap.innerHTML = '<div class="settings-panel" style="margin:0;padding:8px 12px;background:rgba(0,0,0,.15);border-bottom:1px solid #2a3a4a">'
            + '<h4 style="font-size:10px;color:#ff9900;margin-bottom:6px;text-transform:uppercase">\u23F0 Shift (' + sh + ')</h4>'
            + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px"><label style="color:#8899aa;font-size:10px;min-width:25px">DS</label><input type="time" id="set-ds-start" value="' + SiteSettings.dsStart + '" style="background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:3px 6px;border-radius:3px;font-size:11px"><span>\u2192</span><input type="time" id="set-ds-end" value="' + SiteSettings.dsEnd + '" style="background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:3px 6px;border-radius:3px;font-size:11px"></div>'
            + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px"><label style="color:#8899aa;font-size:10px;min-width:25px">NS</label><input type="time" id="set-ns-start" value="' + SiteSettings.nsStart + '" style="background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:3px 6px;border-radius:3px;font-size:11px"><span>\u2192</span><input type="time" id="set-ns-end" value="' + SiteSettings.nsEnd + '" style="background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:3px 6px;border-radius:3px;font-size:11px"></div>'
            + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px"><input type="checkbox" id="set-filter-swap" ' + (SiteSettings.filterSwapBefore ? 'checked' : '') + ' style="accent-color:#ff9900"><label style="color:#8899aa;font-size:10px">Hide orphan swap bodies</label></div>'
            + '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #2a3a4a"><h4 style="font-size:10px;color:#82b1ff;margin-bottom:6px;text-transform:uppercase">\uD83D\uDDBC BG Image</h4>'
            + '<div style="display:flex;gap:4px;margin-bottom:4px"><button class="btn sm" id="bg-upload">\uD83D\uDCC2 File</button><button class="btn sm cyan" id="bg-url-btn">\uD83D\uDD17 URL</button>' + (hasBg ? '<button class="btn sm cyan" id="bg-edit-toggle">\uD83D\uDCD0 Move</button><button class="btn sm del" id="bg-remove">\uD83D\uDDD1 Remove</button>' : '') + '</div>'
            + '<div id="bg-url-wrap" style="display:none;margin-top:4px"><div style="display:flex;gap:4px"><input id="bg-url-input" style="flex:1;background:#0d1b2a;color:#4fc3f7;border:1px solid #2a3a4a;padding:4px 8px;border-radius:4px;font-size:10px" placeholder="https://...image.png" spellcheck="false" value="' + (BgImage.bgUrl || '') + '"><button class="btn sm green" id="bg-url-apply">\u2713</button></div></div>'
            + (hasBg ? '<div style="margin-top:4px"><div style="display:flex;align-items:center;gap:6px;font-size:11px"><label style="color:#8899aa;font-size:10px;min-width:50px">Opacity</label><input type="range" id="bg-opacity" min="0.05" max="1" step="0.05" value="' + SiteSettings.bgOpacity + '" style="flex:1;accent-color:#ff9900"></div><div style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:4px"><label style="color:#8899aa;font-size:10px;min-width:50px">Scale</label><input type="range" id="bg-scale" min="0.05" max="10" step="0.05" value="' + SiteSettings.bgScale + '" style="flex:1;accent-color:#ff9900"></div></div>' : '')
            + '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #2a3a4a">'
+ '<h4 style="font-size:10px;color:#69f0ae;margin-bottom:6px;text-transform:uppercase">☁️ GitSync</h4>'
+ '<div style="display:flex;gap:4px;margin-bottom:4px">'
+ '<input id="gitsync-token" type="password" style="flex:1;background:#0d1b2a;color:#69f0ae;border:1px solid #2a3a4a;padding:4px 8px;border-radius:4px;font-size:10px;font-family:monospace" placeholder="ghp_..." value="' + (GitSync._getToken() ? '••••••••••' : '') + '" spellcheck="false">'
+ '<button class="btn sm green" id="gitsync-save">✓</button>'
+ '</div>'
+ '<div style="display:flex;gap:4px">'
+ '<button class="btn sm cyan" id="gitsync-push">☁️ Push now</button>'
+ '<button class="btn sm" id="gitsync-pull">📥 Pull</button>'
+ (GitSync.enabled ? '<button class="btn sm del" id="gitsync-remove">✕</button>' : '')
+ '</div>'
+ '<div style="font-size:9px;color:#5a6a7a;margin-top:4px">'
+ (GitSync.enabled ? '✅ Auto-sync ON — pushes 10s after edits' : '❌ No token — edits stay local only')
+ '</div></div>'
+ '</div></div>';
        var self = this;
        var bt = function(id, key) { var el = document.getElementById(id); if (el) el.addEventListener('change', function(e) { SiteSettings[key] = e.target.value; saveSiteSettingsImmediate(); SSP.fetchData(); }); };
        bt('set-ds-start','dsStart'); bt('set-ds-end','dsEnd'); bt('set-ns-start','nsStart'); bt('set-ns-end','nsEnd');
        var sf = document.getElementById('set-filter-swap'); if (sf) sf.addEventListener('change', function(e) { SiteSettings.filterSwapBefore = e.target.checked; saveSiteSettingsImmediate(); SSP.fetchData(); });
        var urlBtn = document.getElementById('bg-url-btn'); if (urlBtn) urlBtn.onclick = function() { var w = document.getElementById('bg-url-wrap'); w.style.display = w.style.display === 'none' ? '' : 'none'; };
        var urlApply = document.getElementById('bg-url-apply'); if (urlApply) urlApply.onclick = function() { var url = document.getElementById('bg-url-input').value.trim(); if (url) { BgImage.setUrl(url); self._renderSettings(); } };
        var urlInput = document.getElementById('bg-url-input'); if (urlInput) urlInput.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Enter') document.getElementById('bg-url-apply').click(); });
        var upBtn = document.getElementById('bg-upload'); if (upBtn) upBtn.onclick = function() { var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = function(ev) { var file = ev.target.files[0]; if (!file) return; var reader = new FileReader(); reader.onload = function(re) { BgImage.set(re.target.result); self._renderSettings(); R.render(); }; reader.readAsDataURL(file); }; inp.click(); };
        if (hasBg) {
            var editBtn = document.getElementById('bg-edit-toggle'); if (editBtn) editBtn.onclick = function() { State.bgEditMode = !State.bgEditMode; R.canvas.style.cursor = State.bgEditMode ? 'crosshair' : 'default'; R.render(); };
            var remBtn = document.getElementById('bg-remove'); if (remBtn) remBtn.onclick = function() { State.bgEditMode = false; BgImage.remove(); R.canvas.style.cursor = 'default'; self._renderSettings(); };
            var opSlider = document.getElementById('bg-opacity'); if (opSlider) { opSlider.addEventListener('input', function(e) { SiteSettings.bgOpacity = parseFloat(e.target.value); R.render(); }); opSlider.addEventListener('change', function() { saveSiteSettings(); }); }
            var scSlider = document.getElementById('bg-scale'); if (scSlider) { scSlider.addEventListener('input', function(e) { SiteSettings.bgScale = parseFloat(e.target.value); R.render(); }); scSlider.addEventListener('change', function() { saveSiteSettings(); }); }
        }
        wrap.querySelectorAll('input[type="time"]').forEach(function(inp) { inp.addEventListener('keydown', function(e) { e.stopPropagation(); }); });
// ── GitSync bindings ──
document.getElementById('gitsync-save')?.addEventListener('click', function() {
    var inp = document.getElementById('gitsync-token');
    var val = inp.value.trim();
    if (val && !val.startsWith('•')) {
        GitSync.setToken(val);
        inp.value = '••••••••••';
        self._renderSettings();
        UI.setStatus('☁️ GitSync token saved');
    }
});
document.getElementById('gitsync-push')?.addEventListener('click', function() {
    GitSync.push(true);
});
document.getElementById('gitsync-pull')?.addEventListener('click', function() {
    GitSync.pull();
});
document.getElementById('gitsync-remove')?.addEventListener('click', function() {
    GitSync.removeToken();
    self._renderSettings();
    UI.setStatus('☁️ GitSync disabled');
});
document.getElementById('gitsync-token')?.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') document.getElementById('gitsync-save').click();
});
document.getElementById('gitsync-token')?.addEventListener('focus', function(e) {
    if (e.target.value.startsWith('•')) e.target.value = '';
});

    },

    _initTypeEditor() {
        document.getElementById('b-type-edit').onclick = () => {
            this._typeEditorOpen = !this._typeEditorOpen;
            this._renderTypeEditor();
        };
    },

    _renderTypeEditor() {
        var wrap = document.getElementById('type-editor-wrap');
        if (!this._typeEditorOpen || !State.editMode) { wrap.innerHTML = ''; return; }
        var rows = '';
        var entries = Object.entries(ELEMENT_TYPES);
        for (var i = 0; i < entries.length; i++) {
            var k = entries[i][0], t = entries[i][1];
            rows += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:5px;padding:4px 6px;background:rgba(0,0,0,.2);border-radius:4px" data-typekey="' + k + '">'
                + '<input type="color" style="width:26px;height:22px;border:1px solid #4a5a6a;border-radius:3px;cursor:pointer;padding:0;background:none;flex-shrink:0" data-tc="' + k + '" value="' + t.color + '">'
                + '<input style="flex:1;background:#0d1b2a;color:#e0e0e0;border:1px solid #2a3a4a;padding:3px 6px;border-radius:3px;font-size:11px;min-width:0" data-tn="' + k + '" value="' + t.label + '" spellcheck="false" maxlength="30">'
                + (t.builtIn ? '<span style="width:20px"></span>' : '<button style="background:none;border:none;color:#ff5252;cursor:pointer;font-size:13px;padding:2px 4px;border-radius:3px;flex-shrink:0;opacity:.6" data-td="' + k + '">\u2715</button>')
                + '</div>';
        }
        rows += '<div style="display:flex;gap:4px;margin-top:6px"><button class="btn sm green" id="te-add">+ Add</button><button class="btn sm" id="te-reset">\u21BB Reset</button></div>';
        wrap.innerHTML = '<div style="margin-top:6px">' + rows + '</div>';
        var self = this;
        wrap.querySelectorAll('[data-tn]').forEach(function(inp) {
            inp.addEventListener('change', function() { var k2 = inp.dataset.tn, val = inp.value.trim(); if (val && ELEMENT_TYPES[k2]) { ELEMENT_TYPES[k2].label = val; saveTypeOverrides(); self._initLegend(); self._initType(); R.render(); } });
            inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
        });
        wrap.querySelectorAll('[data-tc]').forEach(function(inp) {
            inp.addEventListener('input', function() { var k2 = inp.dataset.tc; if (ELEMENT_TYPES[k2]) { ELEMENT_TYPES[k2].color = inp.value; ELEMENT_TYPES[k2].border = darkenColor(inp.value); } });
            inp.addEventListener('change', function() { saveTypeOverrides(); self._initLegend(); R.render(); });
        });
        wrap.querySelectorAll('[data-td]').forEach(function(btn) {
            btn.addEventListener('click', function() { var k2 = btn.dataset.td; if (ELEMENT_TYPES[k2]?.builtIn) return; removeType(k2); self._initLegend(); self._initType(); self._renderTypeEditor(); R.render(); });
        });
        document.getElementById('te-add').onclick = function() { addCustomType('New Stage', '#e91e63'); self._initLegend(); self._initType(); self._renderTypeEditor(); R.render(); };
        document.getElementById('te-reset').onclick = function() { if (!confirm('Reset all types to default?')) return; resetTypeOverrides(); self._initLegend(); self._initType(); self._renderTypeEditor(); R.render(); };
    },

};
// ============================================================
// GITSYNC — Auto-push map changes to GitHub
// ============================================================
const GitSync = {
    _owner: 'homziukl',
    _repo: 'Ship-Map-Builder',
    _branch: 'main',
    _apiBase: 'https://api.github.com',
    _debounceTimer: null,
    _debounceMs: 10000,
    _pushing: false,
    _lastPushHash: '',
    _lastKnownCount: 0,     // ← TU — safety check for catastrophic loss
    _backupKey: 'gitsync_last_backup',  // ← i ten też jeśli dodajesz daily backup
    enabled: false,

    _getToken() { return GM_getValue('gitsync_pat', ''); },
    setToken(tok) { GM_setValue('gitsync_pat', tok); this.enabled = !!tok; },
    removeToken() { GM_setValue('gitsync_pat', ''); this.enabled = false; },

    _filePath() {
        return `shipmap_${CONFIG.warehouseId.toUpperCase()}.json`;
    },

    _headers() {
        return {
            'Authorization': `Bearer ${this._getToken()}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    },

    // ── Get current file SHA (needed for update) ──
    async _getSha() {
        const path = this._filePath();
        const url = `${this._apiBase}/repos/${this._owner}/${this._repo}/contents/${path}?ref=${this._branch}`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url,
                headers: this._headers(),
                onload(r) {
                    if (r.status === 200) {
                        try {
                            const data = JSON.parse(r.responseText);
                            resolve(data.sha);
                        } catch { reject({ message: 'JSON parse error' }); }
                    } else if (r.status === 404) {
                        resolve(null); // file doesn't exist yet → create
                    } else {
                        reject({ message: `HTTP ${r.status}` });
                    }
                },
                onerror() { reject({ message: 'Network error' }); }
            });
        });
    },

    // ── Push file to GitHub ──
    async push(manual = false) {
        const token = this._getToken();
        if (!token) {
            if (manual) UI.setStatus('⚠️ GitSync: no token — open Settings');
            return;

        }
        if (this._pushing) return;
        // ── Safety checks ──
const elCount = State.elements.length;

// Never push empty map
if (elCount === 0) {
    if (manual) UI.setStatus('⚠️ GitSync: refusing to push empty map');
    this._pushing = false;
    return;
}

// Catastrophic loss detection — if we had 50+ elements and now <10, block auto-push
if (!manual && this._lastKnownCount > 50 && elCount < this._lastKnownCount * 0.2) {
    console.warn(`[ShipMap:GitSync] ⚠ Blocked auto-push: ${this._lastKnownCount} → ${elCount} elements (>80% loss)`);
    UI.setStatus(`⚠️ GitSync: blocked — ${this._lastKnownCount}→${elCount} elements. Manual push if intended.`);
    this._pushing = false;
    return;
}

this._lastKnownCount = elCount;

        this._pushing = true;

        try {
            const content = State.exportJSON();

            // Simple hash to avoid pushing identical content
            const hash = content.length + '_' + content.substring(0, 200);
            if (!manual && hash === this._lastPushHash) {
                this._pushing = false;
                return;
            }

            UI.setStatus('☁️ GitSync: pushing...');

            const sha = await this._getSha();
            const path = this._filePath();
            const url = `${this._apiBase}/repos/${this._owner}/${this._repo}/contents/${path}`;

            const now = new Date();
            const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
            const message = `🚢 ${CONFIG.warehouseId} — ${State.elements.length} elements — ${timeStr}`;

            const body = {
                message,
                content: btoa(unescape(encodeURIComponent(content))),
                branch: this._branch
            };
            if (sha) body.sha = sha; // update existing file

            const result = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'PUT', url,
                    headers: this._headers(),
                    data: JSON.stringify(body),
                    onload(r) {
                        if (r.status === 200 || r.status === 201) {
                            try { resolve(JSON.parse(r.responseText)); }
                            catch { resolve({}); }
                        } else if (r.status === 409) {
                            reject({ message: 'Conflict — someone else pushed. Refresh & retry.' });
                        } else if (r.status === 401 || r.status === 403) {
                            reject({ message: 'Auth failed — check token permissions' });
                        } else if (r.status === 422) {
                            reject({ message: 'SHA mismatch — file changed. Retry...' });
                        } else {
                            reject({ message: `HTTP ${r.status}` });
                        }
                    },
                    onerror() { reject({ message: 'Network error' }); }
                });
            });

            this._lastPushHash = hash;
            const shortSha = result.content?.sha?.substring(0, 7) || '✓';
            UI.setStatus(`☁️ Synced → ${shortSha} · ${State.elements.length} el`);
            console.log(`[ShipMap:GitSync] ✅ Pushed ${path} (${shortSha})`);

        } catch (err) {
            console.error(`[ShipMap:GitSync] ❌ ${err.message}`);
            UI.setStatus(`❌ GitSync: ${err.message}`);

            // Auto-retry on SHA mismatch (once)
            if (err.message?.includes('SHA mismatch') && !manual) {
                this._pushing = false;
                setTimeout(() => this.push(false), 2000);
                return;
            }
        }

        this._pushing = false;
    },

    // ── Schedule push (debounced) ──
    schedulePush() {
        if (!this.enabled) return;
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this.push(false), this._debounceMs);
    },

    // ── Pull latest from GitHub ──
    async pull() {
        const token = this._getToken();
        if (!token) { UI.setStatus('⚠️ GitSync: no token'); return false; }

        UI.setStatus('☁️ GitSync: pulling...');

        try {
            const path = this._filePath();
            const url = `${this._apiBase}/repos/${this._owner}/${this._repo}/contents/${path}?ref=${this._branch}`;

            const data = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url,
                    headers: this._headers(),
                    onload(r) {
                        if (r.status === 200) {
                            try { resolve(JSON.parse(r.responseText)); }
                            catch { reject({ message: 'JSON parse' }); }
                        } else if (r.status === 404) {
                            reject({ message: `File not found: ${path}` });
                        } else {
                            reject({ message: `HTTP ${r.status}` });
                        }
                    },
                    onerror() { reject({ message: 'Network error' }); }
                });
            });

            const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
            const ok = State.importJSON(content);
            if (ok) {
                UI.setStatus(`☁️ Pulled: ${State.elements.length} elements`);
                UI._initLegend();
                UI._initType();
                UI.refreshList();
                R.render();
                return true;
            }
            UI.setStatus('❌ GitSync: invalid map data');
            return false;

        } catch (err) {
            UI.setStatus(`❌ GitSync: ${err.message}`);
            return false;
        }
    },

    init() {
        this.enabled = !!this._getToken();
    }
};

// ============================================================
// MAIN — bootstrap
// ============================================================
function bootMain() {
    UI.init();
    State.load();
    R.init('cvs');
    R.render();
    UI.refreshList();
    UI.setStatus(`✅ v3.4.0 | ${State.elements.length} el | ${State.editMode ? '🔓' : '🔒'}`);
    try { Minimap.init(); } catch(e) { console.warn('[Minimap] init failed:', e); }
    try { GitSync.init(); } catch(e) { console.warn('[GitSync] init failed:', e); }
try { unsafeWindow.__SM = { State, YMS, FMC, Dockmaster, RELAT, MapManager, MatchIndex, ymsGetVrIds }; } catch(e) {}
try { window.__SM = { State, YMS, FMC, Dockmaster, RELAT, MapManager, GitSync, MatchIndex, ymsGetVrIds }; } catch(e) {}
try { document.__SM = { State, YMS, FMC, Dockmaster, RELAT, MapManager, MatchIndex, ymsGetVrIds }; } catch(e) {}




}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootMain);
} else {
    bootMain();
}

})();
