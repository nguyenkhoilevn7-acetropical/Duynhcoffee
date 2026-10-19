'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createBackup}=require('../drive-backup');
const env={GOOGLE_CLIENT_ID:'c',GOOGLE_CLIENT_SECRET:'s',GOOGLE_DRIVE_REFRESH_TOKEN:'r'};
const order=(id,status='shipping')=>({id,status,items:[{id:1,name:'Tea',qty:1}],paymentStatus:'receipt_verified'});
function fixture(orders,local){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mom-recovery-'));
 if(local!==undefined)fs.writeFileSync(path.join(dir,'orders.json'),JSON.stringify(local));
 let writes=0;
 const backup=createBackup({dir,env,snapshot:()=>({}),ordersSnapshot:()=>{throw Error('cache not initialized');},fetchImpl:async(url,opts={})=>{
  if(opts.method==='POST' && url.includes('oauth2'))return Response.json({access_token:'a',expires_in:3600});
  if(opts.method){writes++;throw Error('recovery must be read only on Drive');}
  const u=new URL(url),q=u.searchParams.get('q')||'';
  if(u.searchParams.get('alt')==='media')return new Response(JSON.stringify({schema:'mom-orders-v1',updatedAt:'2026-10-19T00:10:30.134Z',orders}));
  if(q.includes('duynhBackup'))return Response.json({files:[]});
  if(q.includes('folder-v1')){assert.match(q,/name = 'Mom - Đơn hàng dự phòng'/);return Response.json({files:[{id:'folder'}]});}
  assert.match(q,/name = 'Don-hang-du-phong.json'/);assert.match(q,/'folder' in parents/);
  return Response.json({files:[{id:'canonical'}]});
 }});
 return {dir,backup,read:()=>JSON.parse(fs.readFileSync(path.join(dir,'orders.json'))),writes:()=>writes,cleanup(){backup.stop();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('startup restores archived orders before cache exists, without modifying Drive',async()=>{
 const f=fixture([order('ORD-10001')]);try{
  assert.equal(await f.backup.initialize(),false); // Orders recovery must not change menu initialization semantics.
  assert.deepEqual(f.read(),[order('ORD-10001')]);assert.equal(f.writes(),0);
  assert.equal(f.backup.status().orders.restoredCount,1);
  assert.equal(f.backup.status().orders.backupUpdatedAt,'2026-10-19T00:10:30.134Z');
 }finally{f.cleanup();}
});
test('local newer status and receipt survive merge; repeat startup does not duplicate orders',async()=>{
 const local={...order('ORD-10001','done'),receiptImage:'local-receipt'};
 const f=fixture([order('ORD-10001'),order('ORD-10002')],[local,order('ORD-10003','new')]);try{
  await f.backup.initialize();assert.equal(f.read().length,3);assert.deepEqual(f.read()[0],local);
  await f.backup.initialize();assert.equal(f.read().length,3);assert.equal(f.backup.status().orders.restoredCount,0);
 }finally{f.cleanup();}
});
for(const bad of [[order('duplicate'),order('duplicate')],[{id:'',items:[]}],null])test('invalid archive preserves local file: '+JSON.stringify(bad),async()=>{
 const f=fixture(bad,[order('keep')]);try{
  await assert.rejects(f.backup.initialize(),/không hợp lệ/);assert.deepEqual(f.read(),[order('keep')]);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
test('invalid local data stops recovery rather than overwriting it',async()=>{
 const f=fixture([order('cloud')],{corrupt:true});try{
  await assert.rejects(f.backup.initialize(),/không hợp lệ/);assert.deepEqual(f.read(),{corrupt:true});
 }finally{f.cleanup();}
});
