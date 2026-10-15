import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, collection, doc, getDocs, setDoc, deleteDoc, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { catalogProduct, cashierSale, expandCashierSale, historicalProduct } from './access.js?v=1';
window.ferroAccess = { catalogProduct };
import { businessDay, parseSaleDate, saleTotals, itemTotals, salesReport, displaySaleDate, withInventoryCosts } from './sales-report.js?v=roles-1';
import { lineAmount, productValues, stockUnits, maxCartQuantity } from './pricing.js?v=box-2';
import { inventoryReport } from './inventory-report.js?v=margins-1';
import { readDeviceCache, saveDeviceCache, clearDeviceCache } from './device-cache.js?v=gallery-1';
import { matchesProduct, compressProductPhoto, validProductPhoto } from './product-tools.js?v=gallery-1';
import { productPhotos, mountCropper, disposeCropper, cropAction, exportCrop } from './photo-editor.js?v=gallery-1';
window.ferroPhotoEditor = { productPhotos, mountCropper, disposeCropper, cropAction, exportCrop };
window.ferroProductTools = { matchesProduct, compressProductPhoto };

window.ferroReports = { businessDay, saleTotals, itemTotals, salesReport, displaySaleDate, withInventoryCosts };
window.ferroPricing = { lineAmount, productValues, stockUnits, maxCartQuantity };
window.ferroInventoryReport = inventoryReport;

const app = initializeApp({
    apiKey: 'AIzaSyBJRvyFuIrqrA4QrEqvBL6mf5vFMFmGu_Y',
    authDomain: 'ferromaster-pos.firebaseapp.com',
    projectId: 'ferromaster-pos',
    storageBucket: 'ferromaster-pos.firebasestorage.app',
    messagingSenderId: '417792904866',
    appId: '1:417792904866:web:82402d7f738117ae63d1fb'
});
const auth = getAuth(app);
auth.languageCode = 'es';
const db = getFirestore(app);
const owner = 'carzunsan@gmail.com';
const path = ['artifacts', 'ferromaster-pos', 'public', 'data'];
const listeners = new Map();
const subscriptions = new Map();
const snapshots = new Map();
const failedSubscriptions = new Set();
let allowed = false;
let role = null;
let actor = null;
let profileListener = null;
let rawInventory = [];
let rawSales = [];
let inventoryLoaded = false;
let salesLoaded = false;
let catalog = new Map();
let costs = new Map();
function adminOnly() { if (role !== 'admin') throw new Error('Esta operacion requiere administrador.'); }
function publishInventory() {
    if (!inventoryLoaded) return;
    const items = role === 'admin' ? rawInventory.map(item => ({ ...item, stock: catalog.get(String(item.id))?.stock ?? item.stock })) : rawInventory;
    subscriptions.get('inventory')?.(items);
    if (role === 'admin') saveDeviceCache('inventory', items);
}
function publishSales() {
    if (role !== 'admin' || !salesLoaded) return;
    if (rawSales.some(sale => sale.reportVersion === 4 && sale.productIds.some(id => !costs.has(sale.lines[id].costVersion)))) return;
    const items = rawSales.map(sale => expandCashierSale(sale, costs, lineAmount));
    items.sort((a, b) => (parseSaleDate(b.date)?.getTime() || 0) - (parseSaleDate(a.date)?.getTime() || 0));
    subscriptions.get('sales')?.(items);
    saveDeviceCache('sales', items);
}
function startAdminData() {
    for (const kind of ['catalog', 'costs']) listeners.set('@' + kind, onSnapshot(collection(db, ...path, kind), { includeMetadataChanges: true }, snapshot => {
        const rows = new Map(snapshot.docs.map(d => [d.id, d.data()]));
        if (kind === 'catalog') { catalog = rows; publishInventory(); } else { costs = rows; publishSales(); }
    }, fail));
}

function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
function status() {
    if (failedSubscriptions.size) { emit('ferro-sync', 'Error de sincronización'); return; }
    const expected = [...subscriptions.keys()].filter(kind => role === 'admin' || kind === 'inventory').length;
    const ready = snapshots.size === expected && snapshots.size > 0;
    emit('ferro-sync', !navigator.onLine ? 'Sin conexión' : !allowed ? 'Sin sesión' : !ready ? 'Conectando...' : [...snapshots.values()].some(m => m.hasPendingWrites || m.fromCache) ? 'Pendiente de sincronizar' : 'Sincronizado');
}
function fail(error) {
    console.error('Firebase:', error.code || error.message);
    const message = error.code === 'permission-denied' ? 'Firebase denegó el acceso. Revisa la cuenta y los permisos.' : 'No se pudo sincronizar con Firebase. Revisa la conexión.';
    emit('ferro-sync', 'Error de sincronización');
    emit('ferro-error', message);
    return error;
}
function ref(kind, id) {
    const key = String(id ?? '');
    if (!key || key.includes('/')) throw new Error('Identificador de producto o venta no válido.');
    return doc(db, ...path, kind, key);
}
function start(kind) {
    if (!allowed || listeners.has(kind)) return;
    if (role !== 'admin' && kind !== 'inventory') return;
    listeners.set(kind, onSnapshot(collection(db, ...path, role === 'cashier' ? 'catalog' : kind), { includeMetadataChanges: true }, snapshot => {
        snapshots.set(kind, snapshot.metadata);
        let items = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
        if (snapshot.metadata.fromCache && !items.length && readDeviceCache()?.[kind]?.length) {
            status();
            return;
        }
        if (kind === 'inventory') { rawInventory = items; inventoryLoaded = true; publishInventory(); }
        else if (kind === 'sales') { rawSales = items; salesLoaded = true; publishSales(); }
        else subscriptions.get(kind)(items);
        status();
    }, error => { failedSubscriptions.add(kind); fail(error); }));
}
async function write(action) {
    try {
        if (!allowed) throw new Error('Inicia sesión con tu cuenta autorizada.');
        if (!navigator.onLine) throw new Error('Sin conexión. Conéctate antes de guardar cambios.');
        return await action();
    } catch (error) { throw fail(error); }
}

window.ferroFirebase = {
    readDeviceCache,
    async prepareCatalog() {
        adminOnly();
        const inventory = await getDocs(collection(db, ...path, 'inventory'));
        for (const entry of inventory.docs) await runTransaction(db, async transaction => {
            const source = await transaction.get(ref('inventory', entry.id));
            const existing = await transaction.get(ref('catalog', entry.id));
            if (!source.exists() || existing.exists()) return;
            const product = source.data();
            const version = crypto.randomUUID();
            transaction.update(ref('inventory', entry.id), { costVersion: version });
            transaction.set(ref('costs', version), historicalProduct({ ...product, costVersion: version }, entry.id, product.buyPrice != null));
            transaction.set(ref('catalog', entry.id), catalogProduct({ ...product, costVersion: version }));
        });
    },
    async saveUser(user) {
        adminOnly();
        const email = user.email.trim().toLowerCase();
        if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email) || email === owner || !user.name.trim()) throw new Error('Revisa el nombre y correo del cajero.');
        await this.prepareCatalog();
        return write(() => runTransaction(db, async transaction => {
            const userRef = ref('users', email);
            if ((await transaction.get(userRef)).exists()) throw new Error('Ese cajero ya existe. Puedes activar o desactivar su acceso en la lista.');
            transaction.set(userRef, { email, name: user.name.trim(), role: 'cashier', active: user.active !== false });
        }));
    },
    setUserActive(user, active) { adminOnly(); return write(() => setDoc(ref('users', user.email), { email: user.email, name: user.name, role: 'cashier', active })); },
    async initAuth(callback, message) {
        if (isSignInWithEmailLink(auth, location.href)) {
            try {
                await setPersistence(auth, browserLocalPersistence);
                const email = localStorage.getItem('ferro-login-email') || window.prompt('Confirma el correo al que recibiste este enlace:');
                if (!email) throw new Error('Confirma tu correo.');
                await signInWithEmailLink(auth, email.trim().toLowerCase(), location.href);
                history.replaceState(null, '', location.pathname);
            } catch (error) {
                history.replaceState(null, '', location.pathname);
                message('El enlace de acceso no es válido o ha vencido. Solicita uno nuevo.');
            }
        }
        onAuthStateChanged(auth, async user => {
            profileListener?.(); profileListener = null;
            for (const unsubscribe of listeners.values()) unsubscribe();
            listeners.clear();
            snapshots.clear();
            failedSubscriptions.clear();
            allowed = false; role = null; actor = null;
            rawInventory = []; rawSales = []; inventoryLoaded = false; salesLoaded = false; catalog.clear(); costs.clear();
            const activate = (nextRole, name) => {
                allowed = !!nextRole; role = nextRole;
                actor = allowed ? { uid: user.uid, email: user.email, name: name || user.email, role } : null;
                if (role !== 'admin') clearDeviceCache();
                callback(actor);
                if (role === 'admin') startAdminData();
                for (const kind of subscriptions.keys()) start(kind);
                status();
            };
            if (user?.emailVerified && user.email === owner) activate('admin', 'Administrador');
            else if (user?.emailVerified) {
                profileListener = onSnapshot(ref('users', user.email.toLowerCase()), {}, snapshot => {
                    for (const unsubscribe of listeners.values()) unsubscribe(); listeners.clear(); snapshots.clear();
                    const profile = snapshot.exists() ? snapshot.data() : null;
                    activate(profile?.role === 'cashier' && profile.active === true ? 'cashier' : null, profile?.name);
                    if (!allowed) message('Tu cuenta no tiene acceso activo. Consulta al administrador.');
                }, () => { activate(null); message('No se pudo comprobar el acceso.'); });
            } else activate(null);
        }, error => { message('No se pudo iniciar sesión.'); fail(error); });
    },
    async sendLoginLink(email) {
        const address = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Escribe un correo valido.');
        await sendSignInLinkToEmail(auth, address, { url: 'https://car96loc.github.io/MaterFerro/', handleCodeInApp: true });
        localStorage.setItem('ferro-login-email', address);
    },
    async logout() { await signOut(auth); clearDeviceCache(); },
    subscribeInventory(callback) { subscriptions.set('inventory', callback); start('inventory'); },
    subscribeSales(callback) { subscriptions.set('sales', callback); start('sales'); },
    subscribeUsers(callback) { subscriptions.set('users', callback); start('users'); },
    saveProduct(item, { create = false } = {}) {
        if (allowed) adminOnly();
        return write(() => runTransaction(db, async transaction => {
            const productRef = ref('inventory', item.id || item.code);
            const previous = await transaction.get(productRef);
            if (create && previous.exists()) throw new Error('Ese codigo ya existe. Cierra y abre Nuevo producto para generar otro.');
            if (!create && !previous.exists()) throw new Error('Este producto ya fue eliminado en otro dispositivo.');
            const before = previous.data() || {};
            const photos = item.photos === undefined ? (item.photo === undefined || item.photo === before.photo ? productPhotos(before) : item.photo ? [item.photo] : []) : item.photos;
            if (!Array.isArray(photos) || photos.length > 6 || photos.some(photo => !photo || !validProductPhoto(photo))) throw new Error('Usa hasta 6 fotos comprimidas validas.');
            const photo = photos[0] || '';
            const version = crypto.randomUUID();
            const record = {
            costVersion: version,
            photo, photos,
            code: String(item.code), name: String(item.name), category: String(item.category),
            buyPrice: Number(item.buyPrice || 0), price: Number(item.price || 0), stock: Number(item.stock || 0),
            boxMode: !!item.boxMode, unitsPerBox: Number(item.unitsPerBox || 1), boxCost: Number(item.boxCost ?? item.buyPrice ?? 0),
            saleUnits: Number(item.saleUnits || 1), salePrice: Number(item.salePrice ?? item.price ?? 0),
            boxSalePrice: item.boxSalePrice == null ? null : Number(item.boxSalePrice)
            };
            transaction.set(productRef, record);
            transaction.set(ref('catalog', item.id || item.code), catalogProduct(record));
            transaction.set(ref('costs', version), historicalProduct(record, item.id || item.code));
        }));
    },
    deleteProduct(id) { if (allowed) adminOnly(); return write(() => runTransaction(db, async transaction => { transaction.delete(ref('inventory', id)); transaction.delete(ref('catalog', id)); })); },
    saveSale(sale) { adminOnly(); return write(() => setDoc(ref('sales', sale.id), sale)); },
    updateSale(sale) { adminOnly(); return write(() => setDoc(ref('sales', sale.id), sale)); },
    deleteSale(id) { adminOnly(); return write(() => deleteDoc(ref('sales', id))); },
    completeSale(sale) {
        if (role === 'cashier') return write(() => runTransaction(db, async transaction => {
            const products = new Map();
            const saleRef = ref('sales', sale.id);
            if ((await transaction.get(saleRef)).exists()) throw new Error('Esta venta ya fue registrada.');
            for (const item of sale.items) if (!products.has(String(item.id))) {
                const snapshot = await transaction.get(ref('catalog', item.id));
                if (!snapshot.exists()) throw new Error('Producto eliminado.');
                products.set(String(item.id), snapshot.data());
            }
            const recorded = cashierSale(sale, products, actor);
            for (const id of recorded.productIds) transaction.update(ref('catalog', id), { stock: recorded.lines[id].stockAfter, lastSaleId: sale.id });
            transaction.set(saleRef, { ...recorded, createdAt: serverTimestamp() });
        }));
        return write(() => runTransaction(db, async transaction => {
            const saleRef = ref('sales', sale.id);
            if ((await transaction.get(saleRef)).exists()) throw new Error('La venta ya está registrada.');
            const products = new Map();
            const recordedItems = [];
            for (const item of sale.items) {
                const productRef = ref('inventory', item.id);
                const snapshot = await transaction.get(productRef);
                const publicSnapshot = await transaction.get(ref('catalog', item.id));
                const product = snapshot.exists() ? { ...snapshot.data(), stock: publicSnapshot.exists() ? publicSnapshot.data().stock : snapshot.data().stock } : null;
                const qty = Number(item.qty);
                const units = stockUnits(item);
                const previousUnits = products.get(String(item.id))?.units || 0;
                if (!product || !Number.isSafeInteger(qty) || qty <= 0 || !Number.isSafeInteger(units) || units <= 0 || product.stock < previousUnits + units) throw new Error('Existencias insuficientes para ' + item.name);
                products.set(String(item.id), { productRef, id: item.id, units: previousUnits + units, stock: product.stock - previousUnits - units, product });
                if (item.presentation === 'box' && (!product.boxMode || product.boxSalePrice == null || Number(product.unitsPerBox) !== Number(item.unitsPerBox) || Number(product.boxSalePrice) !== Number(item.boxSalePrice))) {
                    throw new Error('La presentacion o el precio de la caja cambio. Vuelve a agregar el producto al carrito.');
                }
                recordedItems.push({ ...item, unitsSold: units, lineTotal: lineAmount(item), code: product.code, name: product.name, category: product.category,
                    buyPrice: Number(product.buyPrice || 0), costKnown: product.buyPrice != null && Number.isFinite(Number(product.buyPrice)) && Number(product.buyPrice) >= 0,
                    stockBefore: Number(product.stock) - previousUnits, stockAfter: Number(product.stock) - previousUnits - units });
            }
            for (const product of products.values()) {
                transaction.update(product.productRef, { stock: product.stock });
                transaction.set(ref('catalog', product.id), catalogProduct({ ...product.product, stock: product.stock }));
            }
            const recordedSale = { ...sale, cashierUid: actor?.uid || 'owner', cashierEmail: actor?.email || owner, cashierName: actor?.name || 'Administrador', itemsCount: recordedItems.reduce((sum, item) => sum + item.unitsSold, 0), total: recordedItems.reduce((sum, item) => sum + Math.round(item.lineTotal * 100), 0) / 100, items: recordedItems, reportVersion: 3 };
            const totals = saleTotals(recordedSale);
            transaction.set(saleRef, { ...recordedSale, totalCost: totals.cost, grossProfit: totals.profit });
        }));
    },
    returnSale(id, itemId) {
        if (allowed) adminOnly();
        return write(() => runTransaction(db, async transaction => {
            const saleRef = ref('sales', id);
            const snapshot = await transaction.get(saleRef);
            if (!snapshot.exists()) throw new Error('La venta ya fue anulada.');
            const stored = snapshot.data();
            const historical = new Map(costs);
            if (stored.reportVersion === 4) for (const productId of stored.productIds) {
                const version = stored.lines[productId].costVersion;
                if (historical.has(version)) continue;
                const cost = await transaction.get(ref('costs', version));
                if (!cost.exists()) throw new Error('No se encontro el costo historico de esta venta.');
                historical.set(version, cost.data());
            }
            const sale = expandCashierSale(stored, historical, lineAmount);
            const returned = itemId == null ? sale.items : sale.items.filter(item => String(item.lineId || item.id) === String(itemId));
            if (!returned.length) throw new Error('El producto ya fue devuelto.');
            const products = new Map();
            for (const item of returned) {
                const productRef = ref('inventory', item.id);
                const product = await transaction.get(productRef);
                const publicProduct = await transaction.get(ref('catalog', item.id));
                const previousUnits = products.get(String(item.id))?.units || 0;
                const units = previousUnits + stockUnits(item);
                if (product.exists()) products.set(String(item.id), { productRef, id: item.id, product: product.data(), units, stock: (publicProduct.exists() ? publicProduct.data().stock : product.data().stock) + units });
            }
            for (const product of products.values()) {
                transaction.update(product.productRef, { stock: product.stock });
                transaction.set(ref('catalog', product.id), catalogProduct({ ...product.product, stock: product.stock }));
            }
            const items = sale.items.filter(item => !returned.includes(item));
            if (!items.length) transaction.delete(saleRef);
            else {
                const total = items.reduce((sum, item) => sum + Math.round(lineAmount(item) * 100), 0) / 100;
                const totals = saleTotals({ items, total });
                transaction.update(saleRef, { reportVersion: 3, items, itemsCount: items.reduce((sum, item) => sum + stockUnits(item), 0), total, totalCost: totals.cost, grossProfit: totals.profit });
            }
        }));
    }
};
window.addEventListener('online', status);
window.addEventListener('offline', status);
window.addEventListener('unhandledrejection', event => { console.error(event.reason); });
const alpine = document.createElement('script');
alpine.src = 'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js';
document.head.appendChild(alpine);
