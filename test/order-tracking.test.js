'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
test('tracking shows every ordered item, snapshot price/image, old-menu fallback, zero shipping and safe text',()=>{
 const dom=new JSDOM(html,{url:'https://shop.test/',runScripts:'outside-only'}),w=dom.window;
 const items=[{id:1,name:'Trà lúc đặt',qty:2,price:45000,total:90000,image:'https://shop.test/snapshot.jpg',custom:'Ít đá'},
  {id:2,name:'Bánh',qty:1,price:30000},
  {id:99,name:'<img src=x onerror=alert(1)>',qty:1,price:0,total:0,image:'javascript:alert(1)'}];
 const order={id:'ORD-9',status:'new',items,beverageTotal:108000,shippingFee:0};
 w.menu=[{id:1,name:'Changed',price:100000,image:'/changed.jpg'},{id:2,image:'/cake.jpg'}];
 w.findOrderById=()=>order;w.formatMoney=n=>n+' đ';
 w.eval(section('    function renderTrackedOrderItems(', '\n\n    // LƯU TRỮ LOCAL'));
 try{
  w.renderLiveTrackingInfo('ORD-9');
  const list=w.document.getElementById('track-order-items'),rows=list.querySelectorAll('[role=listitem]');
  assert.equal(rows.length,3);assert.match(rows[0].textContent,/Trà lúc đặt.*Ít đá.*2 × 45000 đ.*90000 đ/);
  assert.equal(rows[0].querySelector('img').src,'https://shop.test/snapshot.jpg');
  assert.equal(rows[1].querySelector('img').src,'https://shop.test/cake.jpg');
  assert.match(rows[1].textContent,/30000 đ/);assert.equal(rows[2].querySelector('img'),null);
  assert.match(rows[2].textContent,/<img src=x/);
  assert.equal(w.document.getElementById('track-order-beverage').textContent,'108000 đ');
  assert.equal(w.document.getElementById('track-order-ship').textContent,'0 đ');
  assert.equal(w.document.getElementById('track-order-status-badge').style.position,'static');
  rows[0].querySelector('img').dispatchEvent(new w.Event('error'));assert.equal(rows[0].querySelector('img'),null);
  order.items=[items[1]];w.renderLiveTrackingInfo('ORD-9');assert.equal(list.children.length,1);
  order.items=[];w.renderLiveTrackingInfo('ORD-9');assert.match(list.textContent,/Chưa có chi tiết/);
 }finally{w.close();}
});
test('customer checkout persists item snapshots and uses success confirmation without admin order alarm',async()=>{
 const sent=[],calls={alarm:0,success:0,track:0};
 const s={window:{},AbortController,setTimeout,clearTimeout,document:{getElementById:()=>null},cart:[{item:{id:1,name:'Trà',name_en:'Tea',price:45000,image:'/tea.jpg'},qty:2,custom:'Ít đá'}],
  currentDeliveryAddress:'Test address',currentCustomerReceiptBase64:'receipt',isReceiptValid:true,receiptVerificationToken:'proof',receiptVerificationContext:'current',paymentContext:()=> 'current',
  activeDiscount:null,getSelectedShippingFee:()=>0,currentPendingOrderId:'ORD-NEW',orders:[],selectedDeliveryPartner:'ahamove',currentDistanceKm:1,
  getCloudApiUrl:p=>p,fetch:async(url,opts)=>{sent.push(JSON.parse(opts.body));return{ok:true,json:async()=>({success:true})};},
  menu:[],localStorage:{setItem(){}},saveLocalData(){},playNewOrderAlertSound(){calls.alarm++;},updateCartBadge(){},closePaymentCheckoutModal(){},
  playSuccessChime(){calls.success++;},alert(){},formatMoney:String,renderCustomerProducts(){},renderAllBackendTabs(){},openOrderTrackingModal(){calls.track++;}};
 vm.createContext(s);vm.runInContext(section('    async function submitCustomerOrderWithBill()', '    // ==================== QUẢN LÝ QUẢN TRỊ'),s);
 await s.submitCustomerOrderWithBill();
 assert.equal(sent.length,1);assert.equal(sent[0].items[0].image,'/tea.jpg');assert.equal(sent[0].items[0].name_en,'Tea');
 assert.equal(sent[0].items[0].total,90000);assert.equal(calls.alarm,0);assert.equal(calls.success,1);assert.equal(calls.track,1);
});
test('both admin alarms require login and delayed speech stops after logout',()=>{
 let loggedIn=false,tones=0,spoken=0;const timers=[];
 const s={window:{speechSynthesis:{cancel(){},speak(){spoken++;}}},isUserAdmin:()=>loggedIn,kitchenSoundAlertEnabled:true,
  isVoiceNewOrderEnabled:true,isVoiceKitchenEnabled:true,selectedNewOrderSoundPreset:'a',selectedKitchenSoundPreset:'b',
  playSoundPreset(){tones++;},setTimeout:fn=>timers.push(fn),SpeechSynthesisUtterance:function(text){this.text=text;}};
 vm.createContext(s);vm.runInContext(section('    function playNewOrderAlertSound()', '    // Thay thế hàm playLoudKitchenOrderAlert'),s);
 s.playNewOrderAlertSound();s.playKitchenPrepAlertSound();assert.equal(tones,0);assert.equal(timers.length,0);
 loggedIn=true;s.playNewOrderAlertSound();timers.shift()();assert.equal(tones,1);assert.equal(spoken,1);
 s.playKitchenPrepAlertSound();loggedIn=false;timers.shift()();assert.equal(tones,2);assert.equal(spoken,1);
});
test('customer ignores incoming shop alerts even if stale admin view remains active; admin receives them',()=>{
 let loggedIn=false,alarms=0,toasts=0;
 const s={window:{},document:{getElementById:()=>null},LOCAL_DEVICE_ID:'me',isUserAdmin:()=>loggedIn,isAdminViewActive:()=>true,
  orders:[],playNewOrderAlertSound(){alarms++;},showSmsToast(){toasts++;},debouncedSaveLocalData(){},updateCartBadge(){},updateCloudSyncIndicator(){},renderAllBackendTabs(){}};
 vm.createContext(s);vm.runInContext(section('    function handleIncomingMeshPayload','    // ==================== PHÁT SỰ KIỆN'),s);
 s.handleIncomingMeshPayload({type:'NEW_ORDER',order:{id:'ONE'}});assert.equal(alarms,0);assert.equal(toasts,0);
 loggedIn=true;s.handleIncomingMeshPayload({type:'NEW_ORDER',order:{id:'TWO'}});assert.equal(alarms,1);assert.equal(toasts,1);
 s.handleIncomingMeshPayload({type:'NEW_ORDER',order:{id:'TWO'}});assert.equal(alarms,1);
});
test('customer page removes a previous push registration without requesting notification permission',async()=>{
 const dom=new JSDOM(html,{url:'https://shop.test/',runScripts:'outside-only'}),w=dom.window;let removed=0,permissions=0;
 Object.defineProperty(w,'isSecureContext',{value:true});w.PushManager=function(){};
 w.Notification={permission:'granted',requestPermission:async()=>{permissions++;return'granted';}};
 Object.defineProperty(w.navigator,'serviceWorker',{value:{getRegistration:async()=>({pushManager:{getSubscription:async()=>({unsubscribe:async()=>removed++})},getNotifications:async()=>[]})}});
 w.fetch=async()=>({ok:true,json:async()=>({enabled:false})});
 w.localStorage.setItem('duynh_admin_push_token','old');w.localStorage.setItem('duynh_admin_push_enabled','1');
 w.eval(fs.readFileSync(path.join(__dirname,'../admin-notifications.js'),'utf8'));
 try{await w.DuynhAdminNotifications.refresh();assert.ok(removed>=1);assert.equal(permissions,0);assert.equal(w.localStorage.getItem('duynh_admin_push_token'),null);}
 finally{w.close();}
});

