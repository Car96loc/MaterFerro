const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const context = {};
vm.runInNewContext(fs.readFileSync(__dirname + '/access.js', 'utf8').replace(/^export /gm, ''), context);
vm.runInNewContext(fs.readFileSync(__dirname + '/pricing.js', 'utf8').replace(/^export /gm, ''), context);
const product = { id: '1', code: '1', name: 'Perno', category: 'Otros', stock: 400, price: 0.025, buyPrice: 0.01,
    boxCost: 2, boxMode: true, unitsPerBox: 200, saleUnits: 2, salePrice: 0.05, boxSalePrice: 3, costVersion: 'v1' };
const actor = { uid: 'u1', email: 'cajero@example.com', name: 'Ana' };
test('cashier catalog never includes purchase costs or investment', () => {
    const row = context.catalogProduct(product);
    assert.equal(row.buyPrice, undefined);
    assert.equal(row.boxCost, undefined);
    assert.equal(row.price, 0.025);
    assert.equal(context.catalogProduct({ price: 2 }).saleUnits, 1);
});
test('cashier sale uses shared stock; administrator resolves immutable historical costs and prices', () => {
    const sale = context.cashierSale({ id: 's1', date: '2026-10-15', paymentMethod: 'efectivo', items: [
        { id: '1', qty: 1, presentation: 'box', boxSalePrice: 3 },
        { id: '1', qty: 3, price: 0.025, salePrice: 0.05 }
    ] }, new Map([['1', product]]), actor);
    assert.equal(sale.lines['1'].stockAfter, 197);
    assert.equal(sale.lines['1'].buyPrice, undefined);
    const costs = new Map([['v1', context.historicalProduct(product, '1')]]);
    const expanded = context.expandCashierSale(sale, costs, context.lineAmount);
    assert.equal(expanded.total, 3.08);
    assert.equal(expanded.items[0].buyPrice, 0.01);
    assert.equal(expanded.cashierName, 'Ana');
    assert.equal(costs.get('v1').product.photos, undefined);
    assert.throws(() => context.cashierSale({ items: [{ id: '1', qty: 500, price: 0.025, salePrice: 0.05 }] }, new Map([['1', product]]), actor));
});
