// === MATCH INDEX ===
// ============================================================
// MATCH INDEX — O(1) element lookup by label
// ============================================================
const MatchIndex = {
    _exactName: new Map(), _exactChute: new Map(), _chuteSuffix: new Map(),
    _wildcards: [], _looseElements: [], _allChuteEntries: [],
    LOOSE_PREFIXES: ['SLAM STATION', 'KTW3-SHIPPINGSORTER1'],
    rebuild(elements) {
        this._exactName.clear(); this._exactChute.clear(); this._chuteSuffix.clear();
        this._wildcards = []; this._looseElements = []; this._allChuteEntries = [];
        for (const el of elements) {
            if (el.name) { const nu = el.name.toUpperCase().trim(); if (nu.endsWith('*')) { this._wildcards.push({ el, prefix: nu.slice(0, -1) }); } else { this._addToMap(this._exactName, nu, el); } if (this.LOOSE_PREFIXES.some(p => nu.startsWith(p))) { this._looseElements.push({ el, nameUpper: nu }); } }
            if (el.chute) { const cu = el.chute.toUpperCase().trim(); this._addToMap(this._exactChute, cu, el); this._allChuteEntries.push({ el, chuteUpper: cu }); const parts = el.chute.split('-'); const suffix = parts[parts.length - 1]?.toUpperCase(); if (suffix && suffix !== cu) { this._addToMap(this._chuteSuffix, suffix, el); } }
        }
    },
    _addToMap(map, key, el) { let arr = map.get(key); if (!arr) { arr = []; map.set(key, arr); } arr.push(el); },
    getMatching(label) {
        if (!label) return [];
        const lu = label.toUpperCase().trim(); const resultSet = new Set();
        const nameHits = this._exactName.get(lu); if (nameHits) for (const el of nameHits) resultSet.add(el);
        for (const { el, prefix } of this._wildcards) { if (lu.startsWith(prefix)) resultSet.add(el); }
        for (const { el, nameUpper } of this._looseElements) { if (lu.startsWith(nameUpper) && lu.length > nameUpper.length) resultSet.add(el); if (nameUpper.startsWith(lu) && nameUpper.length > lu.length) resultSet.add(el); }
        if (this.LOOSE_PREFIXES.some(p => lu.startsWith(p))) { for (const [nu, els] of this._exactName) { if (nu.startsWith(lu) && nu.length > lu.length) for (const el of els) resultSet.add(el); if (lu.startsWith(nu) && lu.length > nu.length) for (const el of els) resultSet.add(el); } }
        const chuteHits = this._exactChute.get(lu); if (chuteHits) for (const el of chuteHits) resultSet.add(el);
        const suffHits = this._chuteSuffix.get(lu); if (suffHits) for (const el of suffHits) resultSet.add(el);
        for (const { el, chuteUpper } of this._allChuteEntries) { if (resultSet.has(el)) continue; if (chuteUpper.endsWith(lu) || lu.endsWith(chuteUpper)) resultSet.add(el); }
        return [...resultSet];
    }
};
