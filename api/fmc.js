// === FMC API ===
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
