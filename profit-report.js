'use strict';
// Private reporting data never travels through public menu/config/order snapshots.
const crypto = require('node:crypto');
const {recipeUnitCost}=require('./inventory-cost');
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const forbidden = new Set(['__proto__','constructor','prototype']);
function validId(id){return typeof id==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id) && !forbidden.has(id);}
function validateSettings(value){
 if(!value || typeof value!=='object' || Array.isArray(value) || typeof value.version!=='string' || !value.rates || Array.isArray(value.rates) || typeof value.rates!=='object')throw fail('Dữ liệu tỷ lệ chi phí không hợp lệ.');
 for(const [id,entries] of Object.entries(value.rates)){
  if(!validId(id) || !Array.isArray(entries) || !entries.length || entries.length>10000)throw fail('Lịch sử tỷ lệ chi phí không hợp lệ.');
  let previous='';for(const entry of entries){
   if(!entry || typeof entry.from!=='string' || !Number.isFinite(Date.parse(entry.from)) || entry.from<=previous || (entry.percent!==null && (typeof entry.percent!=='number' || !Number.isFinite(entry.percent) || entry.percent<0 || entry.percent>100)))throw fail('Tỷ lệ chi phí phải từ 0 đến 100%.');
   previous=entry.from;
  }
 }
 return value;
}
const emptySettings=()=>({version:'',rates:{}});
function updateSettings(previous,body,menu,now=new Date().toISOString()){
 validateSettings(previous);
 if(body?.version!==previous.version)throw fail('Tỷ lệ chi phí đã thay đổi trên thiết bị khác. Bấm Làm mới để tải lại trước khi lưu.',409);
 if(!Array.isArray(body.items) || body.items.length>10000)throw fail('Danh sách chi phí không hợp lệ.');
 const rates=structuredClone(previous.rates),ids=new Set(),menuIds=new Set(menu.map(m=>String(m.id)));
 for(const row of body.items){
  const id=String(row.itemId);if(!validId(id)||!menuIds.has(id)||ids.has(id))throw fail('Món đã bị xóa hoặc mã món không hợp lệ.');ids.add(id);
  const p=row.percent;if(p!==null && (typeof p!=='number'||!Number.isFinite(p)||p<0||p>100 || Math.abs(p*100-Math.round(p*100))>0.000001))throw fail('Nhập tỷ lệ từ 0 đến 100%, tối đa 2 số thập phân; để trống nếu chưa biết.');
  const history=rates[id];if((history?.at(-1)?.percent??null)===p)continue;
  // First configuration is the explicit baseline for legacy orders. Later edits affect new orders only.
  const effective=history?.length?new Date(Math.max(Date.parse(now),Date.parse(history.at(-1).from)+1)).toISOString():'0001-01-01T00:00:00.000Z';
  (rates[id] ||= []).push({from:effective,percent:p});
 }
 return validateSettings({version:crypto.randomUUID(),rates});
}
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'});
function vnDay(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';const p=Object.fromEntries(dayFormatter.formatToParts(d).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
function validDay(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw fail('Ngày báo cáo không hợp lệ.');return value;}
function rateAt(settings,id,date){const time=Date.parse(date);if(!Number.isFinite(time))return null;const h=settings.rates[String(id)]||[];for(let i=h.length-1;i>=0;i--)if(Date.parse(h[i].from)<=time)return h[i].percent;return null;}
const money=value=>value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=1e12?Math.round(Number(value)):null;
function allocate(total,weights){
 const sum=weights.reduce((a,b)=>a+b,0);if(!sum)return weights.map(()=>0);
 const exact=weights.map(w=>total*w/sum),out=exact.map(Math.floor);let remaining=total-out.reduce((a,b)=>a+b,0);
 const sorted=exact.map((v,i)=>({i,f:v-out[i]})).sort((a,b)=>b.f-a.f||a.i-b.i);
 for(let i=0;i<remaining;i++)out[sorted[i%sorted.length].i]++;
 return out;
}
function orderFinancials(order,settings,recipes={},inventory={items:[]}){
 const created=order.createdAtIso || order.createdAt;
 const source=Array.isArray(order.items)?order.items:[];
 const lines=source.map((item,index)=>{
  const qty=Number(item.qty),price=money(item.price);const gross=item.total!==undefined && item.total!==null?money(item.total):(price!==null&&Number.isFinite(qty)?Math.round(price*qty):null);
  const recipe=recipes[String(item.id)];
  const estimate=recipeUnitCost(recipe,inventory);
  // Extras/toppings need their own costs: fall back to configured percentage instead of undercounting.
  const hasExtras=Array.isArray(item.toppings)&&item.toppings.length>0;
  return {itemId:String(item.id??''),name:String(item.name||'Món không có tên').slice(0,300),qty,unitPrice:price,gross,index,percent:rateAt(settings,item.id,created),
    recipeCost:hasExtras?null:estimate.cost,recipeIssues:hasExtras?['Topping cần giá vốn riêng']:estimate.missing};
  
 });
 let revenue=money(order.beverageTotal)??money(order.total)??money(order.subtotal);
 const gross=lines.reduce((s,l)=>s+(l.gross||0),0);
 const invalid=!lines.length || lines.some(l=>!Number.isInteger(l.qty)||l.qty<=0||l.gross===null) || revenue===null || revenue>gross;
 if(revenue===null)revenue=0;
 const allocated=allocate(Math.min(revenue,gross),lines.map(l=>l.gross||0));
 for(const [i,line] of lines.entries()){
  line.revenue=allocated[i];
  line.cost=invalid?null:line.recipeCost!==null?Math.round(line.recipeCost*line.qty):
    line.percent===null?null:Math.round(line.gross*line.percent/100);
  line.costSource=line.cost===null?'missing':line.recipeCost!==null?'recipe':'percentage';
  line.profit=line.cost===null?null:line.revenue-line.cost;
 }
 const missing=lines.filter(l=>l.cost===null).length;
 const cost=lines.reduce((s,l)=>s+(l.cost||0),0);
 return {lines,revenue,gross,discount:Math.max(0,gross-revenue),cost:invalid||missing?null:cost,knownCost:cost,profit:invalid||missing?null:revenue-cost,missing,invalid};
}
function buildReport(orders,settings,day=vnDay(new Date()),recipes={},inventory={items:[]}){
 validDay(day);validateSettings(settings);
 const summary={received:0,completed:0,cancelled:0,pending:0,quantity:0,revenue:0,shipping:0,cost:0,profit:0,missingOrders:0,invalidOrders:0,legacyDateOrders:0,recipeLines:0,percentageLines:0};
 const reportOrders=[],itemMap=new Map();
 for(const order of orders){
  const created=order.createdAtIso||order.createdAt,createdDay=vnDay(created);
  if(createdDay===day)summary.received++;
  const done=order.status==='done',cancelled=order.status==='cancelled';
  const event=done?(order.completedAtIso||created):cancelled?(order.cancelledAtIso||created):created;
  if(vnDay(event)!==day)continue;
  const f=orderFinancials(order,settings,recipes,inventory);
  const row={id:String(order.id||''),status:String(order.status||'new'),createdAt:created||'',eventAt:event||'',dateFallback:(done&&!order.completedAtIso)||(cancelled&&!order.cancelledAtIso),amount:f.revenue,shipping:money(order.shippingFee)||0,revenue:done?f.revenue:0,cost:done?f.cost:null,profit:done?f.profit:null,discount:f.discount,missing:done?f.missing:0,invalid:done?f.invalid:false,lines:done?f.lines:[]};
  reportOrders.push(row);
  if(row.dateFallback)summary.legacyDateOrders++;
  if(cancelled){summary.cancelled++;continue;}
  if(!done){summary.pending++;continue;}
  summary.completed++;summary.revenue+=f.revenue;summary.shipping+=row.shipping;
  summary.cost+=f.knownCost;summary.profit+=f.profit??0;
  if(f.missing||f.invalid)summary.missingOrders++;
  if(f.invalid)summary.invalidOrders++;
  for(const line of f.lines){
   const key=line.itemId+'\u0000'+line.name;
   if(!itemMap.has(key))itemMap.set(key,{itemId:line.itemId,name:line.name,qty:0,gross:0,revenue:0,knownCost:0,knownProfit:0,missing:0,percents:[]});
   const m=itemMap.get(key);m.qty+=Number.isFinite(line.qty)?line.qty:0;m.gross+=line.gross||0;m.revenue+=line.revenue;
   summary.quantity+=Number.isFinite(line.qty)?line.qty:0;
   if(line.cost===null)m.missing++;else{m.knownCost+=line.cost;m.knownProfit+=line.profit;}
   if(line.costSource==='recipe')summary.recipeLines++;
   if(line.costSource==='percentage')summary.percentageLines++;
   if(!m.percents.includes(line.percent))m.percents.push(line.percent);
  }
 }
 const items=[...itemMap.values()].map(m=>({...m,cost:m.missing?null:m.knownCost,profit:m.missing?null:m.knownProfit,unitProfit:m.missing||!m.qty?null:m.knownProfit/m.qty})).sort((a,b)=>b.revenue-a.revenue);
 return {date:day,timeZone:'Asia/Ho_Chi_Minh',costing:'current_inventory_estimate_with_historical_percentage_fallback',summary:{...summary,cost:summary.missingOrders?null:summary.cost,profit:summary.missingOrders?null:summary.profit},orders:reportOrders.sort((a,b)=>String(b.eventAt).localeCompare(String(a.eventAt))),items};
}
module.exports={emptySettings,validateSettings,updateSettings,vnDay,validDay,rateAt,allocate,orderFinancials,buildReport};
