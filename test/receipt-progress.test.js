'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
test('receipt upload is amber while pending, elapsed counter moves, progress never reverses, unrelated image finishes red and cancels timer',async()=>{
 const dom=new JSDOM(html),d=dom.window.document;let clock=0,timerId=0,compress,finish,report;const timers=new Map();
 const s={window:{},document:d,Date:{now:()=>clock},checkoutPaymentReady:true,receiptScanGeneration:0,receiptVerificationToken:null,receiptVerificationContext:null,isReceiptValid:false,currentCustomerReceiptBase64:null,activeReceiptScanTimers:[],cart:[{item:{price:42000},qty:1}],activeDiscount:null,storeConfig:{bankConfig:{accountHolder:'DAO KHOI NGUYEN'}},formatMoney:x=>x+' đ',paymentContext:()=> 'current',showSmsToast(){},playAudioChime(){},playSuccessChime(){},setInterval(fn){timers.set(++timerId,fn);return timerId;},clearInterval(id){timers.delete(id);},clearActiveReceiptScanTimers(){for(const id of s.activeReceiptScanTimers)timers.delete(id);s.activeReceiptScanTimers=[];},compressReceiptImage(file,cb){compress=cb;},invalidateReceiptVerification(){s.receiptScanGeneration++;s.clearActiveReceiptScanTimers();},runClientVerifyData:async(img,amount,cb)=>{report=cb;return new Promise(r=>finish=r);},console:{info(){}}};
 vm.createContext(s);vm.runInContext(html.slice(html.indexOf('    function handleReceiptImageUpload'),html.indexOf('    window.handleReceiptImageUpload')),s);
 try{
 s.handleReceiptImageUpload({size:100,type:'image/jpeg'});assert.equal(d.getElementById('receipt-upload-box').classList.contains('processing'),true);assert.equal(timers.size,1);
 const work=compress('data:image/jpeg;base64,YWJj');report(42,'Đang nhận dạng chữ trong ảnh...');clock=1500;[...timers.values()][0]();assert.match(d.getElementById('ai-scan-step-ticker').textContent,/42%.*1.5 giây/);
 report(20,'Read again');assert.match(d.getElementById('ai-scan-step-ticker').textContent,/42%/);assert.equal(d.getElementById('btn-submit-customer-order').disabled,true);
 finish({isValid:false,nonReceipt:true,reason:'Not a bank receipt'});await work;assert.equal(timers.size,0);assert.equal(d.getElementById('receipt-upload-box').classList.contains('error'),true);assert.equal(d.getElementById('btn-submit-customer-order').disabled,true);assert.equal(s.isReceiptValid,false);assert.equal(s.receiptVerificationToken,null);
 s.handleReceiptImageUpload({size:100,type:'image/jpeg'});const validWork=compress('data:image/jpeg;base64,ZGVm');finish({isValid:true,verificationToken:'proof',matchedHolder:'DAO KHOI NGUYEN',detectedAmount:42000,scanTiming:{serverMs:500}});await validWork;assert.equal(timers.size,0);assert.equal(s.isReceiptValid,true);assert.equal(d.getElementById('receipt-upload-box').classList.contains('valid'),true);
 }finally{dom.window.close();}
});
