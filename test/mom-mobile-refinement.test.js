'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const css = fs.readFileSync(path.join(root,'mom-mobile-refinement.css'),'utf8');

test('retain previous image asset but restore original Mom logo in customer UI',()=>{
  const original = fs.readFileSync(path.join(root,'public/mom-logo.png'));
  const attached = fs.readFileSync(path.join(root,'public/mom-brand-20261028.jpg'));
  assert.deepEqual(attached,original);
  assert.equal(crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+attached.length+'\0'),attached])).digest('hex'),'f678a24a6ba290ac9d91bd4c896f3aff7ea8127d');
  assert.match(html,/src="\/public\/mom-logo-white\.jpg"/);
});
test('mobile dock has exactly five actionable tabs wired to existing functions',()=>{
  const dom = new JSDOM(html);
  try {
    const tabs=[...dom.window.document.querySelectorAll('#mom-mobile-nav [data-mom-tab]')];
    assert.deepEqual(tabs.map(t=>t.getAttribute('data-mom-tab')),['home','menu','cart','tracking','language']);
    assert.equal(tabs[0].getAttribute('href'),'#view-customer');
    assert.equal(tabs[1].getAttribute('href'),'#mom-menu-section');
    assert.equal(tabs[2].getAttribute('onclick'),'openCartDrawer()');
    assert.equal(tabs[3].getAttribute('onclick'),'openOrderTrackingModal()');
    assert.equal(tabs[4].getAttribute('onclick'),'toggleLanguage()');
    assert.ok(dom.window.document.getElementById('mom-mobile-cart-count'));
    assert.ok(dom.window.document.getElementById('mom-mobile-lang-value'));
  } finally {dom.window.close();}
});
test('product cards use plus-only customization and keep existing quick-buy handler',()=>{
  assert.match(html,/class="btn-card-add"[^>]*onclick="event.stopPropagation\(\); openProductCustomModal\(\$\{item.id\}\)"/);
  assert.match(html,/isOutOfStock \? 'Hết' : '\+'/);
  assert.match(html,/function quickBuyProductNow\(itemId\)/);
  assert.match(html,/function openProductCustomModal\(itemId\)/);
  assert.match(css,/#view-customer \.product-info \.product-card-actions \.btn-card-buy\s*\{\s*display: none/);
});
test('cart badge follows real cart quantities and hides at zero without changing checkout state',()=>{
  const start=html.indexOf('    function updateCartBadge() {');
  const end=html.indexOf('    let floatingCartTimer',start);
  assert.ok(start>0 && end>start);
  const nodes={'cart-counter':{textContent:'0'},'mom-mobile-cart-count':{textContent:'0',hidden:true}};
  const ctx={cart:[{qty:2},{qty:1}],document:{getElementById:id=>nodes[id]||null},updateFloatingCartBar:()=>{}};
  vm.createContext(ctx);vm.runInContext(html.slice(start,end),ctx);
  ctx.updateCartBadge();assert.equal(nodes['cart-counter'].textContent,3);assert.equal(nodes['mom-mobile-cart-count'].textContent,3);assert.equal(nodes['mom-mobile-cart-count'].hidden,false);
  ctx.cart=[];ctx.updateCartBadge();assert.equal(nodes['mom-mobile-cart-count'].hidden,true);
});
test('customer-only responsive CSS does not modify backend and avoids drawer/modal overlap',()=>{
  assert.match(html,/mom-mobile-refinement\.css\?v=20261028-2/);
  assert.match(css,/body:has\(#view-backend\.active\) \.mom-mobile-nav \{ display: none !important;/);
  assert.match(css,/body:has\(#view-customer\.active\) \.header-controls/);
  assert.match(css,/#view-customer #category-filter-pills\.category-scroll-nav/);
  assert.match(css,/#view-customer #floating-cart-bar \{ display: none !important;/);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});
