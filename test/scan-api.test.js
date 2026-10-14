'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
test('HTTP scan starts quickly, retries share work, and completed proof is server verified',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duynh-scan-api-'));
 for(const name of ['server.js','drive-backup.js','receipt-jobs.js','index.html'])fs.copyFileSync(path.join(__dirname,'..',name),path.join(dir,name));
 const verifier=path.join(__dirname,'..','receipt-verification.js');
 fs.writeFileSync(path.join(dir,'receipt-verification.js'),`const real=require(${JSON.stringify(verifier)}); module.exports={createReceiptVerifier:options=>real.createReceiptVerifier({...options,recognize:()=>new Promise(resolve=>setTimeout(()=>resolve('Số tiền 45.000đ\\nNgười nhận DAO KHOI NGUYEN'),80))})};`);
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const child=spawn(process.execPath,['server.js'],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port)}});
 try{
 await new Promise((resolve,reject)=>{child.stdout.on('data',resolve);child.once('exit',c=>reject(Error('Exit '+c)));setTimeout(()=>reject(Error('Startup timeout')),5000).unref();});
 const base='http://127.0.0.1:'+port;
 const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/api/menu',[{id:1,name:'Tea',price:45000}])).status,200);
 assert.equal((await post('/api/config',{bankConfig:{accountHolder:'DAO KHOI NGUYEN'}})).status,200);
 const body={image:'data:image/png;base64,YWJj',items:[{id:1,qty:1}],expectedAmount:1,expectedHolder:'WRONG'};
 let response=await post('/api/receipt-scans',body);assert.equal(response.status,202);
 const pending=await response.json();assert.equal(pending.status,'pending');assert.ok(!pending.result);assert.ok(!pending.image);
 const retry=await(await post('/api/receipt-scans',body)).json();assert.equal(retry.jobId,pending.jobId);
 await new Promise(resolve=>setTimeout(resolve,120));
 const completed=await(await fetch(base+'/api/receipt-scans/'+pending.jobId)).json();
 assert.equal(completed.status,'complete');assert.equal(completed.result.isValid,true);assert.ok(completed.result.verificationToken);
 const cached=await(await post('/api/receipt-scans',body)).json();assert.equal(cached.status,'complete');assert.equal(cached.jobId,pending.jobId);
 await post('/api/config',{bankConfig:{accountHolder:'DAO KHUE NGUYEN'}});
 const changed=await(await post('/api/receipt-scans',body)).json();assert.notEqual(changed.jobId,pending.jobId);
 await new Promise(resolve=>setTimeout(resolve,120));
 const rejected=await(await fetch(base+'/api/receipt-scans/'+changed.jobId)).json();assert.equal(rejected.result.isValid,false);assert.ok(!rejected.result.verificationToken);
 }finally{if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});fs.rmSync(dir,{recursive:true,force:true});}
});
