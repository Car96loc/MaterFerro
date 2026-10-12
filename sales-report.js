const businessZone = 'America/Bogota';

export function businessDay(value = new Date()) {
    const date = value instanceof Date ? value : parseSaleDate(value);
    if (!date || !Number.isFinite(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en', { timeZone: businessZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = type => parts.find(part => part.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

export function parseSaleDate(value) {
    if (typeof value !== 'string') return null;
    const legacy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    const text = legacy ? `${legacy[3]}-${legacy[2].padStart(2, '0')}-${legacy[1].padStart(2, '0')}T${legacy[4].padStart(2, '0')}:${legacy[5]}:${legacy[6] || '00'}-05:00` : value;
    if (!legacy && !/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
    const date = new Date(text);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function periodRange(period, anchor) {
    if (period === 'all') return { start: '', end: '', label: 'Todo el historial' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor || '')) return null;
    const date = new Date(anchor + 'T12:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor) return null;
    const end = new Date(date);
    if (period === 'week') {
        date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
        end.setTime(date.getTime()); end.setUTCDate(end.getUTCDate() + 6);
    } else if (period === 'month') {
        date.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + 1, 0);
    } else if (period === 'year') {
        date.setUTCMonth(0, 1); end.setUTCMonth(11, 31);
    }
    const startKey = date.toISOString().slice(0, 10);
    const endKey = end.toISOString().slice(0, 10);
    const display = key => key.split('-').reverse().join('/');
    return { start: startKey, end: endKey, label: startKey === endKey ? display(startKey) : `${display(startKey)} - ${display(endKey)}` };
}

export function itemTotals(item) {
    const quantity = Number(item.qty || 0);
    const revenue = Number(item.price || 0) * quantity;
    const known = item.costKnown !== false && item.buyPrice != null && Number.isFinite(Number(item.buyPrice)) && Number(item.buyPrice) >= 0;
    const cost = known ? Number(item.buyPrice) * quantity : null;
    return { revenue, cost, profit: known ? revenue - cost : null, known };
}

export function saleTotals(sale) {
    const items = (sale?.items || []).map(itemTotals);
    const revenue = Number(sale?.total || 0);
    const known = items.length > 0 && items.every(item => item.known);
    const recordedCost = items.reduce((sum, item) => sum + (item.cost || 0), 0);
    return { revenue, cost: known ? recordedCost : null, profit: known ? revenue - recordedCost : null, known, missingItems: items.filter(item => !item.known).length };
}

export function salesReport(sales, period, anchor) {
    const range = periodRange(period, anchor);
    const filtered = !range ? [] : sales.filter(sale => {
        const day = businessDay(sale.date);
        return period === 'all' || (day && day >= range.start && day <= range.end);
    }).sort((a, b) => (parseSaleDate(b.date)?.getTime() || 0) - (parseSaleDate(a.date)?.getTime() || 0));
    const totals = filtered.map(saleTotals);
    const known = totals.every(total => total.known);
    const revenue = totals.reduce((sum, total) => sum + total.revenue, 0);
    const cost = known ? totals.reduce((sum, total) => sum + total.cost, 0) : null;
    const days = new Map();
    for (const sale of filtered) {
        const day = businessDay(sale.date) || 'Sin fecha';
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(sale);
    }
    return { range, sales: filtered, revenue, cost, profit: known ? revenue - cost : null, known,
        missingSales: totals.filter(total => !total.known).length,
        invalidDates: sales.filter(sale => !businessDay(sale.date)).length,
        days: [...days].sort(([a], [b]) => b.localeCompare(a)).map(([day, rows]) => {
            const totals = rows.map(saleTotals);
            const complete = totals.every(total => total.known);
            const revenue = totals.reduce((sum, total) => sum + total.revenue, 0);
            const cost = complete ? totals.reduce((sum, total) => sum + total.cost, 0) : null;
            return { day, count: rows.length, revenue, cost, profit: complete ? revenue - cost : null };
        }) };
}

export function displaySaleDate(value) {
    const date = parseSaleDate(value);
    return date ? new Intl.DateTimeFormat('es-CO', { timeZone: businessZone, dateStyle: 'short', timeStyle: 'short' }).format(date) : 'Sin fecha';
}
