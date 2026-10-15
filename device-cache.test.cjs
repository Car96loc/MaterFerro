const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function cache(storage = new Map()) {
    const context = { localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key)
    } };
    vm.runInNewContext(fs.readFileSync(__dirname + '/device-cache.js', 'utf8').replace(/^export /gm, ''), context);
    return context;
}

test('device copy survives reload and empty server inventory replaces old products', () => {
    const storage = new Map();
    let c = cache(storage);
    c.saveDeviceCache('inventory', [{ id: 'p1', stock: 60 }]);
    c.saveDeviceCache('sales', [{ id: 's1' }]);
    c = cache(storage);
    assert.equal(c.readDeviceCache().inventory[0].stock, 60);
    assert.equal(c.readDeviceCache().sales[0].id, 's1');
    c.saveDeviceCache('inventory', []);
    assert.equal(c.readDeviceCache().inventory.length, 0);
    assert.equal(c.readDeviceCache().sales.length, 1);
    c.clearDeviceCache();
    assert.equal(c.readDeviceCache(), null);
});

test('corrupt storage, other owners and blocked storage do not break opening', () => {
    for (const raw of ['broken', JSON.stringify({ owner: 'other@example.com', inventory: [], sales: [] })]) {
        assert.equal(cache(new Map([['ferromaster-device-cache-v1', raw]])).readDeviceCache(), null);
    }
    const c = cache();
    c.localStorage.getItem = c.localStorage.setItem = c.localStorage.removeItem = () => { throw new Error('blocked'); };
    assert.equal(c.readDeviceCache(), null);
    assert.doesNotThrow(() => c.saveDeviceCache('inventory', []));
    assert.doesNotThrow(() => c.clearDeviceCache());
});

test('photo quota overflow still caches latest product stock without altering cloud photo data', () => {
    const c = cache();
    const write = c.localStorage.setItem;
    c.localStorage.setItem = (key, value) => {
        if (value.includes('photo')) throw new Error('quota');
        write(key, value);
    };
    const items = [{ id: '1', stock: 25, photo: 'large-photo' }];
    c.saveDeviceCache('inventory', items);
    assert.equal(c.readDeviceCache().inventory[0].stock, 25);
    assert.equal(c.readDeviceCache().inventory[0].photo, undefined);
    assert.equal(items[0].photo, 'large-photo');
});
