// === VISTA API ===
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
