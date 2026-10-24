'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {emptyInventory,validateInventory,mutateInventory,validateItem,purchaseTotal}=require('../inventory');
const {validate:validateBackup,TAG}=require('../drive-backup');
const baseItem={name:'Trà lài',category:'Nguyên liệu',unit:'kg',stock:2,minimum:3,buyQuantity:8,purchaseDate:'2026-10-26',supplier:'Nhà cung cấp A',supplierPhone:'0900 000 000',purchaseLocation:'Chợ đầu mối',purchaseUnitPrice:25000,status:'need',notes:'Gọi trước',image:''};
test('private purchasing records support optimistic updates and deletion',()=>{
 const empty=emptyInventory();assert.deepEqual(empty,{version:'',items:[]});
 const first=mutateInventory(empty,{version:'',action:'save',item:baseItem});
 assert.equal(first.items.length,1);assert.equal(first.items[0].supplier,'Nhà cung cấp A');
 assert.equal(first.items[0].purchaseUnitPrice,25000);
 assert.equal(purchaseTotal(first.items[0]),200000);
 const edited=mutateInventory(first,{version:first.version,action:'save',item:{...baseItem,id:first.items[0].id,status:'ordered',stock:4}});
 assert.equal(edited.items[0].stock,4);
 assert.equal(edited.items[0].createdAt,first.items[0].createdAt);
 assert.throws(()=>mutateInventory(edited,{version:first.version,action:'delete',id:first.items[0].id}),e=>e.status===409);
 const removed=mutateInventory(edited,{version:edited.version,action:'delete',id:edited.items[0].id});
 assert.equal(removed.items.length,0);
 assert.notEqual(removed.version,edited.version);
});
test('purchase price is optional for older records, validates integer VND, and calculates totals',()=>{
  const legacy={...baseItem};delete legacy.purchaseUnitPrice;
  assert.equal(validateItem(legacy).purchaseUnitPrice,null);
  assert.equal(purchaseTotal(validateItem(legacy)),null);
  assert.equal(purchaseTotal(validateItem({...baseItem,purchaseUnitPrice:0})),0);
  assert.equal(purchaseTotal(validateItem({...baseItem,buyQuantity:2.5,purchaseUnitPrice:24000})),60000);
 assert.equal(validateItem({...baseItem,costQuantity:1000,costUnit:'g'}).costQuantity,1000);
 assert.throws(()=>validateItem({...baseItem,costQuantity:1000,costUnit:''}),/quy đổi/);
 assert.throws(()=>validateItem({...baseItem,costQuantity:0,costUnit:'ml'}),/quy đổi/);
  assert.throws(()=>validateItem({...baseItem,purchaseUnitPrice:-1}),/Đơn giá mua/);
  assert.throws(()=>validateItem({...baseItem,purchaseUnitPrice:2500.5}),/Đơn giá mua/);
  assert.throws(()=>validateItem({...baseItem,purchaseUnitPrice:Infinity}),/Đơn giá mua/);
  assert.throws(()=>validateItem({...baseItem,purchaseUnitPrice:'25000'}),/Đơn giá mua/);
  assert.throws(()=>validateItem({...baseItem,purchaseUnitPrice:1000000001}),/Đơn giá mua/);
});
test('invalid image, impossible date, negative stock, oversized names are rejected',()=>{
 assert.throws(()=>validateItem({...baseItem,stock:-1}),/Tồn kho/);
 assert.throws(()=>validateItem({...baseItem,name:'x'.repeat(200)}),/quá dài/);
 assert.throws(()=>validateItem({...baseItem,purchaseDate:'2026-02-30'}),/đúng định dạng/);
 assert.throws(()=>validateItem({...baseItem,image:'data:image/svg+xml;base64,abc'}),/Ảnh/);
 assert.throws(()=>validateItem({...baseItem,image:'https://external.example/photo.jpg'}),/Ảnh/);
 assert.throws(()=>validateInventory({version:'',items:[{id:'a',...baseItem},{id:'a',...baseItem}]}),/trùng/);
 const photo='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64');
 assert.equal(validateItem({...baseItem,image:photo}).image,photo);
});
test('Drive backup validates optional inventory while retaining old backup compatibility',()=>{
 const legacy={schema:TAG,createdAt:new Date().toISOString(),menu:[],config:{},discounts:[]};
 assert.deepEqual(validateBackup(legacy),legacy);
 const withInventory={...legacy,inventory:mutateInventory(emptyInventory(),{version:'',action:'save',item:baseItem})};
 assert.equal(validateBackup(withInventory).inventory.items.length,1);
 assert.throws(()=>validateBackup({...legacy,inventory:{items:'unsafe'}}),/Kho/);
});
test('authenticated inventory API persists, blocks public access and survives restart',async()=>{
 const root=path.resolve(__dirname,'..');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mom-inventory-'));
 for(const name of ['server.js','inventory.js','inventory-cost.js','profit-report.js','profit-excel.js','drink-recipes.js','menu-options.js','menu-ai.js','delivery.js','admin-push.js','drive-backup.js','receipt-verification.js','receipt-jobs.js','receipt-image.js']){
   fs.copyFileSync(path.join(root,name),path.join(dir,name));
 }
 fs.writeFileSync(path.join(dir,'store_config.json'),JSON.stringify({adminAccount:{username:'test-inventory',password:'inventory-test-password'},banner:{images:[]}}));
 fs.writeFileSync(path.join(dir,'menu.json'),'[]');
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 let child=null;const base='http://127.0.0.1:'+port;
 async function start(){
   child=spawn(process.execPath,['server.js'],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port)},stdio:['ignore','pipe','pipe']});
   const output=[];child.stderr.on('data',v=>output.push(v.toString()));
   for(let i=0;i<110;i++){
     if(child.exitCode!==null)throw Error('Server stopped: '+output.join(''));
     try{const r=await fetch(base+'/api/health');if(r.ok)return;}catch{}
     await new Promise(resolve=>setTimeout(resolve,40));
   }
   throw Error('Server start timeout: '+output.join(''));
 }
 async function stop(){if(child&&!child.killed){const p=new Promise(resolve=>child.once('exit',resolve));child.kill();await p;child=null;}}
 try{
   await start();
   const endpoint=base+'/api/admin/inventory';
   assert.equal((await fetch(endpoint)).status,401);
   assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
   assert.equal((await fetch(base+'/inventory.json')).status,404);
   assert.equal((await fetch(base+'/inventory.js')).status,404);
   assert.equal((await fetch(base+'/inventory-cost.js')).status,404);
   const session=await(await fetch(base+'/api/admin-push/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'test-inventory',password:'inventory-test-password'})})).json();
   assert.ok(session.token);
   const headers={'Content-Type':'application/json',Authorization:'Bearer '+session.token};
   let state=await(await fetch(endpoint,{headers})).json();assert.deepEqual(state,emptyInventory());
   const post=async body=>fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)});
   let response=await post({version:state.version,action:'save',item:baseItem});
   assert.equal(response.status,200);state=await response.json();
   assert.equal(state.items[0].name,'Trà lài');assert.equal(state.backup.connected,false);
   assert.equal((await post({version:'',action:'delete',id:state.items[0].id})).status,409);
   const publicMenu=await(await fetch(base+'/api/menu')).json();assert.ok(!JSON.stringify(publicMenu).includes('Nhà cung cấp A'));
   const publicSync=await(await fetch(base+'/api/sync')).json();assert.ok(!JSON.stringify(publicSync).includes('Nhà cung cấp A'));
   await stop();await start();
   const token=(await(await fetch(base+'/api/admin-push/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'test-inventory',password:'inventory-test-password'})})).json()).token;
   const saved=await(await fetch(endpoint,{headers:{Authorization:'Bearer '+token}})).json();
   assert.equal(saved.items[0].supplier,'Nhà cung cấp A');
   assert.equal(saved.items[0].purchaseUnitPrice,25000);
   assert.equal(purchaseTotal(saved.items[0]),200000);
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
