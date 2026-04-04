// === DOCKMASTER API ===
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
