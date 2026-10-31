'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {createRatingsStore,validOrder,safeState}=require('../product-ratings');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const proof='a'.repeat(64);
const order={id:'ORD-15723',phone:'0912345678',paymentStatus:'receipt_verified',status:'new',
 items:[{id:41,qty:1},{id:42,qty:2}]};
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mom-ratings-'));
 let orders=[{...order,items:order.items.map(x=>({...x}))}];
 const store=createRatingsStore({dir,getOrders:()=>orders});
 return {store,dir,orders,close(){fs.rmSync(dir,{recursive:true,force:true});}};
}
test('only a real verified order can be granted a review capability',()=>{
 const f=fixture();
 try{
  assert.equal(f.store.register({...order,paymentStatus:'receipt_submitted'},proof),false);
  assert.equal(f.store.register({...order,status:'cancelled'},proof),false);
  assert.equal(f.store.register({...order},'easy-guess'),false);
  assert.equal(f.store.register(f.orders[0],proof),true);
  assert.equal(f.store.hasGrant(order.id,proof),true);
  assert.equal(f.store.hasGrant(order.id,'b'.repeat(64)),false);
  assert.equal(f.store.register(f.orders[0],'b'.repeat(64)),false);
  assert.equal(f.store.register(f.orders[0],proof),true,'retries are idempotent');
  const disk=fs.readFileSync(path.join(f.dir,'product-ratings.json'),'utf8');
  assert.ok(!disk.includes(proof),'plain proof may not be written');
  assert.ok(!disk.includes(order.phone),'phone must not be stored in ratings');
 }finally{f.close();}
});
test('a buyer cannot review an unpurchased product or submit outside 1–5 hearts',()=>{
 const f=fixture();
 try{
  f.store.register(f.orders[0],proof);
  assert.equal(f.store.rate({orderId:order.id,productId:99,score:5,proof}).status,403);
  assert.equal(f.store.rate({orderId:order.id,productId:41,score:6,proof}).status,422);
  assert.equal(f.store.rate({orderId:order.id,productId:41,score:3,proof:'b'.repeat(64)}).status,403);
  assert.equal(f.store.rate({orderId:order.id,productId:41,score:5,proof}).status,200);
  assert.deepEqual(f.store.summary()['41'],{count:1,average:5});
 }finally{f.close();}
});
test('repeat ratings from same phone update rather than inflate the vote count',()=>{
 const f=fixture();
 try{
  f.store.register(f.orders[0],proof);
  f.store.rate({orderId:order.id,productId:41,score:5,proof});
  f.store.rate({orderId:order.id,productId:41,score:2,proof});
  assert.deepEqual(f.store.summary()['41'],{count:1,average:2});
  f.orders.push({id:'ORD-15724',phone:'0912345678',paymentStatus:'receipt_verified',status:'done',items:[{id:41,qty:1}]});
  const other='b'.repeat(64);
  f.store.register(f.orders[1],other);
  f.store.rate({orderId:'ORD-15724',productId:41,score:4,proof:other});
  assert.deepEqual(f.store.summary()['41'],{count:1,average:4});
  f.orders.push({id:'ORD-15725',phone:'0934000000',paymentStatus:'receipt_verified',status:'done',items:[{id:41,qty:1}]});
  const third='c'.repeat(64);
  f.store.register(f.orders[2],third);
  f.store.rate({orderId:'ORD-15725',productId:41,score:5,proof:third});
  assert.deepEqual(f.store.summary()['41'],{count:2,average:4.5});
 }finally{f.close();}
});
test('ratings persist across process restart, cancellation removes score from aggregates',()=>{
 const f=fixture();
 try{
  f.store.register(f.orders[0],proof);
  f.store.rate({orderId:order.id,productId:41,score:4,proof});
  const restarted=createRatingsStore({dir:f.dir,getOrders:()=>f.orders});
  assert.equal(restarted.hasGrant(order.id,proof),true);
  assert.deepEqual(restarted.summary()['41'],{count:1,average:4});
  f.orders[0].status='cancelled';
  assert.equal(restarted.summary()['41'],undefined);
 }finally{f.close();}
});
test('ratings restore from backup only if local file does not exist',()=>{
 const f=fixture(),next=fixture();
 try{
  f.store.register(f.orders[0],proof);
  f.store.rate({orderId:order.id,productId:41,score:4,proof});
  next.store.restore(f.store.read());
  assert.deepEqual(next.store.summary()['41'],{count:1,average:4});
  next.store.restore({...f.store.read(),records:{}});
  assert.deepEqual(next.store.summary()['41'],{count:1,average:4});
 }finally{f.close();next.close();}
});
test('ratings HTML and secure server integration are connected without exposing proof',()=>{
 const doc=new JSDOM(html).window.document;
 assert.ok(doc.querySelector('script[src*="product-ratings-client.js"]'));
 assert.ok(doc.querySelector('link[href*="product-ratings.css"]'));
 assert.match(html,/class="mom-heart-ratings" data-product-id=/);
 assert.match(html,/window\.MomDrinkRatings\?\.rememberOrder/);
 assert.match(server,/delete body\.ratingProof/);
 assert.match(server,/ratingEnabled:ratingsStore\.hasGrant/);
 assert.match(server,/ratingsStore\.register\(savedOrder,ratingProof\)/);
 assert.match(server,/'product-ratings\.json'[\s\S]*path\.basename\(normalized\)/);
 assert.match(server,/pathname==='\/api\/ratings'/);
});

test('heart rating uses SVG icons and explains eligibility without submitting unverified ratings',()=>{
 const client=fs.readFileSync(path.join(__dirname,'../product-ratings-client.js'),'utf8');
 const dom=new JSDOM('<!doctype html><html lang="vi"><body><div id="customer-products-grid"><div class="mom-heart-ratings" data-product-id="41"></div></div></body></html>',{url:'https://mom.example',runScripts:'outside-only'});
 const {window}=dom,requests=[],notifications=[];
 try{
  window.fetch=async (url,opts)=>{requests.push({url,method:opts?.method||'GET'});return {ok:true,json:async()=>({ratings:{}})};};
  window.showSmsToast=(title,message)=>notifications.push({title,message});
  window.eval(client);
  window.MomDrinkRatings.paint();
  const buttons=window.document.querySelectorAll('.mom-heart-rating-btn');
  assert.equal(buttons.length,5);
  assert.equal(window.document.querySelectorAll('.mom-heart-rating-btn svg path').length,5);
  assert.equal(buttons[0].querySelector('svg').getAttribute('aria-hidden'),'true');
  assert.equal(buttons[4].getAttribute('aria-label'),'Đánh giá 5 tim');
  buttons[4].click();
  assert.equal(requests.filter(r=>r.method==='POST').length,0);
  assert.match(window.document.querySelector('.mom-rating-eligibility[role="alert"]').textContent,/Rating chỉ dành cho khách đã đặt order và thanh toán món này/);
  assert.match(notifications.at(-1).message,/Rating chỉ dành cho khách đã đặt order/);
 }finally{dom.window.close();}
});

test('admin display scores stay distinct from verified buyer votes and survive restart',()=>{
 const f=fixture();
 try{
  f.store.register(f.orders[0],proof);
  f.store.rate({orderId:order.id,productId:41,score:3,proof});
  const custom=f.store.setEditorial({productId:'41',score:4.7,count:128,version:''});
  assert.equal(custom.status,200);
  assert.equal(f.store.editorial()['41'].count,128);
  assert.deepEqual(f.store.summary()['41'],{count:1,average:3});
  const reloaded=createRatingsStore({dir:f.dir,getOrders:()=>f.orders});
  assert.equal(reloaded.editorial()['41'].score,4.7);
  assert.equal(reloaded.editorial()['41'].count,128);
  assert.equal(reloaded.setEditorial({productId:'41',score:2,count:50,version:''}).status,409);
  assert.equal(reloaded.setEditorial({productId:'41',score:5.1,count:50,version:custom.result.entry.version}).status,422);
  assert.equal(reloaded.setEditorial({productId:'41',score:5,count:-1,version:custom.result.entry.version}).status,422);
  const changed=reloaded.setEditorial({productId:'41',score:4.5,count:0,version:custom.result.entry.version});
  assert.equal(changed.status,200);
  assert.equal(reloaded.editorial()['41'].count,0);
  assert.equal(reloaded.setEditorial({productId:'41',remove:true,version:changed.result.entry.version}).status,200);
  assert.equal(reloaded.editorial()['41'],undefined);
  assert.deepEqual(reloaded.summary()['41'],{count:1,average:3});
 }finally{f.close();}
});
test('old ratings backups work and malformed shop scores are rejected',()=>{
 const f=fixture();
 try{
  const original=f.store.read();
  const legacy={...original};delete legacy.editorial;
  assert.doesNotThrow(()=>safeState(legacy));
  assert.throws(()=>safeState({...legacy,editorial:{41:{score:4.5,count:10,version:'bad'}}}),/Invalid editorial/);
  assert.throws(()=>safeState({...legacy,editorial:{41:{score:4.8,count:2.5,version:'a'.repeat(36)}}}),/Invalid editorial/);
  assert.throws(()=>safeState({...legacy,editorial:{41:{score:7,count:10,version:'a'.repeat(36)}}}),/Invalid editorial/);
 }finally{f.close();}
});
test('editorial ratings admin UI requires server token and shows per-item controls',async()=>{
 const script=fs.readFileSync(path.join(__dirname,'../admin-product-ratings.js'),'utf8');
 const doc='<html lang="vi"><body><details id="mom-rating-admin" open><div id="mom-rating-admin-list"></div></details></body></html>';
 const dom=new JSDOM(doc,{url:'https://mom.test',runScripts:'outside-only'});
 const {window}=dom,requests=[];
 try{
  window.isUserAdmin=()=>true;
  window.localStorage.setItem('duynh_admin_api_token','test-token');
  window.MomDrinkRatings={refresh(){}};
  window.fetch=async(url,opts)=>{
    requests.push({url,opts});
    if(opts?.method==='POST')return {ok:true,json:async()=>({success:true,productId:'41',entry:{score:4.2,count:32,version:'b'.repeat(36)}})};
    return {ok:true,json:async()=>({ratings:{41:{average:4,count:2}},editorial:{}})};
  };
  window.eval(script);
  window.MomRatingsAdmin.render([{id:41,name:'Trà Mãng Cầu',image:''}]);
  await new Promise(resolve=>setTimeout(resolve,0)); // wait for automatic initial fetch
  assert.match(window.document.getElementById('mom-rating-admin-list').textContent,/Trà Mãng Cầu/);
  const inputs=window.document.querySelectorAll('#mom-rating-admin-list input');
  assert.equal(inputs.length,2);
  inputs[0].value='4.2';inputs[1].value='32';
  window.document.querySelector('.mom-rating-admin-save').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  const post=requests.find(r=>r.opts?.method==='POST');
  assert.equal(post.url,'/api/admin/ratings');
  assert.equal(post.opts.headers.Authorization,'Bearer test-token');
  assert.deepEqual(JSON.parse(post.opts.body),{productId:'41',score:4.2,count:32,version:'',remove:false});
  window.isUserAdmin=()=>false;
  window.document.querySelector('.mom-rating-admin-save').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(requests.filter(r=>r.opts?.method==='POST').length,1);
 }finally{dom.window.close();}
});
test('weighted rating adds verified reviews to Admin without overwriting or double-counting',()=>{
 const f=fixture();
 try{
  let p=f.store.setEditorial({productId:'41',score:4.5,count:100,version:''});
  assert.equal(p.status,200);
  assert.deepEqual(f.store.combined()['41'],{count:100,average:4.5,buyerCount:0,adminCount:100});
  assert.equal(f.store.register(f.orders[0],proof),true);
  f.store.rate({orderId:order.id,productId:41,score:5,proof});
  assert.deepEqual(f.store.combined()['41'],{count:101,average:4.5,buyerCount:1,adminCount:100});
  assert.deepEqual(f.store.summary()['41'],{count:1,average:5});
  f.orders.push({...order,id:'ORD-15724',phone:'0934000000'});
  const other='b'.repeat(64);
  assert.equal(f.store.register(f.orders[1],other),true);
  f.store.rate({orderId:'ORD-15724',productId:41,score:5,proof:other});
  assert.deepEqual(f.store.combined()['41'],{count:102,average:4.5,buyerCount:2,adminCount:100});
  // One customer changing score must not create a new rating.
  f.store.rate({orderId:'ORD-15724',productId:41,score:1,proof:other});
  assert.deepEqual(f.store.combined()['41'],{count:102,average:4.5,buyerCount:2,adminCount:100});
  assert.deepEqual(f.store.summary()['41'],{count:2,average:3});
  const next=f.store.setEditorial({productId:'41',score:3.5,count:20,version:p.result.entry.version});
  assert.equal(next.status,200);
  assert.deepEqual(f.store.combined()['41'],{count:22,average:3.5,buyerCount:2,adminCount:20});
  f.orders[0].status='cancelled';
  assert.deepEqual(f.store.combined()['41'],{count:21,average:3.4,buyerCount:1,adminCount:20});
  assert.equal(f.store.setEditorial({productId:'41',remove:true,version:next.result.entry.version}).status,200);
  assert.deepEqual(f.store.combined()['41'],{count:1,average:1,buyerCount:1,adminCount:0});
 }finally{f.close();}
});
test('curated fractional score keeps half SVG heart without invented customer rating counts',async()=>{
 const client=fs.readFileSync(path.join(__dirname,'../product-ratings-client.js'),'utf8');
 const dom=new JSDOM('<html lang="vi"><body><div id="customer-products-grid"><div class="mom-heart-ratings" data-product-id="41"></div><div class="mom-heart-ratings" data-product-id="42"></div></div></body></html>',{url:'https://mom.test',runScripts:'outside-only'});
 try{
  const {window}=dom;
  window.fetch=async()=>({ok:true,json:async()=>({
    ratings:{41:{count:0,average:0},42:{count:2,average:4}},
    combined:{41:{count:200,average:4.5,buyerCount:0,adminCount:200},42:{count:2,average:4,buyerCount:2,adminCount:0}},
    editorial:{41:{count:200,score:4.5,version:'a'.repeat(36)}}
  })});
  window.eval(client);await window.MomDrinkRatings.refresh();
  const target=window.document.querySelector('.mom-heart-ratings[data-product-id="41"]');
  assert.match(target.querySelector('.mom-heart-meta').textContent,/Điểm hiển thị: 4.5\\/5/);
  assert.doesNotMatch(target.textContent,/200|do quán thiết lập|200 lượt|200 đánh giá/);
  assert.equal(target.querySelectorAll('.mom-heart-rating-btn.filled').length,4);
  assert.equal(target.querySelectorAll('.mom-heart-rating-btn.partial').length,1);
  assert.equal(target.querySelectorAll('.mom-heart-rating-btn.partial svg').length,2);
  assert.equal(target.querySelector('.mom-heart-rating-btn.partial').style.getPropertyValue('--mom-heart-fill'),'50%');
  const organic=window.document.querySelector('.mom-heart-ratings[data-product-id="42"]');
  assert.match(organic.querySelector('.mom-heart-meta').textContent,/4.0 \\(2 đánh giá\\)/);
  assert.equal(organic.querySelectorAll('.mom-heart-rating-btn.filled').length,4);
  assert.equal(organic.querySelectorAll('.mom-heart-rating-btn.partial').length,0);
 }finally{dom.window.close();}
});
test('public rating API and protected Admin rating API remain separate',()=>{
 assert.ok(server.includes("pathname==='/api/admin/ratings'"));
 assert.ok(server.includes("if(!adminPush.verify("));
 assert.ok(server.includes("ratingsStore.setEditorial(body||{})"));
 assert.ok(server.includes("ratings:ratingsStore.summary(),combined:ratingsStore.combined(),editorial:ratingsStore.editorial()"));
 assert.ok(html.includes('id="mom-rating-admin"'));
 assert.ok(html.includes('window.MomRatingsAdmin?.render(menu)'));
});
