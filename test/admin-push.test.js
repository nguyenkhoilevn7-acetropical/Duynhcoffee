'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {createAdminPush,validSubscription}=require('../admin-push');
function subscription(id='one'){
 const c=crypto.createECDH('prime256v1');c.generateKeys();return {endpoint:'https://fcm.googleapis.com/fcm/send/'+id,keys:{p256dh:c.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')}};
}
async function fixture(options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duynh-push-')),sent=[];let remote=null,writes=0;
 const config={adminAccount:{username:'owner',password:'configured-secret'}};
 const backup={loadPushState:async()=>remote,savePushState:async data=>{writes++;remote=JSON.parse(JSON.stringify(data));return true;}};
 const service=createAdminPush({dir,readConfig:()=>config,backup,env:{GOOGLE_CLIENT_SECRET:'stable-server-secret'},sendImpl:async(...args)=>sent.push(args),...options});await service.initialize();
 return {service,dir,sent,config,backup,token:service.login('owner','configured-secret','test'),get remote(){return remote;},get writes(){return writes;},close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('only authenticated admin devices subscribe; rejects tampering, expiry and arbitrary endpoints',async()=>{
 let time=1000;const f=await fixture({now:()=>time});try{
  await assert.rejects(f.service.subscribe('forged',subscription(),'vi'),{status:401});
  assert.throws(()=>f.service.login('owner','duynh2026','other'),{status:401});
  const bad=subscription();bad.endpoint='https://localhost/private';assert.equal(validSubscription(bad),false);
  bad.endpoint='https://fcm.googleapis.com.attacker.test/send';assert.equal(validSubscription(bad),false);
  await assert.rejects(f.service.subscribe(f.token,bad,'vi'),{status:400});
  assert.equal(f.service.verify(f.token+'x'),null);time+=31*86400000;assert.equal(f.service.verify(f.token),null);
 }finally{f.close();}
});
test('all subscribed devices get a private high urgency push; refresh is idempotent and logout removes only that device',async()=>{
 const f=await fixture();try{
  const token2=f.service.login('owner','configured-secret','two'),a=subscription('a'),b=subscription('b');
  await f.service.subscribe(f.token,a,'vi');await f.service.subscribe(token2,b,'en');
  const before=f.writes;await f.service.subscribe(f.token,a,'vi');assert.equal(f.writes,before);
  await f.service.notifyOrder({id:'ORD-9',customerName:'PRIVATE NAME',total:45000,address:'PRIVATE ADDRESS',receiptImage:'PRIVATE RECEIPT'});
  assert.equal(f.sent.length,2);assert.match(f.sent[0][1],/Có đơn hàng mới/);assert.match(f.sent[1][1],/New order/);
  for(const [,payload,opts] of f.sent){assert.doesNotMatch(payload,/PRIVATE|45000/);assert.equal(opts.urgency,'high');assert.equal(opts.TTL,3600);assert.ok(opts.vapidDetails.privateKey);}
  await f.service.unsubscribe(f.token);f.sent.length=0;await f.service.notifyOrder({id:'ORD-10'});assert.equal(f.sent.length,1);assert.equal(f.sent[0][0].endpoint,b.endpoint);
  assert.equal(f.service.status(f.token).enabled,false);assert.equal(f.service.status(token2).enabled,true);
 }finally{f.close();}
});
test('Drive restore survives a fresh deployment with stable application keys and device tokens',async()=>{
 const f=await fixture(),other=fs.mkdtempSync(path.join(os.tmpdir(),'duynh-push-restored-'));try{
  await f.service.subscribe(f.token,subscription(),'vi');
  const restored=createAdminPush({dir:other,readConfig:()=>f.config,backup:f.backup,env:{GOOGLE_CLIENT_SECRET:'stable-server-secret'},sendImpl:async(...args)=>f.sent.push(args)});
  await restored.initialize();assert.equal(restored.publicKey,f.service.publicKey);assert.ok(restored.verify(f.token));assert.equal(restored.status(f.token).durable,true);
  await restored.notifyOrder({id:'AFTER-DEPLOY'});assert.equal(f.sent.length,1);
  assert.doesNotMatch(JSON.stringify(f.remote),/privateKey|configured-secret|stable-server-secret/);
 }finally{f.close();fs.rmSync(other,{recursive:true,force:true});}
});
test('expired endpoints are removed, transient failures retained, changed credentials revoke delivery',async()=>{
 let failure=410;const f=await fixture({sendImpl:async()=>{throw Object.assign(Error('push failed'),{statusCode:failure});}});try{
  await f.service.subscribe(f.token,subscription(),'vi');await f.service.notifyOrder({id:'a'});assert.equal(f.service.status(f.token).enabled,false);
  failure=503;await f.service.subscribe(f.token,subscription(),'vi');await f.service.notifyOrder({id:'b'});assert.equal(f.service.status(f.token).enabled,true);
  f.config.adminAccount.password='new-password';assert.equal(f.service.verify(f.token),null);assert.equal(f.service.status(f.token).enabled,false);
  await f.service.notifyOrder({id:'c'});assert.equal(f.service.status(f.token).enabled,false);
 }finally{f.close();}
});
test('push failure does not lose device data and local persistence is never reported as durable',async()=>{
 const f=await fixture({backup:{loadPushState:async()=>null,savePushState:async()=>{throw Error('offline');}}});try{
  const result=await f.service.subscribe(f.token,subscription(),'vi');assert.equal(result.enabled,true);assert.equal(result.durable,false);assert.ok(result.warning);
  const bytes=JSON.parse(fs.readFileSync(path.join(f.dir,'.admin-push.json')));assert.equal(bytes.subscriptions.length,1);
  assert.equal(fs.statSync(path.join(f.dir,'.admin-push.json')).mode&0o777,0o600);
 }finally{f.close();}
});
test('failed authentication is rate limited',async()=>{
 const f=await fixture();try{
  for(let i=0;i<5;i++)assert.throws(()=>f.service.login('owner','wrong','same'),{status:401});
  assert.throws(()=>f.service.login('owner','configured-secret','same'),{status:429});
 }finally{f.close();}
});
test('notification payload encrypts and signs with real Web Push library',async()=>{
 let encrypted;
 const f=await fixture({sendImpl:async(...args)=>{encrypted=require('web-push').generateRequestDetails(...args);}});try{
  await f.service.subscribe(f.token,subscription(),'vi');await f.service.notifyOrder({id:'TEST'});
  assert.ok(encrypted.body.length>0);assert.equal(encrypted.headers['Content-Encoding'],'aes128gcm');
  assert.match(encrypted.headers.Authorization,/vapid/);assert.equal(encrypted.headers.Urgency,'high');
 }finally{f.close();}
});
test('admin UI requests permission only on explicit enable, restores on reload and unsubscribes on logout',async()=>{
 const {JSDOM,VirtualConsole}=require('jsdom');
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://shop.test/',runScripts:'outside-only',virtualConsole:new VirtualConsole()});const w=dom.window;
 let requests=0,subscribed=0,unsubscribed=0,registered=0;const calls=[],sub=subscription();let current=null;
 const curve=crypto.createECDH('prime256v1');curve.generateKeys();const publicKey=curve.getPublicKey().toString('base64url');
 const reg={pushManager:{getSubscription:async()=>current,subscribe:async()=>{subscribed++;current={toJSON:()=>sub,unsubscribe:async()=>{unsubscribed++;current=null;}};return current;}},getNotifications:async()=>[]};
 Object.defineProperty(w,'isSecureContext',{value:true});w.PushManager=function(){};
 w.Notification={permission:'granted',requestPermission:async()=>{requests++;return 'granted';}};
 Object.defineProperty(w.navigator,'serviceWorker',{value:{register:async()=>{registered++;return reg;},ready:Promise.resolve(reg),getRegistration:async()=>reg}});
 w.fetch=async(url,options)=>{calls.push([url,options]);let data={};
  if(url.endsWith('/key'))data={publicKey};else if(url.endsWith('/session'))data={token:'device-session'};
  else if(url.endsWith('/subscription'))data={enabled:options.method!=='DELETE',durable:true};else data={sent:true};
  return {ok:true,json:async()=>data};};
 w.localStorage.setItem('duynh_admin_auth','1');
 w.eval(fs.readFileSync(path.join(__dirname,'../admin-notifications.js'),'utf8'));
 try{
  await w.DuynhAdminNotifications.refresh();assert.equal(requests,0);assert.equal(registered,0);
  w.DuynhAdminNotifications.open();assert.equal(w.document.getElementById('admin-push-modal').style.display,'flex');
  w.document.getElementById('admin-push-password').value='password-for-request-only';
  await w.DuynhAdminNotifications.enable({preventDefault(){}});assert.equal(requests,1);assert.equal(subscribed,1);
  assert.equal(w.document.getElementById('admin-push-password').value,'');assert.equal(w.localStorage.getItem('duynh_admin_push_enabled'),'1');
  assert.equal(w.localStorage.getItem('duynh_admin_push_token'),'device-session');assert.doesNotMatch(JSON.stringify(w.localStorage),/password-for-request-only/);
  await w.DuynhAdminNotifications.refresh();assert.equal(requests,1);assert.equal(subscribed,1);
  await w.DuynhAdminNotifications.disable({logout:true});assert.equal(unsubscribed,1);assert.equal(w.localStorage.getItem('duynh_admin_push_token'),null);
  assert.ok(calls.some(([url,opts])=>url.endsWith('/subscription')&&opts.method==='DELETE'));
 }finally{w.close();}
});
test('worker shows audible notification without an open tab and click opens admin; never caches website requests',async()=>{
 const handlers={},shown=[],opened=[];let waited;
 const self={addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(...args)=>shown.push(args)},location:{origin:'https://shop.test'},
   clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../order-notifications-sw.js'),'utf8'),{self,URL});
 assert.equal(handlers.fetch,undefined);
 handlers.push({data:{json:()=>({title:'Có đơn hàng mới',tag:'order-1',language:'vi'})},waitUntil:p=>waited=p});await waited;
 assert.equal(shown.length,1);assert.equal(shown[0][1].silent,false);assert.equal(shown[0][1].renotify,true);assert.ok(shown[0][1].vibrate.length);
 let closed=false;handlers.notificationclick({notification:{close:()=>closed=true},waitUntil:p=>waited=p});await waited;
 assert.equal(closed,true);assert.deepEqual(opened,['https://shop.test/#admin']);
});
