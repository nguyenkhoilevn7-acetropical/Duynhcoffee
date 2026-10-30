/* Mom's verified purchase heart ratings — customer-facing UI only.
   The backend owns eligibility and totals; no local votes enter aggregates. */
(function(){
  'use strict';
  const STORE='mom_verified_rating_orders_v1';
  let summaries={},credentials=[],inFlight=false;
  function load(){
    try{
      const value=JSON.parse(localStorage.getItem(STORE)||'[]');
      return Array.isArray(value)?value.filter(x=>x&&/^[a-f0-9]{64}$/i.test(x.proof)&&Array.isArray(x.ids)).slice(-40):[];
    }catch{return [];}
  }
  function persist(){try{localStorage.setItem(STORE,JSON.stringify(credentials.slice(-40)));}catch(_){}}
  const fmt=n=>Number(n||0).toFixed(1);
  const lang=()=>document.documentElement.lang==='en'?'en':'vi';
  const msg=(vi,en)=>lang()==='en'?en:vi;
  const purchase=id=>credentials.find(x=>x.ids.includes(String(id)))||null;
  const currentRating=id=>summaries[String(id)]||{count:0,average:0};
  function newProof(){
    if(!window.crypto||typeof window.crypto.getRandomValues!=='function')return undefined;
    const bytes=new Uint8Array(32);window.crypto.getRandomValues(bytes);
    return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  }
  function rememberOrder({orderId,items,proof,confirmed}) {
    if(!confirmed||typeof proof!=='string'||!/^[a-f0-9]{64}$/i.test(proof)||!Array.isArray(items))return;
    credentials=credentials.filter(o=>String(o.orderId)!==String(orderId));
    credentials.push({orderId:String(orderId),proof,ids:[...new Set(items.map(i=>String(i.id)))]});
    persist();paint();
  }
  function paint(){
    const container=document.getElementById('customer-products-grid');
    if(!container)return;
    for(const target of container.querySelectorAll('.mom-heart-ratings[data-product-id]')){
      const id=String(target.dataset.productId),data=currentRating(id),owned=!!purchase(id);
      target.replaceChildren();
      const buttons=document.createElement('div');buttons.className='mom-heart-buttons';
      buttons.setAttribute('role','group');buttons.setAttribute('aria-label',
        msg('Đánh giá món này bằng trái tim','Rate this drink with hearts'));
      for(let score=1;score<=5;score++){
        const btn=document.createElement('button');
        btn.type='button';btn.className='mom-heart-rating-btn';
        btn.textContent=score<=Math.round(data.average)?'♥':'♡';
        btn.classList.toggle('filled',score<=Math.round(data.average));
        btn.setAttribute('aria-label',msg('Đánh giá '+score+' tim','Rate '+score+' hearts'));
        btn.title=owned?msg('Chấm '+score+' tim','Give '+score+' hearts'):
          msg('Chỉ khách đã đặt món này mới có quyền đánh giá','Only verified purchasers may rate');
        btn.addEventListener('click',event=>{event.stopPropagation();rate(id,score);});
        buttons.appendChild(btn);
      }
      const meta=document.createElement('span');meta.className='mom-heart-meta';
      meta.textContent=fmt(data.average)+' ('+data.count+' '+msg('đánh giá','ratings')+')';
      target.append(buttons,meta);
    }
  }
  function feedback(text,error=false){
    if(typeof window.showSmsToast==='function'){
      window.showSmsToast(error?'⚠️ ĐÁNH GIÁ':'❤️ ĐÁNH GIÁ',text);
    }else if(typeof window.alert==='function')window.alert(text);
  }
  async function rate(id,score){
    const grant=purchase(id);
    if(!grant){
      feedback(msg('Chỉ khách đã đặt và thanh toán món này mới được đánh giá. Hãy đặt món trước nhé.',
        'Only verified buyers of this drink can rate it. Please order first.'),true);
      return;
    }
    if(inFlight)return;
    inFlight=true;
    try{
      const response=await fetch('/api/ratings',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({orderId:grant.orderId,proof:grant.proof,productId:id,score})});
      const result=await response.json();
      if(!response.ok||!result.summary)throw Error(result.error||'Unable to save rating');
      summaries[id]=result.summary;paint();
      feedback(msg('Đã ghi nhận '+score+' tim. Cảm ơn anh/chị!',
        'Your '+score+'-heart rating has been saved. Thank you!'));
    }catch(error){feedback(error.message,true);}
    finally{inFlight=false;}
  }
  async function refresh(){
    try {
      const response=await fetch('/api/ratings',{cache:'no-store'});
      if(!response.ok)return;
      const payload=await response.json();
      if(payload&&typeof payload.ratings==='object'&&payload.ratings){
        summaries=payload.ratings;paint();
      }
    }catch(_){}
  }
  function start(){
    credentials=load();paint();refresh();
    window.setInterval(()=>{if(!document.hidden)refresh();},45000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  }
  window.MomDrinkRatings={newProof,rememberOrder,paint,refresh};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();