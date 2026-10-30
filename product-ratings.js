'use strict';
// Verified-buyer heart ratings: capability is minted on the buyer's device and
// accepted ONLY alongside a successfully receipt-verified new order.
// Proofs are SHA-256 hashed at rest and never included in public order records.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_RECORDS = 200000;
const proofOk = s => typeof s==='string' && /^[0-9a-f]{64}$/i.test(s);
const digest = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const cleanPhone = p => String(p||'').replace(/\D/g,'').slice(-11);
function validOrder(order, productId) {
  return !!order && order.status!=='cancelled' &&
    order.paymentStatus==='receipt_verified' &&
    !!cleanPhone(order.phone) && Array.isArray(order.items) &&
    (productId===undefined || order.items.some(i => String(i.id)===String(productId) && Number(i.qty)>0));
}
function safeState(value) {
  if(!value || value.schema!=='mom-heart-ratings-v1' || !/^[0-9a-f]{64}$/.test(value.salt||'') ||
    !value.grants || typeof value.grants!=='object' || Array.isArray(value.grants) ||
    !value.records || typeof value.records!=='object' || Array.isArray(value.records))
    throw Error('Invalid ratings store');
  if(Object.keys(value.records).length>MAX_RECORDS || Object.keys(value.grants).length>MAX_RECORDS)throw Error('Rating store too large');
  if(Object.entries(value.grants).some(([id,hash])=>!/^ORD-[0-9]{5}$/.test(id)||typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash)))
    throw Error('Invalid rating grant');
  for(const record of Object.values(value.records)){
    if(!record||!Number.isInteger(record.score)||record.score<1||record.score>5||
      typeof record.buyer!=='string'||!/^[0-9a-f]{64}$/.test(record.buyer)||
      !/^ORD-[0-9]{5}$/.test(String(record.orderId))||
      !/^[0-9a-z_-]{1,60}$/i.test(String(record.productId)))throw Error('Invalid rating record');
  }
  return value;
}
function createRatingsStore({dir,getOrders,onChange=()=>{}}) {
  const filename=path.join(dir,'product-ratings.json');
  let current=null;
  function read() {
    try {
      if(fs.existsSync(filename))current=safeState(JSON.parse(fs.readFileSync(filename,'utf8')));
      if(current)return current;
    }catch(e){throw new Error('Không đọc được dữ liệu đánh giá: '+e.message);}
    current={schema:'mom-heart-ratings-v1',salt:crypto.randomBytes(32).toString('hex'),grants:{},records:{}};
    return current;
  }
  function save(state) {
    safeState(state);
    const tmp=filename+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(state),'utf8');fs.renameSync(tmp,filename);
    current=state;
    onChange();
  }
  function restore(state){
    safeState(state);
    // Never overwrite newer local state with an older Drive snapshot.
    if(!fs.existsSync(filename))save(state);
  }
  function hasGrant(orderId,proof){
    if(!proofOk(proof))return false;
    return read().grants[String(orderId)]===digest(proof);
  }
  const buyerKey=(state,order)=>digest(state.salt+':'+cleanPhone(order.phone));
  function register(order,proof) {
    if(!proofOk(proof)||!validOrder(order))return false;
    const state=read(),id=String(order.id),hash=digest(proof);
    if(state.grants[id])return state.grants[id]===hash;
    // A proof can only be granted for an order after its verified POST succeeded.
    state.grants[id]=hash;
    save(state);
    return true;
  }
  function rate({orderId,productId,score,proof}) {
    if(!proofOk(proof) || !Number.isSafeInteger(score) || score<1 || score>5)
      return {status:422,error:'Đánh giá phải từ 1 đến 5 tim và có mã xác nhận hợp lệ.'};
    const orders=getOrders(),order=orders.find(o=>String(o.id)===String(orderId));
    if(!validOrder(order,productId))
      return {status:403,error:'Chỉ khách đã mua món này bằng đơn hàng được xác minh mới có quyền đánh giá.'};
    const state=read(),hash=state.grants[String(orderId)];
    if(!hash || hash.length!==64 ||
      !crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(digest(proof),'hex')))
      return {status:403,error:'Thiếu quyền đánh giá từ đơn hàng đã mua trên thiết bị này.'};
    const buyer=buyerKey(state,order),key=String(productId)+':'+buyer;
    const previous=state.records[key];
    if(!previous && Object.keys(state.records).length>=MAX_RECORDS)
      return {status:503,error:'Hệ thống đánh giá đã đầy.'};
    state.records[key]={productId:String(productId),buyer,score,orderId:String(orderId),updatedAt:new Date().toISOString()};
    save(state);
    return {status:200,result:{productId:String(productId),score,summary:summary(getOrders())[String(productId)]}};
  }
  function summary(orders=getOrders()) {
    const state=read();
    const byId=new Map(orders.filter(o=>validOrder(o)).map(o=>[String(o.id),o]));
    const totals={};
    for(const item of Object.values(state.records)){
      const order=byId.get(String(item.orderId));
      if(!order || !validOrder(order,item.productId))continue;
      const id=String(item.productId);
      const value=totals[id]||(totals[id]={count:0,sum:0});
      value.count++;value.sum+=item.score;
    }
    return Object.fromEntries(Object.entries(totals).map(([id,v])=>[id,{count:v.count,average:Math.round(10*v.sum/v.count)/10}]));
  }
  return {register,hasGrant,rate,summary,read,restore};
}
module.exports={createRatingsStore,validOrder,proofOk,safeState};
