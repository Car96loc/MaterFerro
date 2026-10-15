const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const tools = {};
vm.runInNewContext(fs.readFileSync(__dirname + '/product-tools.js', 'utf8').replace(/^export /gm, ''), tools);

test('search ignores accents, case, whitespace and accepts minor typos and reordered words', () => {
    const product = { id: '1', code: '123', name: 'Tornillo galvanizado', category: 'Ferreteria' };
    for (const query of ['TORNILLO', '  tornillo ', 'tornilo', 'galvanisado', 'galvanizado tornillo', '#123']) assert.equal(tools.matchesProduct(product, query), true, query);
    assert.equal(tools.matchesProduct({ name: 'Silicón', code: '7' }, 'silicon'), true);
    assert.equal(tools.matchesProduct({ name: 'silicon' }, 'silicón'), true);
    assert.equal(tools.matchesProduct(product, 'martillo'), false);
    assert.equal(tools.matchesProduct(product, '129'), false);
    assert.equal(tools.matchesProduct(product, 'zz'), false);
    assert.equal(tools.matchesProduct(product, ''), true);
});

test('photos allow bounded JPEG data only, not SVG or remote URLs', () => {
    assert.equal(tools.validProductPhoto(''), true);
    assert.equal(tools.validProductPhoto('data:image/jpeg;base64,YWJj'), true);
    for (const photo of [null, 'https://example.com/x.jpg', 'data:image/svg+xml;base64,YWJj', 'data:image/jpeg;base64,' + 'a'.repeat(45000)]) assert.equal(tools.validProductPhoto(photo), false);
});

test('actual app searches both views and removes all presentations of selected product', () => {
    const context = { window: { ferroProductTools: tools, ferroReports: { businessDay: () => '2026-10-15' } } };
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    vm.runInNewContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1], context);
    const app = context.ferroApp();
    app.inventory = [{ id: '1', name: 'Silicón', category: 'Otros', code: '1' }];
    app.posSearch = 'silicon'; app.inventorySearch = 'silicn';
    assert.equal(app.filteredPosProducts.length, 1);
    assert.equal(app.filteredInventory.length, 1);
    app.posCategory = 'Otra';
    assert.equal(app.filteredPosProducts.length, 0);
    app.cart = [{ id: '1', presentation: 'unit' }, { id: '1', presentation: 'box' }, { id: '2' }];
    assert.equal(app.productInCart('1'), true);
    app.removeProductFromCart('1');
    assert.equal(app.productInCart('1'), false);
    assert.equal(app.cart.length, 1);
    app.openPhoto({ name: 'Foto', photo: 'data:image/jpeg;base64,YWJj' });
    assert.equal(app.photoPreview.name, 'Foto');
    app.inventory[0].photo = 'data:image/jpeg;base64,YWJj';
    const cartItem = { id: '1', name: 'Silicon', qty: 2 };
    assert.equal(app.cartProduct(cartItem).photo, app.inventory[0].photo);
    assert.equal(cartItem.photo, undefined);
    assert.equal(app.cartProduct({ id: 'deleted', name: 'Anterior' }).name, 'Anterior');
    assert.match(html, /product-tile-photo/);
    assert.match(html, /Código: /);
    assert.doesNotMatch(html, /x-text="'#' \+/);
});

test('photo decoder rejects unsupported files before attempting processing', async () => {
    await assert.rejects(tools.compressProductPhoto({ type: 'image/svg+xml', size: 10 }));
    await assert.rejects(tools.compressProductPhoto({ type: 'image/jpeg', size: 21 * 1024 * 1024 }));
});

test('photo compression bounds dimensions, produces JPEG and releases temporary URL', async () => {
    let revoked = false;
    const canvas = {
        getContext: () => ({ fillRect() {}, drawImage() {} }),
        toDataURL(type, quality) {
            assert.equal(type, 'image/jpeg');
            return 'data:image/jpeg;base64,' + (quality > 0.5 ? 'a'.repeat(46000) : 'YWJj');
        }
    };
    const context = {
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() { revoked = true; } },
        Image: class { naturalWidth = 4000; naturalHeight = 2000; set src(value) { this.onload(); } },
        document: { createElement: () => canvas }
    };
    vm.runInNewContext(fs.readFileSync(__dirname + '/product-tools.js', 'utf8').replace(/^export /gm, ''), context);
    const photo = await context.compressProductPhoto({ type: 'image/png', size: 10000 });
    assert.equal(photo, 'data:image/jpeg;base64,YWJj');
    assert.equal(canvas.width, 800);
    assert.equal(canvas.height, 400);
    assert.equal(revoked, true);
});

test('cancelled photo processing cannot overwrite a different product form', async () => {
    let finish;
    const context = { window: { ferroReports: { businessDay: () => '2026-10-15' }, ferroProductTools: {
        compressProductPhoto: () => new Promise(resolve => { finish = resolve; })
    } } };
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    vm.runInNewContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1], context);
    const app = context.ferroApp();
    const input = { files: [{}], value: 'old.jpg' };
    const pending = app.selectProductPhoto({ target: input });
    assert.equal(app.photoBusy, true);
    app.closeProductModal();
    app.editProduct({ id: 'different', photo: '' });
    finish('data:image/jpeg;base64,YWJj');
    await pending;
    assert.equal(app.productForm.photo, '');
    assert.equal(app.photoBusy, false);
});
