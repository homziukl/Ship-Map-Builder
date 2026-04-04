// === HELPERS ===
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
