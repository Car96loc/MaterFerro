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
    vm.runInNewContext(fs.readFileSync(__dirname + '/pricing.js', 'utf8').replace(/^export /gm, ''), context);
    vm.runInNewContext(fs.readFileSync(__dirname + '/sales-report.js', 'utf8').replace(/^export /gm, ''), context);
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
    await c.api.saveProduct({ id: 'p1', code: '1', name: 'Martillo', category: 'Herramientas', stock: 4 }, { create: true });
    assert.equal(c.store.get(key('inventory', 'p1')).stock, 4);
    await assert.rejects(c.api.saveProduct({ id: 'p1', stock: 99 }, { create: true }));
    await c.api.deleteProduct('p1');
    await assert.rejects(c.api.saveProduct({ id: 'p1', stock: 99 }));
    assert.equal(c.store.has(key('inventory', 'p1')), false);
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
    const c = client(new Map([[key('inventory', 'p1'), { stock: 3, code: '1', name: 'Martillo', category: 'Herramientas', buyPrice: 4 }]]));
    await c.login();
    await c.api.completeSale(sale('v1'));
    assert.equal(c.store.get(key('inventory', 'p1')).stock, 1);
    const recorded = c.store.get(key('sales', 'v1'));
    assert.equal(recorded.totalCost, 8);
    assert.equal(recorded.grossProfit, 12);
    assert.equal(recorded.items[0].buyPrice, 4);
    assert.equal(recorded.items[0].stockBefore, 3);
    c.store.get(key('inventory', 'p1')).buyPrice = 99;
    assert.equal(recorded.grossProfit, 12);
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

test('partial return recalculates stored cost and profit using historical prices', async () => {
    const historical = { id: 'v1', total: 30, itemsCount: 3, items: [
        { id: 'p1', qty: 2, price: 10, buyPrice: 4, costKnown: true },
        { id: 'p2', qty: 1, price: 10, buyPrice: 3, costKnown: true }
    ] };
    const c = client(new Map([[key('sales', 'v1'), historical], [key('inventory', 'p1'), { stock: 1, buyPrice: 99 }]]));
    await c.login();
    await c.api.returnSale('v1', 'p1');
    const result = c.store.get(key('sales', 'v1'));
    assert.equal(result.total, 10);
    assert.equal(result.totalCost, 3);
    assert.equal(result.grossProfit, 7);
    assert.equal(result.itemsCount, 1);
    assert.equal(c.store.get(key('inventory', 'p1')).stock, 3);
});

test('box product persists and odd sale charges 8 cents, restores correct stock on return', async () => {
    const c = client();
    await c.login();
    const product = { id: 'bolts', code: '61', name: 'Pernos', category: 'Tornilleria',
        boxMode: true, unitsPerBox: 100, boxCost: 1, saleUnits: 2, salePrice: 0.05,
        buyPrice: 0.01, price: 0.025, stock: 100 };
    await c.api.saveProduct(product, { create: true });
    assert.equal(c.store.get(key('inventory', 'bolts')).saleUnits, 2);
    await c.api.completeSale({ id: 'odd', total: 0.08, itemsCount: 3, items: [{ ...product, qty: 3 }] });
    const recorded = c.store.get(key('sales', 'odd'));
    assert.equal(recorded.total, 0.08);
    assert.equal(recorded.items[0].lineTotal, 0.08);
    assert.equal(recorded.totalCost, 0.03);
    assert.equal(recorded.grossProfit, 0.05);
    assert.equal(c.store.get(key('inventory', 'bolts')).stock, 97);
    await c.api.returnSale('odd', 'bolts');
    assert.equal(c.store.get(key('inventory', 'bolts')).stock, 100);
    assert.equal(c.store.has(key('sales', 'odd')), false);
});

test('mixed box/unit sale shares stock and single-line return keeps the other presentation', async () => {
    const product = { code: '61', name: 'Tornillos', category: 'Tornilleria', boxMode: true,
        unitsPerBox: 200, boxCost: 2, boxSalePrice: 3, buyPrice: 0.01, price: 0.025, saleUnits: 2, salePrice: 0.05, stock: 400 };
    const c = client(new Map([[key('inventory', 'screws'), product]]));
    await c.login();
    const carton = { ...product, id: 'screws', lineId: 'screws:box', presentation: 'box', price: 3, qty: 1 };
    const loose = { ...product, id: 'screws', lineId: 'screws:unit', presentation: 'unit', qty: 2 };
    await c.api.completeSale({ id: 'mixed', items: [carton, loose], total: 3.05 });
    const recorded = c.store.get(key('sales', 'mixed'));
    assert.equal(recorded.total, 3.05);
    assert.equal(recorded.totalCost, 2.02);
    assert.ok(Math.abs(recorded.grossProfit - 1.03) < 0.000001);
    assert.equal(recorded.itemsCount, 202);
    assert.equal(c.store.get(key('inventory', 'screws')).stock, 198);
    await c.api.returnSale('mixed', 'screws:unit');
    const remaining = c.store.get(key('sales', 'mixed'));
    assert.equal(remaining.items.length, 1);
    assert.equal(remaining.items[0].presentation, 'box');
    assert.equal(remaining.total, 3);
    assert.equal(remaining.totalCost, 2);
    assert.equal(remaining.grossProfit, 1);
    assert.equal(remaining.itemsCount, 200);
    assert.equal(c.store.get(key('inventory', 'screws')).stock, 200);
    await c.api.returnSale('mixed');
    assert.equal(c.store.get(key('inventory', 'screws')).stock, 400);
});

test('full mixed return restores all units; combined overselling is atomic', async () => {
    const product = { code: '61', name: 'Pernos', category: 'Herramientas', boxMode: true,
        unitsPerBox: 200, boxSalePrice: 3, buyPrice: 0.01, stock: 201 };
    const c = client(new Map([[key('inventory', 'p'), product]]));
    await c.login();
    const carton = { id: 'p', lineId: 'p:box', presentation: 'box', unitsPerBox: 200, boxSalePrice: 3, price: 3, qty: 1 };
    const loose = { id: 'p', lineId: 'p:unit', presentation: 'unit', price: 0.025, qty: 2 };
    await assert.rejects(c.api.completeSale({ id: 'too-many', items: [carton, loose] }));
    assert.equal(c.store.get(key('inventory', 'p')).stock, 201);
    assert.equal(c.store.has(key('sales', 'too-many')), false);
    loose.qty = 1;
    await c.api.completeSale({ id: 'ok', items: [carton, loose] });
    assert.equal(c.store.get(key('inventory', 'p')).stock, 0);
    await c.api.returnSale('ok');
    assert.equal(c.store.get(key('inventory', 'p')).stock, 201);
});
