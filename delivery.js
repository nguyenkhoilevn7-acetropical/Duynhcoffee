'use strict';
const crypto=require('node:crypto');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const lifecycleFields=['status','deliveryStatus','deliveryPartner','deliveryPartnerName','trackingCode','driver','dispatchedAtIso','handedToShipperAtIso','completedAtIso','cancelledAtIso','cancelReason','deliveryCarrierOrderId','deliveryVerifiedAtIso','deliveryCarrierStatus','deliverySyncError'];
function protectOrderWrite(incoming,existing){
 const clean={...incoming};for(const key of lifecycleFields)delete clean[key];
 return existing?{...existing,...clean}:{...clean,status:'new',deliveryPartner:incoming.deliveryPartner==='lalamove'?'lalamove':'ahamove',deliveryPartnerName:incoming.deliveryPartner==='lalamove'?'Lalamove Giao Nhanh':'Ahamove Siêu Tốc'};
}
function transition(order,status,reason){
 if(status==='done')throw fail('Chỉ hoàn tất khi hãng giao hàng xác nhận đã giao đến khách.');
 const allowed={new:['prep','cancelled'],prep:['shipping','cancelled'],shipping:['cancelled'],cancelled:['new'],done:[]};
 if(status===order.status)return order;
 if(!allowed[order.status]?.includes(status))throw fail('Không thể chuyển trạng thái đơn hàng.');
 order.status=status;
 if(status==='shipping'){order.deliveryStatus='in_transit';order.handedToShipperAtIso=new Date().toISOString();delete order.completedAtIso;}
 if(status==='cancelled'){order.cancelledAtIso=new Date().toISOString();if(reason)order.cancelReason=String(reason).slice(0,500);}
 if(status==='new'){for(const key of lifecycleFields)if(key!=='status'&&key!=='deliveryPartner'&&key!=='deliveryPartnerName')delete order[key];}
 return order;
}
function carrierStatus(partner,data){
 const raw=String(data.status||'').toUpperCase();
 if(partner==='ahamove'){
  const stops=Array.isArray(data.path)?data.path.slice(1):[];
  if(stops.some(s=>s.status==='FAILED')||['IN_RETURN','RETURNED'].includes(data.sub_status))return'failed';
  if(raw==='COMPLETED')return stops.length&&stops.every(s=>s.status==='COMPLETED')?'delivered':'failed';
  if(raw==='IN PROCESS')return'in_transit';
  if(raw==='CANCELLED')return'failed';
 }else{
  if(raw==='COMPLETED')return (data.stops||[]).slice(1).some(s=>s.POD?.status==='FAILED')?'failed':'delivered';
  if(raw==='PICKED_UP')return'in_transit';
  if(['CANCELED','CANCELLED','REJECTED','EXPIRED'].includes(raw))return'failed';
 }
 return'assigned';
}
function createDelivery({getOrders,saveOrders,broadcast,env=process.env,fetchImpl=fetch,now=Date.now}){
 const inflight=new Map(),lastCheck=new Map();let polling=false,cursor=0;
 const configured=partner=>partner==='lalamove'?!!(env.LALAMOVE_API_KEY&&env.LALAMOVE_API_SECRET):partner==='ahamove'&&!!env.AHAMOVE_ACCESS_TOKEN;
 const identifier=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{4,80}$/.test(id);
 async function details(partner,id){
  if(!configured(partner))throw fail('Chưa cấu hình API giao hàng trên máy chủ.',503);
  if(!identifier(id))throw fail('Mã vận đơn không hợp lệ.',422);
  const route='/v3/orders/'+encodeURIComponent(id);let host,headers;
  if(partner==='lalamove'){
   host='https://rest.lalamove.com';const timestamp=String(now());
   const signature=crypto.createHmac('sha256',env.LALAMOVE_API_SECRET).update(timestamp+'\r\nGET\r\n'+route+'\r\n\r\n').digest('hex');
   headers={Authorization:'hmac '+env.LALAMOVE_API_KEY+':'+timestamp+':'+signature,Market:'VN','Content-Type':'application/json'};
  }else{host='https://partner-api.ahamove.com';headers={Authorization:'Bearer '+env.AHAMOVE_ACCESS_TOKEN};}
  const response=await fetchImpl(host+route,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw fail(response.status===401?'Phiên API giao hàng đã hết hạn. Vui lòng cập nhật kết nối.':'Chưa lấy được vận đơn từ hãng giao hàng.',502);
  const body=await response.json(),data=partner==='lalamove'?body.data:body;
  if(!data||String(partner==='lalamove'?data.orderId:data._id)!==id)throw fail('Hãng trả về mã vận đơn không khớp.',502);
  return data;
 }
 function apply(order,data){
  if(['done','cancelled'].includes(order.status))return order;
  const status=carrierStatus(order.deliveryPartner,data);
  order.deliveryStatus=status;order.deliveryCarrierStatus=String(data.status||'').slice(0,40);order.deliveryVerifiedAtIso=new Date(now()).toISOString();
  delete order.deliverySyncError;
  if(order.deliveryPartner==='ahamove'&&data.supplier_name)order.driver={name:String(data.supplier_name).slice(0,100)};
  if(status==='in_transit'){order.status='shipping';order.handedToShipperAtIso ||= new Date(now()).toISOString();}
  if(status==='delivered'){order.status='done';order.completedAtIso ||= new Date(now()).toISOString();}
  saveOrders();broadcast('ORDER_STATUS',{orderId:order.id,status:order.status,order});return order;
 }
 async function bind(id,partner,carrierOrderId){
  const order=getOrders().find(o=>o.id===id);if(!order)throw fail('Không tìm thấy đơn hàng.',404);
  if(!['new','prep','shipping'].includes(order.status))throw fail('Không thể liên kết vận đơn cho đơn đã kết thúc.');
  if(order.deliveryCarrierOrderId&&(order.deliveryCarrierOrderId!==carrierOrderId||order.deliveryPartner!==partner))throw fail('Đơn này đã liên kết vận đơn khác.');
  if(getOrders().some(o=>o.id!==id&&o.deliveryPartner===partner&&o.deliveryCarrierOrderId===carrierOrderId))throw fail('Vận đơn đã được liên kết với đơn khác.');
  const data=await details(partner,carrierOrderId);
  if(['delivered','failed'].includes(carrierStatus(partner,data)))throw fail('Vận đơn đã kết thúc; hãy chọn vận đơn đang hoạt động.');
  const current=getOrders().find(o=>o.id===id);
  if(!current||!['new','prep','shipping'].includes(current.status))throw fail('Đơn hàng đã thay đổi. Vui lòng tải lại.');
  if(current.deliveryCarrierOrderId&&(current.deliveryCarrierOrderId!==carrierOrderId||current.deliveryPartner!==partner))throw fail('Đơn này đã liên kết vận đơn khác.');
  if(getOrders().some(o=>o.id!==id&&o.deliveryPartner===partner&&o.deliveryCarrierOrderId===carrierOrderId))throw fail('Vận đơn đã được liên kết với đơn khác.');
  Object.assign(current,{deliveryPartner:partner,deliveryPartnerName:partner==='ahamove'?'Ahamove Siêu Tốc':'Lalamove Giao Nhanh',deliveryCarrierOrderId:carrierOrderId,trackingCode:carrierOrderId,dispatchedAtIso:new Date(now()).toISOString()});
  delete current.driver;return apply(current,data);
 }
 async function refresh(id,{throttle=false}={}){
  if(inflight.has(id))return inflight.get(id);
  const order=getOrders().find(o=>o.id===id);
  if(!order?.deliveryCarrierOrderId||['done','cancelled'].includes(order.status))return order;
  const partner=order.deliveryPartner,carrierId=order.deliveryCarrierOrderId;
  if(throttle&&now()-(lastCheck.get(id)||0)<15000)return order;
  if(lastCheck.size>2000)lastCheck.clear();lastCheck.set(id,now());
  const task=(async()=>{
   try{const data=await details(partner,carrierId);const current=getOrders().find(o=>o.id===id);if(current&&current.deliveryCarrierOrderId===carrierId&&current.deliveryPartner===partner)return apply(current,data);}
   catch(error){const current=getOrders().find(o=>o.id===id);if(current&&current.deliveryCarrierOrderId===carrierId&&!['done','cancelled'].includes(current.status)){current.deliverySyncError='Chưa đồng bộ được hãng giao hàng. Hệ thống sẽ thử lại.';saveOrders();broadcast('ORDER_STATUS',{orderId:current.id,status:current.status,order:current});}throw error;}
   finally{inflight.delete(id);}
  })();inflight.set(id,task);return task;
 }
 async function callback(partner,body){
  // Callback payload is only a signal. Ignore its claimed status/driver and
  // confirm independently over the authenticated carrier API before any write.
  const carrierId=String(partner==='lalamove'?body.data?.order?.orderId||'':body._id||'');
  const order=getOrders().find(o=>o.deliveryPartner===partner&&o.deliveryCarrierOrderId===carrierId);
  if(!order)return {ignored:true};await refresh(order.id,{throttle:true});return{received:true};
 }
 async function poll(){
  if(polling)return;polling=true;
  try{const orders=getOrders().filter(o=>o.deliveryCarrierOrderId&&configured(o.deliveryPartner)&&!['done','cancelled'].includes(o.status));
   if(!orders.length)return;
   for(let i=0;i<Math.min(5,orders.length);i++){const order=orders[(cursor+i)%orders.length];try{await refresh(order.id,{throttle:true});}catch{}}
   cursor=(cursor+5)%orders.length;
  }finally{polling=false;}
 }
 return{bind,refresh,callback,poll,configured};
}
module.exports={createDelivery,carrierStatus,protectOrderWrite,transition};
