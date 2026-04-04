// === SSP API ===
// ============================================================
// SSP
// ============================================================
const SSP = {
    _fetchJSON(url) { return new Promise((resolve, reject) => { GM_xmlhttpRequest({ method:'GET', url, headers:{'Accept':'application/json'}, withCredentials:true, onload(r) { if (r.status >= 200 && r.status < 300) { try { resolve(JSON.parse(r.responseText)); } catch { reject({message:'JSON parse error'}); } } else reject({message:`HTTP ${r.status}`}); }, onerror() { reject({message:'Network error'}); } }); }); },
    _postJSON(url, body) { return new Promise((resolve, reject) => { GM_xmlhttpRequest({ method:'POST', url, headers:{'Accept':'application/json','Content-Type':'application/json'}, data:JSON.stringify(body), withCredentials:true, onload(r) { if (r.status >= 200 && r.status < 300) { try { resolve(JSON.parse(r.responseText)); } catch { reject({message:'JSON parse error'}); } } else reject({message:`HTTP ${r.status}`}); }, onerror() { reject({message:'Network error'}); } }); }); },
    _parseRoute(raw) { return parseRoute(raw) || '—'; },
    _statusColor(s) { return { 'LOADING_IN_PROGRESS':'#69f0ae','FINISHED_LOADING':'#ffd600','TRAILER_ATTACHED':'#4fc3f7','READY_TO_DEPART':'#ff9800','READY_FOR_LOADING':'#80cbc4','DEPARTED':'#9e9e9e','SCHEDULED':'#5a6a7a','CANCELLED':'#ff5252' }[s]||'#5a6a7a'; },
    _statusShort(s) { return { 'LOADING_IN_PROGRESS':'L','FINISHED_LOADING':'C','TRAILER_ATTACHED':'ATT','READY_TO_DEPART':'RTD','READY_FOR_LOADING':'RFL','DEPARTED':'DEP','SCHEDULED':'S','CANCELLED':'X' }[s]||s; },
    _statusLabel(s) { return { 'LOADING_IN_PROGRESS':'🔄 Loading','FINISHED_LOADING':'✅ Finished','TRAILER_ATTACHED':'🔗 Attached','READY_TO_DEPART':'🚛 Ready','READY_FOR_LOADING':'📋 Ready for Load','DEPARTED':'✈️ Departed','SCHEDULED':'📋 Scheduled','CANCELLED':'❌ Cancelled' }[s]||s; },
    _facilityStatus(s) { return { 'LOADING_IN_PROGRESS':'inFaciltiy','FINISHED_LOADING':'inFaciltiy','TRAILER_ATTACHED':'inFaciltiy','READY_TO_DEPART':'inFaciltiy','READY_FOR_LOADING':'inFaciltiy','SCHEDULED':'inFaciltiy','DEPARTED':'departed','CANCELLED':'cancelled' }[s]||'inFaciltiy'; },

    async fetchData() {
        State.dataLoading = true; UI.updateDataPanel();
        try {
            const now = Date.now(), startDate = now - 24 * 3600000, endDate = now + 3 * 24 * 3600000;
            const url = `${CONFIG.baseUrl}/ssp/dock/hrz/ob/fetchdata?entity=getOutboundDockView&nodeId=${CONFIG.warehouseId}&startDate=${startDate}&endDate=${endDate}&loadCategories=outboundScheduled,outboundInProgress,outboundReadyToDepart&shippingPurposeType=TRANSSHIPMENT,NON-TRANSSHIPMENT,SHIP_WITH_AMAZON`;
            const data = await this._fetchJSON(url);
            const aaData = data?.ret?.aaData || [], allRows = [];
            for (const item of aaData) { const ld = item.load; if (!ld || !ld.route) continue; allRows.push({ route:this._parseRoute(ld.route), rawRoute:ld.route, vrId:ld.vrId, status:ld.status, statusLabel:this._statusLabel(ld.status), statusShort:this._statusShort(ld.status), statusColor:this._statusColor(ld.status), carrier:ld.carrier, cpt:ld.criticalPullTime||'—', sdt:ld.scheduledDepartureTime||'—', dockDoor:item.resource?.[0]?.label||'—', trailer:item.trailer?.trailerNumber||'—', equipmentType:ld.equipmentType||'', loadGroupId:ld.loadGroupId, planId:ld.planId, trailerId:item.trailer?.trailerId||'', trailerNumber:item.trailer?.trailerNumber||'', facilityStatus:this._facilityStatus(ld.status), _expanded:false, _containers:null, _containersLoading:false }); }
            const vrIdCount = new Map(); for (const row of allRows) { if (!row.vrId) continue; vrIdCount.set(row.vrId, (vrIdCount.get(row.vrId)||0)+1); }
            const seen = new Set(), preLoads = []; let swapFiltered = 0;
            for (const row of allRows) { if (seen.has(row.planId)) continue; seen.add(row.planId); if (SiteSettings.filterSwapBefore && isSwapBody(row.equipmentType) && !isOneSwapBody(row.equipmentType)) { if ((vrIdCount.get(row.vrId)||0) < 2) { swapFiltered++; continue; } } preLoads.push(row); }
            const swapGroups = new Map(), loads = [];
            for (const row of preLoads) { if (row.vrId && isSwapBody(row.equipmentType) && !isOneSwapBody(row.equipmentType) && (vrIdCount.get(row.vrId)||0) >= 2) { if (!swapGroups.has(row.vrId)) swapGroups.set(row.vrId, []); swapGroups.get(row.vrId).push(row); } else { loads.push(row); } }
            for (const [, group] of swapGroups) {
                if (group.length < 2) { loads.push(group[0]); continue; }
                group.sort((a,b) => { const sa = a.sdt==='—'?'zzz':a.sdt, sb = b.sdt==='—'?'zzz':b.sdt; return sa.localeCompare(sb); });
                const primary = group[0], routes = [...new Set(group.map(g => g.route))], planIds = group.map(g => g.planId), dockDoors = [...new Set(group.map(g => g.dockDoor).filter(d => d !== '—'))];
                const statusPrio = ['LOADING_IN_PROGRESS','FINISHED_LOADING','TRAILER_ATTACHED','READY_TO_DEPART','READY_FOR_LOADING','SCHEDULED','DEPARTED','CANCELLED'];
                const bestStatus = group.reduce((best, g) => { const bi = statusPrio.indexOf(best.status), gi = statusPrio.indexOf(g.status); return gi < bi && gi >= 0 ? g : best; }, primary);
                loads.push({ ...primary, route: routes.length > 1 ? routes.join(' + ') : routes[0], status: bestStatus.status, statusLabel: SSP._statusLabel(bestStatus.status), statusShort: SSP._statusShort(bestStatus.status), statusColor: SSP._statusColor(bestStatus.status), dockDoor: dockDoors.length ? dockDoors.join('+') : '—', _swapCount: group.length, _swapPlanIds: planIds, _swapGroup: group });
            }
            loads.sort((a, b) => { const sa = a.sdt === '—' ? 'zzz' : a.sdt, sb = b.sdt === '—' ? 'zzz' : b.sdt; const cmp = sa.localeCompare(sb); if (cmp !== 0) return cmp; return a.route.localeCompare(b.route); });
            State.sspLoads = loads; State.swapFilteredCount = swapFiltered; State.dataLastUpdated = new Date(); State.dataLoading = false;
            if (State.highlightedVrId) { State.resyncHighlightAfterRefresh(); } else { if (State.highlightedLoadIdx >= 0 && State.highlightedLoadIdx >= loads.length) State.clearHighlight(); }
            if (State.drawerOpen && State.highlightedVrId) { const newDrawerIdx = loads.findIndex(l => l.vrId && l.vrId.toUpperCase() === State.highlightedVrId); if (newDrawerIdx >= 0 && loads[newDrawerIdx]._containers) { State.drawerLoadIdx = newDrawerIdx; } else if (newDrawerIdx < 0) { UI.closeDrawer(); } } else if (State.drawerOpen && State.drawerLoadIdx >= loads.length) { UI.closeDrawer(); }
            UI.updateDataPanel(); UI.setStatus(`📡 ${loads.length} loads | ${swapFiltered} swap-filtered`);
            UI.updateDashKpi();
        } catch (err) { State.dataLoading = false; UI.updateDataPanel(); UI.setStatus(`❌ SSP: ${err.message}`); }
    },

    async fetchContainerDetails(load, loadIdx) {
        if (!load.loadGroupId || !load.planId) { UI.setStatus('❌ No loadGroupId'); return null; }
        load._containersLoading = true; UI.updateDataPanel();
        try {
            const params = new URLSearchParams({ entity:'getContainerDetailsForLoadGroupId', nodeId:CONFIG.warehouseId, loadGroupId:load.loadGroupId, planId:load.planId, vrId:load.vrId, status:load.facilityStatus, trailerId:load.trailerId, trailerNumber:load.trailerNumber });
            const data = await this._fetchJSON(`${CONFIG.baseUrl}/ssp/dock/hrz/ob/fetchdata?${params}`);
            const rootNodes = data?.ret?.aaData?.ROOT_NODE || [], flat = [];
            const walk = (nodes, depth, parentLabel) => { for (const node of nodes) { const c = node.container, children = node.childNodes || []; let descPkgs = 0, descWeight = 0; const countDesc = (arr) => { for (const ch of arr) { if (ch.container.contType === 'PACKAGE') { descPkgs++; descWeight += ch.container.weightSpec?.weight?.value ?? 0; } if (ch.childNodes?.length) countDesc(ch.childNodes); } }; countDesc(children); flat.push({ label:c.label||'—', contType:c.contType||'—', containerId:c.containerId, weight:c.weightSpec?.weight?.value??0, assocTime:c.parentChildAssTime||'', depth, parentLabel, childCount:children.length, descPkgs, descWeight:Math.round(descWeight*100)/100, stackingFilter:c.stackingFilter||c.sortDestination||c.stackFilter||c.route||c.sortAttributes?.stackingFilter||'' }); if (children.length) walk(children, depth+1, c.label); } };
            walk(rootNodes, 0, null);
            const packages = flat.filter(c => c.contType === 'PACKAGE'), pallets = flat.filter(c => c.contType === 'PALLET'), locations = flat.filter(c => c.depth === 0);
            const totalWeight = packages.reduce((s, c) => s + c.weight, 0);
            const parsed = { flat, packages, pallets, locations, stats:{ totalContainers:flat.length, packageCount:packages.length, palletCount:pallets.length, locationCount:locations.length, totalWeightKg:Math.round(totalWeight*100)/100 } };
            load._containers = parsed; load._containersLoading = false; load._expanded = true;
            State.setHighlight(loadIdx); UI.openDrawer(loadIdx); UI.updateDataPanel();
            UI.setStatus(`📦 ${parsed.stats.packageCount} pkgs — ${load.vrId}`); return parsed;
        } catch (err) { load._containersLoading = false; load._expanded = false; UI.updateDataPanel(); UI.setStatus(`❌ ${err.message}`); return null; }
    },
    startAutoRefresh() { this.stopAutoRefresh(); this.fetchData(); State.autoRefreshTimer = setInterval(() => this.fetchData(), CONFIG.data.refreshInterval); },
    stopAutoRefresh() { if (State.autoRefreshTimer) { clearInterval(State.autoRefreshTimer); State.autoRefreshTimer = null; } },
};
