'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('click actual new-order card, persist kitchen status, reload and hand over to shipper',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mom-approval-flow-'));
 for(const name of fs.readdirSync(root))if(/\.(js|css|html)$/.test(name))fs.copyFileSync(path.join(root,name),path.join(dir,name));
 const menu=Array.from({length:8},(_,i)=>({id:i+1,name:'QA tea '+i,category:'tea',price:45000,stock:100,isAvailable:true,image:''}));
 const existing={id:'ORD-90001',status:'new',customerName:'Local QA',items:[{id:1,name:'QA tea',qty:1,price:45000,total:45000}],total:45000,createdAtIso:new Date().toISOString()};
 for(const [name,data] of Object.entries({'menu.json':menu,'orders.json':[existing],'discounts.json':[],'store_config.json':{adminAccount:{username:'qa-owner',password:'qa-local-only'},bankConfig:{accountHolder:'QA RECEIVER'},banner:{images:[]}}}))fs.writeFileSync(path.join(dir,name),JSON.stringify(data));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{cwd:dir,env:{PATH:process.env.PATH,NODE_PATH:path.join(root,'node_modules'),PORT:String(port)},stdio:['ignore','pipe','pipe']});
 child.stdout.resume();child.stderr.resume();let dom,persistedStorage={};
 const closeApp=()=>{persistedStorage=Object.fromEntries(Object.keys(dom.window.localStorage).map(key=>[key,dom.window.localStorage.getItem(key)]));dom.window.close();};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await pause(30);}
  const session=await(await fetch(base+'/api/admin-push/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qa-owner',password:'qa-local-only'})})).json();assert.ok(session.token);
  class LocalResources extends ResourceLoader{fetch(url,options){return url.startsWith(base)?super.fetch(url,options):null;}}
  const errors=[],requests=[];
  const open=async()=>{
   dom=await JSDOM.fromURL(base+'/#admin',{resources:new LocalResources(),runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole().on('jsdomError',e=>errors.push(e.message)),beforeParse(w){
    for(const [key,value] of Object.entries(persistedStorage))w.localStorage.setItem(key,value);
    w.localStorage.setItem('duynh_admin_auth','1');w.localStorage.setItem('duynh_admin_api_token',session.token);
    w.AbortController=AbortController;w.AbortSignal=AbortSignal;
    w.fetch=(input,options)=>{const url=new URL(input,base).href;requests.push({url,options});return fetch(url,options);};
    w.WebSocket=class{constructor(){this.readyState=0;}close(){}};
    w.scrollTo=()=>{};w.alert=()=>{};w.confirm=()=>false;
   }});
   for(let i=0;i<100;i++){if(dom.window.document.getElementById('view-backend')?.classList.contains('active') && dom.window.eval('isInitialLoadDone') && dom.window.document.querySelector('#grid-orders-new .backend-order-card, #grid-orders-prep .backend-order-card, #grid-orders-shipping .backend-order-card'))return;await pause(30);}
   throw Error('No order card: '+errors.join('; '));
  };
  await open();
  const w=dom.window,button=w.document.querySelector('[onclick="approveOrder(\'ORD-90001\')"]');assert.ok(button);button.click();
  for(let i=0;i<100;i++){if(w.findOrderById('ORD-90001')?.status==='prep')break;await pause(30);}
  assert.equal(w.findOrderById('ORD-90001').status,'prep','toast: '+w.document.getElementById('sms-toast-body').textContent+'; errors: '+errors.join('; '));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'orders.json')))[0].status,'prep');
  closeApp();await open();assert.equal(dom.window.findOrderById('ORD-90001').status,'prep');
  const handover=dom.window.document.querySelector('[onclick="completeOrder(\'ORD-90001\')"]');assert.ok(handover);handover.click();
  for(let i=0;i<100;i++){if(dom.window.findOrderById('ORD-90001')?.status==='shipping')break;await pause(30);}
  assert.equal(dom.window.findOrderById('ORD-90001').status,'shipping');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'orders.json')))[0].status,'shipping');
  const mutationsBefore=requests.filter(r=>r.options?.method==='POST' && r.url.includes('/api/orders')).length;
  dom.window.simulateCustomerOrderWithBill();
  const testCard=dom.window.document.querySelector('#grid-orders-new .backend-order-card');assert.ok(testCard);
  const testId=testCard.id.replace('card-','');
  testCard.querySelector('.btn-checkout-now').click();
  for(let i=0;i<30;i++){if(dom.window.findOrderById(testId)?.status==='prep' && !dom.window.pendingOrderActions?.size)break;await pause(30);}
  assert.equal(dom.window.findOrderById(testId)?.status,'prep','test-order approval failed: '+dom.window.document.getElementById('sms-toast-body').textContent);
  await pause(0);
  assert.match(testCard.textContent,/ĐƠN THỬ/);
  await dom.window.completeOrder(testId);assert.equal(dom.window.findOrderById(testId).status,'shipping');
  assert.equal(requests.filter(r=>r.options?.method==='POST' && r.url.includes('/api/orders')).length,mutationsBefore);
  closeApp();await open();assert.equal(dom.window.findOrderById(testId).status,'shipping');
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'orders.json')));assert.equal(saved.length,1,'test orders must not enter real customer records');
  assert.equal(dom.window.document.getElementById('stat-total-revenue').textContent,dom.window.formatMoney(45000));
  dom.window.eval('orders.push('+JSON.stringify({...existing,id:'ORD-40400'})+');renderAllBackendTabs();');
  dom.window.document.querySelector('[onclick="approveOrder(\'ORD-40400\')"]').click();
  for(let i=0;i<100;i++){if(!dom.window.pendingOrderActions?.size)break;await pause(20);}
  const notice=dom.window.document.getElementById('admin-order-action-notice');assert.equal(notice.hidden,false);assert.match(notice.textContent,/chưa có trên máy chủ/);
  assert.equal(dom.window.findOrderById('ORD-40400').status,'new');
  dom.window.localStorage.removeItem('duynh_admin_api_token');dom.window.localStorage.removeItem('duynh_admin_push_token');
  dom.window.document.querySelector('[onclick="approveOrder(\'ORD-40400\')"]').click();await pause(0);
  assert.equal(dom.window.document.getElementById('admin-login-modal').style.display,'flex');
  assert.equal(dom.window.pendingDeliveryAction.path,'/api/orders/ORD-40400/status');

 }finally{dom?.window.close();if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});fs.rmSync(dir,{recursive:true,force:true});}
});
