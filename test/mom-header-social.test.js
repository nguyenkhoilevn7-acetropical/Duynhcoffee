'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../mom-header-social.css'),'utf8');

test('social icons are exactly once in header, not footer, with original IDs',()=>{
  const doc=new JSDOM(html).window.document;
  const header=doc.querySelector('header .header-inner');
  const nav=header.querySelector('.mom-header-social');
  assert.ok(nav,'social nav must be within the header');
  assert.equal(header.lastElementChild,nav,'social nav follows controls at right');
  for(const id of ['customer-facebook-link','customer-tiktok-link','customer-tiktok-pending']){
    assert.equal(doc.querySelectorAll('#'+id).length,1,'unique '+id);
    assert.equal(nav.contains(doc.getElementById(id)),true,'moved '+id);
    assert.equal(doc.querySelector('footer #'+id),null,'not duplicated in footer');
  }
  const fb=doc.getElementById('customer-facebook-link');
  assert.match(fb.href,/^https:\/\/www\.facebook\.com\//);
  assert.equal(fb.getAttribute('target'),'_blank');
  assert.equal(fb.getAttribute('rel'),'noopener noreferrer');
  const tt=doc.getElementById('customer-tiktok-link'),pending=doc.getElementById('customer-tiktok-pending');
  assert.equal(tt.hasAttribute('hidden'),true);
  assert.equal(pending.disabled,true);
  assert.ok(pending.getAttribute('aria-label').includes('Sắp có'));
});

test('existing Facebook and TikTok settings still control same UI IDs',()=>{
  assert.match(html,/function renderCustomerFooterInfo\(\)/);
  assert.match(html,/getElementById\('customer-facebook-link'\)/);
  assert.match(html,/getElementById\('customer-tiktok-link'\)/);
  assert.match(html,/getElementById\('customer-tiktok-pending'\)/);
  assert.match(html,/if\(tiktok\)\{tiktok\.hidden=!url/);
  assert.match(html,/if\(pending\)pending\.hidden=Boolean\(url\)/);
});

test('social placement is top-right on mobile; admin and bottom dock remain unchanged',()=>{
  const doc=new JSDOM(html).window.document;
  assert.ok(doc.querySelector('#mom-mobile-nav [data-mom-tab="cart"]'));
  assert.ok(doc.getElementById('view-backend'));
  assert.match(css,/header \.header-inner > \.mom-header-social/);
  assert.match(css,/justify-content: flex-end/);
  assert.match(css,/body:has\(#view-customer\.active\) header \.mom-header-social/);
  assert.match(css,/body:has\(#view-backend\.active\) header \.mom-header-social/);
  assert.match(css,/\.mom-header-social \[hidden\]/);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
  assert.match(html,/mom-header-social\.css\?v=20261028-1/);
});
