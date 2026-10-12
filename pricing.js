export function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function lineAmount(item) {
    if (Number.isFinite(item.lineTotal)) return item.lineTotal;
    if (item.presentation === 'box') return roundMoney(Number(item.boxSalePrice) * Number(item.qty || 0));
    const units = Number(item.saleUnits || 1);
    if (item.boxMode && Number.isInteger(units) && units > 0) {
        const cents = Math.round((Number(item.salePrice) + Number.EPSILON) * 100);
        return Math.round(cents * Number(item.qty || 0) / units) / 100;
    }
    return roundMoney(Number(item.price || 0) * Number(item.qty || 0));
}

export function stockUnits(item) {
    return Number(item.qty || 0) * (item.presentation === 'box' ? Number(item.unitsPerBox) : 1);
}

export function maxCartQuantity(cart, item, stock) {
    const otherUnits = cart.filter(row => row !== item && String(row.id) === String(item.id))
        .reduce((sum, row) => sum + stockUnits(row), 0);
    const size = item.presentation === 'box' ? Number(item.unitsPerBox) : 1;
    return Math.max(0, Math.floor((Number(stock) - otherUnits) / size));
}

export function productValues(form, editing = false) {
    const boxMode = !!form.boxMode;
    const unitsPerBox = boxMode ? Number(form.unitsPerBox) : 1;
    const boxCost = boxMode ? Number(form.boxCost) : Number(form.buyPrice || 0);
    const saleUnits = boxMode ? Number(form.saleUnits) : 1;
    const salePrice = boxMode ? Number(form.salePrice) : Number(form.price || 0);
    const boxSalePrice = boxMode && form.boxSalePrice !== '' && form.boxSalePrice != null ? Number(form.boxSalePrice) : null;
    const boxCount = boxMode && !editing ? Number(form.boxCount) : 1;
    const stock = boxMode && !editing ? unitsPerBox * boxCount : Number(form.stock || 0);
    if (![unitsPerBox, saleUnits, boxCount].every(value => Number.isSafeInteger(value) && value > 0)
        || !Number.isSafeInteger(stock) || stock < 0
        || ![boxCost, salePrice].every(value => Number.isFinite(value) && value >= 0)) {
        throw new Error('Revisa las cantidades enteras y los precios de compra y venta.');
    }
    if (boxSalePrice != null && (!Number.isFinite(boxSalePrice) || boxSalePrice < 0)) throw new Error('Revisa el precio de venta de la caja.');
    return { boxMode, unitsPerBox, boxCost, saleUnits, salePrice, boxSalePrice,
        buyPrice: boxCost / unitsPerBox, price: salePrice / saleUnits, stock };
}
