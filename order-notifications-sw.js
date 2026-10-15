'use strict';
// Push only: deliberately no fetch handler/cache, so storefront and receipt APIs stay untouched.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};try{data=event.data.json();}catch{}
  const en=data.language==='en';
  event.waitUntil(self.registration.showNotification(String(data.title||'Đuỷnh Tea & Coffee').slice(0,100),{
    body:String(data.body||(en?'Open Admin to view the order.':'Mở quản trị để xem đơn hàng.')).slice(0,200),
    tag:String(data.tag||'duynh-new-order').slice(0,100),renotify:true,
    silent:false,vibrate:[300,100,300,100,600],requireInteraction:true,
    lang:en?'en':'vi',data:{url:'/#admin'}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL('/#admin',self.location.origin).href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.navigate(url);return client.focus();}}
    return self.clients.openWindow(url);
  })());
});
