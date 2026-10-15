const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

test('crop editor supports touch zoom, 4:3 export, bounded input and cleanup', async () => {
    const actions = [];
    let ready = false;
    let revoked = false;
    let options;
    let exportOptions;
    const canvas = {
        getContext: () => ({ fillRect() {}, drawImage() {} }),
        toDataURL: () => 'data:image/jpeg;base64,YWJj'
    };
    const context = {
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() { revoked = true; } },
        Image: class { naturalWidth = 4000; naturalHeight = 2000; set src(value) { this.onload(); } },
        document: { createElement: () => canvas },
        Cropper: class {
            constructor(element, config) { options = config; config.ready(); }
            getCroppedCanvas(config) { exportOptions = config; return canvas; }
            zoom(value) { actions.push(value); }
            rotate(value) { actions.push(value); }
            reset() { actions.push('reset'); }
            destroy() { actions.push('destroy'); }
        }
    };
    vm.runInNewContext(fs.readFileSync(__dirname + '/product-tools.js', 'utf8').replace(/^export /gm, ''), context);
    vm.runInNewContext(fs.readFileSync(__dirname + '/photo-editor.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
    await context.mountCropper({}, { type: 'image/jpeg', size: 10000 }, () => { ready = true; });
    assert.equal(ready, true);
    assert.equal(options.zoomOnTouch, true);
    assert.equal(options.dragMode, 'move');
    assert.equal(options.aspectRatio, 4 / 3);
    assert.equal(canvas.width, 1200);
    assert.equal(canvas.height, 600);
    assert.equal(revoked, true);
    assert.equal(context.exportCrop(), 'data:image/jpeg;base64,YWJj');
    assert.equal(exportOptions.width, 800);
    assert.equal(exportOptions.height, 600);
    for (const action of ['in', 'out', 'rotate', 'reset']) context.cropAction(action);
    context.disposeCropper();
    assert.deepEqual(actions, [0.1, -0.1, 90, 'reset', 'destroy']);
    assert.throws(() => context.exportCrop());
});
