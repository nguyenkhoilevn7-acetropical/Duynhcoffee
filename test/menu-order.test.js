'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function client(){
 const elements=new Map();const writes=[];
 const s={window:{},console,currentCategory:'all',menu:[{id:1,name:'Tea',category:'tea',price:45000},{id:2,name:'Coffee',category:'coffee',price:39000},{id:3,name:'Cake',category:'bakery',price:35000}],
 storeConfig:{bankConfig:{accountHolder:'DAO KHOI NGUYEN'}},localStorage:{getItem(){return null;},setItem(){}},
 document:{getElementById:id=>elements.get(id)||null},isUserAdmin:()=>true,isAdminViewActive:()=>false,
 saveLocalData(){},renderAdminMenuTable(){},renderCustomerProducts(){},showSmsToast(){},
 getCloudApiUrl:p=>p,lastMenuVersion:0,lastConfigVersion:0,cart:[],activeDiscount:null,
 renderPaymentBankInfo(){},updateCheckoutFinancials(){},
 fetch:async(p,o)=>{writes.push({path:p,body:JSON.parse(o.body)});return {ok:true,json:async()=>p==='/api/config'?{success:true,config:{...s.storeConfig,...JSON.parse(o.body)},configVersion:2}:{success:true,menuVersion:2}};}};
 vm.createContext(s);
 vm.runInContext(html.slice(html.indexOf('    let receiptVerificationToken'),html.indexOf('    function renderBackendConfig')),s);
 vm.runInContext(html.slice(html.indexOf('    const DEFAULT_CATEGORIES'),html.indexOf('    function toggleInlineCategoryCreator')),s);
 vm.runInContext(html.slice(html.indexOf('    function renderCategoryFilterPills'),html.indexOf('    // =========================================================================\n    // 🤖 AI XÉT')),s);
 return {s,writes,elements};
}
const ids=list=>Array.from(list,x=>x.id);
test('category moves persist defaults/custom categories, refresh other client and preserve payment config',async()=>{
 const a=client(),b=client();
 a.s.storeConfig.categories=[{id:'juice',name:'Juice'}];
 assert.equal(await a.s.moveMenuCategory('coffee',-1),true);
 assert.deepEqual(a.writes[0].body,{categoryOrder:['coffee','tea','bakery','juice']});
 assert.deepEqual(ids(a.s.getCategoriesList()),['coffee','tea','bakery','juice']);
 b.s.applyServerConfig(JSON.parse(JSON.stringify(a.s.storeConfig)),3);
 assert.deepEqual(ids(b.s.getCategoriesList()),['coffee','tea','bakery','juice']);
 assert.equal(b.s.storeConfig.bankConfig.accountHolder,'DAO KHOI NGUYEN');
 assert.equal(await a.s.moveMenuCategory('coffee',-1),false);assert.equal(a.writes.length,1);
});
test('reordering products preserves every field and uses acknowledged array order on two clients',async()=>{
 const a=client(),b=client();a.s.menu[1].stock=7;a.s.menu[1].image='custom-image';
 assert.equal(await a.s.moveMenuItem(2,-1),true);
 assert.deepEqual(ids(a.s.menu),[2,1,3]);assert.equal(a.s.menu[0].image,'custom-image');assert.equal(a.s.menu[0].stock,7);
 b.s.menu=JSON.parse(JSON.stringify(a.writes[0].body));assert.deepEqual(ids(b.s.menu),[2,1,3]);
 assert.deepEqual(ids(b.s.menu.filter(m=>m.category==='coffee')),[2]);
});
test('before/after placement works for new/existing items, both edges and stale targets without losing items',()=>{
 const {s}=client();
 assert.deepEqual(ids(s.positionMenuItem(s.menu,3,'before:1')),[3,1,2]);
 assert.deepEqual(ids(s.positionMenuItem(s.menu,1,'after:2')),[2,1,3]);
 assert.deepEqual(ids(s.positionMenuItem(s.menu,3,'start')),[3,1,2]);
 assert.deepEqual(ids(s.positionMenuItem(s.menu,1,'end')),[2,3,1]);
 assert.deepEqual(ids(s.positionMenuItem(s.menu,1,'before:deleted')),[1,2,3]);
 assert.deepEqual(ids(s.positionMenuItem([...s.menu,{id:4}],4,'after:1')),[1,4,2,3]);
});
test('failed server save never claims success or replaces local item/category order',async()=>{
 const {s}=client();s.fetch=async()=>({ok:false,json:async()=>({error:'disk full'})});
 assert.equal(await s.moveMenuItem(2,-1),false);assert.deepEqual(ids(s.menu),[1,2,3]);
 assert.equal(await s.moveMenuCategory('coffee',-1),false);assert.deepEqual(ids(s.getCategoriesList()),['tea','coffee','bakery']);
});
test('duplicate clicks do not issue overlapping writes; next click works after completion',async()=>{
 const {s}=client();let finish,count=0;s.fetch=async()=>{count++;return new Promise(r=>finish=()=>r({ok:true,json:async()=>({success:true,menuVersion:2})}));};
 const first=s.moveMenuItem(2,-1);assert.equal(await s.moveMenuItem(2,-1),false);assert.equal(count,1);finish();await first;
 const second=s.moveMenuItem(2,1);assert.equal(count,2);finish();assert.equal(await second,true);assert.deepEqual(ids(s.menu),[1,2,3]);
});
test('dropdown offers existing positions without injecting product labels',()=>{
 const {s,elements}=client();elements.set('add-menu-position',{innerHTML:'',value:''});
 s.menu[0].name='<b>Tea & Cake</b>';s.populateMenuPositions('add');
 assert.match(elements.get('add-menu-position').innerHTML,/before:1/);
 assert.match(elements.get('add-menu-position').innerHTML,/&lt;b&gt;Tea &amp; Cake&lt;\/b&gt;/);
 assert.equal(elements.get('add-menu-position').value,'end');
});
test('menu sync detects category, order and translated text changes',()=>{
 const s={};vm.createContext(s);vm.runInContext(html.slice(html.indexOf('    function hasMenuChanged'),html.indexOf('    function hasOrdersChanged')),s);
 assert.equal(s.hasMenuChanged([{id:1,name_en:'Tea'}],[{id:1,name_en:'New tea'}]),true);
 assert.equal(s.hasMenuChanged([{id:1},{id:2}],[{id:2},{id:1}]),true);
 assert.equal(s.hasMenuChanged([{id:1}],[{id:1}]),false);
});

test('real server broadcasts edits and display order to two live clients, HTTP fallback and reconnect after restart',async()=>{
 const os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process'),WS=require('ws');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duynh-menu-order-'));
 for(const name of ['server.js','profit-report.js','profit-excel.js','drink-recipes.js','menu-options.js','menu-ai.js','delivery.js','admin-push.js','order-notifications-sw.js','admin-notifications.js','drive-backup.js','receipt-verification.js','receipt-jobs.js','index.html']) fs.copyFileSync(path.join(__dirname,'..',name),path.join(dir,name));
 const port=await new Promise(resolve=>{const n=net.createServer();n.listen(0,'127.0.0.1',()=>{const p=n.address().port;n.close(()=>resolve(p));});});
 const base='http://127.0.0.1:'+port;let child;const sockets=[];
 async function start(){child=spawn(process.execPath,['server.js'],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),5000);child.stdout.on('data',()=>{clearTimeout(timer);resolve();});child.once('exit',c=>{clearTimeout(timer);reject(Error('server exit '+c));});});}
 async function stop(){for(const w of sockets)w.terminate();if(child&&child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});}
 function waitMessage(w,type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{w.off('message',listener);reject(Error('missing '+type));},4000);function listener(raw){const p=JSON.parse(raw);if(p.type===type){clearTimeout(timer);w.off('message',listener);resolve(p);}}w.on('message',listener);});}
 function connectedClient(){const {s,elements}=client();elements.set('category-filter-pills',{innerHTML:''});elements.set('customer-products-grid',{innerHTML:''});s._elements=elements;Object.assign(s,{currentCategory:'all',formatMoney:String,getItemLocalizedName:m=>m.name,getItemLocalizedDesc:m=>m.description||'',LOCAL_DEVICE_ID:'test',isInitialLoadDone:false,lastOrdersVersion:0,lastDiscountsVersion:0,orders:[],discounts:[],
  mergeMenuWithServer:m=>m,hasMenuChanged:(a,b)=>JSON.stringify(a)!==JSON.stringify(b),debouncedSaveLocalData(){},saveLocalDiscounts(){},
  loadBannerSettingsToAdmin(){},renderBackendConfig(){},renderCustomerFooterInfo(){},renderFrontendBanner(){},renderAllBackendTabs(){},renderAdminDiscountsTable(){},sanitizeOrdersData(){},updateCartBadge(){},updateCloudSyncIndicator(){}});
  vm.runInContext(html.slice(html.indexOf('    function renderCustomerProducts()'),html.indexOf('    function filterCategory')),s);
  vm.runInContext(html.slice(html.indexOf('    function handleIncomingMeshPayload'),html.indexOf('    // ==================== PHÁT SỰ KIỆN')),s);return s;}
 async function connect(s){const w=new WS('ws://127.0.0.1:'+port+'/ws');sockets.push(w);const initial=waitMessage(w,'HANDSHAKE');w.on('message',raw=>s.handleIncomingMeshPayload(JSON.parse(raw),'render_ws'));await initial;return w;}
 async function post(p,body){const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);assert.equal((await r.json()).success,true);}
 try {
  await start();const a=connectedClient(),b=connectedClient();b.isUserAdmin=()=>false;const wa=await connect(a),wb=await connect(b);
  const config={categories:[{id:'juice',name:'Fresh Juice'}],categoryOrder:['coffee','juice','tea','bakery']};
  let ready=Promise.all([waitMessage(wa,'CONFIG_UPDATE'),waitMessage(wb,'CONFIG_UPDATE')]);await post('/api/config',config);await ready;
  for(const s of [a,b]){assert.deepEqual(ids(s.getCategoriesList()),config.categoryOrder);const pills=s._elements.get('category-filter-pills').innerHTML;assert.ok(pills.indexOf('coffee')<pills.indexOf('juice'));assert.ok(pills.indexOf('juice')<pills.indexOf("filterCategory('tea'"));}
  const menu=[{id:2,name:'Edited coffee',name_en:'English coffee',category:'coffee',price:41000,stock:8,isAvailable:true,isBestSeller:true,description:'Updated',image:'https://example.test/coffee.jpg'},
    {id:1,name:'Tea',category:'tea',price:45000,image:'https://example.test/tea.jpg'},{id:3,name:'Juice',category:'juice',price:39000,image:'https://example.test/juice.jpg'}];
  ready=Promise.all([waitMessage(wa,'MENU_UPDATE'),waitMessage(wb,'MENU_UPDATE')]);await post('/api/menu',menu);await ready;
  for(const s of [a,b]){assert.deepEqual(JSON.parse(JSON.stringify(s.menu)),menu);const grid=s._elements.get('customer-products-grid').innerHTML;assert.ok(grid.indexOf('Edited coffee')<grid.indexOf('Tea'));assert.match(grid,/Updated/);assert.match(grid,/41000/);}
  const fallback=connectedClient();fallback.handleIncomingMeshPayload({type:'FULL_SYNC',...await(await fetch(base+'/api/sync')).json()},'render_http');
  assert.deepEqual(ids(fallback.menu),[2,1,3]);assert.deepEqual(ids(fallback.getCategoriesList()),config.categoryOrder);
  // Deletion is authorized, uses current server state, and preserves every product field.
  let r=await fetch(base+'/api/menu/categories/coffee',{method:'DELETE'});assert.equal(r.status,401);
  const session=await(await fetch(base+'/api/admin-push/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'duynh2026'})})).json();
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+session.token};
  r=await fetch(base+'/api/menu/categories/coffee',{method:'DELETE',headers,body:'{}'});assert.equal(r.status,409);
  r=await fetch(base+'/api/menu/categories/coffee',{method:'DELETE',headers,body:JSON.stringify({replacementId:'coffee'})});assert.equal(r.status,409);
  const oldConfig=JSON.parse(JSON.stringify(config)),oldMenu=JSON.parse(JSON.stringify(menu));
  fs.writeFileSync(path.join(dir,'orders.json'),JSON.stringify([{id:'OLD-ORDER',status:'done',items:[{name:'Edited coffee',qty:1}]}]));
  fs.writeFileSync(path.join(dir,'drink-recipes.json'),JSON.stringify({2:{ingredients:[{name:'Coffee',quantity:30,unit:'ml'}],steps:['Brew']}}));
  const ordersBefore=fs.readFileSync(path.join(dir,'orders.json'),'utf8'),recipesBefore=fs.readFileSync(path.join(dir,'drink-recipes.json'),'utf8');
  ready=Promise.all([waitMessage(wa,'CONFIG_UPDATE'),waitMessage(wb,'CONFIG_UPDATE')]);
  r=await fetch(base+'/api/menu/categories/coffee',{method:'DELETE',headers,body:JSON.stringify({replacementId:'juice'})});assert.equal(r.status,200);
  const removed=await r.json();await ready;assert.equal(removed.movedCount,1);assert.equal(removed.backup.pending,true);
  menu[0].category='juice';config.categoryOrder=config.categoryOrder.filter(id=>id!=='coffee');
  assert.deepEqual(removed.menu,menu);assert.deepEqual(removed.config.deletedCategoryIds,['coffee']);
  for(const s of [a,b]){assert.deepEqual(ids(s.getCategoriesList()),config.categoryOrder);assert.equal(s.menu[0].category,'juice');}
  assert.equal(fs.readFileSync(path.join(dir,'orders.json'),'utf8'),ordersBefore);assert.equal(fs.readFileSync(path.join(dir,'drink-recipes.json'),'utf8'),recipesBefore);
  // A stale device cannot recreate deleted categories or move products back into them.
  await post('/api/config',{...oldConfig,deletedCategoryIds:[]});
  assert.deepEqual((await(await fetch(base+'/api/config')).json()).deletedCategoryIds,['coffee']);
  r=await fetch(base+'/api/menu',{method:'POST',headers,body:JSON.stringify(oldMenu)});assert.equal(r.status,409);
  wa.send(JSON.stringify({type:'MENU_UPDATE',menu:oldMenu}));
  assert.deepEqual(await(await fetch(base+'/api/menu')).json(),menu);
  ready=Promise.all([waitMessage(wa,'CONFIG_UPDATE'),waitMessage(wb,'CONFIG_UPDATE')]);
  r=await fetch(base+'/api/menu/categories/bakery',{method:'DELETE',headers,body:'{}'});assert.equal(r.status,200);await ready;
  config.categoryOrder=config.categoryOrder.filter(id=>id!=='bakery');
  r=await fetch(base+'/api/menu/categories/bakery',{method:'DELETE',headers,body:'{}'});assert.equal(r.status,404);
  await stop();await start();const late=connectedClient();await connect(late);
  assert.deepEqual(JSON.parse(JSON.stringify(late.menu)),menu);assert.deepEqual(ids(late.getCategoriesList()),config.categoryOrder);
 } finally {await stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('delete waits for server acknowledgement, updates filters on both clients and leaves state intact on failure',async()=>{
 const a=client(),b=client();a.s.currentCategory='coffee';
 const draft=a.s.menu.map(m=>m.category==='coffee'?{...m,category:'tea'}:m);
 let release; a.s.fetch=async(p,o)=>{assert.equal(o.method,'DELETE');assert.equal(p,'/api/menu/categories/coffee');return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({success:true,menu:draft,config:{deletedCategoryIds:['coffee']},menuVersion:4,configVersion:4})});});};
 const job=a.s.deleteMenuCategory('coffee','tea');assert.equal(a.s.menu[1].category,'coffee');
 assert.equal(await a.s.deleteMenuCategory('coffee','tea'),false);release();assert.equal(await job,true);
 assert.equal(a.s.currentCategory,'all');assert.equal(a.s.menu[1].category,'tea');assert.equal(ids(a.s.getCategoriesList()).includes('coffee'),false);
 b.s.applyServerConfig({deletedCategoryIds:['coffee']},4);assert.equal(ids(b.s.getCategoriesList()).includes('coffee'),false);
 const failed=client(),before=JSON.stringify(failed.s.menu),error={textContent:''};
 failed.s.fetch=async()=>({ok:false,json:async()=>({error:'Server did not save'})});
 assert.equal(await failed.s.deleteMenuCategory('tea','coffee',error),false);assert.equal(error.textContent,'Server did not save');assert.equal(JSON.stringify(failed.s.menu),before);
});

test('editing a product saves all fields and selected position only on server acknowledgement',async()=>{
 for(const fails of [false,true]){
  const {s,elements,writes}=client();
  const values={'edit-menu-id':'1','edit-menu-name':'New tea','edit-menu-category':'coffee','edit-menu-price':'49000','edit-menu-stock':'12','edit-menu-status':'1','edit-menu-desc':'New description','edit-menu-image-url':'https://example.test/new.jpg','edit-menu-position':'after:3'};
  for(const [id,value] of Object.entries(values))elements.set(id,{value});elements.set('edit-menu-bestseller',{checked:true});
  Object.assign(s,{menuAISaving:false,menuSaveBusy(){},cancelMenuAIWork(){},ensureMenuAI:async()=>true,translateFnbText:t=>'EN '+t,cleanMenuEnglish:t=>t || '',closeEditMenuModal(){},playSuccessChime(){}});
  if(fails)s.fetch=async()=>({ok:false,json:async()=>({error:'save failed'})});
  vm.runInContext(html.slice(html.indexOf('    async function saveProductChanges'),html.indexOf('    function openAddMenuModal')),s);
  await s.saveProductChanges();
  if(fails){assert.deepEqual(ids(s.menu),[1,2,3]);assert.equal(s.menu[0].name,'Tea');}
  else{assert.deepEqual(ids(s.menu),[2,3,1]);const item=s.menu[2];assert.equal(item.name,'New tea');assert.equal(item.name_en,'EN New tea');assert.equal(item.price,49000);assert.equal(item.stock,12);assert.equal(item.isBestSeller,true);assert.equal(item.category,'coffee');assert.equal(item.description,'New description');assert.equal(item.image,values['edit-menu-image-url']);assert.equal(writes.length,1);}
 }
});

