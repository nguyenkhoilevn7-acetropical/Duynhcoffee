'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'),'utf8');
const iosCss = fs.readFileSync(path.join(__dirname, '..', 'admin-ios.css'),'utf8');
const between = (start, end) => html.slice(html.indexOf(start), html.indexOf(end,html.indexOf(start)));

test('new order timer and clock share one horizontal row, aligned at opposite edges', () => {
 const block=between('function createAdminNewOrderCard','function createAdminPrepOrderCard');
 assert.match(block,/class="ios-order-timing"/);
 const row = block.slice(block.indexOf('class="ios-order-timing"'),block.indexOf('<!-- MÓN ĂN',block.indexOf('class="ios-order-timing"')));
 assert.match(row,/class="live-wait-timer-badge"/);
 assert.match(row,/class="ios-order-clock"/);
 assert.ok(row.indexOf('class="live-wait-timer-badge"') < row.indexOf('class="ios-order-clock"'));
 assert.match(iosCss,/#view-backend \.ios-order-timing\s*{[^}]*flex-wrap:\s*nowrap\s*!important/s);
 assert.match(iosCss,/#view-backend \.ios-order-timing\s*{[^}]*justify-content:\s*space-between\s*!important/s);
});
test('new order cancel stays right and address is emphasized for new, prep and shipping cards', () => {
 const newCard=between('function createAdminNewOrderCard','function createAdminPrepOrderCard');
 const prep=between('function createAdminPrepOrderCard','function createAdminDoneOrderCard');
 const shipping=between('function createAdminShippingOrderCard','function renderAllBackendTabs');
 assert.match(newCard,/class="ios-order-alert-header"/);
 assert.match(newCard,/class="btn-isolated-cancel ios-order-cancel"/);
 assert.match(newCard,/class="ios-order-address"/);
 assert.match(prep,/class="ios-order-address"/);
 assert.match(shipping,/class="ios-order-address"/);
 assert.match(iosCss,/#view-backend \.ios-order-cancel\s*{[^}]*margin-left:\s*auto\s*!important/s);
 assert.match(iosCss,/#view-backend \.ios-order-address\s*{[^}]*font-weight:\s*750\s*!important/s);
});
test('drawer opens from right, and new recipe script version is referenced',()=>{
 assert.match(iosCss,/#ios-admin-drawer\s*{[^}]*inset:\s*0 0 0 auto/s);
 assert.match(iosCss,/#ios-admin-drawer\s*{[^}]*border-radius:\s*25px 0 0 25px/s);
 assert.match(html,/admin-recipes\.js\?v=20261025-2/);
 assert.match(html,/admin-ios\.css\?v=20261025-2/);
});
