const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function client(store = new Map()) {
    const subscriptions = new Map();
    const events = [];
    const navigator = { onLine: true };
    const window = { dispatchEvent(event) { events.push(event); }, addEventListener() {} };
    let authCallback;
    const context = {
        console: { error() {} }, window, navigator,
        location: { href: 'https://car96loc.github.io/MaterFerro/', pathname: '/MaterFerro/' },
        history: { replaceState() {} },
        document: { createElement() { return {}; }, head: { appendChild() {} } },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        initializeApp() { return {}; }, getAuth() { return {}; }, getFirestore() { return {}; },
        isSignInWithEmailLink() { return false; },
        onAuthStateChanged(auth, callback) { authCallback = callback; },
        signOut: async () => {}, sendSignInLinkToEmail: async () => {},
        collection: (db, ...path) => path.join('/'), doc: (db, ...path) => path.join('/'),
        onSnapshot(path, options, callback, error) { subscriptions.set(path.split('/').at(-1), { callback, error }); return () => {}; },
        async setDoc(path, value) { store.set(path, structuredClone(value)); },
        async deleteDoc(path) { store.delete(path); },
        async runTransaction(db, operation) {
            const draft = new Map([...store].map(([key, value]) => [key, structuredClone(value)]));
            const result = await operation({
                async get(path) { return { exists: () => draft.has(path), data: () => structuredClone(draft.get(path)) }; },
                update(path, value) { draft.set(path, { ...draft.get(path), ...structuredClone(value) }); },
                set(path, value) { draft.set(path, structuredClone(value)); },
                delete(path) { draft.delete(path); }
            });
            store.clear();
            for (const [key, value] of draft) store.set(key, value);
            return result;
        }
    };
    const source = fs.readFileSync(__dirname + '/firebase-sync.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
    vm.runInNewContext(source, context);
    const api = window.ferroFirebase;
    api.initAuth(() => {}, () => {});
    return { api, store, events, subscriptions, navigator, login: user => authCallback(user || { email: 'carzunsan@gmail.com', emailVerified: true }) };
}
const key = (kind, id) => `artifacts/ferromaster-pos/public/data/${kind}/${id}`;
const sale = id => ({ id, items: [{ id: 'p1', name: 'Martillo', qty: 2, price: 10 }], total: 20, itemsCount: 2 });

test('verified owner only, with no anonymous writes', async () => {
    const c = client();
    await assert.rejects(c.api.saveProduct({ id: 'x' }));
    await c.login({ email: 'other@example.com', emailVerified: true });
    await assert.rejects(c.api.deleteProduct('x'));
    await c.login();
    await c.api.saveProduct({ id: 'p1', code: '1', name: 'Martillo', category: 'Herramientas', stock: 4 });
    assert.equal(c.store.get(key('inventory', 'p1')).stock, 4);
});

test('empty inventory is delivered and never recreated; sync includes both collections', async () => {
    const c = client();
    let inventory;
    c.api.subscribeInventory(items => { inventory = items; });
    c.api.subscribeSales(() => {});
    await c.login();
    const snapshot = { docs: [], metadata: { fromCache: false, hasPendingWrites: false } };
    c.subscriptions.get('inventory').callback(snapshot);
    assert.equal(inventory.length, 0);
    assert.equal(c.store.size, 0);
    assert.notEqual(c.events.at(-1).detail, 'Sincronizado');
    c.subscriptions.get('sales').callback(snapshot);
    assert.equal(c.events.at(-1).detail, 'Sincronizado');
    c.subscriptions.get('inventory').callback({ ...snapshot, metadata: { fromCache: true } });
    assert.equal(c.events.at(-1).detail, 'Pendiente de sincronizar');
    c.subscriptions.get('inventory').error({ code: 'permission-denied' });
    assert.ok(c.events.some(event => event.detail === 'Error de sincronización'));
});

test('sale and stock are atomic; insufficient stock and duplicate sale do not change records', async () => {
    const c = client(new Map([[key('inventory', 'p1'), { stock: 3 }]]));
    await c.login();
    await c.api.completeSale(sale('v1'));
    assert.equal(c.store.get(key('inventory', 'p1')).stock, 1);
    await assert.rejects(c.api.completeSale(sale('v2')));
    await assert.rejects(c.api.completeSale(sale('v1')));
    assert.equal(c.store.get(key('inventory', 'p1')).stock, 1);
    assert.equal(c.store.has(key('sales', 'v2')), false);
});

test('return restores stock once; repeated return and offline writes fail', async () => {
    const c = client(new Map([[key('inventory', 'p1'), { stock: 1 }], [key('sales', 'v1'), sale('v1')]]));
    await c.login();
    await c.api.returnSale('v1', 'p1');
    assert.equal(c.store.get(key('inventory', 'p1')).stock, 3);
    assert.equal(c.store.has(key('sales', 'v1')), false);
    await assert.rejects(c.api.returnSale('v1', 'p1'));
    assert.equal(c.store.get(key('inventory', 'p1')).stock, 3);
    c.navigator.onLine = false;
    await assert.rejects(c.api.deleteProduct('p1'));
    assert.ok(c.store.has(key('inventory', 'p1')));
});

test('inline application code parses', () => {
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
    assert.ok(!html.includes('demo-api-key'));
    assert.ok(!html.includes('cloudItems.length === 0'));
});
