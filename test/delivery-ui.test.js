'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
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
