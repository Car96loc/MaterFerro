import { lineAmount } from './pricing.js?v=weight-7';

function validNumber(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function summarize(rows) {
    const investment = rows.every(row => row.investment != null) ? rows.reduce((sum, row) => sum + row.investment, 0) : null;
    const revenue = rows.every(row => row.revenue != null) ? rows.reduce((sum, row) => sum + Math.round(row.revenue * 100), 0) / 100 : null;
    const profit = investment != null && revenue != null ? revenue - investment : null;
    return { count: rows.length, units: rows.filter(row => !row.weightMode).reduce((sum, row) => sum + row.stock, 0),
        weightKg: rows.filter(row => row.weightMode).reduce((sum, row) => sum + row.stock, 0), investment, revenue, profit,
        margin: profit != null && revenue > 0 ? profit / revenue * 100 : null };
}

export function inventoryReport(inventory, scenario = 'units') {
    const rows = inventory.map(item => {
        const stock = Math.max(0, Number(item.stock) || 0);
        if (item.weightMode) {
            const unitKg = Number(item.weightUnitKg || 0);
            const investment = validNumber(item.buyPrice) ? Number(item.buyPrice) * stock : null;
            const revenue = unitKg > 0 && Number(item.price) > 0 && validNumber(item.price)
                ? Math.round((stock / unitKg * Number(item.price) + Number.EPSILON) * 100) / 100 : null;
            const profit = investment != null && revenue != null ? revenue - investment : null;
            return { ...item, stock, boxes: 0, looseUnits: stock, investment, revenue, profit, missingBoxPrice: false,
                margin: profit != null && revenue > 0 ? profit / revenue * 100 : null };
        }
        const usesBoxes = scenario === 'boxes' && item.boxMode && validNumber(item.boxSalePrice)
            && Number.isSafeInteger(Number(item.unitsPerBox)) && Number(item.unitsPerBox) > 0;
        const boxes = usesBoxes ? Math.floor(stock / Number(item.unitsPerBox)) : 0;
        const looseUnits = stock - boxes * Number(item.unitsPerBox || 1);
        const knownPrice = looseUnits === 0 || (validNumber(item.price) && (!item.boxMode || validNumber(item.salePrice)));
        const investment = stock === 0 ? 0 : validNumber(item.buyPrice) ? Number(item.buyPrice) * stock : null;
        const boxRevenue = boxes ? lineAmount({ ...item, presentation: 'box', qty: boxes }) : 0;
        const looseRevenue = looseUnits ? lineAmount({ ...item, presentation: 'unit', qty: looseUnits }) : 0;
        const revenue = knownPrice ? (Math.round(boxRevenue * 100) + Math.round(looseRevenue * 100)) / 100 : null;
        const profit = investment != null && revenue != null ? revenue - investment : null;
        return { ...item, stock, boxes, looseUnits, investment, revenue, profit,
            missingBoxPrice: scenario === 'boxes' && !!item.boxMode && !usesBoxes && stock > 0,
            margin: profit != null && revenue > 0 ? profit / revenue * 100 : null };
    });
    const groups = new Map();
    for (const row of rows) {
        const category = row.category || 'Otros';
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(row);
    }
    return { ...summarize(rows), rows,
        categories: [...groups].map(([name, items]) => ({ name, ...summarize(items) })),
        top: rows.filter(row => row.stock > 0 && row.margin != null).sort((a, b) => b.margin - a.margin).slice(0, 10),
        missingCosts: rows.filter(row => row.investment == null).length,
        missingPrices: rows.filter(row => row.revenue == null).length,
        missingBoxPrices: rows.filter(row => row.missingBoxPrice).length };
}
