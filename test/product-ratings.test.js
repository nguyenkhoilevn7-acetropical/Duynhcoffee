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
 assert.match(server,/path\.basename\(normalized\)[\s\S]*'product-ratings\.json'/);
 assert.match(server,/pathname==='\/api\/ratings'/);
});
