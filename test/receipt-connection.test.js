'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('    async function runClientVerifyData'),html.indexOf('    function handleReceiptImageUpload'));
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const pending=id=>({jobId:id,status:'pending'}),complete=(id,isValid=true)=>({jobId:id,status:'complete',result:{isValid,matchedAmount:isValid,matchedRecipient:isValid,...(isValid?{verificationToken:'server-proof'}:{})}});
function setup(handler){
 let clock=0,next=0;const calls=[],timeouts=[],timers=new Map(),progress=[];
 const s={AbortController,TypeError,Date:{now:()=>clock},cart:[{item:{id:1},qty:1}],activeDiscount:null,getCloudApiUrl:p=>p,
  setTimeout(fn,ms){const id=++next;timers.set(id,fn);timeouts.push(ms);if(ms<=5000)queueMicrotask(()=>{if(timers.delete(id)){clock+=ms;fn();}});return id;},
  clearTimeout:id=>timers.delete(id),fetch:async(path,options)=>{calls.push({path,options});return handler({path,options,index:calls.length,budget:timeouts.at(-1),advance:ms=>clock+=ms});}};
 vm.createContext(s);vm.runInContext(source,s);
 return {calls,timeouts,progress,run:()=>s.runClientVerifyData('data:image/jpeg;base64,YWJj',45000,(...args)=>progress.push(args)),get clock(){return clock;}};
}
test('lost upload response retries identical input and receives completed server job automatically',async()=>{
 const f=setup(({index,advance})=>{if(index===1){advance(45000);throw Object.assign(Error('upload timeout'),{name:'AbortError'});}return response(complete('same'));});
 const result=await f.run();assert.equal(result.isValid,true);assert.equal(result.verificationToken,'server-proof');
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.body,f.calls[1].options.body);assert.ok(f.timeouts.includes(45000));assert.ok(f.progress.some(p=>p[1].includes('tự kết nối')));
});
test('temporary gateway HTML and polling disconnects keep the accepted job rather than uploading again',async()=>{
 const f=setup(({index})=>{
  if(index===1)return response(pending('one'),202);
  if(index===2)return{ok:false,status:502,json:async()=>{throw new SyntaxError('HTML gateway error');}};
  if(index===3)throw new TypeError('Network disconnected');
  return response(complete('one'));
 });
 assert.equal((await f.run()).isValid,true);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
 assert.ok(f.calls.slice(1).every(c=>c.path==='/api/receipt-scans/one'));
});
test('queued scan may take over sixty seconds and still returns authoritative rejection',async()=>{
 const f=setup(({index,advance})=>{if(index===1)return response(pending('queued'),202);advance(30000);return response(index<4?pending('queued'):complete('queued',false));});
 const result=await f.run();assert.ok(f.clock>60000);assert.equal(result.isValid,false);assert.equal(result.verificationUnavailable,undefined);assert.equal(result.verificationToken,undefined);
});
test('one server restart recreates missing job with the same input and then retrieves its result',async()=>{
 const f=setup(({index})=>response(index===1?pending('old'):index===2?{error:'Server restarted'}:index===3?pending('new'):complete('new'),index===2?404:200));
 assert.equal((await f.run()).isValid,true);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,2);assert.equal(f.calls[0].options.body,f.calls[2].options.body);assert.equal(f.calls[3].path,'/api/receipt-scans/new');
});
test('validation errors are not retried and never unlock payment',async()=>{
 const f=setup(()=>response({error:'Giỏ hàng không hợp lệ'},422)),result=await f.run();
 assert.equal(f.calls.length,1);assert.equal(result.isValid,false);assert.equal(result.verificationUnavailable,true);assert.equal(result.verificationToken,undefined);assert.match(result.reason,/Giỏ hàng/);
});
test('persistent disconnection terminates within the overall deadline and never invents a verification token',async()=>{
 const f=setup(({advance,budget})=>{advance(budget);throw Object.assign(Error('timeout'),{name:'AbortError'});}),result=await f.run();
 assert.ok(f.clock<=180000);assert.ok(f.calls.length<=4);assert.equal(result.isValid,false);assert.equal(result.verificationUnavailable,true);assert.equal(result.verificationToken,undefined);
});
