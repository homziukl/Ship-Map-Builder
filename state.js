// === STATE ===
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
    stemElementMap: {}, stemLastUpdated: null, stemLoading: false,
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
    getNextId(type) { const prefix = ELEMENT_TYPES[type]?.label?.split(' ')[0]?.replace(/[^a-zA-Z0-9]/g, '') || type; const rx = new RegExp(`^${prefix}-(\\d+)`, 'i'); const used = new Set(); for (const el of this.elements) { const m = el.id.match(rx); if (m) used.add(parseInt(m[1], 10)); } let n = 1; while (used.has(n)) n++; return `${prefix}-${String(n).padStart(3, '0')}`; },
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
            const sd = this.stemElementMap?.[el.name || el.id]; if (sd) { const dir = (sd.direction || '').toUpperCase(); const allDirs = (sd.allDirections || []).join(' ').toUpperCase(); const login = (sd.userLogin || '').toUpperCase(); if (dir.includes(q) || allDirs.includes(q) || login.includes(q) || (sd.chuteLabel || '').toUpperCase().includes(q)) { this.mapSearchMatches.add(el.id); continue; } }
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
