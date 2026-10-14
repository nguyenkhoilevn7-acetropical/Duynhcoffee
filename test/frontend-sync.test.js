'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function setup() {
  const calls = { products: 0, banner: 0, backend: 0, financials: 0 };
  const s = { console, window: {}, document: { getElementById: () => null },
    LOCAL_DEVICE_ID: 'me', isUserAdmin: () => false, isAdminViewActive: () => false,
    lastMenuVersion: null, lastOrdersVersion: null, lastConfigVersion: null, lastDiscountsVersion: null,
    isInitialLoadDone: false, menu: [{id: 1, name: 'Tea', price: 39000}], orders: [], discounts: [],
    storeConfig: {bankConfig: {accountHolder: 'DAO KHOI NGUYEN'}}, bannerUploadedImages: [],
    cart: [], activeDiscount: null, localStorage: {setItem(){}, getItem(){return '';}},
    mergeMenuWithServer: m => m, hasMenuChanged: (a,b) => JSON.stringify(a) !== JSON.stringify(b),
    debouncedSaveLocalData(){}, saveLocalDiscounts(){},
    renderCustomerProducts(){calls.products++;}, renderFrontendBanner(){calls.banner++;},
    renderAllBackendTabs(){calls.backend++;}, renderCustomerFooterInfo(){}, updateCartBadge(){},
    updateCheckoutFinancials(){calls.financials++;}, updateCloudSyncIndicator(){} };
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    let receiptVerificationToken'),html.indexOf('    // ==================== WEBSOCKET CLIENT')),s);
  vm.runInContext(html.slice(html.indexOf('    function handleIncomingMeshPayload'),html.indexOf('    // ==================== PHÁT SỰ KIỆN')),s);
  return {s,calls};
}
test('handshake, HTTP full sync and reconnect do not replace unchanged customer content', () => {
  const {s,calls} = setup();
  const data = {menu: s.menu, orders: [], discounts: [], config: s.storeConfig,
    menuVersion: 1, ordersVersion: 1, configVersion: 1, discountsVersion: 1};
  s.handleIncomingMeshPayload({type:'HANDSHAKE', ...data});
  s.handleIncomingMeshPayload({type:'FULL_SYNC', ...data});
  s.handleIncomingMeshPayload({type:'HANDSHAKE', ...data, menuVersion:2, ordersVersion:2, configVersion:2});
  assert.equal(calls.products,0); assert.equal(calls.banner,0); assert.equal(calls.backend,0);
  assert.equal(s.lastMenuVersion,2);
  s.handleIncomingMeshPayload({type:'FULL_SYNC', ...data, menuVersion:3, configVersion:3,
    menu:[{id:1,name:'New tea',price:39000}],config:{bankConfig:{accountHolder:'NEW RECIPIENT'}}});
  assert.equal(calls.products,1);assert.equal(s.storeConfig.bankConfig.accountHolder,'NEW RECIPIENT');
});
test('duplicate config updates preserve receipt; real bank change invalidates it', () => {
  const {s} = setup();
  vm.runInContext("receiptVerificationToken='token';receiptVerificationContext=paymentContext();isReceiptValid=true;",s);
  s.handleIncomingMeshPayload({type:'CONFIG_UPDATE',config:s.storeConfig,configVersion:1});
  assert.equal(s.isReceiptValid,true);
  s.handleIncomingMeshPayload({type:'CONFIG_UPDATE',config:{bankConfig:{accountHolder:'OTHER'}},configVersion:2});
  assert.equal(s.isReceiptValid,false);
});
test('banner retains its slide and timer on identical sync, changes when banner images change', () => {
  let builds=0,starts=0,stops=0;
  const container={dataset:{},style:{},set innerHTML(v){builds++;}};
  const box={classList:{add(){},remove(){}}};
  const s={window:{},document:{getElementById:id=>id==='frontend-hero-banner'?box:id==='hero-banner-image-container'?container:null},
    bannerSlideTimer:null,bannerActiveSlideIndex:0,config:{images:['a','b'],autoplaySpeed:3.5},
    getBannerConfig(){return s.config;},setInterval(){starts++;return starts;},clearInterval(){stops++;},nextFrontendBannerSlide(){}};
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    function renderFrontendBanner()'),html.indexOf('    function goToFrontendBannerSlide')),s);
  s.renderFrontendBanner();s.bannerActiveSlideIndex=1;s.renderFrontendBanner();
  assert.equal(builds,1);assert.equal(starts,1);assert.equal(stops,0);assert.equal(s.bannerActiveSlideIndex,1);
  s.config={images:['c','d']};s.renderFrontendBanner();assert.equal(builds,2);assert.equal(stops,1);
});
test('slow HTTP polling has only one outstanding request and releases guard after failure',async()=>{
  let requests=0,resolve;
  const s={wsClient:null,isInitialLoadDone:false,lastMenuVersion:null,lastOrdersVersion:null,lastConfigVersion:null,lastDiscountsVersion:null,
    getCloudApiUrl:()=>'/api/sync',AbortController,setTimeout,clearTimeout,Date,
    fetch:()=>{requests++;return new Promise(r=>resolve=r);}};
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    let fullSyncInFlight'),html.indexOf('    // ==================== XỬ LÝ DỮ LIỆU')),s);
  const pending=s.pullFullSyncFromServer();await s.pullFullSyncFromServer();assert.equal(requests,1);
  resolve({ok:false});await pending;
  const next=s.pullFullSyncFromServer();assert.equal(requests,2);resolve({ok:false});await next;
});
test('banner releases hidden images after transition and loads the requested slide',()=>{
  let finish;
  const imgs=[{src:'a'},{src:null},{src:null}].map(x=>({...x,getAttribute(){return this.src;},removeAttribute(){this.src=null;}}));
  const slides=imgs.map(img=>({querySelector:()=>img,classList:{toggle(){}}}));
  const track={};
  const s={window:{},bannerActiveSlideIndex:1,getBannerConfig:()=>({images:['a','b','c']}),
    setTimeout:fn=>{finish=fn;return 1;},clearTimeout(){},
    document:{querySelectorAll:q=>q.includes('track')?slides:[],getElementById:()=>track}};
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    function updateFrontendSliderDom'),html.indexOf('    function copyBannerPromoCode')),s);
  s.updateFrontendSliderDom('fade');assert.equal(imgs[1].src,'b');assert.equal(imgs[0].src,'a');assert.equal(imgs[2].src,null);
  finish();assert.equal(imgs[0].src,null);assert.equal(imgs[1].src,'b');
});
test('receipt decoding releases bitmap and canvas before starting verification',async()=>{
  let closed=false,canvas={width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/png;base64,ok'};
  const s={createImageBitmap:async()=>({width:900,height:1200,close(){closed=true;}}),
    document:{createElement:()=>canvas},showSmsToast(){throw Error('unexpected error');}};
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    async function compressReceiptImage'),html.indexOf('    async function runClientVerifyData')),s);
  let called=false;
  await s.compressReceiptImage({},data=>{called=true;assert.equal(data,'data:image/png;base64,ok');assert.equal(closed,true);assert.equal(canvas.width,0);});
  assert.equal(called,true);
});
