const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const reports = {};
for (const file of ['pricing.js', 'inventory-report.js', 'sales-report.js']) {
    vm.runInNewContext(fs.readFileSync(__dirname + '/' + file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), reports);
}
const bolts = { id: '1', name: 'Pernos', code: '1', category: 'Pernos', stock: 200, buyPrice: 0.01,
    boxMode: true, unitsPerBox: 200, boxSalePrice: 3, price: 0.025, saleUnits: 2, salePrice: 0.05 };

test('unit and box scenarios have independent revenue, investment and margin', () => {
    const unit = reports.inventoryReport([bolts], 'units');
    assert.equal(unit.investment, 2);
    assert.equal(unit.revenue, 5);
    assert.equal(unit.profit, 3);
    assert.equal(unit.margin, 60);
    const box = reports.inventoryReport([bolts], 'boxes');
    assert.equal(box.investment, 2);
    assert.equal(box.revenue, 3);
    assert.equal(box.profit, 1);
    assert.ok(Math.abs(box.margin - 100 / 3) < 0.000001);
});

test('box leftovers round with checkout pricing and categories reconcile with totals', () => {
    const report = reports.inventoryReport([{ ...bolts, stock: 203 }, { id: '2', category: 'Otros', stock: 2, buyPrice: 1, price: 2 }], 'boxes');
    assert.equal(report.rows[0].boxes, 1);
    assert.equal(report.rows[0].looseUnits, 3);
    assert.equal(report.rows[0].revenue, 3.08);
    assert.equal(report.revenue, 7.08);
    assert.ok(Math.abs(report.investment - 4.03) < 0.000001);
    assert.equal(report.categories.reduce((sum, category) => sum + category.revenue, 0), report.revenue);
    assert.ok(Math.abs(report.categories.reduce((sum, category) => sum + category.profit, 0) - report.profit) < 0.000001);
});

test('weighted margin uses revenue, and zero costs and loss-making products are included', () => {
    const report = reports.inventoryReport([
        { id: '1', stock: 1, buyPrice: 0, price: 10 },
        { id: '2', stock: 100, buyPrice: 9, price: 10 }
    ]);
    assert.equal(report.profit, 110);
    assert.ok(Math.abs(report.margin - 110 / 1010 * 100) < 0.000001);
    assert.notEqual(report.margin, 55);
    const loss = reports.inventoryReport([{ id: 'x', stock: 2, buyPrice: 3, price: 2 }]);
    assert.equal(loss.profit, -2);
    assert.equal(loss.margin, -50);
    assert.equal(loss.top[0].profit, -2);
});

test('missing costs/prices remain unknown; missing box price has explicit unit fallback', () => {
    const cost = reports.inventoryReport([{ id: 'x', stock: 1, price: 2 }]);
    assert.equal(cost.investment, null);
    assert.equal(cost.profit, null);
    assert.equal(cost.margin, null);
    const price = reports.inventoryReport([{ id: 'x', stock: 1, buyPrice: 2 }]);
    assert.equal(price.revenue, null);
    const fallback = reports.inventoryReport([{ ...bolts, boxSalePrice: null }], 'boxes');
    assert.equal(fallback.revenue, 5);
    assert.equal(fallback.missingBoxPrices, 1);
    assert.equal(reports.inventoryReport([]).margin, null);
    assert.equal(reports.inventoryReport([{ stock: 0 }]).profit, 0);
});

test('actual sales profit stays separate from current inventory and potential estimates', () => {
    const context = { window: { ferroPricing: reports, ferroReports: reports, ferroInventoryReport: reports.inventoryReport } };
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    vm.runInNewContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1], context);
    const app = context.ferroApp();
    app.inventory = [bolts];
    app.salesPeriod = 'all';
    app.sales = [{ total: 3, items: [{ id: '1', qty: 1, presentation: 'box', unitsPerBox: 200, price: 3, buyPrice: 0.01, lineTotal: 3 }] }];
    assert.equal(app.realSalesReport.profit, 1);
    assert.equal(app.inventoryReport.profit, 3);
    app.inventoryScenario = 'boxes';
    assert.equal(app.inventoryReport.profit, 1);
    app.inventory[0].buyPrice = 10;
    assert.equal(app.realSalesReport.profit, 1);
    app.sales = [{ total: 3, items: [{ id: '1', qty: 1, price: 3 }] }];
    assert.equal(app.realSalesReport.profit, null);
});
