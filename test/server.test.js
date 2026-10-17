'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
test('HTTP menu/config save succeeds, empty values survive restart, private source blocked',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duynh-server-'));
 for(const name of ['server.js','drink-recipes.js','menu-options.js','menu-ai.js','delivery.js','admin-push.js','order-notifications-sw.js','admin-notifications.js','drive-backup.js','receipt-verification.js','receipt-jobs.js','index.html','site-i18n.js','backup.html','privacy.html','terms.html'])fs.copyFileSync(path.join(__dirname,'..',name),path.join(dir,name));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 let child;
 async function start(){child=spawn(process.execPath,['server.js'],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port)}});await new Promise((resolve,reject)=>{child.stderr.on('data',d=>console.error(String(d)));child.stdout.on('data',()=>resolve());child.on('exit',c=>reject(Error('Exit '+c)));setTimeout(()=>reject(Error('Startup timeout')),5000).unref();});}
 async function stop(){if(child && child.exitCode===null){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});child=null;}}
 const base='http://127.0.0.1:'+port;
 try{
 await start();
 const health=await fetch(base+'/api/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
 const bundle=await fetch(base+'/site-i18n.js');assert.equal(bundle.status,200);assert.match(bundle.headers.get('content-type'),/javascript/);assert.match(await bundle.text(),/DuynhI18n/);
 const worker=await fetch(base+'/order-notifications-sw.js');assert.equal(worker.status,200);assert.match(worker.headers.get('content-type'),/javascript/);assert.match(await worker.text(),/showNotification/);
 assert.ok((await(await fetch(base+'/api/admin-push/key')).json()).publicKey);
 assert.equal((await fetch(base+'/api/admin-push/subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 const signed=await(await fetch(base+'/api/admin-push/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'duynh2026'})})).json();assert.ok(signed.token);
 const aiHeaders={Authorization:'Bearer '+signed.token,'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/api/menu-ai/status')).status,401);
 assert.equal((await(await fetch(base+'/api/menu-ai/status',{headers:aiHeaders})).json()).configured,false);
 assert.equal((await fetch(base+'/api/menu-ai/generate',{method:'POST',headers:aiHeaders,body:JSON.stringify({name:'Trà xoài'})})).status,503);
 const pushStatus=await(await fetch(base+'/api/admin-push/status',{headers:{Authorization:'Bearer '+signed.token}})).json();assert.equal(pushStatus.enabled,false);
 assert.equal((await fetch(base+'/api/admin-push/session',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:'{}'})).status,403);
 const menu=[{id:91,name:'Regression tea',price:23000,image:'x'.repeat(60)}];
 let r=await fetch(base+'/api/menu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(menu)});
 assert.equal(r.status,200);assert.equal((await r.json()).success,true);assert.deepEqual(await(await fetch(base+'/api/menu')).json(),menu);
 r=await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bankConfig:{accountHolder:'DAO KHUE NGUYEN'},banner:{images:[]}})});
 assert.equal(r.status,200);assert.equal((await r.json()).success,true);
 const picture='https://example.test/banner.jpg', clip='data:video/mp4;base64,'+Buffer.alloc(256*1024).toString('base64');
 r=await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({banner:{images:[picture]}})});assert.equal(r.status,200);
 r=await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({banner:{images:[picture,clip]}})});assert.equal(r.status,422);
 assert.deepEqual((await(await fetch(base+'/api/config')).json()).banner.images,[picture]);
 await stop();const legacy=JSON.parse(fs.readFileSync(path.join(dir,'store_config.json'),'utf8'));legacy.banner.images.push(clip);fs.writeFileSync(path.join(dir,'store_config.json'),JSON.stringify(legacy));await start();
 const cleaned=await(await fetch(base+'/api/config')).json();assert.deepEqual(cleaned.banner.images,[picture]);assert.ok(JSON.stringify(cleaned).length<clip.length);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'store_config.json'),'utf8')).banner.images,[picture]);
 await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({banner:{images:[]}})});
 r=await fetch(base+'/api/menu',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'});assert.equal(r.status,200);
 for(const route of ['/server.js','/menu-ai.js','/delivery.js','/admin-push.js','/.admin-push.json','/drive-backup.js','/receipt-jobs.js','/store_config.json','/api/backup/status']) assert.ok([401,404].includes((await fetch(base+route)).status));
 for(const route of ['/privacy.html','/terms.html','/backup.html']){const html=await(await fetch(base+route)).text();assert.match(html,/<\/body>\s*<\/html>\s*$/);}
 await stop();await start();assert.deepEqual(await(await fetch(base+'/api/menu')).json(),[]);
 const config=await(await fetch(base+'/api/config')).json();assert.equal(config.bankConfig.accountHolder,'DAO KHUE NGUYEN');assert.deepEqual(config.banner.images,[]);
 r=await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bankConfig:{accountHolder:'DAO KHOI NGUYEN'}})});
 const payment=await(await fetch(base+'/api/payment-config')).json();assert.equal(payment.bankConfig.accountHolder,'DAO KHOI NGUYEN');assert.deepEqual(Object.keys(payment),['bankConfig']);
 const changed=await r.json();assert.equal(changed.config.bankConfig.accountHolder,'DAO KHOI NGUYEN');assert.ok(changed.configVersion);assert.equal(changed.config.bankConfig.bin,'970436');
 r=await fetch(base+'/api/verify-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:'not an image',items:[{id:91,qty:1}]})});assert.equal(r.status,422);assert.equal((await r.json()).isValid,false);
 r=await fetch(base+'/api/receipt-scans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:'not an image',items:[{id:91,qty:1}]})});assert.equal(r.status,422);
 r=await fetch(base+'/api/receipt-scans/unknown');assert.equal(r.status,404);
 r=await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'INVALID',total:1,receiptImage:'x',items:[{id:91,qty:1}]})});assert.equal(r.status,422);
 assert.deepEqual(await(await fetch(base+'/api/orders')).json(),[]);
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});

