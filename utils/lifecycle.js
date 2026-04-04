// === LIFECYCLE ===
// ============================================================
// LIFECYCLE — central timer management
// ============================================================
const Lifecycle = {
    _timers: [],
    register(name, fn, interval) {
        const id = setInterval(fn, interval);
        this._timers.push({ name, id });
        return id;
    },
    unregister(id) {
        clearInterval(id);
        this._timers = this._timers.filter(t => t.id !== id);
    },
    stopAll() {
        for (const t of this._timers) clearInterval(t.id);
        this._timers = [];
        console.log('[ShipMap] Lifecycle: all timers stopped');
    },
};
window.addEventListener('beforeunload', () => Lifecycle.stopAll());
