const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function application() {
    let resolveAuth;
    let authError;
    const window = {
        addEventListener() {},
        ferroReports: { businessDay: () => '2026-10-12' },
        ferroFirebase: {
            initAuth(callback, error) { resolveAuth = callback; authError = error; },
            subscribeInventory() {}, subscribeSales() {}
        }
    };
    const context = { window, setInterval() {} };
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    vm.runInNewContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1], context);
    const app = context.ferroApp();
    app.updateClock = () => {};
    app.init();
    return { app, resolveAuth, authError, html };
}

test('returning session never shows email form while authentication restores', () => {
    const { app, resolveAuth, html } = application();
    assert.match(html, /x-show="!authPending && !authReady"/);
    assert.equal(app.authPending, true);
    assert.equal(app.authReady, false);
    resolveAuth({ email: 'carzunsan@gmail.com' });
    assert.equal(app.authPending, false);
    assert.equal(app.authReady, true);
});

test('first visit and logout show login and clear private state', () => {
    const { app, resolveAuth } = application();
    resolveAuth(null);
    assert.equal(app.authPending, false);
    assert.equal(app.authReady, false);
    resolveAuth({ email: 'carzunsan@gmail.com' });
    app.inventory = [{ id: 'private' }];
    app.sales = [{ id: 'sale' }];
    app.cart = [{ id: 'cart' }];
    resolveAuth(null);
    assert.equal(app.authReady, false);
    assert.equal(app.inventory.length + app.sales.length + app.cart.length, 0);
});

test('authentication errors leave login available instead of waiting forever', () => {
    const { app, authError } = application();
    authError('No se pudo iniciar sesion.');
    assert.equal(app.authPending, false);
    assert.equal(app.authReady, false);
    assert.equal(app.authMessage, 'No se pudo iniciar sesion.');
});
