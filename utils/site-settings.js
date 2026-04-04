// === SITE SETTINGS ===
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
