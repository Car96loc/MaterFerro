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
    try {
        const value = readDeviceCache() || { owner: cacheOwner, inventory: [], sales: [] };
        value[kind] = items;
        localStorage.setItem(cacheKey, JSON.stringify(value));
    } catch { /* Storage can be unavailable or full; cloud sync remains authoritative. */ }
}

export function clearDeviceCache() {
    try { localStorage.removeItem(cacheKey); } catch { /* Private browsing may deny storage. */ }
}
