const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const pricing = {};
vm.runInNewContext(fs.readFileSync(__dirname + '/pricing.js', 'utf8').replace(/^export /gm, ''), pricing);
const box = { boxMode: true, unitsPerBox: 100, boxCost: 1, boxCount: 1, saleUnits: 2, salePrice: 0.05 };

test('box cost and group selling price produce precise unit values and stock', () => {
    const product = pricing.productValues(box);
    assert.equal(product.buyPrice, 0.01);
    assert.equal(product.price, 0.025);
    assert.equal(product.stock, 100);
    assert.equal(pricing.productValues({ ...box, boxCount: 3 }).stock, 300);
});

test('odd and even unit quantities round each product subtotal to cents', () => {
    const product = pricing.productValues(box);
    for (const [qty, expected] of [[1, 0.03], [2, 0.05], [3, 0.08], [4, 0.10], [5, 0.13], [100, 2.50]]) {
        assert.equal(pricing.lineAmount({ ...product, qty }), expected);
    }
    assert.equal(pricing.lineAmount({ boxMode: true, saleUnits: 3, salePrice: 1, qty: 3 }), 1);
});

test('editing box product keeps remaining stock, and normal products keep ordinary fields', () => {
    assert.equal(pricing.productValues({ ...box, stock: 97 }, true).stock, 97);
    const normal = pricing.productValues({ buyPrice: 2.5, price: 4, stock: 7 });
    assert.equal(normal.buyPrice, 2.5);
    assert.equal(normal.price, 4);
    assert.equal(normal.stock, 7);
    assert.equal(pricing.lineAmount({ ...normal, qty: 3 }), 12);
});

test('invalid boxes, fractional quantities and negative prices are rejected', () => {
    for (const change of [{ unitsPerBox: 0 }, { saleUnits: 0 }, { boxCount: 1.5 }, { boxCost: -1 }, { salePrice: NaN }]) {
        assert.throws(() => pricing.productValues({ ...box, ...change }));
    }
    assert.throws(() => pricing.productValues({ buyPrice: 1, price: 2, stock: -1 }));
});

test('stored charged amount is authoritative for historical sale details', () => {
    assert.equal(pricing.lineAmount({ price: 0.025, qty: 3, lineTotal: 0.08 }), 0.08);
});
