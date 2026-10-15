const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, collection, getDoc, getDocs, setDoc, updateDoc, runTransaction, serverTimestamp } = require('firebase/firestore');
const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
const check = enabled ? test : test.skip;
let env;
const access = {};
vm.runInNewContext(fs.readFileSync(__dirname + '/access.js', 'utf8').replace(/^export /gm, ''), access);
const root = 'artifacts/ferromaster-pos/public/data';
const owner = 'carzunsan@gmail.com';
const email = 'cajero@example.com';
const ref = (db, kind, id) => doc(db, root, kind, id);
const cashier = () => env.authenticatedContext('cashier-1', { email, email_verified: true }).firestore();
before(async () => {
    if (enabled) env = await initializeTestEnvironment({ projectId: 'demo-ferro', firestore: { rules: fs.readFileSync(__dirname + '/firestore.rules', 'utf8') } });
});
beforeEach(async () => {
    if (!enabled) return;
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(ref(db, 'users', email), { email, name: 'Ana', role: 'cashier', active: true });
        await setDoc(ref(db, 'sales', 'old'), { total: 99 });
        for (let i = 0; i < 8; i++) {
            const product = { code: String(i), name: 'Perno ' + i, category: 'Otros', price: 2, stock: 20, buyPrice: 0.5, costVersion: 'cost-' + i };
            await setDoc(ref(db, 'inventory', String(i)), product);
            await setDoc(ref(db, 'catalog', String(i)), JSON.parse(JSON.stringify(access.catalogProduct(product))));
            await setDoc(ref(db, 'costs', 'cost-' + i), JSON.parse(JSON.stringify(access.historicalProduct(product, String(i)))));
        }
    });
});
after(async () => { await env?.cleanup(); });

async function sell(db, count = 1, mutate = value => value, updateStock = true) {
    return runTransaction(db, async transaction => {
        const saleRef = ref(db, 'sales', 'new');
        await transaction.get(saleRef);
        const products = new Map();
        const items = [];
        for (let i = 0; i < count; i++) {
            const id = String(i);
            products.set(id, (await transaction.get(ref(db, 'catalog', id))).data());
            items.push({ id, qty: 2, presentation: 'unit', price: 2, salePrice: 2 });
        }
        const sale = JSON.parse(JSON.stringify(access.cashierSale({ id: 'new', date: new Date().toISOString(), paymentMethod: 'efectivo', items }, products, { uid: 'cashier-1', email, name: 'Ana' })));
        mutate(sale);
        if (updateStock) for (const id of sale.productIds) transaction.update(ref(db, 'catalog', id), { stock: sale.lines[id].stockAfter, lastSaleId: sale.id });
        transaction.set(saleRef, { ...sale, createdAt: serverTimestamp() });
    });
}
check('cajero reads catalog but cannot read private inventory, costs, sales or list users', async () => {
    const db = cashier();
    await assertSucceeds(getDocs(collection(db, root, 'catalog')));
    await assertSucceeds(getDoc(ref(db, 'users', email)));
    for (const kind of ['inventory', 'costs', 'sales', 'users']) await assertFails(getDocs(collection(db, root, kind)));
    await assertFails(getDoc(ref(db, 'sales', 'old')));
    await assertFails(getDoc(ref(db, 'inventory', '0')));
    await assertFails(getDoc(ref(db, 'costs', 'cost-0')));
});
check('cajero cannot modify price, edit products, grant privileges or write stock without a sale', async () => {
    const db = cashier();
    await assertFails(updateDoc(ref(db, 'catalog', '0'), { price: 0.01 }));
    await assertFails(updateDoc(ref(db, 'catalog', '0'), { stock: 0, lastSaleId: 'old' }));
    await assertFails(updateDoc(ref(db, 'inventory', '0'), { stock: 0 }));
    await assertFails(updateDoc(ref(db, 'users', email), { role: 'admin' }));
});
check('cashier sale commits atomically without exposing costs', async () => {
    await assertSucceeds(sell(cashier(), 1));
    const db = env.authenticatedContext('owner', { email: owner, email_verified: true }).firestore();
    const sale = (await getDoc(ref(db, 'sales', 'new'))).data();
    assert.equal(sale.cashierEmail, email);
    assert.equal(sale.lines['0'].stockAfter, 18);
    assert.equal(sale.lines['0'].buyPrice, undefined);
    assert.equal((await getDoc(ref(db, 'catalog', '0'))).data().stock, 18);
});
for (const count of [2, 3, 4, 5, 8]) check('atomic cashier sale with ' + count + ' products', async () => {
    await assertSucceeds(sell(cashier(), count));
});
check('forged price, fake sale without stock decrement and overselling are denied', async () => {
    await assertFails(sell(cashier(), 1, sale => { sale.lines['0'].price = 0.01; }));
    await assertFails(sell(cashier(), 1, () => {}, false));
    await assertFails(sell(cashier(), 1, sale => { sale.lines['0'].unitQty = 21; sale.lines['0'].unitsSold = 21; sale.lines['0'].stockAfter = -1; }));
    await assertFails(sell(cashier(), 1, sale => { sale.lines['0'].costVersion = 'fake-cost'; }));
});

check('mixed boxes and odd units validate together, and old sales cannot be replayed', async () => {
    await env.withSecurityRulesDisabled(async context => {
        await updateDoc(ref(context.firestore(), 'catalog', '0'), { stock: 400, boxMode: true, unitsPerBox: 200, saleUnits: 2, salePrice: 0.05, price: 0.025, boxSalePrice: 3 });
    });
    const db = cashier();
    await assertSucceeds(runTransaction(db, async transaction => {
        const p = (await transaction.get(ref(db, 'catalog', '0'))).data();
        const sale = JSON.parse(JSON.stringify(access.cashierSale({ id: 'mixed', date: new Date().toISOString(), paymentMethod: 'efectivo', items: [
            { id: '0', qty: 1, presentation: 'box', boxSalePrice: 3 }, { id: '0', qty: 3, price: 0.025, salePrice: 0.05 }
        ] }, new Map([['0', p]]), { uid: 'cashier-1', email, name: 'Ana' })));
        transaction.update(ref(db, 'catalog', '0'), { stock: sale.lines['0'].stockAfter, lastSaleId: 'mixed' });
        transaction.set(ref(db, 'sales', 'mixed'), { ...sale, createdAt: serverTimestamp() });
    }));
    await assertFails(updateDoc(ref(db, 'catalog', '0'), { stock: 197, lastSaleId: 'mixed' }));
});
check('deactivation revokes an already authenticated cashier; owner access remains intact', async () => {
    const db = cashier();
    const admin = env.authenticatedContext('owner', { email: owner, email_verified: true }).firestore();
    await assertSucceeds(updateDoc(ref(admin, 'users', email), { active: false }));
    await assertFails(getDoc(ref(db, 'catalog', '0')));
    await assertFails(sell(db));
    await assertSucceeds(getDocs(collection(admin, root, 'inventory')));
    await assertSucceeds(getDocs(collection(admin, root, 'sales')));
});
