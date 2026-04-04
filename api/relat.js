// === RELAT API ===
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
