'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');

test('customer startup builds product images and banner only once', () => {
  const calls = { products: 0, banner: 0, sync: 0 };
  const view = { classList: { add() {}, remove() {} } };
  const s = { console: { log() {}, error() {} }, window: { location: { hash: '' } },
    document: { querySelectorAll: () => [view], getElementById: () => view },
    ensureHealthyMenuImages() {}, sanitizeOrdersData() {}, applyLanguageToStaticDom() {},
    renderCategoryFilterPills() {}, updateCartBadge() {}, startLiveWaitTimerTicker() {},
    initRealtimeCloudMesh() { calls.sync++; },
    renderCustomerProducts() { calls.products++; }, renderFrontendBanner() { calls.banner++; } };
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    function switchView(mode)'), html.indexOf('    // MÔ PHỎNG ĐƠN MỚI CÓ BILL')), s);
  vm.runInContext(html.slice(html.indexOf('    function initAppBoot()'), html.indexOf('    // =========================================================================', html.indexOf('    function initAppBoot()'))), s);
  s.initAppBoot();
  assert.equal(calls.products, 1);
  assert.equal(calls.banner, 1);
  assert.equal(calls.sync, 1);
});

test('product cards defer image decoding below the viewport', () => {
  const grid = { innerHTML: '' };
  const s = { window: {}, document: { getElementById: () => grid }, currentCategory: 'all',
    menu: [{ id: 1, name: 'Tea', image: 'receipt-free-menu.jpg', price: 39000, category: 'tea' }],
    getItemLocalizedName: i => i.name, getItemLocalizedDesc: () => '', formatMoney: String };
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    function renderCustomerProducts()'), html.indexOf('    function filterCategory')), s);
  s.renderCustomerProducts();
  assert.match(grid.innerHTML, /class="product-img" loading="lazy" decoding="async"/);
});

test('initial sync uses one automatic WebSocket snapshot, with bounded HTTP fallback', () => {
  for (const receivesHandshake of [true,false]) {
    const timers = new Map();let next=0,requests=0,locals=0;
    const s={console:{log(){}},isInitialLoadDone:false,pollIntervalTimer:null,
      initWebSocketSync(){},initLocalTabSync(){locals++;},pullFullSyncFromServer(){requests++;},
      setTimeout(fn,ms){timers.set(++next,{fn,ms});return next;},clearTimeout(id){timers.delete(id);},
      setInterval(fn,ms){timers.set(++next,{fn,ms});return next;},clearInterval(id){timers.delete(id);}};
    vm.createContext(s);
    vm.runInContext(html.slice(html.indexOf('    let initialSyncFallbackTimer'),html.indexOf('    const DEFAULT_INITIAL_MENU')),s);
    s.initRealtimeCloudMesh();assert.equal(requests,0);assert.equal(locals,1);
    s.isInitialLoadDone=receivesHandshake;
    [...timers.values()].find(t=>t.ms===1500).fn();assert.equal(requests,receivesHandshake?0:1);
    [...timers.values()].find(t=>t.ms===6500).fn();assert.equal(requests,receivesHandshake?1:2);
  }
});

test('WebSocket connection accepts server handshake without requesting duplicate full data', () => {
  let socket,received=0;const sent=[];
  class WebSocket {constructor(){socket=this;this.readyState=1;}send(data){sent.push(JSON.parse(data));}}
  const s={WebSocket,wsClient:null,wsPingTimer:null,wsReconnectTimer:null,console:{log(){},warn(){}},
    getCloudWsUrl:()=> 'wss://example.test',updateCloudSyncIndicator(){},clearTimeout(){},clearInterval(){},
    setInterval(){return 1;},setTimeout(){return 1;},handleIncomingMeshPayload(p){if(p.type==='HANDSHAKE') received++;}};
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    function initWebSocketSync()'),html.indexOf('    // ==================== MULTI-TAB')),s);
  s.initWebSocketSync();socket.onopen();socket.onmessage({data:JSON.stringify({type:'HANDSHAKE',menu:[{id:1}]})});
  assert.equal(received,1);assert.equal(sent.length,0);
});

test('modal locks the document scroller and restores it after nested or forced closes', () => {
  const classes=()=>{const names=new Set();return {add:n=>names.add(n),remove:n=>names.delete(n),contains:n=>names.has(n)};};
  const root={classList:classes()},body={classList:classes(),style:{overflow:''}};
  const s={window:{},document:{documentElement:root,body}};
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    let activeModalCount'),html.indexOf('async function openPaymentCheckoutModal')),s);
  s.lockScreenScroll();s.lockScreenScroll();s.unlockScreenScroll();
  assert.equal(root.classList.contains('modal-open'),true);
  s.unlockScreenScroll();assert.equal(root.classList.contains('modal-open'),false);assert.equal(body.style.overflow,'');
  s.lockScreenScroll();s.lockScreenScroll();s.unlockScreenScroll(true);
  assert.equal(root.classList.contains('modal-open'),false);assert.equal(body.classList.contains('modal-open'),false);
  s.unlockScreenScroll();assert.equal(root.classList.contains('modal-open'),false);
});

test('checkout never leaks scroll locks on empty cart, duplicate opens or missing modal',async()=>{
  const rootNames=new Set(),bodyNames=new Set();const cl=set=>({add:n=>set.add(n),remove:n=>set.delete(n)});
  let modal={style:{display:'none'}};
  const s={window:{},document:{documentElement:{classList:cl(rootNames)},body:{classList:cl(bodyNames),style:{}},
    getElementById:id=>id==='checkout-modal'?modal:null},
    fetch:async()=>({ok:true,json:async()=>({})}),getCloudApiUrl:()=>'/config',applyServerConfig(){},alert(){},
    cart:[],orders:[],storeConfig:{bankConfig:{}},currentDistanceKm:0,currentDeliveryAddress:'',
    hideFloatingCartNow(){},closeCartDrawer(){},calculateShippingFees:()=>({feeAhamove:1,feeLalamove:1}),
    formatMoney:String,updateShipFeeDisplay(){},updateGoogleMapsPreview(){},updateCheckoutFinancials(){}};
  vm.createContext(s);
  vm.runInContext(html.slice(html.indexOf('    let activeModalCount'),html.indexOf('    // GỬI ĐƠN HÀNG')),s);
  await s.openPaymentCheckoutModal();assert.equal(rootNames.has('modal-open'),false);
  s.cart=[{qty:1,item:{price:45000}}];
  await Promise.all([s.openPaymentCheckoutModal(),s.openPaymentCheckoutModal()]);
  assert.equal(rootNames.has('modal-open'),true);
  s.closePaymentCheckoutModal();assert.equal(rootNames.has('modal-open'),false);
  s.lockScreenScroll();s.closePaymentCheckoutModal();assert.equal(rootNames.has('modal-open'),true);
  s.unlockScreenScroll();modal=null;await s.openPaymentCheckoutModal();assert.equal(rootNames.has('modal-open'),false);
});

test('closing login as a guest returns to the menu rather than leaving an empty page',()=>{
 const element={style:{display:'flex'}};let customerViews=0;
 const s={document:{getElementById:()=>element},isUserAdmin:()=>false,switchView:mode=>{assert.equal(mode,'customer');customerViews++;}};
 vm.createContext(s);vm.runInContext(html.slice(html.indexOf('    function closeAdminLoginModal'),html.indexOf('    async function executeAdminLogin')),s);
 s.closeAdminLoginModal();assert.equal(element.style.display,'none');assert.equal(customerViews,1);
 s.isUserAdmin=()=>true;s.closeAdminLoginModal();assert.equal(customerViews,1);
});
