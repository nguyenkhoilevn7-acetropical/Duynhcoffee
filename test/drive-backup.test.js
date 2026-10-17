'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createBackup, sanitize, TAG} = require('../drive-backup');
test('private notification registrations use a separate app-owned Drive record and survive reload',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duynh-private-drive-'));let file=null,bytes='',created=0;const calls=[];
 const fetchImpl=async(url,opts={})=>{
  calls.push([url,opts]);
  if(url.includes('oauth2.googleapis.com/token'))return Response.json({access_token:'a',expires_in:3600});
  if(url.includes('/upload/drive/')){assert.equal(opts.method,'PATCH');bytes=opts.body;return Response.json({id:file});}
  if(opts.method==='POST'){const meta=JSON.parse(opts.body);assert.deepEqual(meta.appProperties,{duynhPrivate:'admin-push-v1'});created++;file='private-id';return Response.json({id:file});}
  if(url.includes('alt=media'))return new Response(bytes);
  assert.match(decodeURIComponent(url),/duynhPrivate/);return Response.json({files:file?[{id:file}]:[]});
 };
 const env={GOOGLE_CLIENT_ID:'c',GOOGLE_CLIENT_SECRET:'s',GOOGLE_DRIVE_REFRESH_TOKEN:'r'};
 const options={dir,env,fetchImpl,snapshot:()=>{throw Error('must not read public menu snapshot');},apply:()=>{throw Error('must not replace menu');}};
 const first=createBackup(options),next=createBackup(options);
 try{
  assert.equal(await first.loadPushState(),null);const data={schema:'duynh-admin-push-v1',subscriptions:[{endpoint:'private'}]};
  assert.equal(await first.savePushState(data),true);assert.deepEqual(await next.loadPushState(),data);
  await next.savePushState({...data,subscriptions:[]});assert.equal(created,1);assert.deepEqual(JSON.parse(bytes).subscriptions,[]);
 }finally{first.stop();next.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
const env = { GOOGLE_CLIENT_ID:'client', GOOGLE_CLIENT_SECRET:'secret', GOOGLE_DRIVE_REFRESH_TOKEN:'refresh',
  GOOGLE_REDIRECT_URI:'https://example.test/api/backup/google/callback', BACKUP_ADMIN_KEY:'x'.repeat(40) };
function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duynh-test-'));
  let current={menu:[{id:1,name:'Tea',price:45000}],config:{storeName:'Test',banner:{images:[]},adminAccount:{password:'private'},apiKey:'private'},discounts:[]};
  let files=[],fail=false;
  const fetchImpl=async (url,opts={})=>{
    if(fail) return new Response('',{status:503});
    if(url.includes('oauth2.googleapis.com/token')) return Response.json({access_token:'access',expires_in:3600});
    if(url.includes('uploadType=resumable')) { const meta=JSON.parse(opts.body); files.unshift({...meta,id:String(files.length+1)});return new Response('',{headers:{location:'https://www.googleapis.com/upload/session'}}); }
    if(url.endsWith('/upload/session')) { files[0].bytes=Buffer.from(opts.body);return Response.json({id:files[0].id}); }
    if(url.includes('?alt=media')) { const id=url.match(/files\/([^?]+)/)[1];return new Response(files.find(x=>x.id===id).bytes); }
    return Response.json({files:files.filter(f=>f.bytes).map(f=>({id:f.id,name:f.name,appProperties:f.appProperties}))});
  };
  const backup=createBackup({dir,env,fetchImpl,snapshot:()=>current,apply:data=>{current=data;},debounceMs:60000});
  return {dir,backup,files,setFail:v=>{fail=v;},setCurrent:v=>{current=v;},cleanup:()=>{backup.stop();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('removes secrets recursively without losing payment settings',()=>{
 assert.deepEqual(sanitize({bankConfig:{accountNumber:'123'},adminAccount:{password:'x'},nested:{token:'x',value:3}}),{bankConfig:{accountNumber:'123'},nested:{value:3}});
});
test('uploads checksummed snapshots and restores empty menu/banner safely',async()=>{
 const f=fixture();try{
 f.setCurrent({menu:[],config:{storeName:'Empty',banner:{images:[]},password:'hidden'},discounts:[]});
 f.backup.changed();await f.backup.flush();assert.equal(f.files.length,1);
 assert.equal(f.files[0].bytes.toString().includes('hidden'),false);
 assert.equal(f.backup.status().pending,false);
 assert.equal(await f.backup.initialize(),true);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir,'menu.json'))),[]);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir,'store_config.json'))).banner.images,[]);
 }finally{f.cleanup();}
});
test('falls back to an older valid checksum; rejects all-invalid without local overwrite',async()=>{
 const f=fixture();try{
 await f.backup.flush();await f.backup.flush();f.files[0].bytes=Buffer.from('{bad');
 assert.equal(await f.backup.initialize(),true);
 const old=fs.readFileSync(path.join(f.dir,'menu.json'),'utf8');f.files[1].bytes=Buffer.from('{bad');
 await assert.rejects(f.backup.initialize(),/Không đọc/);assert.equal(fs.readFileSync(path.join(f.dir,'menu.json'),'utf8'),old);
 }finally{f.cleanup();}
});
test('network failure never overwrites disk and remains pending',async()=>{
 const f=fixture();try{
 fs.writeFileSync(path.join(f.dir,'menu.json'),'["keep"]');f.setFail(true);
 await assert.rejects(f.backup.initialize());assert.equal(fs.readFileSync(path.join(f.dir,'menu.json'),'utf8'),'["keep"]');
 f.backup.changed();await assert.rejects(f.backup.flush());assert.equal(f.backup.status().pending,true);
 }finally{f.cleanup();}
});
function response(){return {headers:{},status:null,body:'',removeHeader(k){delete this.headers[k];},setHeader(k,v){this.headers[k]=v;},writeHead(c,h){this.status=c;Object.assign(this.headers,h);},end(s){this.body=s;}};}
test('backup endpoints reject unauthenticated requests, cross-origin and unconfirmed restore',async()=>{
 const f=fixture();try{
 let r=response();await f.backup.handle({method:'POST',headers:{}},r,{pathname:'/api/backup/save',query:{}});assert.equal(r.status,401);
 r=response();await f.backup.handle({method:'POST',headers:{authorization:'Bearer '+env.BACKUP_ADMIN_KEY,origin:'https://evil.test'}},r,{pathname:'/api/backup/save',query:{}});assert.equal(r.status,403);
 r=response();await f.backup.handle({method:'POST',headers:{authorization:'Bearer '+env.BACKUP_ADMIN_KEY}},r,{pathname:'/api/backup/restore',query:{}});assert.equal(r.status,400);
 r=response();await f.backup.handle({method:'GET',headers:{}},r,{pathname:'/api/backup/google/callback',query:{state:'wrong',code:'fake'}});assert.equal(r.status,400);
 }finally{f.cleanup();}
});
test('OAuth start requires admin and requests only drive.file offline with browser binding',async()=>{
 const f=fixture();try{const r=response();await f.backup.handle({method:'POST',headers:{authorization:'Bearer '+env.BACKUP_ADMIN_KEY}},r,{pathname:'/api/backup/google/start',query:{}});
 assert.equal(r.status,200);const u=new URL(JSON.parse(r.body).url);assert.equal(u.searchParams.get('scope'),'https://www.googleapis.com/auth/drive.file');assert.equal(u.searchParams.get('access_type'),'offline');assert.match(r.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
 }finally{f.cleanup();}
});
test('restore preserves local credentials without including them on Drive',async()=>{
 const f=fixture();try{
 fs.writeFileSync(path.join(f.dir,'store_config.json'),JSON.stringify({adminAccount:{password:'keep-local'},nested:{apiKey:'keep-key'}}));
 f.setCurrent({menu:[],config:{storeName:'Restored',nested:{value:4}},discounts:[]});await f.backup.flush();await f.backup.initialize();
 const config=JSON.parse(fs.readFileSync(path.join(f.dir,'store_config.json')));assert.equal(config.adminAccount.password,'keep-local');assert.equal(config.nested.apiKey,'keep-key');assert.equal(config.nested.value,4);
 assert.equal(f.files[0].bytes.toString().includes('keep-local'),false);
 }finally{f.cleanup();}
});
test('OAuth callback binds cookie, consumes state, leaves activation to Render setup',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duynh-oauth-'));
 let calls=0;const b=createBackup({dir,env:{...env,GOOGLE_DRIVE_REFRESH_TOKEN:''},snapshot:()=>({}),apply:()=>{},fetchImpl:async()=>{calls++;return Response.json({refresh_token:'private-example',scope:'https://www.googleapis.com/auth/drive.file'});}});
 try{
 const r=response();await b.handle({method:'POST',headers:{authorization:'Bearer '+env.BACKUP_ADMIN_KEY}},r,{pathname:'/api/backup/google/start',query:{}});
 const state=new URL(JSON.parse(r.body).url).searchParams.get('state'),cookie=r.headers['Set-Cookie'].split(';')[0];
 const callback=response();await b.handle({method:'GET',headers:{cookie}},callback,{pathname:'/api/backup/google/callback',query:{state,code:'test'}});
 assert.equal(callback.status,200);assert.equal(callback.headers['Cache-Control'],'no-store');assert.equal(b.status().connected,false);assert.equal(calls,1);
 const replay=response();await b.handle({method:'GET',headers:{cookie}},replay,{pathname:'/api/backup/google/callback',query:{state,code:'test'}});assert.equal(replay.status,400);assert.equal(calls,1);
 }finally{b.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('recipes round trip in Drive backup; restoring an older backup preserves local recipes',async()=>{
 const f=fixture();try{
 const recipes={'1':{ingredients:[{name:'Trà lài',amount:120,unit:'ml'}],steps:'Ủ trà',notes:'',version:'v1'}};
 f.setCurrent({menu:[{id:1,name:'Tea',price:45000}],config:{},discounts:[],recipes});
 await f.backup.flush();assert.deepEqual(JSON.parse(f.files[0].bytes).recipes,recipes);
 await f.backup.initialize();assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir,'drink-recipes.json'))),recipes);
 f.setCurrent({menu:[],config:{},discounts:[]});await f.backup.flush();await f.backup.initialize();
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir,'drink-recipes.json'))),recipes);
 }finally{f.cleanup();}
});

test('order mirror retains historical orders, updates status, strips pictures and survives restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mom-order-mirror-'));
 const files=[];let failBoard=false,failHistory=false,patches=0;
 const fetchImpl=async(url,opts={})=>{
  const u=new URL(url);
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'a',expires_in:3600});
  if(opts.method==='POST'){
   const metadata=JSON.parse(opts.body);assert.equal(metadata.permissions,undefined);
   const f={...metadata,id:'f'+(files.length+1),body:''};files.push(f);return Response.json({id:f.id});
  }
  if(opts.method==='PATCH'){
   const f=files.find(f=>url.includes('/'+f.id+'?'));assert.ok(f);
   if(f.mimeType==='text/plain'&&failBoard)return new Response('',{status:503});
   f.body=opts.body;patches++;return Response.json({id:f.id});
  }
  if(u.searchParams.get('alt')==='media'){
   if(failHistory)return new Response('',{status:503});
   const f=files.find(f=>u.pathname.endsWith('/'+f.id));return new Response(f.body);
  }
  const q=u.searchParams.get('q');const kind=q.match(/value='([^']+)'/)[1];
  return Response.json({files:files.filter(f=>f.appProperties.duynhOrders===kind).map(f=>({id:f.id}))});
 };
 let orders=[{id:'ORD-12345',status:'new',createdAtIso:'2026-10-17T01:00:00Z',customerName:'Anh A',phone:'0901234567',deliveryAddress:'Đường A',total:45000,
  receiptImage:'secret-image',verificationToken:'secret-token',submissionKey:'retry-key',items:[{id:1,name:'Trà',qty:2,custom:'50% đá, ít ngọt',image:'big-image',toppings:[{name:'Macchiato'}]}]}];
 const options={dir,env,fetchImpl,debounceMs:60000,snapshot:()=>({}),apply:()=>{},ordersSnapshot:()=>orders};
 let backup=createBackup(options);
 try{
  backup.ordersChanged();await backup.flushOrders();
  assert.equal(files.length,3);assert.equal(backup.status().orders.pending,false);
  const data=files.find(f=>f.mimeType==='application/json'),board=files.find(f=>f.mimeType==='text/plain');
  assert.ok(data.parents.includes(files[0].id));assert.ok(board.parents.includes(files[0].id));
  assert.doesNotMatch(data.body,/secret-image|secret-token|big-image/);
  assert.match(board.body,/CHƯA LÀM/);assert.match(board.body,/2 × Trà/);assert.match(board.body,/50% đá, ít ngọt/);assert.match(board.body,/Macchiato/);assert.match(board.body,/0901234567/);
  orders[0].status='prep';backup.ordersChanged();failBoard=true;
  await assert.rejects(backup.flushOrders(),/503/);assert.equal(backup.status().orders.pending,true);assert.match(backup.status().orders.lastError,/503/);
  failBoard=false;await backup.flushOrders();assert.match(board.body,/ĐANG PHA/);assert.doesNotMatch(board.body,/CHƯA LÀM/);
  backup.stop();orders=[];backup=createBackup(options);await backup.flushOrders();
  assert.equal(files.length,3);assert.equal(backup.status().orders.count,1);assert.equal(JSON.parse(data.body).orders[0].status,'prep');
  orders=[{id:'ORD-54321',status:'done',items:[],total:1}];backup.ordersChanged();await backup.flushOrders();
  assert.equal(JSON.parse(data.body).orders.length,2);assert.match(board.body,/ĐÃ HOÀN TẤT/);
  backup.stop();backup=createBackup(options);failHistory=true;const before=patches;
  await assert.rejects(backup.flushOrders(),/503/);assert.equal(patches,before); // Never replace unreadable history with an empty/new snapshot.
  failHistory=false;await backup.flushOrders();assert.equal(backup.status().orders.count,2);
 }finally{backup.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('order-only backup endpoint requires owner key, and unconfigured backups remain pending',async()=>{
 const backup=createBackup({dir:os.tmpdir(),env:{},snapshot:()=>({}),apply:()=>{},ordersSnapshot:()=>[]});
 try{
  backup.ordersChanged();assert.equal(backup.status().orders.pending,true);
  const r=response();await backup.handle({method:'POST',headers:{}},r,{pathname:'/api/backup/orders/save'});assert.equal(r.status,401);
  await assert.rejects(backup.flushOrders(),/Chưa cấu hình Google Drive/);assert.equal(backup.status().orders.lastSuccess,null);
 }finally{backup.stop();}
});
