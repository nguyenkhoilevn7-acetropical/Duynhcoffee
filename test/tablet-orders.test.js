'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function checkout(){
 const button={textContent:'Gửi đơn',disabled:false,setAttribute(){},removeAttribute(){}};
 const writes=[],alerts=[];
 const s={window:{},AbortController,setTimeout,clearTimeout,document:{getElementById:id=>id==='btn-submit-customer-order'?button:null},
 cart:[{item:{id:1,name:'Tea',price:45000,image:'data:image/jpeg;base64,'+'A'.repeat(200000)},qty:1}],currentDeliveryAddress:'Address',currentCustomerReceiptBase64:'receipt',isReceiptValid:true,receiptVerificationToken:'token',receiptVerificationContext:'context',paymentContext:()=> 'context',activeDiscount:null,getSelectedShippingFee:()=>0,currentPendingOrderId:'ORD-RETRY',orders:[],selectedDeliveryPartner:'ahamove',currentDistanceKm:1,menu:[],localStorage:{setItem(){}},getCloudApiUrl:p=>p,fetch:async(url,opts)=>{writes.push(JSON.parse(opts.body));return{ok:true,json:async()=>({success:true})};},saveLocalData(){},updateCartBadge(){},closePaymentCheckoutModal(){},playSuccessChime(){},alert:m=>alerts.push(m),formatMoney:String,renderCustomerProducts(){},renderAllBackendTabs(){},openOrderTrackingModal(){}};
 vm.createContext(s);vm.runInContext(html.slice(html.indexOf('    async function submitCustomerOrderWithBill()'),html.indexOf('    // ==================== QUẢN LÝ QUẢN TRỊ')),s);
 return{s,button,writes,alerts};
}
test('slow submit locks immediately, ignores repeated taps and excludes embedded product photos',async()=>{
 const {s,button}=checkout();let finish,count=0,payload;
 s.fetch=async(url,opts)=>{count++;payload=JSON.parse(opts.body);return new Promise(r=>{finish=()=>r({ok:true,json:async()=>({success:true})});});};
 const first=s.submitCustomerOrderWithBill();assert.equal(button.disabled,true);assert.match(button.textContent,/Đang gửi/);
 await s.submitCustomerOrderWithBill();assert.equal(count,1);assert.equal(payload.items[0].image,'');assert.ok(JSON.stringify(payload).length<2000);
 // WebSocket may deliver the saved order before its HTTP acknowledgement.
 s.orders.push({...payload});finish();await first;assert.equal(s.orders.length,1);assert.equal(s.cart.length,0);
});
test('lost response retries the identical payload once; persistent failure retains cart and ID',async()=>{
 const c=checkout();let calls=0;const payloads=[];
 c.s.fetch=async(url,opts)=>{calls++;payloads.push(opts.body);if(calls===1)throw Error('network');return{ok:true,json:async()=>({success:true})};};
 await c.s.submitCustomerOrderWithBill();assert.equal(calls,2);assert.equal(payloads[0],payloads[1]);assert.equal(c.s.orders[0].id,'ORD-RETRY');
 const failed=checkout();failed.s.fetch=async()=>{throw Error('offline');};await failed.s.submitCustomerOrderWithBill();assert.equal(failed.s.cart.length,1);assert.equal(failed.s.currentPendingOrderId,'ORD-RETRY');assert.equal(failed.button.disabled,false);assert.equal(failed.s.window.__orderSubmitInFlight,false);
});
test('order IDs are independent of local order counts on simultaneous devices',()=>{
 const start=html.indexOf('    function createCustomerOrderId()'),end=html.indexOf('\n    }',start)+6;
 const s={};vm.createContext(s);vm.runInContext(html.slice(start,end),s);
 const ids=new Set(Array.from({length:200},()=>s.createCustomerOrderId()));assert.equal(ids.size,200);for(const id of ids)assert.match(id,/^ORD-[A-Z0-9-]+$/);
});
test('HTTP repair runs even with an apparently live socket and requests conditional deltas',async()=>{
 let url,count=0;
 const s={wsClient:{readyState:1},isInitialLoadDone:true,lastMenuVersion:1,lastOrdersVersion:2,lastConfigVersion:3,lastDiscountsVersion:4,AbortController,setTimeout,clearTimeout,getCloudApiUrl:p=>p,fetch:async p=>{url=p;count++;return{ok:true,json:async()=>({notModified:true})};},updateCloudSyncIndicator(){}};
 vm.createContext(s);vm.runInContext(html.slice(html.indexOf('    let fullSyncInFlight'),html.indexOf('    // ==================== XỬ LÝ DỮ LIỆU')),s);
 await s.pullFullSyncFromServer();assert.equal(count,1);assert.match(url,/delta=1/);assert.match(url,/ov=2/);
});
test('real stylesheet allows complete names/descriptions and auto-height admin actions at enlarged font sizes',()=>{
 const dom=new JSDOM(html);try{
 const d=dom.window.document,wrap=d.createElement('div');wrap.innerHTML='<div class="product-info"><div class="product-name">Mom’s Preserved Plum Kumquat Tea With Additional Toppings</div><div class="product-desc">A long bilingual description on a Samsung tablet with large text.</div></div><div class="backend-order-card"><button style="height:42px">Xem Bill Chuyển Khoản</button></div>';d.body.append(wrap);
 for(const selector of ['.product-name','.product-desc']){const style=dom.window.getComputedStyle(wrap.querySelector(selector));assert.equal(style.height,'auto');assert.equal(style.overflow,'visible');assert.equal(style.display,'block');}
 // The explicit override wins over fixed inline heights in actual browser CSS.
 assert.match(d.getElementById('responsive-order-text-fix').textContent,/backend-order-card button\{height:auto!important/);
 }finally{dom.window.close();}
});
