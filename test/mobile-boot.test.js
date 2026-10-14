'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');

test('customer startup builds product images and banner only once', () => {
  const calls = { products: 0, banner: 0, sync: 0 };
  const view = { classList: { add() {}, remove() {} } };
  const s = { console: { log() {}, error() {} }, window: { location: { hash: '' } },
    document: { querySelectorAll: () => [view], getElementById: () => view },
    ensureHealthyMenuImages() {}, sanitizeOrdersData() {}, applyLanguageToStaticDom() {},
    renderCategoryFilterPills() {}, updateCartBadge() {}, startLiveWaitTimerTicker() {},
    initRealtimeCloudMesh() { calls.sync++; },
    renderCustomerProducts() { calls.products++; }, renderFrontendBanner() { calls.banner++; } };
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    function switchView(mode)'), html.indexOf('    // MÔ PHỎNG ĐƠN MỚI CÓ BILL')), s);
  vm.runInContext(html.slice(html.indexOf('    function initAppBoot()'), html.indexOf('    // =========================================================================', html.indexOf('    function initAppBoot()'))), s);
  s.initAppBoot();
  assert.equal(calls.products, 1);
  assert.equal(calls.banner, 1);
  assert.equal(calls.sync, 1);
});

test('product cards defer image decoding below the viewport', () => {
  const grid = { innerHTML: '' };
  const s = { window: {}, document: { getElementById: () => grid }, currentCategory: 'all',
    menu: [{ id: 1, name: 'Tea', image: 'receipt-free-menu.jpg', price: 39000, category: 'tea' }],
    getItemLocalizedName: i => i.name, getItemLocalizedDesc: () => '', formatMoney: String };
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    function renderCustomerProducts()'), html.indexOf('    function filterCategory')), s);
  s.renderCustomerProducts();
  assert.match(grid.innerHTML, /class="product-img" loading="lazy" decoding="async"/);
});
