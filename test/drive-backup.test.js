'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createBackup, sanitize, TAG} = require('../drive-backup');
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
