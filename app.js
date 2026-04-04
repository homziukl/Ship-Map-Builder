// === APP ===
// ============================================================
// FMC SHELL â€” save site code + intercept for bonus data
// ============================================================
if (/trans-logistics-eu\.amazon\.com\/fmc/i.test(location.href)) {
    const detectSite = () => {
        const m = location.pathname.match(/\/fmc\/(?:execution|dashboard|planning|excel)\/([A-Z0-9a-z]+)/i);
        return m ? m[1] : null;
    };
    const SITE = detectSite();
    if (SITE) {
        GM_setValue('shipmap_fmc_site_code', SITE);
        console.log(`[ShipMap:FMC] ðŸ“‹ Site code saved: ${SITE}`);
    }
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        this._sm_url = url; this._sm_method = method;
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
        if (this._sm_url && /\/fmc\/search\/execution\/by-criteria/i.test(this._sm_url)) {
            if (body && typeof body === 'string') {
                try { GM_setValue('shipmap_fmc_captured_body', body); } catch (e) { console.debug('[ShipMap:FMC] save body failed:', e.message); }
            }
            this.addEventListener('load', () => {
                if (this.status >= 200 && this.status < 300 && this.responseText) {
                    try {
                        const resp = JSON.parse(this.responseText);
                        if (resp.success && resp.returnedObject?.records) {
                            GM_setValue('shipmap_fmc_last_response', JSON.stringify({
                                timestamp: Date.now(),
                                recordCount: resp.returnedObject.records.length,
                                site: SITE
                            }));
                        }
                    } catch (e) { console.debug('[ShipMap:FMC] parse response failed:', e.message); }
                }
            });
        }
        return origSend.apply(this, arguments);
    };
    const addBadge = () => {
        if (!document.body) return;
        const badge = document.createElement('div');
        badge.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:99999;background:rgba(22,33,62,0.92);color:#ff9900;padding:6px 14px;border-radius:8px;font:bold 11px "Amazon Ember",Arial,sans-serif;border:1px solid #ff9900;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
        badge.innerHTML = `ðŸš¢ ShipMap FMC | ${SITE || '?'} | synced âœ…`;
        document.body.appendChild(badge);
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') addBadge();
    else document.addEventListener('DOMContentLoaded', addBadge);
    return;
}

// ============================================================
// YMS TOKEN CAPTURE (runs ONLY on YMS tab, then exits)
// ============================================================
if (/trans-logistics-eu\.amazon\.com\/yms/i.test(location.href)) {
    const decodeJwtPayload = (tok) => { const b64 = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(b64)); };
    const validateToken = (tok) => { try { const p = decodeJwtPayload(tok); if (p.iss !== 'YMS-1.0') return null; const nowSec = Date.now() / 1000; if (!p.exp || p.exp < nowSec + 60) return null; if (p.nbf && p.nbf > nowSec + 5) return null; const yard = p.context?.yard?.toUpperCase(); if (!yard || yard.length < 3) return null; return { yard, exp: p.exp, accountId: p.context.accountId, user: p.context.userName }; } catch { return null; } };
    const extractToken = () => { const scripts = document.querySelectorAll('script'); for (const s of scripts) { const m = (s.textContent || '').match(/ymsSecurityToken\s*=\s*["']?(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']?/); if (m) return m[1]; } for (const s of scripts) { const m2 = (s.textContent || '').match(/["']token["']\s*:\s*["'](eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']/); if (m2) return m2[1]; } const m3 = document.documentElement.innerHTML.match(/eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/); return m3 ? m3[0] : null; };
    const capture = () => { const tok = extractToken(); if (!tok) return; const info = validateToken(tok); if (!info) return; const siteKey = `yms_token_${info.yard}`; const existing = GM_getValue(siteKey, null); if (existing === tok) return; GM_setValue(siteKey, tok); GM_setValue('yms_token', tok); console.log(`[ShipMap] âœ… Token captured â†’ ${siteKey} | yard=${info.yard}`); };
    if (document.readyState === 'complete') capture();
    else window.addEventListener('load', capture);
    setInterval(capture, 30000);
    return;
}

// MAIN â€” bootstrap
// ============================================================
function bootMain() {
    UI.init();
    State.load();
    R.init('cvs');
    R.render();
    UI.refreshList();
    UI.setStatus(`âœ… v3.4.1 | ${State.elements.length} el | ${State.editMode ? 'ðŸ”“' : 'ðŸ”’'}`);
    try { Minimap.init(); } catch(e) { console.warn('[Minimap] init failed:', e); }
    try { GitSync.init(); } catch(e) { console.warn('[GitSync] init failed:', e); }
try { unsafeWindow.__SM = { State, YMS, FMC, Dockmaster, RELAT, MapManager, MatchIndex, ymsGetVrIds }; } catch(e) {}
try { window.__SM = { State, YMS, FMC, Dockmaster, RELAT, MapManager, GitSync, MatchIndex, ymsGetVrIds }; } catch(e) {}
try { document.__SM = { State, YMS, FMC, Dockmaster, RELAT, MapManager, MatchIndex, ymsGetVrIds }; } catch(e) {}




}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootMain);
} else {
    bootMain();
}
