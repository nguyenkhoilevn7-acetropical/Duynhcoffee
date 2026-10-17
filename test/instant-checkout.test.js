'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
test('checkout renders synchronously while payment request is pending, gates stale QR, retries and coalesces requests',async()=>{
 const dom=new JSDOM(html),document=dom.window.document;let resolve,requests=0;
 const s={window:dom.window,document,AbortController,setTimeout,clearTimeout,alert(){},cart:[{qty:1,item:{id:1,price:42000}}],orders:[],storeConfig:{bankConfig:{accountNumber:'old',accountHolder:'Old'}},currentDistanceKm:0,currentDeliveryAddress:'',hideFloatingCartNow(){},closeCartDrawer(){},calculateShippingFees:()=>({feeAhamove:1,feeLalamove:1}),formatMoney:String,updateShipFeeDisplay(){},updateGoogleMapsPreview(){},updateCheckoutFinancials(){},renderCheckoutItemsPreview(){},getCloudApiUrl:p=>p,applyServerConfig:c=>s.storeConfig={...s.storeConfig,...c},fetch:path=>{assert.equal(path,'/api/payment-config');requests++;return new Promise(r=>resolve=r);}};
 vm.createContext(s);vm.runInContext(html.slice(html.indexOf('    let activeModalCount'),html.indexOf('    // GỬI ĐƠN HÀNG')),s);
 try{
 const opened=s.openPaymentCheckoutModal();assert.equal(document.getElementById('checkout-modal').style.display,'flex');await opened;
 assert.equal(requests,1);assert.equal(document.getElementById('checkout-payment-details').style.display,'none');assert.equal(document.getElementById('receipt-file-input').disabled,true);
 await s.openPaymentCheckoutModal();assert.equal(requests,1);
 const refresh=s.refreshCheckoutPaymentConfig();resolve({ok:true,json:async()=>({bankConfig:{accountNumber:'fresh',accountHolder:'Fresh recipient'}})});await refresh;
 assert.equal(document.getElementById('checkout-payment-details').style.display,'');assert.equal(document.getElementById('receipt-file-input').disabled,false);assert.equal(s.storeConfig.bankConfig.accountNumber,'fresh');
 const failed=s.refreshCheckoutPaymentConfig();resolve({ok:false});await new Promise(setImmediate);assert.equal(requests,3);resolve({ok:false});await failed;assert.equal(document.getElementById('checkout-payment-details').style.display,'none');assert.equal(document.getElementById('checkout-bank-retry').style.display,'');assert.equal(document.getElementById('checkout-modal').style.display,'flex');
 const retry=s.refreshCheckoutPaymentConfig();resolve({ok:true,json:async()=>({bankConfig:{accountNumber:'fresh',accountHolder:'Fresh recipient'}})});await retry;assert.equal(document.getElementById('receipt-file-input').disabled,false);
 const transient=s.refreshCheckoutPaymentConfig();resolve({ok:false});await new Promise(setImmediate);assert.equal(document.getElementById('checkout-bank-retry').style.display,'none');resolve({ok:true,json:async()=>({bankConfig:{accountNumber:'recovered',accountHolder:'Recovered recipient'}})});await transient;assert.equal(s.storeConfig.bankConfig.accountNumber,'recovered');assert.equal(document.getElementById('checkout-payment-details').style.display,'');assert.equal(document.getElementById('receipt-file-input').disabled,false);
 }finally{dom.window.close();}
});
