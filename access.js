export const adminEmail = 'carzunsan@gmail.com';
export function catalogProduct(item) {
    const source = { boxMode: false, weightMode: false, unitsPerBox: 1, saleUnits: 1, salePrice: item.price, boxSalePrice: null, photo: '', photos: [], ...item };
    const fields = ['code', 'name', 'category', 'price', 'stock', 'photo', 'photos', 'boxMode', 'weightMode', 'weightUnit', 'weightUnitKg', 'unitsPerBox', 'saleUnits', 'salePrice', 'boxSalePrice', 'costVersion'];
    return Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}
export function cashierSale(sale, products, user) {
    const lines = {};
    for (const item of sale.items) {
        const id = String(item.id);
        const product = products.get(id);
        if (!product) throw new Error('Producto no disponible.');
        const weighted = !!product.weightMode;
        const line = lines[id] ||= { weightMode: weighted, weightQtyMilli: 0, weightUnit: product.weightUnit || '', unitQty: 0, boxQty: 0, code: product.code, name: product.name, category: product.category,
            price: Number(product.price), boxMode: !!product.boxMode, unitsPerBox: Number(product.unitsPerBox || 1),
            saleUnits: Number(product.saleUnits || 1), salePrice: Number(product.salePrice ?? product.price), weightUnitKg: Number(product.weightUnitKg || 0),
            boxSalePrice: product.boxSalePrice ?? null, costVersion: product.costVersion };
        if (weighted) {
            const quantityMilli = Math.round(Number(item.qty) * 1000);
            if (item.presentation !== 'weight' || !Number.isSafeInteger(quantityMilli) || quantityMilli <= 0
                || Math.abs(Number(item.qty) - quantityMilli / 1000) > 1e-9
                || item.weightUnit !== product.weightUnit || Number(item.weightUnitKg) !== Number(product.weightUnitKg)
                || Number(item.price) !== Number(product.price)
                || Math.round(Number(product.price) * quantityMilli / 1000 * 100) < 1) {
                throw new Error('Revisa el peso o el precio de venta antes de cobrar.');
            }
            line.weightQtyMilli += quantityMilli;
            continue;
        }
        if (!Number.isSafeInteger(item.qty) || item.qty <= 0) throw new Error('Cantidad no valida.');
        if (item.presentation === 'box') {
            if (!product.boxMode || product.boxSalePrice == null || Number(item.boxSalePrice) !== Number(product.boxSalePrice)) throw new Error('El precio de caja cambio. Agrega el producto nuevamente.');
            line.boxQty += item.qty;
        } else {
            if (product.boxMode && item.qty % line.saleUnits !== 0) throw new Error('La venta debe usar paquetes de ' + line.saleUnits + ' unidades.');
            if (Number(item.price) !== Number(product.price) || Number(item.salePrice ?? item.price) !== line.salePrice) throw new Error('El precio cambio. Agrega el producto nuevamente.');
            line.unitQty += item.qty;
        }
    }
    const productIds = Object.keys(lines);
    if (productIds.length > 8) throw new Error('La caja permite hasta 8 productos distintos por venta. Divide la compra en dos ventas.');
    for (const id of productIds) {
        const line = lines[id];
        const product = products.get(id);
        if (line.weightMode) {
            line.unitsSold = line.weightQtyMilli * line.weightUnitKg / 1000;
            line.stockBefore = Number(product.stock);
            line.stockAfter = line.stockBefore - line.unitsSold;
            if (!(line.unitsSold > 0) || line.stockAfter < -1e-9) throw new Error('Existencias insuficientes para ' + line.name);
            lines[id] = { weightMode: true, weightQtyMilli: line.weightQtyMilli, weightUnit: line.weightUnit,
                unitsSold: line.unitsSold, stockBefore: line.stockBefore, stockAfter: line.stockAfter, costVersion: line.costVersion };
            continue;
        }
        line.unitsSold = line.unitQty + line.boxQty * line.unitsPerBox;
        line.stockBefore = Number(product.stock);
        line.stockAfter = line.stockBefore - line.unitsSold;
        if (line.stockAfter < 0) throw new Error('Existencias insuficientes para ' + line.name);
        lines[id] = { unitQty: line.unitQty, boxQty: line.boxQty, unitsSold: line.unitsSold, stockBefore: line.stockBefore, stockAfter: line.stockAfter, costVersion: line.costVersion };
    }
    return { id: sale.id, date: sale.date, paymentMethod: sale.paymentMethod, reportVersion: 4,
        cashierUid: user.uid, cashierEmail: user.email, cashierName: user.name || user.email, productIds, lines };
}
export function expandCashierSale(sale, costs, amount) {
    if (sale.reportVersion !== 4) return sale;
    const items = [];
    for (const id of sale.productIds) {
        const stored = sale.lines[id];
        const cost = costs.get(stored.costVersion);
        const line = { ...(cost?.product || {}), ...stored };
        if (line.weightMode) {
            const qty = line.weightQtyMilli / 1000;
            const item = { ...line, id, lineId: id + ':weight', presentation: 'weight', qty,
                weightMode: true, weightUnit: line.weightUnit || cost?.product?.weightUnit,
                weightUnitKg: Number(cost?.product?.weightUnitKg || 0), price: Number(cost?.product?.price || 0),
                unitsSold: line.unitsSold, buyPrice: cost?.buyPrice };
            if (cost?.known) item.costKnown = true;
            else { item.costKnown = false; item.costSource = 'historical-pending'; }
            item.lineTotal = amount(item);
            items.push(item);
            continue;
        }
        for (const [presentation, qty] of [['unit', line.unitQty], ['box', line.boxQty]]) {
            if (!qty) continue;
            const item = { ...line, id, lineId: id + ':' + presentation, presentation, qty,
                price: presentation === 'box' ? line.boxSalePrice : line.price,
                unitsSold: qty * (presentation === 'box' ? line.unitsPerBox : 1) };
            if (cost?.known) { item.buyPrice = cost.buyPrice; item.costKnown = true; }
            else { item.costKnown = false; item.costSource = 'historical-pending'; }
            item.lineTotal = amount(item);
            items.push(item);
        }
    }
    return { ...sale, date: sale.createdAt?.toDate?.().toISOString() || sale.date, items, itemsCount: items.reduce((sum, item) => sum + item.unitsSold, 0),
        total: items.reduce((sum, item) => sum + Math.round(item.lineTotal * 100), 0) / 100 };
}

export function historicalProduct(product, id, known = true) {
    const { photo, photos, stock, ...publicFields } = catalogProduct(product);
    return { productId: String(id), known, buyPrice: Number(product.buyPrice || 0), product: publicFields };
}
