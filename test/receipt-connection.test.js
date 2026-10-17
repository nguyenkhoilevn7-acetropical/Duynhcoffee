'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('    async function runClientVerifyData'),html.indexOf('    function handleReceiptImageUpload'));
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const pending=id=>({jobId:id,status:'pending'}),complete=(id,isValid=true)=>({jobId:id,status:'complete',result:{isValid,matchedAmount:isValid,matchedRecipient:isValid,...(isValid?{verificationToken:'server-proof',detectedAmount:45000,expectedAmount:45000}:{})}});
function setup(handler){
 let clock=0,next=0;const calls=[],timeouts=[],timers=new Map(),progress=[];
 const s={AbortController,TypeError,Date:{now:()=>clock},cart:[{item:{id:1},qty:1}],activeDiscount:null,getCloudApiUrl:p=>p,
  setTimeout(fn,ms){const id=++next;timers.set(id,fn);timeouts.push(ms);if(ms<=5000)queueMicrotask(()=>{if(timers.delete(id)){clock+=ms;fn();}});return id;},
  clearTimeout:id=>timers.delete(id),fetch:async(path,options)=>{calls.push({path,options});return handler({path,options,index:calls.length,budget:timeouts.at(-1),advance:ms=>clock+=ms});}};
 vm.createContext(s);vm.runInContext(source,s);
 return {s,calls,timeouts,progress,run:(amount=45000)=>s.runClientVerifyData('data:image/jpeg;base64,YWJj',amount,(...args)=>progress.push(args)),get clock(){return clock;}};
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

test('a success flag for 45000 cannot approve a checkout that expects 53000 or omits evidence',async()=>{
 for (const fields of [{detectedAmount:45000,expectedAmount:53000},{detectedAmount:53000,expectedAmount:45000},{detectedAmount:undefined},{expectedAmount:undefined}]) {
  const f=setup(()=>{const job=complete('wrong');Object.assign(job.result,fields);return response(job);});
  const result=await f.run();assert.equal(result.isValid,false);assert.equal(result.matchedAmount,false);assert.equal(result.verificationToken,undefined);
 }
});

test('client sends selected toppings and compares the same 53000 payable amount',async()=>{
 const f=setup(({options})=>{const body=JSON.parse(options.body);assert.equal(body.items[0].toppings[0].id,'Trân Châu Trắng');const job=complete('with-topping');job.result.detectedAmount=job.result.expectedAmount=53000;return response(job);});
 f.s.cart[0].toppings=[{id:'Trân Châu Trắng',price:8000}];assert.equal((await f.run(53000)).isValid,true);
 const legacy=setup(()=>response(complete('base-price-only')));const result=await legacy.run(53000);assert.equal(result.isValid,false);assert.equal(result.verificationToken,undefined);
});

test('client timing keeps server OCR and queue timing distinct from request duration',async()=>{
 const f=setup(({advance})=>{advance(1400);const job=complete('timed');job.queueMs=300;job.result.processingMs=900;return response(job);});
 const r=await f.run();assert.equal(r.scanTiming.serverMs,900);assert.equal(r.scanTiming.queueMs,300);assert.equal(r.scanTiming.requestMs,1400);assert.equal(r.scanTiming.reusedJob,true);assert.equal(r.isValid,true);
});

test('client forwards actual OCR progress and returns non-receipt outcome without retrying upload',async()=>{
 const f=setup(({index})=>index===1?response({jobId:'p',status:'pending',progress:{percent:12,phase:'preparing'}},202):index===2?response({jobId:'p',status:'pending',progress:{percent:48,phase:'recognizing'}}):response({jobId:'p',status:'complete',result:{isValid:false,nonReceipt:true,reason:'Not a bank receipt'}}));
 const r=await f.run();assert.equal(r.nonReceipt,true);assert.equal(r.isValid,false);assert.ok(f.progress.some(x=>x[0]===12));assert.ok(f.progress.some(x=>x[0]===48));assert.equal(f.calls.filter(x=>x.options.method==='POST').length,1);
});
