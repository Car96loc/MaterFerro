const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const photoA = 'data:image/jpeg;base64,YWJj';
const photoB = 'data:image/jpeg;base64,ZGVm';
function app() {
    const context = { window: { ferroReports: { businessDay: () => '2026-10-15' }, ferroPhotoEditor: {
        disposeCropper() {}, exportCrop: () => photoB
    } } };
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    vm.runInNewContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1], context);
    return context.ferroApp();
}
test('legacy single photo becomes a gallery; reorder and delete update cover without mutating inventory', () => {
    const a = app();
    const product = { id: '1', photo: photoA, photos: [photoA, photoB] };
    a.editProduct(product);
    a.movePhoto(1, -1);
    assert.equal(a.productForm.photo, photoB);
    assert.equal(product.photos[0], photoA);
    a.deletePhoto(0);
    assert.equal(a.productForm.photo, photoA);
    a.deletePhoto(0);
    assert.equal(a.productForm.photo, '');
    assert.equal(product.photos.length, 2);
    a.editProduct({ photo: photoA });
    assert.equal(a.productForm.photos[0], photoA);
});
test('confirming crop appends or replaces a photo; gallery viewer cycles', () => {
    const a = app();
    a.productForm = { photos: [photoA], photo: photoA };
    a.cropReady = true; a.cropIndex = -1;
    a.confirmPhotoCrop();
    assert.equal(a.productForm.photos.length, 2);
    assert.equal(a.productForm.photo, photoA);
    a.cropReady = true; a.cropIndex = 0;
    a.confirmPhotoCrop();
    assert.equal(a.productForm.photo, photoB);
    a.openPhoto({ name: 'Fotos', photos: [photoA, photoB], photo: photoA });
    a.stepPhoto(1);
    assert.equal(a.photoPreview.photo, photoB);
    a.stepPhoto(1);
    assert.equal(a.photoPreview.photo, photoA);
});
test('file selection enforces gallery limit before opening cropper', async () => {
    const a = app();
    let message;
    a.showNotification = value => { message = value; };
    a.productForm = { photos: Array(6).fill(photoA) };
    await a.selectProductPhotos({ target: { files: [{}], value: 'file' } });
    assert.match(message, /6 fotos/);
    assert.equal(a.cropOpen, false);
});
