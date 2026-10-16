'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {getOptions,validateOptions}=require('../menu-options'),{calculateAmount,createReceiptVerifier}=require('../receipt-verification');
const options={ice:[{id:'extra',name:'Thêm đá',name_en:'Extra ice'}],sugar:[{id:'less',name:'Ít ngọt',name_en:'Less sweet'}],toppings:[{id:'pudding',name:'Pudding',name_en:'Pudding',price:7000}]};
test('per-item options keep defaults compatible, allow disabled groups, and validate duplicates/prices',()=>{
 assert.equal(getOptions({category:'tea'}).toppings.length,4);assert.equal(getOptions({category:'bakery'}).toppings.length,0);
 assert.equal(getOptions({options}).toppings[0].price,7000);
 assert.deepEqual(validateOptions({ice:[],sugar:[],toppings:[]}),{ice:[],sugar:[],toppings:[]});
 for(const bad of [{...options,toppings:[{...options.toppings[0],price:-1}]},{...options,toppings:[...options.toppings,...options.toppings]},{...options,ice:[{id:'x',name:''}]}])assert.throws(()=>validateOptions(bad));
});
test('receipt verification uses the configured topping price and rejects client price spoofing, disabled or removed toppings',async()=>{
 const state={menu:[{id:'new-drink',price:45000,options}],discounts:[],config:{bankConfig:{accountHolder:'DAO KHOI NGUYEN'}}};
 const items=[{id:'new-drink',qty:1,toppings:[{id:'pudding',price:0}]}];
 assert.equal(calculateAmount(items,state.menu,[],null),52000);
 assert.throws(()=>calculateAmount([{id:'new-drink',qty:1,toppings:[{id:'Kem Macchiato'}]}],state.menu,[],null));
 let text='Giao dịch thành công\n45.000đ\nNgười nhận DAO KHOI NGUYEN';const ai=createReceiptVerifier({readState:()=>state,recognize:async()=>text});
 const body={image:'data:image/png;base64,YWJj',items,payableAmount:52000};
 assert.equal((await ai.verify(body)).isValid,false);text=text.replace('45.000','52.000');const good=await ai.verify(body);assert.equal(good.isValid,true);
 const order={receiptImage:body.image,items,total:52000,verificationToken:good.verificationToken};assert.equal(ai.assertVerified(order),true);
 state.menu[0].options={...options,toppings:[]};assert.throws(()=>ai.assertVerified(order));
});
test('admin option editor adds/removes rows and round-trips custom ice, sweetness, bilingual topping and price',()=>{
 const {JSDOM}=require('jsdom'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),dom=new JSDOM(html);
 const s={window:{MenuOptions:require('../menu-options')},document:dom.window.document,currentLang:'vi',translateFnbText:x=>x,alert:()=>{}};vm.createContext(s);
 vm.runInContext(html.slice(html.indexOf('    function menuOptionsFor'),html.indexOf('    function openEditCartItemModal')),s);
 s.renderMenuOptionsEditor('add',{options});assert.equal(s.readMenuOptionsEditor('add').toppings[0].price,7000);
 s.addMenuOptionRow('add','toppings');const rows=dom.window.document.querySelectorAll('#add-menu-options [data-option-group="toppings"] .menu-option-row');const row=rows[1];row.querySelector('[data-field="name"]').value='Hạt đát';row.querySelector('[data-field="name_en"]').value='Palm seeds';row.querySelector('[data-field="price"]').value='9000';
 const saved=s.readMenuOptionsEditor('add');assert.equal(saved.toppings.length,2);assert.equal(saved.toppings[1].price,9000);
 rows[0].querySelector('button').click();assert.equal(s.readMenuOptionsEditor('add').toppings.length,1);
 s.renderMenuOptionsEditor('edit',{options:saved});assert.equal(s.readMenuOptionsEditor('edit').ice[0].name,'Thêm đá');assert.equal(s.readMenuOptionsEditor('edit').sugar[0].name,'Ít ngọt');dom.window.close();
});
test('delete, restock and bestseller wait for acknowledgement, handle string IDs and retain data on failure',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),els=new Map();for(const id of ['quick-restock-id','quick-restock-qty','quick-restock-modal','delete-menu-name','delete-menu-modal','delete-menu-confirm'])els.set(id,{value:'',style:{},textContent:'',disabled:false});
 let finish,writes=0;const s={document:{getElementById:id=>els.get(id)},menu:[{id:'drink-a',name:'Drink',stock:3,isBestSeller:false}],menuOrderSaving:false,localPendingItems:new Map([['drink-a',{item:{id:'drink-a'}}]]),showSmsToast(){},playSuccessChime(){},playAudioChime(){},
 saveOrderedMenu:async draft=>{writes++;s.menuOrderSaving=true;const ok=await new Promise(r=>finish=r);s.menuOrderSaving=false;if(ok)s.menu=draft;return ok;}};
 vm.createContext(s);vm.runInContext(html.slice(html.indexOf('    function closeQuickRestockModal'),html.indexOf('    async function saveStoreSettings')),s);
 vm.runInContext(html.slice(html.indexOf('    async function toggleBestSeller'),html.indexOf('    // AI drafts stay')),s);
 s.deleteMenuItem('drink-a');const fail=s.confirmDeleteMenuItem();assert.equal(s.menu.length,1);assert.equal(els.get('delete-menu-confirm').disabled,true);finish(false);await fail;assert.equal(s.menu.length,1);assert.equal(s.localPendingItems.size,1);
 els.get('quick-restock-id').value='drink-a';els.get('quick-restock-qty').value='0';await s.executeQuickRestock();assert.equal(writes,1);
 els.get('quick-restock-qty').value='2';const restock=s.executeQuickRestock();assert.equal(s.menu[0].stock,3);finish(true);await restock;assert.equal(s.menu[0].stock,5);
 const best=s.toggleBestSeller('drink-a');finish(true);await best;assert.equal(s.menu[0].isBestSeller,true);
 const removed=s.confirmDeleteMenuItem();finish(true);await removed;assert.equal(s.menu.length,0);assert.equal(s.localPendingItems.size,0);assert.equal(els.get('delete-menu-modal').style.display,'none');
});
