// === CONSTANTS ===
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
    data: { refreshInterval: 120000, ymsRefreshInterval: 60000, vistaRefreshInterval: 120000, trendInterval: 600000, fmcRefreshInterval: 120000, dockmasterRefreshInterval: 120000, relatRefreshInterval: 180000, ymsTokenCaptureInterval: 30000, ymsTokenPickupInterval: 10000, uiRefreshInterval: 60000, stemRefreshInterval: 120000, stemEnabled: true, stemGraphqlUrl: '/graphql' },
    urls: {
        dockmaster: 'https://fc-inbound-dock-execution-service-eu-eug1-dub.dub.proxy.amazon.com',
        relat: 'https://eu.relat.aces.amazon.dev',
    },
    fmcFallbackSite: 'AT1hgc',
    maxUndoSteps: 50,
};


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
