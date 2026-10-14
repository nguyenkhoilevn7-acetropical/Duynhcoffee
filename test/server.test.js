'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
test('HTTP menu/config save succeeds, empty values survive restart, private source blocked',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duynh-server-'));
 for(const name of ['server.js','drive-backup.js','receipt-verification.js','receipt-jobs.js','index.html','backup.html','privacy.html','terms.html'])fs.copyFileSync(path.join(__dirname,'..',name),path.join(dir,name));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 let child;
 async function start(){child=spawn(process.execPath,['server.js'],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port)}});await new Promise((resolve,reject)=>{child.stderr.on('data',d=>console.error(String(d)));child.stdout.on('data',()=>resolve());child.on('exit',c=>reject(Error('Exit '+c)));setTimeout(()=>reject(Error('Startup timeout')),5000).unref();});}
 async function stop(){if(child && child.exitCode===null){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});child=null;}}
 const base='http://127.0.0.1:'+port;
 try{
 await start();
 const menu=[{id:91,name:'Regression tea',price:23000,image:'x'.repeat(60)}];
 let r=await fetch(base+'/api/menu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(menu)});
 assert.equal(r.status,200);assert.equal((await r.json()).success,true);assert.deepEqual(await(await fetch(base+'/api/menu')).json(),menu);
 r=await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bankConfig:{accountHolder:'DAO KHUE NGUYEN'},banner:{images:[]}})});
 assert.equal(r.status,200);assert.equal((await r.json()).success,true);
 r=await fetch(base+'/api/menu',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'});assert.equal(r.status,200);
 for(const route of ['/server.js','/drive-backup.js','/receipt-jobs.js','/store_config.json','/api/backup/status']) assert.ok([401,404].includes((await fetch(base+route)).status));
 for(const route of ['/privacy.html','/terms.html','/backup.html']){const html=await(await fetch(base+route)).text();assert.match(html,/<\/body>\s*<\/html>\s*$/);}
 await stop();await start();assert.deepEqual(await(await fetch(base+'/api/menu')).json(),[]);
 const config=await(await fetch(base+'/api/config')).json();assert.equal(config.bankConfig.accountHolder,'DAO KHUE NGUYEN');assert.deepEqual(config.banner.images,[]);
 r=await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bankConfig:{accountHolder:'DAO KHOI NGUYEN'}})});
 const changed=await r.json();assert.equal(changed.config.bankConfig.accountHolder,'DAO KHOI NGUYEN');assert.ok(changed.configVersion);assert.equal(changed.config.bankConfig.bin,'970436');
 r=await fetch(base+'/api/verify-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:'not an image',items:[{id:91,qty:1}]})});assert.equal(r.status,422);assert.equal((await r.json()).isValid,false);
 r=await fetch(base+'/api/receipt-scans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:'not an image',items:[{id:91,qty:1}]})});assert.equal(r.status,422);
 r=await fetch(base+'/api/receipt-scans/unknown');assert.equal(r.status,404);
 r=await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'INVALID',total:1,receiptImage:'x',items:[{id:91,qty:1}]})});assert.equal(r.status,422);
 assert.deepEqual(await(await fetch(base+'/api/orders')).json(),[]);
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
