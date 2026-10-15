(function(){
  'use strict';
  const key='duynh_admin_push_token',enabledKey='duynh_admin_push_enabled';
  let busy=false, refreshing=false;
  const el=id=>document.getElementById(id);
  const t=text=>window.DuynhI18n?window.DuynhI18n.translate(text):text;
  const admin=()=>localStorage.getItem('duynh_admin_auth')==='1'||sessionStorage.getItem('duynh_admin_auth')==='1';
  const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  function status(text){if(el('admin-push-status'))el('admin-push-status').textContent=t(text);}
  async function api(route,method='GET',body,token=localStorage.getItem(key)){
    const response=await fetch('/api/admin-push/'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
    const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Không kết nối được máy chủ thông báo.'),{status:response.status});return data;
  }
  const bytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
  async function registration(){
    await navigator.serviceWorker.register('/order-notifications-sw.js',{scope:'/',updateViaCache:'none'});
    let timer;
    try{return await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Chưa khởi động được thông báo nền. Vui lòng thử lại.')),15000);})]);}
    finally{clearTimeout(timer);}
  }
  function report(data){
    el('admin-push-test').disabled=!data.enabled;el('admin-push-disable').disabled=!data.enabled;
    status(!data.enabled?'Chưa bật thông báo khi khóa màn hình.':data.durable?'Đã bật thông báo khi khóa màn hình trên máy này.':'Đã bật trên máy này; chưa sao lưu thiết bị lên Drive. Hãy mở lại quản trị sau khi triển khai mới.');
  }
  async function syncSubscription(reg){
    const info=await api('key'),existing=await reg.pushManager.getSubscription();let sub=existing;
    if(sub&&sub.options?.applicationServerKey){
      const old=Array.from(new Uint8Array(sub.options.applicationServerKey)).join(','),next=Array.from(bytes(info.publicKey)).join(',');
      if(old!==next){await sub.unsubscribe();sub=null;}
    }
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(info.publicKey)});
    const result=await api('subscription','POST',{subscription:sub.toJSON(),language:document.documentElement.lang==='en'?'en':'vi'});
    localStorage.setItem(enabledKey,'1');report(result);return result;
  }
  function open(){
    if(!admin())return;
    if(!supported()){status('Trình duyệt này chưa hỗ trợ thông báo nền. Hãy dùng Chrome hoặc Samsung Internet qua HTTPS.');return;}
    if(Notification.permission==='denied'){status('Thông báo đang bị chặn. Hãy cho phép thông báo của website trong cài đặt trình duyệt.');return;}
    el('admin-push-error').textContent='';el('admin-push-password').value='';
    el('admin-push-modal').style.display='flex';
  }
  function close(){el('admin-push-modal').style.display='none';el('admin-push-password').value='';}
  async function enable(event){
    event.preventDefault();if(busy||!admin())return;
    busy=true;el('admin-push-confirm').disabled=true;el('admin-push-error').textContent='';
    try{
      // Invoke directly from the user's button click; never request permission on page load.
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw Error('Chưa được cấp quyền thông báo. Hãy chọn Cho phép để nhận đơn khi khóa màn hình.');
      const auth=await api('session','POST',{username:el('admin-push-username').value.trim(),password:el('admin-push-password').value},'');
      localStorage.setItem(key,auth.token);el('admin-push-password').value='';
      await syncSubscription(await registration());close();
      try{await api('test','POST');}catch(error){status(error.message);}
    }catch(error){el('admin-push-error').textContent=t(error.message);}
    finally{busy=false;el('admin-push-confirm').disabled=false;}
  }
  async function disable({logout=false}={}){
    if(!supported()){localStorage.removeItem(key);localStorage.removeItem(enabledKey);return;}
    let failure=null;
    try{const reg=await navigator.serviceWorker.getRegistration('/');const sub=reg&&await reg.pushManager.getSubscription();if(sub)await sub.unsubscribe();if(reg)for(const notification of await reg.getNotifications())notification.close();}catch(error){failure=error;}
    try{if(localStorage.getItem(key))await api('subscription','DELETE');}catch(error){failure=failure||error;}
    localStorage.removeItem(key);localStorage.removeItem(enabledKey);report({enabled:false});
    if(failure&&!logout)status('Chưa xác nhận tắt thông báo với máy chủ. Hãy kiểm tra mạng rồi thử lại.');
  }
  async function refresh(){
    if(refreshing)return;
    if(!admin()){
      if(localStorage.getItem(key)||localStorage.getItem(enabledKey)==='1')await disable({logout:true});
      return;
    }
    if(!supported()){status('Trình duyệt này chưa hỗ trợ thông báo nền. Hãy dùng Chrome hoặc Samsung Internet qua HTTPS.');return;}
    if(!localStorage.getItem(key)||localStorage.getItem(enabledKey)!=='1'){report({enabled:false});return;}
    refreshing=true;
    try{
      if(Notification.permission!=='granted'){report({enabled:false});status('Thông báo đang bị chặn. Hãy cho phép thông báo của website trong cài đặt trình duyệt.');return;}
      await syncSubscription(await registration());
    }catch(error){
      report({enabled:false});status(error.status===401?'Phiên thông báo đã hết hạn. Hãy bấm Bật thông báo khi khóa màn hình.':error.message);
    }finally{refreshing=false;}
  }
  async function test(){
    if(busy)return;busy=true;
    try{await api('test','POST');status('Đã gửi thông báo thử. Hãy kiểm tra âm báo và thông báo của điện thoại.');}
    catch(error){status(error.message);}finally{busy=false;}
  }
  window.DuynhAdminNotifications={open,close,enable,disable,refresh,test};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
  document.addEventListener('DOMContentLoaded',()=>{el('admin-push-form')?.addEventListener('submit',enable);refresh();});
  window.addEventListener('storage',event=>{if(event.key==='duynh_admin_auth'&&!event.newValue)disable({logout:true});});
})();
