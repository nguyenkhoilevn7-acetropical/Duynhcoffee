'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process');
test('finance API: authentication, persistence, concurrent devices, export and public-data isolation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profit-api-'));
 for(const name of fs.readdirSync(path.join(__dirname,'..')))if(/\.(js|css|html)$/.test(name))fs.copyFileSync(path.join(__dirname,'..',name),path.join(dir,name));
 const write=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data));
 write('menu.json',[{id:1,name:'QA Tea',price:50000}]);write('store_config.json',{adminAccount:{username:'qa-owner',password:'qa-password-only'},banner:{images:[]}});
 write('orders.json',[{id:'ORD-12345',status:'done',createdAtIso:'2026-10-18T01:00:00Z',completedAtIso:'2026-10-18T03:00:00Z',beverageTotal:100000,items:[{id:1,name:'QA Tea',qty:2,price:50000,total:100000}]}]);
 const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 let child;const base='http://127.0.0.1:'+port;
 async function start(){child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,PORT:String(port),GEMINI_API_KEY:'',GOOGLE_DRIVE_REFRESH_TOKEN:''}});await new Promise((r,j)=>{child.stdout.once('data',r);child.once('exit',c=>j(Error('Server exit '+c)));setTimeout(()=>j(Error('Startup timeout')),5000).unref();});}
 async function stop(){if(child?.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});}
 try{
 await start();for(const route of ['/api/admin/profits','/api/admin/profits/export','/api/admin/profits/settings'])assert.equal((await fetch(base+route)).status,401);
 for(const file of ['/profit-report.js','/profit-excel.js','/profit-settings.json','/%70rofit-settings.json'])assert.equal((await fetch(base+file)).status,404);
 const login=await(await fetch(base+'/api/admin-push/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qa-owner',password:'qa-password-only'})})).json();assert.ok(login.token);
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+login.token};
 const report=()=>fetch(base+'/api/admin/profits?date=2026-10-18',{headers}).then(r=>r.json());
 const before=await report();assert.equal(before.report.summary.profit,null);
 const payload={version:before.version,items:[{itemId:'1',percent:25}]};
 let r=await fetch(base+'/api/admin/profits/settings',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(r.status,200);const version=(await r.json()).version;
 r=await fetch(base+'/api/admin/profits/settings',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(r.status,409);
 const after=await report();assert.equal(after.report.summary.profit,75000);assert.equal(after.report.orders[0].profit,75000);assert.equal(after.report.items[0].unitProfit,37500);assert.equal(after.version,version);
 r=await fetch(base+'/api/admin/profits/export?date=2026-10-18',{headers});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/spreadsheetml/);assert.match(r.headers.get('content-disposition'),/2026-10-18.xlsx/);assert.equal(Buffer.from(await r.arrayBuffer()).readUInt32LE(0),0x04034b50);
 assert.equal((await fetch(base+'/api/admin/profits?date=bad',{headers})).status,400);
 for(const route of ['/api/menu','/api/config','/api/orders','/api/sync'])assert.doesNotMatch(await(await fetch(base+route)).text(),/profitSettings|"rates"|"percent":25|"cost"|"profit"/);
 await stop();await start();assert.equal((await report()).report.summary.profit,75000);
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
