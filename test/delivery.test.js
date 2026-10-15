'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDelivery,carrierStatus,protectOrderWrite,transition}=require('../delivery');
test('handover is distinct from delivery and client writes cannot forge lifecycle fields',()=>{
 const order={id:'ORD-1',status:'new'};transition(order,'prep');transition(order,'shipping');
 assert.equal(order.status,'shipping');assert.ok(order.handedToShipperAtIso);assert.equal(order.completedAtIso,undefined);
 assert.throws(()=>transition(order,'done'),/Chỉ hoàn tất/);
 const forged={id:'ORD-1',status:'done',deliveryStatus:'delivered',deliveryCarrierOrderId:'FAKE',completedAtIso:'fake',total:45000};
 const clean=protectOrderWrite(forged);assert.equal(clean.status,'new');assert.equal(clean.deliveryCarrierOrderId,undefined);assert.equal(clean.completedAtIso,undefined);
 const merged=protectOrderWrite(forged,order);assert.equal(merged.status,'shipping');assert.equal(merged.deliveryCarrierOrderId,undefined);assert.equal(merged.total,45000);
 assert.throws(()=>transition({status:'new'},'shipping'));assert.throws(()=>transition({status:'done'},'prep'));
});
test('Ahamove completion requires successful destination stops, not just a completed trip',()=>{
 for(const path of [[],[{}],[{}, {status:'FAILED'}],[{}, {status:'COMPLETED'},{status:'FAILED'}]])assert.notEqual(carrierStatus('ahamove',{status:'COMPLETED',path}),'delivered');
 assert.equal(carrierStatus('ahamove',{status:'COMPLETED',path:[{},{status:'COMPLETED'}]}),'delivered');
 assert.equal(carrierStatus('ahamove',{status:'COMPLETED',sub_status:'RETURNED',path:[{},{status:'COMPLETED'}]}),'failed');
 assert.equal(carrierStatus('ahamove',{status:'IN PROCESS'}),'in_transit');
 assert.equal(carrierStatus('lalamove',{status:'PICKED_UP'}),'in_transit');
 assert.equal(carrierStatus('lalamove',{status:'COMPLETED',stops:[{},{POD:{status:'FAILED'}}]}),'failed');
});
function fixture(partner='lalamove'){
 const orders=[{id:'ORD-1',status:'prep'}],calls=[],events=[];let time=100000,status='ON_GOING',path=[{},{status:'COMPLETED'}],fail=false;
 const env={LALAMOVE_API_KEY:'key',LALAMOVE_API_SECRET:'secret',AHAMOVE_ACCESS_TOKEN:'token'};
 const service=createDelivery({getOrders:()=>orders,saveOrders(){},broadcast:(...args)=>events.push(args),env,now:()=>time,
  fetchImpl:async(url,options)=>{calls.push({url,options});if(fail)return{ok:false,status:401};const id=url.split('/').at(-1);return{ok:true,json:async()=>partner==='lalamove'?{data:{orderId:id,status}}:{_id:id,status,path}};}});
 return{orders,calls,events,service,env,set status(v){status=v;},set path(v){path=v;},set fail(v){fail=v;},advance(){time+=16000;}};
}
test('real ID binding uses signed carrier API; spoofed delivered callback only triggers independent verification',async()=>{
 const f=fixture();await f.service.bind('ORD-1','lalamove','123456');
 assert.equal(f.orders[0].status,'prep');assert.equal(f.orders[0].trackingCode,'123456');assert.equal(f.orders[0].driver,undefined);
 const call=f.calls[0];assert.equal(call.url,'https://rest.lalamove.com/v3/orders/123456');assert.equal(call.options.method,'GET');assert.equal(call.options.headers.Market,'VN');
 const signature=crypto.createHmac('sha256','secret').update('100000\r\nGET\r\n/v3/orders/123456\r\n\r\n').digest('hex');assert.equal(call.options.headers.Authorization,'hmac key:100000:'+signature);
 await f.service.callback('lalamove',{data:{order:{orderId:'123456',status:'COMPLETED'}}});assert.notEqual(f.orders[0].status,'done');
 f.status='PICKED_UP';f.advance();await f.service.callback('lalamove',{data:{order:{orderId:'123456',status:'COMPLETED'}}});assert.equal(f.orders[0].status,'shipping');assert.equal(f.orders[0].completedAtIso,undefined);
 f.status='COMPLETED';f.advance();await f.service.callback('lalamove',{data:{order:{orderId:'123456',status:'COMPLETED'}}});assert.equal(f.orders[0].status,'done');assert.ok(f.orders[0].completedAtIso);assert.equal(f.events.at(-1)[1].order.status,'done');
 const count=f.calls.length;await f.service.refresh('ORD-1');assert.equal(f.calls.length,count);
});
test('Ahamove failed destination never marks a store order delivered; successful destination completes it',async()=>{
 const f=fixture('ahamove');f.status='ACCEPTED';await f.service.bind('ORD-1','ahamove','AHA123');
 assert.equal(f.calls[0].url,'https://partner-api.ahamove.com/v3/orders/AHA123');assert.equal(f.calls[0].options.headers.Authorization,'Bearer token');
 transition(f.orders[0],'shipping');f.status='COMPLETED';f.path=[{},{status:'FAILED'}];await f.service.refresh('ORD-1');assert.equal(f.orders[0].status,'shipping');assert.equal(f.orders[0].deliveryStatus,'failed');
 f.path=[{},{status:'COMPLETED'}];await f.service.refresh('ORD-1');assert.equal(f.orders[0].status,'done');
});
test('unconfigured, expired, invalid or reused carrier IDs cannot create fake deliveries',async()=>{
 const f=fixture();delete f.env.LALAMOVE_API_SECRET;
 await assert.rejects(f.service.bind('ORD-1','lalamove','123456'),{status:503});assert.equal(f.orders[0].trackingCode,undefined);
 f.env.LALAMOVE_API_SECRET='secret';await assert.rejects(f.service.bind('ORD-1','lalamove','https://localhost/secret'),{status:422});assert.equal(f.calls.length,0);
 await f.service.bind('ORD-1','lalamove','123456');f.orders.push({id:'ORD-2',status:'prep'});
 await assert.rejects(f.service.bind('ORD-2','lalamove','123456'),/liên kết/);
 f.fail=true;await assert.rejects(f.service.refresh('ORD-1'),{status:502});assert.notEqual(f.orders[0].status,'done');assert.ok(f.orders[0].deliverySyncError);
});
test('callbacks for unknown IDs are ignored; repeated callback work is coalesced and polling recovers missed delivery events',async()=>{
 const f=fixture();assert.deepEqual(await f.service.callback('lalamove',{data:{order:{orderId:'missing',status:'COMPLETED'}}}),{ignored:true});assert.equal(f.calls.length,0);
 await f.service.bind('ORD-1','lalamove','123456');await Promise.all([f.service.callback('lalamove',{data:{order:{orderId:'123456'}}}),f.service.callback('lalamove',{data:{order:{orderId:'123456'}}})]);assert.equal(f.calls.length,2);
 f.status='COMPLETED';f.advance();await f.service.poll();assert.equal(f.orders[0].status,'done');
});
