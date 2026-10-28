'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'mom-mobile-refinement.css'),'utf8');

test('restore original Mom brand artwork and align customer header left on mobile',()=>{
  const d=new JSDOM(html).window.document;
  const header=d.querySelector('header .brand-logo-area .header-logo-img');
  assert.ok(header);
  assert.equal(header.getAttribute('src'),'/public/mom-logo-white.jpg');
  assert.equal(d.querySelector('#mom-story .mom-story-art img').getAttribute('src'),'/public/mom-logo-white.jpg');
  assert.match(css,/body:has\(#view-customer\.active\) \.header-inner\s*\{\s*justify-content: flex-start !important;/);
  assert.match(css,/body:has\(#view-customer\.active\) \.brand-logo-area\s*\{\s*margin: 0 auto 0 0 !important;/);
  assert.match(css,/\.mom-logo-frame \.header-logo-img\s*\{[^}]*position: absolute !important;/s);
  assert.ok(fs.statSync(path.join(root,'public/mom-logo-white.jpg')).size>1000);
});

test('remove only unwanted menu intro, preserve functional menu anchor and product grid',()=>{
  const d=new JSDOM(html).window.document;
  assert.equal(d.querySelectorAll('#mom-menu-section').length,1);
  assert.equal(d.getElementById('mom-menu-section').textContent.trim(),'');
  assert.equal(d.getElementById('mom-menu-section').getAttribute('aria-hidden'),'true');
  assert.ok(d.getElementById('category-filter-pills'));
  assert.ok(d.getElementById('customer-products-grid'));
  assert.equal(d.querySelector('#mom-mobile-nav [data-mom-tab="menu"]').getAttribute('href'),'#mom-menu-section');
  assert.doesNotMatch(d.getElementById('view-customer').textContent,/Hôm nay mình uống gì\?|Trà, cà phê và những món uống yêu thích/);
});

test('compact modal actions preserve handlers, dynamic price and safe tap size',()=>{
  const d=new JSDOM(html).window.document;
  const actions=d.querySelector('#product-custom-modal #ios-custom-normal-actions');
  assert.ok(actions);
  const buttons=[...actions.querySelectorAll(':scope > button')];
  assert.equal(buttons.length,2);
  assert.equal(buttons[0].getAttribute('onclick'),'submitProductCustomToCart()');
  assert.equal(buttons[1].getAttribute('onclick'),'submitProductCustomAndBuyNow()');
  assert.ok(buttons[1].querySelector('#ios-custom-total-btn-price'));
  assert.match(css,/#product-custom-modal #ios-custom-normal-actions\s*\{[^}]*max-width: 420px !important;/s);
  assert.match(css,/#product-custom-modal #ios-custom-normal-actions > button\s*\{[^}]*min-height: 50px !important;/s);
  assert.match(css,/#product-custom-modal #ios-custom-normal-actions > button\s*\{[^}]*max-height: 60px !important;/s);
  assert.ok(d.getElementById('ios-custom-edit-actions'),'existing edit cart action remains');
  assert.ok(d.getElementById('checkout-modal'),'checkout modal remains');
});
