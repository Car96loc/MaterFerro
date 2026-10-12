const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const reports = {};
vm.runInNewContext(fs.readFileSync(__dirname + '/sales-report.js', 'utf8').replace(/^export /gm, ''), reports);
const sale = (date, total = 20) => ({ date, total, items: [{ qty: 2, price: 10, buyPrice: 4, costKnown: true }] });

test('Bogota business day includes late evening UTC and parses legacy Spanish dates', () => {
    assert.equal(reports.businessDay('2026-10-13T04:59:59Z'), '2026-10-12');
    assert.equal(reports.businessDay('2026-10-13T05:00:00Z'), '2026-10-13');
    assert.equal(reports.businessDay('12/10/2026, 23:59:59'), '2026-10-12');
    assert.equal(reports.businessDay('not a date'), '');
});

test('calendar ranges handle Monday weeks, leap months and year boundaries', () => {
    assert.equal(reports.periodRange('week', '2027-01-01').start, '2026-12-28');
    assert.equal(reports.periodRange('week', '2027-01-01').end, '2027-01-03');
    assert.equal(reports.periodRange('month', '2024-02-10').end, '2024-02-29');
    assert.equal(reports.periodRange('year', '2026-10-12').start, '2026-01-01');
    assert.equal(reports.periodRange('year', '2026-10-12').end, '2026-12-31');
    assert.equal(reports.periodRange('day', ''), null);
    assert.equal(reports.periodRange('day', '2026-02-30'), null);
});

test('period totals and daily breakdown use only matching sales', () => {
    const rows = [sale('2026-10-12T15:00:00Z'), sale('2026-10-13T04:59:59Z'), sale('2026-10-13T05:00:00Z')];
    const report = reports.salesReport(rows, 'day', '2026-10-12');
    assert.equal(report.sales.length, 2);
    assert.equal(report.revenue, 40);
    assert.equal(report.cost, 16);
    assert.equal(report.profit, 24);
    assert.equal(report.days.length, 1);
    assert.equal(reports.salesReport(rows, 'month', '2026-10-01').revenue, 60);
    assert.equal(reports.salesReport(rows, 'day', '2026-11-01').profit, 0);
});

test('missing historical costs are unknown, while explicit zero costs and losses are supported', () => {
    const legacy = { date: '12/10/2026, 10:00:00', total: 20, items: [{ qty: 2, price: 10 }] };
    const report = reports.salesReport([legacy, sale('2026-10-12T15:00:00Z')], 'day', '2026-10-12');
    assert.equal(report.revenue, 40);
    assert.equal(report.cost, null);
    assert.equal(report.profit, null);
    assert.equal(report.missingSales, 1);
    assert.equal(reports.itemTotals({ qty: 2, price: 10, buyPrice: 0, costKnown: true }).profit, 20);
    assert.equal(reports.itemTotals({ qty: 2, price: 10, buyPrice: 0, costKnown: false }).profit, null);
    assert.equal(reports.itemTotals({ qty: 2, price: 10, buyPrice: 12 }).profit, -4);
});

test('invalid dates remain available in all-history view', () => {
    const row = sale('bad date');
    assert.equal(reports.salesReport([row], 'day', '2026-10-12').sales.length, 0);
    const report = reports.salesReport([row], 'all', '');
    assert.equal(report.sales.length, 1);
    assert.equal(report.invalidDates, 1);
});
