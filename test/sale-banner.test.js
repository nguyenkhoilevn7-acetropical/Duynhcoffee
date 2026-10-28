'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const banner=require('../sale-banner.js');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../sale-banner.js'),'utf8');
const base=Date.parse('2026-10-28T09:00:00Z');
const sale=(id,overrides={})=>({id,kind:'sale',mode:'automatic',title:'Happy Hour',
  reason:'Mừng sinh nhật Mom',scope:'all',type:'percent',value:20,productIds:[],active:true,...overrides});
const menu=[{id:1,name:'Trà',price:50000},{id:2,name:'Coffee',price:40000}];
test('discount banner evaluates upcoming and live sales with hard disable / expiration gates',()=>{
 const live=sale(1,{startsAt:new Date(base-60e3).toISOString(),endsAt:new Date(base+60e3).toISOString()});
 const future=sale(2,{startsAt:new Date(base+86400e3).toISOString(),endsAt:new Date(base+2*86400e3).toISOString()});
 const off=sale(3,{active:false});
 const ended=sale(4,{endsAt:new Date(base).toISOString()});
 const rows=banner.evaluateCampaigns([live,future,off,ended],base);
 assert.deepEqual(rows.map(x=>[x.campaign.id,x.status]),[[1,'live'],[2,'upcoming']]);
 assert.equal(banner.evaluateCampaigns([off,ended],base).length,0);
 assert.equal(banner.evaluateCampaigns([live],base+60e3).length,0);
 assert.equal(banner.evaluateCampaigns([future],base+86400e3)[0].status,'live');
 assert.equal(banner.evaluateCampaigns([{code:'VIP20',percent:20,active:true}],base).length,0);
});
test('countdown and sale prices stay accurate, with fixed / percent targeting',()=>{
 assert.equal(banner.formatDuration(90e3),'00:01:30');
 assert.equal(banner.formatDuration(86400e3+1000),'1 ngày 00:00:01');
 assert.equal(banner.formatDuration(0),'00:00:00');
 assert.equal(banner.formatDuration(null),'Không giới hạn');
 assert.equal(banner.formatDuration(null,'en'),'No end date');
 assert.equal(banner.priceInfo(sale(1),menu,'vi').after,32000);
 assert.equal(banner.priceInfo(sale(2,{scope:'selected',productIds:['1'],type:'amount',value:5000}),menu,'vi').after,45000);
});
test('hero announces live and future sales; disabling everything hides all sale content immediately',()=>{
 const now=Date.now();
 const campaigns=[
  sale(1,{startsAt:new Date(now-20000).toISOString(),endsAt:new Date(now+60000).toISOString()}),
  sale(2,{title:'Ngày lễ hội',reason:'Tri ân khách hàng',startsAt:new Date(now+2*86400e3).toISOString(),
    endsAt:new Date(now+3*86400e3).toISOString()})
 ];
 const dom=new JSDOM(html,{url:'https://mom.example',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
 const w=dom.window,doc=w.document;
 try{
  let boundaries=0;
  w.getMomPublicSales=()=>campaigns;
  w.getMomPublicMenu=()=>menu;
  w.refreshMomSaleBoundary=()=>boundaries++;
  w.eval(source);
  doc.dispatchEvent(new w.Event('DOMContentLoaded'));
  const root=doc.getElementById('mom-sale-hero');
  assert.ok(root);
  assert.equal(root.hidden,false);
  assert.equal(root.querySelectorAll('.mom-sale-hero-card').length,2);
  assert.match(root.textContent,/Mừng sinh nhật Mom/);
  assert.match(root.textContent,/Ngày lễ hội/);
  assert.match(root.textContent,/Lịch SALE sắp tới/);
  assert.match(root.textContent,/Giá SALE từ:/);
  assert.ok(root.querySelectorAll('.mom-sale-hero-timer').length===2);
  campaigns.forEach(p=>p.active=false);
  w.MomSaleBanner.refresh();
  assert.equal(root.hidden,true,'No SALE should remain visible after all campaigns are switched off');
  assert.equal(root.querySelectorAll('.mom-sale-hero-card').length,0);
  assert.equal(root.textContent,'');
  campaigns[0].active=true;
  w.MomSaleBanner.refresh();
  assert.equal(root.hidden,false);
  campaigns[0].active=false;
  w.MomSaleBanner.tick();
  assert.equal(root.hidden,true);
 }finally{w.close();}
});
test('sale start/end crossing changes banner automatically and refreshes checkout pricing',()=>{
 const now=Date.now();
 const begin=now+20000,end=now+40000;
 let campaigns=[sale(11,{startsAt:new Date(begin).toISOString(),endsAt:new Date(end).toISOString()})];
 const dom=new JSDOM('<html lang="vi"><body><div id="mom-sale-hero" hidden></div></body></html>',{
   url:'https://mom.example',runScripts:'outside-only',virtualConsole:new VirtualConsole()
 });
 const w=dom.window,doc=w.document;let boundaries=0;
 try{
  w.getMomPublicSales=()=>campaigns;w.getMomPublicMenu=()=>menu;
  w.refreshMomSaleBoundary=()=>boundaries++;
  w.eval(source);doc.dispatchEvent(new w.Event('DOMContentLoaded'));
  w.MomSaleBanner.tick(begin-1000);
  assert.equal(doc.querySelectorAll('.is-upcoming').length,1);
  w.MomSaleBanner.tick(begin);
  assert.equal(doc.querySelectorAll('.is-live').length,1);
  assert.ok(boundaries>=1);
  const before=boundaries;
  w.MomSaleBanner.tick(end);
  assert.equal(doc.getElementById('mom-sale-hero').hidden,true);
  assert.equal(doc.getElementById('mom-sale-hero').textContent,'');
  assert.equal(boundaries,before+1,'Expiry also refreshes checkout prices');
 }finally{w.close();}
});
test('promo message is a safe text node, not executable markup',()=>{
 const now=Date.now();
 const campaigns=[sale(1,{reason:'<img src=x onerror=alert(1)>',startsAt:new Date(now-1000).toISOString()})];
 const dom=new JSDOM('<html lang="vi"><body><div id="mom-sale-hero" hidden></div></body></html>',{
   url:'https://mom.example',runScripts:'outside-only'
 });
 const w=dom.window;
 try{
  w.getMomPublicSales=()=>campaigns;w.getMomPublicMenu=()=>menu;w.eval(source);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  assert.equal(w.document.querySelector('#mom-sale-hero img'),null);
  assert.match(w.document.getElementById('mom-sale-hero').textContent,/onerror=alert/);
 }finally{w.close();}
});
test('hero and admin reason field assets are connected to the existing app',()=>{
 const admin=fs.readFileSync(path.join(__dirname,'../sale-admin.js'),'utf8');
 const css=fs.readFileSync(path.join(__dirname,'../sale-banner.css'),'utf8');
 assert.match(html,/id="mom-sale-hero" hidden/);
 assert.match(html,/sale-banner.js\?v=20261028-1/);
 assert.match(html,/sale-banner.css\?v=20261028-1/);
 assert.match(html,/id="mom-sale-reason"/);
 assert.match(html,/window\.getMomPublicSales=/);
 assert.match(html,/window\.getMomPublicMenu=/);
 assert.match(html,/window\.MomSaleBanner\?\.refresh\(\)/);
 assert.match(admin,/reason:\(el\('mom-sale-reason'\)/);
 assert.match(admin,/window\.MomSaleBanner\?\.refresh\(\)/);
 assert.match(css,/#view-customer #mom-sale-hero\[hidden\]\{display:none!important\}/);
});
