'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {mutateInventory,emptyInventory}=require('../inventory');
const js=fs.readFileSync(path.join(__dirname,'../admin-inventory.js'),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
test('Inventory uses the existing admin tab; shows supplier, low stock and edits through authenticated API',async()=>{
 const dom=new JSDOM('<main><div id="tab-inventory" class="backend-tab-content active"></div></main>',{url:'https://mom.example/',runScripts:'outside-only'});
 const w=dom.window;let state=emptyInventory(),authCalls=0;const root=w.document;
 try{
  w.isUserAdmin=()=>true;w.getCloudApiUrl=p=>p;w.confirm=()=>true;
  w.AbortSignal.timeout=()=>undefined;
  w.localStorage.setItem('duynh_admin_api_token','test-private-token');
  w.fetch=async(path,options={})=>{
   assert.equal(path,'/api/admin/inventory');
   assert.equal(options.headers.Authorization,'Bearer test-private-token');authCalls++;
   if(options.method==='POST'){state=mutateInventory(state,JSON.parse(options.body));return {ok:true,json:async()=>({...state,backup:{connected:false}})};}
   return {ok:true,json:async()=>JSON.parse(JSON.stringify(state))};
  };
  w.eval(js);w.MomInventory.open();await tick();
  assert.ok(root.querySelector('#inv-form'));assert.equal(root.querySelector('#inv-list [data-id]'),null);
  root.querySelector('#inv-name').value='Đường kính';
  root.querySelector('#inv-supplier').value='Supply ABC';
  root.querySelector('#inv-stock').value='1';
  root.querySelector('#inv-minimum').value='4';
  root.querySelector('#inv-buyQuantity').value='10';
  root.querySelector('#inv-purchaseDate').value='2026-10-25';
  root.querySelector('#inv-purchaseUnitPrice').value='25000';
  root.querySelector('#inv-buyQuantity').dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.match(root.querySelector('#inv-estimated-total').textContent,/250.000 đ/);
  root.querySelector('#inv-purchaseLocation').value='Chợ đầu mối';
  root.querySelector('#inv-status').value='need';
  root.querySelector('#inv-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await tick();
  assert.equal(state.items.length,1);assert.equal(state.items[0].purchaseLocation,'Chợ đầu mối');
  assert.equal(state.items[0].purchaseUnitPrice,25000);
  assert.match(root.querySelector('#inv-list').textContent,/250.000 đ/);
  assert.match(root.querySelector('#inv-summary').textContent,/250.000 đ/);
  assert.match(root.querySelector('#inv-list').textContent,/Supply ABC/);
  assert.match(root.querySelector('#inv-list').textContent,/Gần hết hàng/);
  assert.equal(root.querySelectorAll('.inv-summary strong')[1].textContent,'1');
  root.querySelector('#inv-stock').value='5';
  root.querySelector('#inv-status').value='ordered';
  root.querySelector('#inv-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await tick();
  assert.equal(state.items[0].status,'ordered');assert.equal(state.items[0].stock,5);
  assert.equal(state.items[0].purchaseUnitPrice,25000);
  assert.equal(root.querySelector('#inv-purchaseUnitPrice').value,'25000');
  root.querySelector('#inv-filter').value='ordered';
  root.querySelector('#inv-filter').dispatchEvent(new w.Event('change'));
  assert.equal(root.querySelectorAll('.inv-item').length,1);
  assert.ok(authCalls>=3);
  root.querySelector('#inv-delete').click();await tick();
  assert.equal(state.items.length,0);
 }finally{w.close();}
});
test('Inventory item names are escaped instead of injecting arbitrary HTML',async()=>{
 const dom=new JSDOM('<div id="tab-inventory" class="backend-tab-content active"></div>',{url:'https://mom.example/',runScripts:'outside-only'});
 const w=dom.window;
 try{
  const state=mutateInventory(emptyInventory(),{version:'',action:'save',item:{name:'<img src=x onerror=alert(1)>',stock:1,minimum:2,buyQuantity:3}});
  w.isUserAdmin=()=>true;w.getCloudApiUrl=p=>p;w.AbortSignal.timeout=()=>undefined;
  w.fetch=async()=>({ok:true,json:async()=>state});w.eval(js);w.MomInventory.open();await tick();
  assert.equal(w.document.querySelectorAll('#inv-list img').length,0);
  assert.match(w.document.querySelector('#inv-list').textContent,/<img/);
 }finally{w.close();}
});


test('Quick-edit layout keeps the essential fields visible and hides advanced inputs by default',async()=>{
 const dom=new JSDOM('<div id="tab-inventory" class="backend-tab-content active"></div>',{url:'https://mom.example/',runScripts:'outside-only'});
 const w=dom.window;const d=w.document;
 try{
  w.isUserAdmin=()=>true;w.getCloudApiUrl=p=>p;w.AbortSignal.timeout=()=>undefined;
  w.fetch=async()=>({ok:true,json:async()=>emptyInventory()});
  w.eval(js);w.MomInventory.open();await tick();
  const form=d.querySelector('#inv-form'),advanced=d.querySelector('#inv-advanced');
  assert.ok(form&&advanced);
  assert.equal(advanced.open,false);
  for(const key of ['name','purchaseLocation','supplierPhone','purchaseUnitPrice','lastPurchasedDate','buyQuantity']){
   assert.ok(d.querySelector('#inv-'+key));
   assert.equal(d.querySelector('#inv-'+key).closest('details'),null,'primary field should be visible: '+key);
  }
  for(const key of ['stock','minimum','supplier','category','unit','status','notes','purchaseDate']){
   assert.equal(d.querySelector('#inv-'+key)?.closest('details'),advanced,'advanced field should stay optional: '+key);
  }
  assert.ok(d.querySelector('#inv-file'),'optional product image must remain');
  assert.equal(d.querySelector('#inv-buyQuantity').value,'1');
  d.querySelector('#inv-purchaseUnitPrice').value='35000';
  d.querySelector('#inv-purchaseUnitPrice').dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.match(d.querySelector('#inv-estimated-total').textContent,/35.000 đ/);
  assert.equal(d.querySelectorAll('.inv-summary > div').length,3);
 }finally{w.close();}
});
test('Editing a legacy item keeps stock, supplier and notes even when advanced panel stays closed',async()=>{
 const dom=new JSDOM('<div id="tab-inventory" class="backend-tab-content active"></div>',{url:'https://mom.example/',runScripts:'outside-only'});
 const w=dom.window;const d=w.document;
 let state=mutateInventory(emptyInventory(),{version:'',action:'save',item:{
  name:'Sữa tươi',supplier:'Đại lý A',supplierPhone:'0901234567',category:'Sữa',unit:'thùng',
  stock:5,minimum:8,buyQuantity:2,purchaseUnitPrice:120000,lastPurchasedDate:'2026-10-01',
  status:'ordered',notes:'Mua thùng nguyên',purchaseDate:'2026-10-30'
 }});
 try{
  w.isUserAdmin=()=>true;w.getCloudApiUrl=p=>p;w.confirm=()=>true;w.AbortSignal.timeout=()=>undefined;
  w.localStorage.setItem('duynh_admin_api_token','test-token');
  w.fetch=async(_path,options={})=>{
   if(options.method==='POST'){state=mutateInventory(state,JSON.parse(options.body));return {ok:true,json:async()=>state};}
   return {ok:true,json:async()=>state};
  };
  w.eval(js);w.MomInventory.open();await tick();
  d.querySelector('.inv-item').click();
  assert.equal(d.querySelector('#inv-advanced').open,false);
  assert.equal(d.querySelector('#inv-purchaseLocation').value,'Đại lý A');
  assert.equal(d.querySelector('#inv-buyQuantity').value,'2');
  d.querySelector('#inv-purchaseUnitPrice').value='125000';
  d.querySelector('#inv-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await tick();
  assert.equal(state.items[0].purchaseUnitPrice,125000);
  assert.equal(state.items[0].purchaseLocation,'Đại lý A');
  assert.equal(state.items[0].supplier,'Đại lý A');
  assert.equal(state.items[0].stock,5);
  assert.equal(state.items[0].minimum,8);
  assert.equal(state.items[0].unit,'thùng');
  assert.equal(state.items[0].notes,'Mua thùng nguyên');
  assert.equal(state.items[0].status,'ordered');
  assert.match(d.querySelector('#inv-list').textContent,/250.000 đ/);
  assert.match(d.querySelector('#inv-list').textContent,/Tồn: 5 thùng/);
 }finally{w.close();}
});
test('Inventory remains bilingual without changing the site translation engine',async()=>{
 const dom=new JSDOM('<div id="tab-inventory" class="backend-tab-content active"></div>',{url:'https://mom.example/',runScripts:'outside-only'});
 const w=dom.window;
 try{
  w.document.documentElement.lang='en';
  w.isUserAdmin=()=>true;w.getCloudApiUrl=p=>p;w.AbortSignal.timeout=()=>undefined;
  w.fetch=async()=>({ok:true,json:async()=>emptyInventory()});
  w.eval(js);w.MomInventory.open();await tick();
  assert.match(w.document.querySelector('#inv-form').textContent,/Where to buy \/ supplier/);
  assert.match(w.document.querySelector('#inv-form').textContent,/Total purchase cost/);
  assert.match(w.document.querySelector('#inv-advanced summary').textContent,/More details/);
 }finally{w.close();}
});
