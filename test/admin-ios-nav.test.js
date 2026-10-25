'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const enhancement = fs.readFileSync(path.join(__dirname, '../admin-ios.js'), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('iOS admin navigation preserves original tabs and opens a functional drawer', async () => {
  const dom = new JSDOM(html, { url: 'https://mom.example/', runScripts: 'outside-only' });
  const w = dom.window, doc = w.document;
  try {
    const original = [...doc.querySelectorAll('.backend-tab-btn')].map(btn => btn.id).sort();
    const badge = doc.getElementById('badge-count-new');
    const notificationStatus = doc.getElementById('admin-push-status');

    w.eval(enhancement);
    doc.dispatchEvent(new w.Event('DOMContentLoaded'));
    await settle();
    assert.equal(doc.getElementById('view-backend').dataset.iosAdminReady, '1');
    assert.deepEqual([...doc.querySelectorAll('.backend-tab-btn')].map(btn => btn.id).sort(), original);
    assert.deepEqual([...doc.querySelectorAll('.backend-tabs-nav > .backend-tab-btn')].map(btn => btn.id),
      ['btn-tab-new', 'btn-tab-prep', 'btn-tab-shipping']);
    assert.ok(doc.getElementById('ios-admin-drawer').contains(doc.getElementById('btn-tab-inventory')));
    assert.ok(doc.getElementById('ios-admin-drawer').contains(notificationStatus));
    assert.equal(doc.getElementById('badge-count-new'), badge);
    assert.ok(doc.getElementById('ios-admin-drawer').contains(
      [...doc.querySelectorAll('.nav-btn')].find(btn => btn.getAttribute('onclick')?.includes('logoutAdmin()'))
    ));

    const toggle = doc.getElementById('ios-admin-menu-toggle');
    const drawer = doc.getElementById('ios-admin-drawer');
    assert.equal(drawer.hidden, true);
    toggle.click();
    assert.equal(drawer.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    doc.getElementById('ios-admin-backdrop').click();
    assert.equal(drawer.hidden, true);
    toggle.click();
    const soundSettings = doc.querySelector('#ios-admin-drawer .nav-btn[onclick="openSoundSettingsModal()"]');
    assert.ok(soundSettings);
    soundSettings.click();
    assert.equal(drawer.hidden, true, 'the menu must not cover the sound settings modal');
    toggle.click();
    doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(drawer.hidden, true);

    const previous = doc.querySelector('.backend-tab-btn.active');
    previous.classList.remove('active');
    doc.getElementById('btn-tab-all').classList.add('active');
    await settle();
    assert.match(doc.getElementById('ios-admin-current-tab').textContent, /Tất Cả Đơn/);
    toggle.click();
    doc.getElementById('btn-tab-all').click();
    assert.equal(drawer.hidden, true);
  } finally { w.close(); }
});

test('admin iOS enhancement is isolated to the admin view and loaded only once', async () => {
  const dom = new JSDOM(html, { url: 'https://mom.example/', runScripts: 'outside-only' });
  const w = dom.window, doc = w.document;
  try {
    const customerView = doc.getElementById('view-customer');
    const beforeCustomerMarkup = customerView.outerHTML;
    w.eval(enhancement);
    doc.dispatchEvent(new w.Event('DOMContentLoaded'));
    await settle();
    w.eval(enhancement);
    doc.dispatchEvent(new w.Event('DOMContentLoaded'));
    assert.equal(doc.querySelectorAll('#ios-admin-menu-toggle').length, 1);
    assert.equal(customerView.outerHTML, beforeCustomerMarkup);
    assert.equal(doc.querySelectorAll('#admin-push-status').length, 1);
  } finally { w.close(); }
});
