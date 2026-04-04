// === STEM API ===
// ============================================================
// STEM — Sortation rules from STEM GraphQL API
// ============================================================
const STEM_RESERVATIONS_QUERY = `query Reservations($nodeId: String!) { reservations(nodeId: $nodeId, cached: true) { reservationId stackingFilters startTime endTime lastUpdateTime userLogin reservationProperties { key value } resources { resourceId label resourceType } } }`;
const STEM_RESOURCES_QUERY = `query Resources($nodeId: String!, $resourceType: String) { resources(nodeId: $nodeId, resourceType: $resourceType) { resourceId label resourceType properties { key value } } }`;

function epochMsToTime(ms) {
    if (!ms) return null;
    try { const d = new Date(ms); return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }); }
    catch { return null; }
}

const STEM = {
    _csrfToken: null,
    _autoTimer: null,

    async _fetchCsrf() {
        const r = await fetch('/csrfToken', { credentials: 'same-origin' });
        if (r.status === 401 || r.status === 403) throw new Error(`STEM auth failed (${r.status})`);
        if (!r.ok) throw new Error(`STEM CSRF error (${r.status})`);
        const token = (await r.text()).trim();
        if (!token) throw new Error('STEM CSRF token empty');
        this._csrfToken = token;
        return token;
    },

    async _gql(query, variables) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        try {
            const r = await fetch(CONFIG.data.stemGraphqlUrl, {
                method: 'POST',
                headers: { 'anti-csrftoken-a2z': this._csrfToken, 'Content-Type': 'application/json', 'Accept': '*/*' },
                body: JSON.stringify({ query, variables }),
                credentials: 'same-origin',
                signal: ctrl.signal,
            });
            clearTimeout(timer);
            if (r.status === 401 || r.status === 403) throw new Error(`403`);
            if (!r.ok) throw new Error(`STEM GraphQL HTTP ${r.status}`);
            const json = await r.json();
            if (json.errors?.length) {
                console.warn('[ShipMap:STEM] GraphQL errors:', json.errors.map(e => e.message).join('; '));
                return {};
            }
            return json.data || {};
        } catch (err) {
            clearTimeout(timer);
            if (err.name === 'AbortError') throw new Error('STEM timeout (30s)');
            throw err;
        }
    },

    _mergeData(reservations, resources) {
        const map = new Map();
        // Reservations → assigned chutes
        for (const r of (reservations || [])) {
            const res = r.resources || [];
            const label = res[0]?.label || '';
            if (!label) continue;
            const sf = r.stackingFilters || [];
            const allDirs = sf.map(s => simplifyStackingFilter(s)).filter(Boolean);
            map.set(label.toUpperCase(), {
                chuteLabel: label,
                assigned: true,
                direction: allDirs[0] || '',
                allDirections: allDirs,
                startTime: epochMsToTime(r.startTime),
                endTime: epochMsToTime(r.endTime),
                userLogin: r.userLogin || '',
                reservationId: r.reservationId || '',
            });
        }
        // Resources → fill unassigned chutes
        for (const res of (resources || [])) {
            const label = res.label || '';
            if (!label) continue;
            const key = label.toUpperCase();
            if (!map.has(key)) {
                map.set(key, {
                    chuteLabel: label,
                    assigned: false,
                    direction: '',
                    allDirections: [],
                    startTime: null,
                    endTime: null,
                    userLogin: '',
                    reservationId: '',
                });
            }
        }
        return map;
    },

    async fetchData(retryCount = 0) {
        if (!CONFIG.data.stemEnabled) return;
        if (State.stemLoading) return;
        State.stemLoading = true;
        try {
            if (!this._csrfToken) await this._fetchCsrf();
            const [resResult, resourceResult] = await Promise.allSettled([
                this._gql(STEM_RESERVATIONS_QUERY, { nodeId: CONFIG.warehouseId }),
                this._gql(STEM_RESOURCES_QUERY, { nodeId: CONFIG.warehouseId, resourceType: 'CHUTE' }),
            ]);
            const reservations = resResult.status === 'fulfilled' ? (resResult.value.reservations || []) : [];
            const resources = resourceResult.status === 'fulfilled' ? (resourceResult.value.resources || []) : [];
            if (resResult.status === 'rejected') console.warn('[ShipMap:STEM] Reservations failed:', resResult.reason?.message);
            if (resourceResult.status === 'rejected') console.warn('[ShipMap:STEM] Resources failed:', resourceResult.reason?.message);
            if (resResult.status === 'rejected' && resourceResult.status === 'rejected') {
                console.error('[ShipMap:STEM] Both queries failed, keeping previous data');
                return;
            }
            const merged = this._mergeData(reservations, resources);
            const newMap = {};
            // Build reverse map: element name/id → stem data (via MatchIndex + direct name match)
            for (const [, chuteData] of merged) {
                const matched = MatchIndex.getMatching(chuteData.chuteLabel);
                for (const el of matched) {
                    const elKey = el.name || el.id;
                    newMap[elKey] = { ...chuteData };
                }
            }
            // Fallback: direct match for elements not yet mapped (handles BG/BOX naming)
            for (const el of State.elements) {
                const elKey = el.name || el.id;
                if (newMap[elKey]) continue;
                const elUpper = elKey.toUpperCase();
                for (const [mapKey, chuteData] of merged) {
                    if (mapKey === elUpper || chuteData.chuteLabel.toUpperCase() === elUpper) {
                        newMap[elKey] = { ...chuteData };
                        break;
                    }
                }
            }
            State.stemElementMap = newMap;
            State.stemLastUpdated = new Date();
            const assigned = [...merged.values()].filter(c => c.assigned).length;
            console.log(`[ShipMap:STEM] ✅ ${merged.size} chutes (${assigned} assigned), ${Object.keys(newMap).length} mapped`);
            R.requestRender();
        } catch (err) {
            if (err.message?.includes('403') && this._csrfToken && retryCount < 1) {
                this._csrfToken = null;
                State.stemLoading = false;
                return this.fetchData(retryCount + 1);
            }
            console.error('[ShipMap:STEM]', err.message);
        } finally {
            State.stemLoading = false;
        }
    },

    startAutoRefresh() { this.stopAutoRefresh(); this.fetchData(); this._autoTimer = setInterval(() => this.fetchData(), CONFIG.data.stemRefreshInterval); },
    stopAutoRefresh() { if (this._autoTimer) { clearInterval(this._autoTimer); this._autoTimer = null; } },
};
