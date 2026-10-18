'use strict';
// Local synthetic traffic only. Never accepts an external target URL.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process'),{PNG}=require('pngjs');
const root=path.resolve(__dirname,'..'),count=Math.min(100,Math.max(1,Number(process.env.TEST_ORDERS)||100));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]||0;
async function scenario(mode,baseline){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mom-load-test-'));for(const n of fs.readdirSync(root))if(/\.(js|css|html)$/.test(n))fs.copyFileSync(path.join(root,n),path.join(dir,n));
 fs.cpSync(path.join(root,'ocr-data'),path.join(dir,'ocr-data'),{recursive:true});
 if(baseline)for(const n of ['server.js','receipt-verification.js','receipt-jobs.js'])fs.copyFileSync(path.join(baseline,n),path.join(dir,n));
 const write=(n,v)=>fs.writeFileSync(path.join(dir,n),JSON.stringify(v));
 write('menu.json',[{id:1,name:'Synthetic load test tea',price:50000,stock:9999}]);write('orders.json',[]);write('discounts.json',[]);write('store_config.json',{adminAccount:{username:'qa-owner',password:'qa-password-only'},bankConfig:{accountHolder:'DAO KHOI NGUYEN'},banner:{images:[]}});
 const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});const base='http://127.0.0.1:'+port;
 fs.writeFileSync(path.join(dir,'.qa-metrics.cjs'),"setInterval(()=>{if(process.send)process.send({rss:process.memoryUsage().rss});},100).unref();");
 const child=spawn(process.execPath,['--require',path.join(dir,'.qa-metrics.cjs'),'server.js'],{cwd:dir,env:{PATH:process.env.PATH,NODE_PATH:process.env.NODE_PATH||'',PORT:String(port)},stdio:['ignore','pipe','pipe','ipc']});child.stderr.on('data',()=>{});child.stdout.on('data',()=>{});
 let peakRss=0;child.on('message',m=>{if(Number.isFinite(m.rss))peakRss=Math.max(peakRss,m.rss);});const monitor=setInterval(()=>{try{const m=fs.readFileSync('/proc/'+child.pid+'/status','utf8').match(/VmRSS:\s+(\d+)/);if(m)peakRss=Math.max(peakRss,Number(m[1])*1024);}catch{}},100);
 const headers={'Content-Type':'application/json'},post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,body:await r.json()};};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await pause(50);}
  await pause(500);
  const original=PNG.sync.read(fs.readFileSync(path.join(root,'test/fixtures/synthetic-bank-receipt.png')));
  const cases=Array.from({length:count},(_,i)=>{const p=new PNG({width:original.width,height:original.height});original.data.copy(p.data);p.data[0]=i;p.data[1]=255-i;const bytes=PNG.sync.write(p);return {id:'ORD-'+(10000+i),submissionKey:'local-synthetic-'+i,image:'data:image/png;base64,'+bytes.toString('base64'),items:[{id:1,name:'Synthetic load test tea',qty:1,price:50000,total:50000}],payableAmount:50000,beverageTotal:50000,total:50000,shippingFee:0,createdAtIso:new Date().toISOString()};});
  let accepted=0,rejected=0,failed=0,duplicates=0;const elapsed=[],ocr=[],queue=[],ack=[],savedIds=[];const begin=performance.now();
  async function run(c){const start=performance.now();let scan;let tries=0;do{scan=await post('/api/receipt-scans',c);if(!baseline&&scan.status===429){await pause(Math.min(500*2**Math.min(tries++,3),4000)*(0.7+Math.random()*.6));}}while(!baseline&&scan.status===429&&performance.now()-start<180000);if(scan.status!==200&&scan.status!==202){rejected++;return;}
   accepted++;let job=scan.body;
   while(job.status==='pending'&&performance.now()-start<300000){const r=await fetch(base+'/api/receipt-scans/'+job.jobId+'?waitMs=4000',{signal:AbortSignal.timeout(10000)});if(!r.ok){failed++;return;}job=await r.json();}
   if(job.status!=='complete'||!job.result?.isValid){failed++;return;}
   ocr.push(job.result.processingMs);queue.push(job.queueMs||0);
   if(baseline){elapsed.push(Math.round(performance.now()-start));return;}
   const payload={...c,image:undefined,payableAmount:undefined,receiptImage:c.image,verificationToken:job.result.verificationToken,status:'new'},saveStart=performance.now();
   const result=await post('/api/orders',payload);ack.push(Math.round(performance.now()-saveStart));if(result.status!==200){failed++;return;}savedIds.push(result.body.orderId);
   // Confirm retrying a lost response does not create a second order.
   if(c===cases[0]){const again=await post('/api/orders',payload);if(again.status===200&&again.body.orderId===result.body.orderId)duplicates++;else failed++;}
   elapsed.push(Math.round(performance.now()-start));
  }
  if(mode==='burst')await Promise.all(cases.map(run));else for(const c of cases)await run(c);
  const orders=JSON.parse(fs.readFileSync(path.join(dir,'orders.json'))),unique=new Set(orders.map(o=>o.id));
  if(!baseline&&(orders.length!==count||unique.size!==count||savedIds.length!==count||failed||rejected))throw Error('Missing, duplicate or rejected orders: '+JSON.stringify({saved:orders.length,unique:unique.size,failed,rejected}));
  const result={mode:baseline?'baseline-burst':mode==='burst'?'100-concurrent':'100-sequential',requested:count,accepted,rejected,failed,savedOrders:orders.length,uniqueOrders:unique.size,duplicateRetryPassed:duplicates,totalSeconds:+((performance.now()-begin)/1000).toFixed(2),endToEndMs:{p50:percentile(elapsed,.5),p95:percentile(elapsed,.95),max:Math.max(0,...elapsed)},ocrMs:{p50:percentile(ocr,.5),p95:percentile(ocr,.95)},queueMs:{p95:percentile(queue,.95),max:Math.max(0,...queue)},orderSaveMs:{p95:percentile(ack,.95)},peakProcessRssMB:+(peakRss/1048576).toFixed(1),averageImageBytes:Math.round(cases.reduce((s,c)=>s+c.image.length,0)/count*.75)};
  console.log(JSON.stringify(result));return result;
 }finally{clearInterval(monitor);if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{const results=[];if(process.env.TEST_BASELINE_DIR)results.push(await scenario('burst',process.env.TEST_BASELINE_DIR));if(process.env.TEST_MODE!=='burst')results.push(await scenario('sequential'));if(process.env.TEST_MODE!=='sequential')results.push(await scenario('burst'));if(process.env.TEST_REPORT_PATH)fs.writeFileSync(process.env.TEST_REPORT_PATH,JSON.stringify({note:'Synthetic PNG receipts; real local Tesseract OCR and HTTP order writes. Not a Render benchmark. Sequential traffic compresses a daily volume and does not simulate a full day of arrivals.',results},null,2));})().catch(error=>{console.error(error);process.exitCode=1;});
