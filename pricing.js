export function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const weightUnitKilograms = { kg: 1, lb: 0.45359237, g: 0.001 };
export const weightUnitKg = unit => weightUnitKilograms[unit] || 0;
export const weightQuantityScale = 1000;

export function weightQuantityMilli(item) {
    if (Number.isSafeInteger(item.weightQtyMilli)) return item.weightQtyMilli;
    return Math.round(Number(item.qty || 0) * weightQuantityScale);
}

export function lineAmount(item) {
    if (Number.isFinite(item.lineTotal)) return item.lineTotal;
    if (item.presentation === 'box') return roundMoney(Number(item.boxSalePrice) * Number(item.qty || 0));
    if (item.weightMode) return roundMoney(Number(item.price || 0) * weightQuantityMilli(item) / weightQuantityScale);
    const units = Number(item.saleUnits || 1);
    if (item.boxMode && Number.isInteger(units) && units > 0) {
        const cents = Math.round((Number(item.salePrice) + Number.EPSILON) * 100);
        return Math.round(cents * Number(item.qty || 0) / units) / 100;
    }
    return roundMoney(Number(item.price || 0) * Number(item.qty || 0));
}

export function stockUnits(item) {
    if (item.weightMode) {
        return weightQuantityMilli(item) * Number(item.weightUnitKg || weightUnitKg(item.weightUnit)) / weightQuantityScale;
    }
    return Number(item.qty || 0) * (item.presentation === 'box' ? Number(item.unitsPerBox) : 1);
}

export function maxCartQuantity(cart, item, stock) {
    const otherUnits = cart.filter(row => row !== item && String(row.id) === String(item.id))
        .reduce((sum, row) => sum + stockUnits(row), 0);
    if (item.weightMode) {
        const unitKg = Number(item.weightUnitKg || weightUnitKg(item.weightUnit));
        return Math.max(0, Math.floor(((Number(stock) - otherUnits) / unitKg + Number.EPSILON) * weightQuantityScale) / weightQuantityScale);
    }
    const size = item.presentation === 'box' ? Number(item.unitsPerBox) : (item.boxMode ? Number(item.saleUnits || 1) : 1);
    return Math.max(0, Math.floor((Number(stock) - otherUnits) / size) * size);
}

export function productValues(form, editing = false) {
    if (form.weightMode) {
        const unit = String(form.weightUnit || 'lb');
        const unitKg = weightUnitKg(unit);
        const purchaseKg = Number(form.weightPurchaseKg || 0);
        const purchaseCost = Number(form.weightPurchaseCost ?? (editing ? form.buyPrice : 0));
        const boxCount = editing ? 1 : Number(form.weightBoxCount || 1);
        const stock = editing && !form.weightRestock ? Number(form.stock || 0) : purchaseKg * boxCount;
        const buyPrice = purchaseKg > 0 ? purchaseCost / purchaseKg : 0;
        const price = Number(form.price || 0);
        if (form.boxMode || !unitKg || ![stock, buyPrice, price].every(value => Number.isFinite(value) && value >= 0)
            || !(purchaseKg > 0) || !Number.isSafeInteger(boxCount) || boxCount <= 0
            || !Number.isFinite(purchaseCost) || purchaseCost < 0
            || Math.abs(purchaseKg * 1000 - Math.round(purchaseKg * 1000)) > 1e-7
            || Math.abs(stock * 1000 - Math.round(stock * 1000)) > 1e-7) {
            throw new Error('Revisa el peso, la unidad de venta y los precios.');
        }
        return { boxMode: false, weightMode: true, weightUnit: unit, weightUnitKg: unitKg,
            unitsPerBox: 1, boxCost: purchaseCost * boxCount, weightPurchaseCost: purchaseCost,
            weightPurchaseKg: purchaseKg, saleUnits: 1, salePrice: price,
            boxSalePrice: null, buyPrice, price, stock };
    }
    const boxMode = !!form.boxMode;
    const unitsPerBox = boxMode ? Number(form.unitsPerBox) : 1;
    const boxCost = boxMode ? Number(form.boxCost) : Number(form.buyPrice || 0);
    const saleUnits = boxMode ? Number(form.saleUnits) : 1;
    const salePrice = boxMode ? Number(form.salePrice) : Number(form.price || 0);
    const boxSalePrice = boxMode && form.boxSalePrice !== '' && form.boxSalePrice != null ? Number(form.boxSalePrice) : null;
    const boxCount = boxMode && (!editing || form.boxRestock) ? Number(form.boxCount) : 1;
    const currentStock = Number(form.stock || 0);
    const stock = boxMode && !editing ? unitsPerBox * boxCount
        : boxMode && form.boxRestock ? currentStock + unitsPerBox * boxCount : currentStock;
    if (![unitsPerBox, saleUnits, boxCount].every(value => Number.isSafeInteger(value) && value > 0)
        || !Number.isSafeInteger(stock) || stock < 0
        || ![boxCost, salePrice].every(value => Number.isFinite(value) && value >= 0)) {
        throw new Error('Revisa las cantidades enteras y los precios de compra y venta.');
    }
    if (boxSalePrice != null && (!Number.isFinite(boxSalePrice) || boxSalePrice < 0)) throw new Error('Revisa el precio de venta de la caja.');
    return { boxMode, weightMode: false, weightUnit: null, weightUnitKg: null, unitsPerBox, boxCost, saleUnits, salePrice, boxSalePrice,
        buyPrice: boxCost / unitsPerBox, price: salePrice / saleUnits, stock };
}
