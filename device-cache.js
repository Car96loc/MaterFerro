const cacheKey = 'ferromaster-device-cache-v1';
const cacheOwner = 'carzunsan@gmail.com';

export function readDeviceCache() {
    try {
        const value = JSON.parse(localStorage.getItem(cacheKey));
        if (value?.owner !== cacheOwner || !Array.isArray(value.inventory) || !Array.isArray(value.sales)) return null;
        return value;
    } catch { return null; }
}

export function saveDeviceCache(kind, items) {
    const value = readDeviceCache() || { owner: cacheOwner, inventory: [], sales: [] };
    value[kind] = items;
    try {
        localStorage.setItem(cacheKey, JSON.stringify(value));
    } catch {
        // Keep current stock cached even when photos exceed the browser's storage quota.
        try {
            value.inventory = value.inventory.map(({ photo, photos, ...item }) => item);
            localStorage.setItem(cacheKey, JSON.stringify(value));
        } catch { /* Storage may be blocked; cloud sync remains authoritative. */ }
    }
}

export function clearDeviceCache() {
    try { localStorage.removeItem(cacheKey); } catch { /* Private browsing may deny storage. */ }
}
