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
  assert.match(html,/mom-header-social\.css\?v=20261028-4/);
});

test('approved preview renders standalone blue Facebook f and black TikTok note without circles',()=>{
  const doc=new JSDOM(html).window.document;
  const facebook=doc.getElementById('customer-facebook-link');
  const fPath=facebook.querySelector('svg path').getAttribute('d');
  assert.match(fPath,/^M9\.101 23\.691/);
  assert.match(fPath,/v8\.245Z$/);
  assert.doesNotMatch(fPath,/C19\.396 23\.238|c0-6\.627-5\.373-12-12-12/);
  for(const id of ['customer-tiktok-link','customer-tiktok-pending']){
    const icon=doc.getElementById(id).querySelector('svg path').getAttribute('d');
    assert.match(icon,/^M12\.525\.02/,'preserve TikTok note shape');
  }
  const base=css.match(/header \.mom-header-social \.social-button\s*\{([^}]+)\}/s);
  assert.ok(base,'header social styles exist');
  assert.match(base[1],/width: 44px !important/);
  assert.match(base[1],/height: 44px !important/);
  assert.match(base[1],/border-radius: 0 !important/);
  assert.match(base[1],/border: 0 !important/);
  assert.match(base[1],/background: transparent !important/);
  assert.match(base[1],/box-shadow: none !important/);
  const fb=css.match(/header \.mom-header-social \.social-facebook\s*\{([^}]+)\}/s);
  const tt=css.match(/header \.mom-header-social \.social-tiktok\s*\{([^}]+)\}/s);
  assert.ok(fb && tt);
  assert.match(fb[1],/color: #1877F2 !important/);
  assert.match(tt[1],/color: #101010 !important/);
  assert.match(fb[1],/background: transparent !important/);
  assert.match(tt[1],/background: transparent !important/);
  assert.match(css,/header \.mom-header-social \.social-button:disabled\s*\{[^}]*opacity: 1 !important/);
  assert.doesNotMatch(css,/border-radius: 50% !important|background: #151515 !important/);
});

test('Facebook and TikTok graphics are optically aligned inside identical 29px icon boxes',()=>{
  const doc=new JSDOM(html).window.document;
  const fbSvg=doc.querySelector('#customer-facebook-link svg');
  const tiktokSvg=doc.querySelector('#customer-tiktok-link svg');
  const tiktokPendingSvg=doc.querySelector('#customer-tiktok-pending svg');
  assert.equal(fbSvg.getAttribute('viewBox'),'5.5 4.2 13 19.8');
  assert.equal(tiktokSvg.getAttribute('viewBox'),'0 0 24 24');
  assert.equal(tiktokPendingSvg.getAttribute('viewBox'),'0 0 24 24');
  const fbCss=css.match(/header \.mom-header-social \.social-facebook svg\s*\{([^}]+)\}/s);
  const ttCss=css.match(/header \.mom-header-social \.social-tiktok svg\s*\{([^}]+)\}/s);
  for(const rule of [fbCss,ttCss]){
    assert.ok(rule);
    assert.match(rule[1],/width: 29px !important/);
    assert.match(rule[1],/height: 29px !important/);
  }
  assert.match(css,/header \.mom-header-social \.social-button svg\s*\{[^}]*align-self: center;/s);
  assert.match(css,/header \.mom-header-social \.social-button\s*\{[^}]*align-items: center !important;[^}]*justify-content: center !important;/s);
  assert.match(css,/header \.mom-header-social \.social-facebook\s*\{[^}]*color: #1877F2 !important;/s);
  assert.match(css,/header \.mom-header-social \.social-tiktok\s*\{[^}]*color: #101010 !important;/s);
});
