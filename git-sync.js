// === GIT SYNC ===
// GITSYNC â€” Auto-push map changes to GitHub
// ============================================================
const GitSync = {
    _owner: 'homziukl',
    _repo: 'Ship-Map-Builder',
    _branch: 'main',
    _apiBase: 'https://api.github.com',
    _debounceTimer: null,
    _debounceMs: 10000,
    _pushing: false,
    _lastPushHash: '',
    _lastKnownCount: 0,     // â† TU â€” safety check for catastrophic loss
    _backupKey: 'gitsync_last_backup',  // â† i ten teÅ¼ jeÅ›li dodajesz daily backup
    enabled: false,

    _getToken() { return GM_getValue('gitsync_pat', ''); },
    setToken(tok) { GM_setValue('gitsync_pat', tok); this.enabled = !!tok; },
    removeToken() { GM_setValue('gitsync_pat', ''); this.enabled = false; },

    _filePath() {
        return `shipmap_${CONFIG.warehouseId.toUpperCase()}.json`;
    },

    _headers() {
        return {
            'Authorization': `Bearer ${this._getToken()}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    },

    // â”€â”€ Get current file SHA (needed for update) â”€â”€
    async _getSha() {
        const path = this._filePath();
        const url = `${this._apiBase}/repos/${this._owner}/${this._repo}/contents/${path}?ref=${this._branch}`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url,
                headers: this._headers(),
                onload(r) {
                    if (r.status === 200) {
                        try {
                            const data = JSON.parse(r.responseText);
                            resolve(data.sha);
                        } catch { reject({ message: 'JSON parse error' }); }
                    } else if (r.status === 404) {
                        resolve(null); // file doesn't exist yet â†’ create
                    } else {
                        reject({ message: `HTTP ${r.status}` });
                    }
                },
                onerror() { reject({ message: 'Network error' }); }
            });
        });
    },

    // â”€â”€ Push file to GitHub â”€â”€
    async push(manual = false) {
        const token = this._getToken();
        if (!token) {
            if (manual) UI.setStatus('âš ï¸ GitSync: no token â€” open Settings');
            return;

        }
        if (this._pushing) return;
        // â”€â”€ Safety checks â”€â”€
const elCount = State.elements.length;

// Never push empty map
if (elCount === 0) {
    if (manual) UI.setStatus('âš ï¸ GitSync: refusing to push empty map');
    this._pushing = false;
    return;
}

// Catastrophic loss detection â€” if we had 50+ elements and now <10, block auto-push
if (!manual && this._lastKnownCount > 50 && elCount < this._lastKnownCount * 0.2) {
    console.warn(`[ShipMap:GitSync] âš  Blocked auto-push: ${this._lastKnownCount} â†’ ${elCount} elements (>80% loss)`);
    UI.setStatus(`âš ï¸ GitSync: blocked â€” ${this._lastKnownCount}â†’${elCount} elements. Manual push if intended.`);
    this._pushing = false;
    return;
}

this._lastKnownCount = elCount;

        this._pushing = true;

        try {
            const content = State.exportJSON();

            // Simple hash to avoid pushing identical content
            const hash = content.length + '_' + content.substring(0, 200);
            if (!manual && hash === this._lastPushHash) {
                this._pushing = false;
                return;
            }

            UI.setStatus('â˜ï¸ GitSync: pushing...');

            const sha = await this._getSha();
            const path = this._filePath();
            const url = `${this._apiBase}/repos/${this._owner}/${this._repo}/contents/${path}`;

            const now = new Date();
            const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
            const message = `ðŸš¢ ${CONFIG.warehouseId} â€” ${State.elements.length} elements â€” ${timeStr}`;

            const body = {
                message,
                content: btoa(unescape(encodeURIComponent(content))),
                branch: this._branch
            };
            if (sha) body.sha = sha; // update existing file

            const result = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'PUT', url,
                    headers: this._headers(),
                    data: JSON.stringify(body),
                    onload(r) {
                        if (r.status === 200 || r.status === 201) {
                            try { resolve(JSON.parse(r.responseText)); }
                            catch { resolve({}); }
                        } else if (r.status === 409) {
                            reject({ message: 'Conflict â€” someone else pushed. Refresh & retry.' });
                        } else if (r.status === 401 || r.status === 403) {
                            reject({ message: 'Auth failed â€” check token permissions' });
                        } else if (r.status === 422) {
                            reject({ message: 'SHA mismatch â€” file changed. Retry...' });
                        } else {
                            reject({ message: `HTTP ${r.status}` });
                        }
                    },
                    onerror() { reject({ message: 'Network error' }); }
                });
            });

            this._lastPushHash = hash;
            const shortSha = result.content?.sha?.substring(0, 7) || 'âœ“';
            UI.setStatus(`â˜ï¸ Synced â†’ ${shortSha} Â· ${State.elements.length} el`);
            console.log(`[ShipMap:GitSync] âœ… Pushed ${path} (${shortSha})`);

        } catch (err) {
            console.error(`[ShipMap:GitSync] âŒ ${err.message}`);
            UI.setStatus(`âŒ GitSync: ${err.message}`);

            // Auto-retry on SHA mismatch (once)
            if (err.message?.includes('SHA mismatch') && !manual) {
                this._pushing = false;
                setTimeout(() => this.push(false), 2000);
                return;
            }
        }

        this._pushing = false;
    },

    // â”€â”€ Schedule push (debounced) â”€â”€
    schedulePush() {
        if (!this.enabled) return;
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this.push(false), this._debounceMs);
    },

    // â”€â”€ Pull latest from GitHub â”€â”€
    async pull() {
        const token = this._getToken();
        if (!token) { UI.setStatus('âš ï¸ GitSync: no token'); return false; }

        UI.setStatus('â˜ï¸ GitSync: pulling...');

        try {
            const path = this._filePath();
            const url = `${this._apiBase}/repos/${this._owner}/${this._repo}/contents/${path}?ref=${this._branch}`;

            const data = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url,
                    headers: this._headers(),
                    onload(r) {
                        if (r.status === 200) {
                            try { resolve(JSON.parse(r.responseText)); }
                            catch { reject({ message: 'JSON parse' }); }
                        } else if (r.status === 404) {
                            reject({ message: `File not found: ${path}` });
                        } else {
                            reject({ message: `HTTP ${r.status}` });
                        }
                    },
                    onerror() { reject({ message: 'Network error' }); }
                });
            });

            const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
            const ok = State.importJSON(content);
            if (ok) {
                UI.setStatus(`â˜ï¸ Pulled: ${State.elements.length} elements`);
                UI._initLegend();
                UI._initType();
                UI.refreshList();
                R.render();
                return true;
            }
            UI.setStatus('âŒ GitSync: invalid map data');
            return false;

        } catch (err) {
            UI.setStatus(`âŒ GitSync: ${err.message}`);
            return false;
        }
    },

    init() {
        this.enabled = !!this._getToken();
    }
};

// ============================================================
