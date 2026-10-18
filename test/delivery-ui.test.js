'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
test('kitchen and shipper buttons visibly acknowledge pending work and recover after failure',()=>{
 const dom=new JSDOM('<button data-order-status-action="ORD-1">Duyệt vào bếp</button><button data-order-status-action="ORD-2">Giao cho shipper</button>',{runScripts:'outside-only'}),w=dom.window;
 try{
  w.viewingReceiptOrderId=null;
  w.eval(section('    window.setOrderActionPending = function(', '    async function deliveryAdminRequest('));
  const [first,second]=w.document.querySelectorAll('button');
  w.setOrderActionPending('ORD-1',true);assert.equal(first.disabled,true);assert.match(first.textContent,/Đang lưu/);assert.equal(second.disabled,false);
  w.setOrderActionPending('ORD-1',false);assert.equal(first.disabled,false);assert.equal(first.textContent,'Duyệt vào bếp');
  w.setOrderActionPending('ORD-2',true);assert.equal(second.getAttribute('aria-busy'),'true');
  w.setOrderActionPending('ORD-2',false);assert.equal(second.textContent,'Giao cho shipper');
 }finally{w.close();}
});
test('tracking displays each real milestone: handover activates delivery, only confirmed delivery finishes it',()=>{
 const dom=new JSDOM(html,{url:'https://shop.test',runScripts:'outside-only'}),w=dom.window,order={id:'ORD-1',status:'new',items:[]};
 w.findOrderById=()=>order;w.menu=[];w.formatMoney=String;
 w.eval(section('    function renderTrackedOrderItems(', '\n\n    // LƯU TRỮ LOCAL'));
 try{
  const active=id=>w.document.getElementById(id).classList.contains('active');
  w.renderLiveTrackingInfo(order.id);assert.equal(active('step-1-received'),true);assert.equal(active('step-2-prep'),false);
  order.status='prep';w.renderLiveTrackingInfo(order.id);assert.equal(active('step-2-prep'),true);assert.equal(active('step-3-shipping'),false);
  order.status='shipping';w.renderLiveTrackingInfo(order.id);assert.equal(active('step-3-shipping'),true);assert.match(w.document.getElementById('track-order-status-badge').textContent,/Shipper/);assert.equal(w.document.getElementById('step-4-delivered').classList.contains('done'),false);
  order.deliveryStatus='failed';w.renderLiveTrackingInfo(order.id);assert.match(w.document.getElementById('track-order-status-badge').textContent,/sự cố/);
  order.status='done';order.deliveryStatus='delivered';w.renderLiveTrackingInfo(order.id);assert.equal(w.document.getElementById('step-4-delivered').classList.contains('done'),true);
 }finally{w.close();}
});
test('kitchen handover waits for server success and never submits a completed status',async()=>{
 const order={id:'ORD-1',status:'prep'},calls=[],toast=[];let succeed=false;
 const s={window:{},AbortSignal,Date,document:{getElementById:()=>({style:{}})},isUserAdmin:()=>true,localStorage:{getItem:()=> 'admin-token',removeItem(){}},
  findOrderById:()=>order,getCloudApiUrl:p=>p,saveLocalData(){},renderAllBackendTabs(){},playSuccessChime(){},showSmsToast:(...args)=>toast.push(args),
  fetch:async(url,opts)=>{calls.push({url,opts});return{ok:succeed,status:succeed?200:503,json:async()=>succeed?{success:true,order:{id:order.id,status:'shipping',deliveryStatus:'in_transit'}}:{error:'offline'}};}};
 vm.createContext(s);vm.runInContext(section('    async function deliveryAdminRequest(', '    // DUYỆT ĐƠN (NEW -> PREP)'),s);
 vm.runInContext(section('    // Bàn giao cho shipper chưa phải', '    function restoreOrder('),s);
 await s.completeOrder(order.id);assert.equal(order.status,'prep');assert.equal(order.completedAtIso,undefined);
 succeed=true;await s.completeOrder(order.id);assert.equal(order.status,'shipping');assert.equal(order.completedAtIso,undefined);
 assert.ok(calls.every(c=>JSON.parse(c.opts.body).status==='shipping'));assert.match(toast.at(-1)[1],/chờ hãng/);
});
test('incoming carrier completion updates tracked order and customer sees only their own status notification',()=>{
 const order={id:'ORD-1',status:'shipping'},calls={render:0,toast:0};
 const s={window:{},document:{getElementById:id=>id==='order-tracking-modal'?{style:{display:'flex'}}:id==='tracking-input-order-id'?{value:'ORD-1'}:null},
  LOCAL_DEVICE_ID:'me',isUserAdmin:()=>false,orders:[order],findOrderById:()=>order,localStorage:{getItem:k=>k==='duynh_latest_order_id'?'ORD-1':null},
  renderLiveTrackingInfo(){calls.render++;},playAudioChime(){},showSmsToast(){calls.toast++;},getStatusBadgeText:s=>s,debouncedSaveLocalData(){},updateCartBadge(){},updateCloudSyncIndicator(){}};
 vm.createContext(s);vm.runInContext(section('    function handleIncomingMeshPayload','    // ==================== PHÁT SỰ KIỆN'),s);
 s.handleIncomingMeshPayload({type:'ORDER_STATUS',data:{orderId:'ORD-1',status:'done',order:{id:'ORD-1',status:'done',deliveryStatus:'delivered',completedAtIso:'confirmed'}}});
 assert.equal(order.status,'done');assert.equal(order.deliveryStatus,'delivered');assert.equal(order.completedAtIso,'confirmed');assert.equal(calls.toast,1);assert.ok(calls.render>0);
 s.handleIncomingMeshPayload({type:'ORDER_STATUS',data:{orderId:'ORD-1',status:'done',order:{id:'ORD-1',status:'done',deliveryStatus:'delivered',deliveryVerifiedAtIso:'later'}}});assert.equal(calls.toast,1);assert.equal(order.deliveryVerifiedAtIso,'later');
 order.status='shipping';s.handleIncomingMeshPayload({type:'ORDER_STATUS',orderId:'ORD-1',status:'done'},'local_tab');assert.equal(order.status,'shipping');
});

test('approving kitchen waits for server and never advertises a handover button after a failed save',async()=>{
 const order={id:'ORD-1',status:'new'},toasts=[];let release;
 const s={window:{},findOrderById:()=>order,Set,showSmsToast:(...a)=>toasts.push(a),playKitchenPrepAlertSound(){},deliveryAdminRequest:()=>new Promise(r=>release=r)};
 vm.createContext(s);vm.runInContext(section('    async function approveOrder(', '    // Bàn giao cho shipper'),s);
 const work=s.approveOrder(order.id);assert.equal(order.status,'new');const duplicate=s.approveOrder(order.id);await duplicate;assert.equal(s.window.pendingOrderActions.size,1);
 order.status='prep';release({success:true});await work;assert.equal(s.window.pendingOrderActions.size,0);assert.match(toasts[0][0],/VÀO BẾP/);
});
test('expired handover session clears both stale tokens and remembers the intended server action for login',async()=>{
 const removed=[],s={window:{},localStorage:{getItem:()=> 'expired',removeItem:k=>removed.push(k)},isUserAdmin:()=>true,document:{getElementById:()=>({style:{}})},getCloudApiUrl:p=>p,AbortSignal,
 fetch:async()=>({ok:false,status:401,json:async()=>({error:'Please sign in'})})};vm.createContext(s);vm.runInContext(section('    async function deliveryAdminRequest(', '    async function dispatchOrderToPartner('),s);
 await assert.rejects(s.deliveryAdminRequest('/api/orders/ORD-1/status',{status:'shipping'}),/sign in/);assert.deepEqual(removed,['duynh_admin_api_token','duynh_admin_push_token']);assert.equal(s.window.pendingDeliveryAction.body.status,'shipping');
});

test('receipt viewer stays open on failed approval and closes only after acknowledged success',async()=>{
 let closed=0,succeed=false,resolve;
 const s={viewingReceiptOrderId:'ORD-1',approveOrder:()=>new Promise(r=>resolve=r),closeReceiptViewerModal:()=>closed++};
 vm.createContext(s);vm.runInContext(section('    async function approveOrderFromModal()', '    // TAB SWITCHING BACKEND'),s);
 const first=s.approveOrderFromModal();assert.equal(closed,0);resolve(false);await first;assert.equal(closed,0);
 const second=s.approveOrderFromModal();assert.equal(closed,0);resolve(true);await second;assert.equal(closed,1);
});
