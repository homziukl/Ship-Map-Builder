// === YMS API ===
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
