'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const equal = (a,b) => { const x=Buffer.from(String(a)),y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); };
function validSubscription(sub) {
  try {
    const u=new URL(sub.endpoint);
    // Only browser push providers; never allow the server to call arbitrary URLs.
    if(u.protocol!=='https:' || u.port || u.username || u.password || u.hash ||
       !['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname) &&
       !u.hostname.endsWith('.notify.windows.com')) return false;
    const key=Buffer.from(sub.keys.p256dh,'base64url'),auth=Buffer.from(sub.keys.auth,'base64url');
    return sub.endpoint.length<2048 && key.length===65 && key[0]===4 && auth.length===16;
  } catch { return false; }
}
function createAdminPush({dir,readConfig,backup,env=process.env,sendImpl,now=Date.now}) {
  const file=path.join(dir,'.admin-push.json');
  let disk={}; try{disk=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  let privateKey;
  if(env.GOOGLE_CLIENT_SECRET) privateKey=crypto.createHash('sha256').update('duynh-admin-push-v1\0'+env.GOOGLE_CLIENT_SECRET).digest();
  else privateKey=disk.privateKey ? Buffer.from(disk.privateKey,'base64url') : crypto.randomBytes(32);
  const curve=crypto.createECDH('prime256v1');curve.setPrivateKey(privateKey);
  const publicKey=curve.getPublicKey().toString('base64url');
  const sign = value => crypto.createHmac('sha256',privateKey).update(value).digest('base64url');
  let subscriptions=Array.isArray(disk.subscriptions)?disk.subscriptions.filter(x=>validSubscription(x.subscription)):[];
  let cloudReady=false, cloudSaved=false, lastError=null, persistence=Promise.resolve();
  const failures=new Map();
  const snapshot=()=>({schema:'duynh-admin-push-v1',publicKey,subscriptions});
  function saveLocal(){fs.writeFileSync(file+'.tmp',JSON.stringify({...snapshot(),privateKey:privateKey.toString('base64url')}),{mode:0o600});fs.renameSync(file+'.tmp',file);}
  async function persist(){
    saveLocal();
    if(!cloudReady) { cloudSaved=false;return; }
    const data=JSON.parse(JSON.stringify(snapshot()));
    const job=persistence.then(()=>backup.savePushState(data));persistence=job.catch(()=>{});
    try{cloudSaved=await job;lastError=null;}catch{cloudSaved=false;lastError='Không sao lưu được thiết bị nhận thông báo';}
  }
  async function initialize(){
    try {
      const remote=await backup.loadPushState();cloudReady=true;
      if(remote?.schema==='duynh-admin-push-v1'&&remote.publicKey===publicKey&&Array.isArray(remote.subscriptions)) {
        subscriptions=remote.subscriptions.filter(x=>validSubscription(x.subscription)).slice(0,100);cloudSaved=true;
      }
      saveLocal();
    } catch {lastError='Chưa phục hồi được thiết bị nhận thông báo';saveLocal();}
  }
  function credentialFingerprint(){const a=readConfig().adminAccount||{};return sign(JSON.stringify([a.username||'admin',a.password||'duynh2026']));}
  function login(user,password,ip){
    const current=now(),previous=failures.get(ip);
    if(previous&&previous.until>current&&previous.count>=5)throw Object.assign(Error('Thử đăng nhập quá nhiều lần. Vui lòng đợi 15 phút.'),{status:429});
    const account=readConfig().adminAccount||{};
    if(!equal(user,account.username||'admin')||!equal(password,account.password||'duynh2026')) {
      if(failures.size>1000)failures.clear();
      failures.set(ip,{count:previous&&previous.until>current?previous.count+1:1,until:previous&&previous.until>current?previous.until:current+15*60000});
      throw Object.assign(Error('Tài khoản hoặc mật khẩu không chính xác! Vui lòng thử lại.'),{status:401});
    }
    failures.delete(ip);
    const value=Buffer.from(JSON.stringify({id:crypto.randomBytes(24).toString('hex'),exp:current+30*86400000,account:credentialFingerprint()})).toString('base64url');
    return value+'.'+sign(value);
  }
  function verify(token){
    try{const [value,signature]=String(token).split('.');if(!equal(sign(value),signature))return null;
      const p=JSON.parse(Buffer.from(value,'base64url'));return p.exp>now()&&p.account===credentialFingerprint()?p:null;
    }catch{return null;}
  }
  const owner = token => sign(token);
  async function subscribe(token,sub,language){
    if(!verify(token))throw Object.assign(Error('Vui lòng xác nhận tài khoản quản trị để bật thông báo.'),{status:401});
    if(!validSubscription(sub))throw Object.assign(Error('Thiết bị nhận thông báo không hợp lệ.'),{status:400});
    const entry={owner:owner(token),subscription:{endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}},language:language==='en'?'en':'vi',account:credentialFingerprint()};
    const idx=subscriptions.findIndex(x=>x.subscription.endpoint===sub.endpoint);
    if(idx>=0&&JSON.stringify(subscriptions[idx])===JSON.stringify(entry)&&cloudSaved)return {enabled:true,durable:true};
    if(idx>=0)subscriptions[idx]=entry;else{if(subscriptions.length>=100)throw Object.assign(Error('Đã đủ 100 thiết bị nhận thông báo.'),{status:409});subscriptions.push(entry);}
    await persist();return {enabled:true,durable:cloudSaved,warning:lastError};
  }
  async function unsubscribe(token){
    if(!verify(token))throw Object.assign(Error('Phiên thông báo đã hết hạn.'),{status:401});
    subscriptions=subscriptions.filter(x=>x.owner!==owner(token));await persist();return {enabled:false};
  }
  async function deliver(entry,payload){
    const send=sendImpl||((...args)=>require('web-push').sendNotification(...args));
    try {
      await send(entry.subscription,JSON.stringify(payload),{TTL:3600,urgency:'high',timeout:10000,
        vapidDetails:{subject:'https://mom-bd4h.onrender.com',publicKey,privateKey:privateKey.toString('base64url')}});
      return true;
    }catch(e){
      if(e.statusCode===404||e.statusCode===410){subscriptions=subscriptions.filter(x=>x!==entry);await persist();}
      return false;
    }
  }
  function message(entry,id,test=false){
    const en=entry.language==='en';
    // No customer names, addresses, amounts or receipts on the lock screen.
    return {title:test?(en?'Mom • Test notification':'Mom • Thông báo thử'):(en?'Mom • New order':'Mom • Có đơn hàng mới'),
      body:en?'Open Admin to view the order.':'Mở quản trị để xem đơn hàng.',
      tag:test?'duynh-push-test':'duynh-order-'+crypto.createHash('sha256').update(String(id)).digest('hex').slice(0,24),language:entry.language};
  }
  async function notifyOrder(order){
    const entries=subscriptions.filter(x=>x.account===credentialFingerprint());
    // Bound fan-out; never hold up saving or acknowledging a customer order.
    for(let i=0;i<entries.length;i+=5)await Promise.all(entries.slice(i,i+5).map(entry=>deliver(entry,message(entry,order.id))));
  }
  async function test(token){
    const entries=subscriptions.filter(x=>x.owner===owner(token)&&x.account===credentialFingerprint());
    if(!entries.length)throw Object.assign(Error('Hãy bật thông báo trên máy này trước.'),{status:409});
    const results=await Promise.all(entries.map(entry=>deliver(entry,message(entry,'test',true))));
    if(!results.some(Boolean))throw Object.assign(Error('Chưa gửi được thông báo thử. Vui lòng bật lại thông báo.'),{status:503});
    return {sent:true};
  }
  function status(token){return {enabled:subscriptions.some(x=>x.owner===owner(token)&&x.account===credentialFingerprint()),durable:cloudSaved,warning:lastError};}
  return {initialize,publicKey,login,verify,subscribe,unsubscribe,notifyOrder,test,status};
}
module.exports={createAdminPush,validSubscription};
