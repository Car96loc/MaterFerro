import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, onAuthStateChanged, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

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

function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
function status() {
    if (failedSubscriptions.size) { emit('ferro-sync', 'Error de sincronización'); return; }
    const ready = snapshots.size === subscriptions.size && snapshots.size > 0;
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
    listeners.set(kind, onSnapshot(collection(db, ...path, kind), { includeMetadataChanges: true }, snapshot => {
        snapshots.set(kind, snapshot.metadata);
        let items = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
        if (kind === 'sales') items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        subscriptions.get(kind)(items);
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
    async initAuth(callback, message) {
        if (isSignInWithEmailLink(auth, location.href)) {
            try {
                await signInWithEmailLink(auth, owner, location.href);
                history.replaceState(null, '', location.pathname);
            } catch (error) {
                message('El enlace de acceso no es válido o ha vencido. Solicita uno nuevo.');
            }
        }
        onAuthStateChanged(auth, async user => {
            for (const unsubscribe of listeners.values()) unsubscribe();
            listeners.clear();
            snapshots.clear();
            failedSubscriptions.clear();
            allowed = !!user && user.email === owner && user.emailVerified;
            callback(allowed ? user : null);
            if (user && !allowed) { message('Esta cuenta no tiene acceso al inventario.'); await signOut(auth); }
            for (const kind of subscriptions.keys()) start(kind);
            status();
        }, error => { message('No se pudo iniciar sesión.'); fail(error); });
    },
    async sendLoginLink(email) {
        if (email.trim().toLowerCase() !== owner) throw new Error('Usa el correo autorizado para este inventario.');
        await sendSignInLinkToEmail(auth, owner, { url: 'https://car96loc.github.io/MaterFerro/', handleCodeInApp: true });
    },
    logout() { return signOut(auth); },
    subscribeInventory(callback) { subscriptions.set('inventory', callback); start('inventory'); },
    subscribeSales(callback) { subscriptions.set('sales', callback); start('sales'); },
    saveProduct(item, { create = false } = {}) {
        return write(() => runTransaction(db, async transaction => {
            const productRef = ref('inventory', item.id || item.code);
            const previous = await transaction.get(productRef);
            if (create && previous.exists()) throw new Error('Ese codigo ya existe. Cierra y abre Nuevo producto para generar otro.');
            if (!create && !previous.exists()) throw new Error('Este producto ya fue eliminado en otro dispositivo.');
            transaction.set(productRef, {
            code: String(item.code), name: String(item.name), category: String(item.category),
            buyPrice: Number(item.buyPrice || 0), price: Number(item.price || 0), stock: Number(item.stock || 0)
            });
        }));
    },
    deleteProduct(id) { return write(() => deleteDoc(ref('inventory', id))); },
    saveSale(sale) { return write(() => setDoc(ref('sales', sale.id), sale)); },
    updateSale(sale) { return write(() => setDoc(ref('sales', sale.id), sale)); },
    deleteSale(id) { return write(() => deleteDoc(ref('sales', id))); },
    completeSale(sale) {
        return write(() => runTransaction(db, async transaction => {
            const saleRef = ref('sales', sale.id);
            if ((await transaction.get(saleRef)).exists()) throw new Error('La venta ya está registrada.');
            const products = [];
            for (const item of sale.items) {
                const productRef = ref('inventory', item.id);
                const snapshot = await transaction.get(productRef);
                const qty = Number(item.qty);
                if (!snapshot.exists() || !Number.isInteger(qty) || qty <= 0 || snapshot.data().stock < qty) throw new Error('Existencias insuficientes para ' + item.name);
                products.push({ productRef, stock: snapshot.data().stock - qty });
            }
            for (const product of products) transaction.update(product.productRef, { stock: product.stock });
            transaction.set(saleRef, sale);
        }));
    },
    returnSale(id, itemId) {
        return write(() => runTransaction(db, async transaction => {
            const saleRef = ref('sales', id);
            const snapshot = await transaction.get(saleRef);
            if (!snapshot.exists()) throw new Error('La venta ya fue anulada.');
            const sale = snapshot.data();
            const returned = itemId == null ? sale.items : sale.items.filter(item => String(item.id) === String(itemId));
            if (!returned.length) throw new Error('El producto ya fue devuelto.');
            const products = [];
            for (const item of returned) {
                const productRef = ref('inventory', item.id);
                const product = await transaction.get(productRef);
                if (product.exists()) products.push({ productRef, stock: product.data().stock + Number(item.qty) });
            }
            for (const product of products) transaction.update(product.productRef, { stock: product.stock });
            const items = sale.items.filter(item => !returned.includes(item));
            if (!items.length) transaction.delete(saleRef);
            else transaction.update(saleRef, { items, itemsCount: items.reduce((sum, item) => sum + Number(item.qty), 0), total: items.reduce((sum, item) => sum + Number(item.qty) * Number(item.price), 0) });
        }));
    }
};
window.addEventListener('online', status);
window.addEventListener('offline', status);
window.addEventListener('unhandledrejection', event => { console.error(event.reason); });
const alpine = document.createElement('script');
alpine.src = 'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js';
document.head.appendChild(alpine);
