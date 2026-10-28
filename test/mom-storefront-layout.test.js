'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const theme = fs.readFileSync(path.join(__dirname, '../mom-storefront.css'), 'utf8');

test('premium theme loads after existing styles without replacing customer or admin application', () => {
  assert.match(html, /<link rel="stylesheet" href="mom-storefront\.css\?v=20261028-1">/);
  assert.ok(html.indexOf('mom-storefront.css') < html.indexOf('</head>'));
  for (const id of [
    'view-customer', 'view-backend', 'frontend-hero-banner',
    'hero-banner-image-container', 'hero-tagline-text', 'hero-slogan-text',
    'hero-promo-badge-container', 'category-filter-pills',
    'customer-products-grid', 'cart-counter', 'floating-cart-bar'
  ]) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
});

test('navigation, storytelling and CTA reuse existing customer flow', () => {
  for (const id of ['mom-menu-section', 'mom-benefits', 'mom-story', 'mom-contact']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /href="#mom-menu-section"/);
  assert.match(html, /onclick="filterCategory\('all', this\)"/);
  for (const handler of [
    'renderCustomerProducts', 'filterCategory', 'openCartDrawer',
    'quickBuyProductNow', 'openProductCustomModal', 'renderFrontendBanner',
    'openOrderTrackingModal', 'switchView'
  ]) {
    assert.match(html, new RegExp('function ' + handler + '\\('));
  }
});

test('storefront styling is responsive without overriding backend operational screens', () => {
  assert.match(theme, /#view-customer \.product-card/);
  assert.match(theme, /#view-customer #customer-products-grid/);
  assert.match(theme, /@media \(max-width:640px\)/);
  assert.match(theme, /@media \(max-width:800px\)/);
  assert.match(theme, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(theme, /#view-backend\s*\{[^}]*display\s*:/);
});
