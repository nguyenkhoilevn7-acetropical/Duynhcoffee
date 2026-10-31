/* Mom's admin-managed product rating display. Buyer reviews remain read-only. */
(function(){
  'use strict';
  let items=[],buyer={},combined={},editorial={},loaded=false,loading=false;
  const root=()=>document.getElementById('mom-rating-admin-list');
  const panel=()=>document.getElementById('mom-rating-admin');
  const txt=(tag,text,className)=>{
    const el=document.createElement(tag);el.textContent=text;
    if(className)el.className=className;
    return el;
  };
  const label=(text,control)=>{
    const el=txt('label',text);el.appendChild(control);return el;
  };
  const number=(min,max,step,value)=>{
    const el=document.createElement('input');el.type='number';el.min=min;el.max=max;el.step=step;
    el.value=String(value);el.inputMode='decimal';return el;
  };
  const fmt=value=>Number(value||0).toFixed(1);
  function renderRows(){
    const target=root();if(!target || !panel()?.open || !loaded)return;
    target.replaceChildren();
    if(!items.length){target.append(txt('p','Chưa có món trong thực đơn.'));return;}
    for(const item of items){
      const id=String(item.id),custom=editorial[id],verified=buyer[id]||{count:0,average:0},mix=combined[id]||verified;
      const card=document.createElement('section');card.className='mom-rating-admin-item';
      const heading=document.createElement('div');heading.className='mom-rating-admin-heading';
      if(item.image && /^(data:image\/(png|jpe?g|webp);base64,|https?:\/\/|\/public\/)/i.test(item.image)){
        const image=document.createElement('img');image.src=item.image;image.alt='';
        image.width=48;image.height=48;image.loading='lazy';heading.appendChild(image);
      }
      const name=document.createElement('div');
      name.append(
        txt('strong',String(item.name||'Món #'+id)),
        txt('small','Tổng cộng: '+fmt(mix.average)+' ♥ · '+mix.count+' lượt'),
        txt('small','Khách đã mua: '+verified.count+' · Do quán thiết lập: '+(custom?.count||0))
      );
      heading.appendChild(name);card.appendChild(heading);
      const fields=document.createElement('div');fields.className='mom-rating-admin-fields';
      const score=number('1','5','0.1',custom?.score??5);
      const count=number('0','1000000','1',custom?.count??0);
      score.setAttribute('aria-label','Điểm tim của '+String(item.name));
      count.setAttribute('aria-label','Số lượt do quán thiết lập của '+String(item.name));
      fields.append(label('Điểm hiển thị (1–5 ♥)',score),label('Số lượt do quán thiết lập',count));
      const actions=document.createElement('div');actions.className='mom-rating-admin-actions';
      const save=txt('button','Lưu rating','mom-rating-admin-save');save.type='button';
      const reset=txt('button','Đặt lại','mom-rating-admin-reset');reset.type='button';reset.disabled=!custom;
      const status=txt('span',custom?'Đã tùy chỉnh':'Đang dùng đánh giá thật','mom-rating-admin-status');
      status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      async function commit(remove){
        if(save.disabled)return;
        const rawScore=score.value.trim(),rawCount=count.value.trim();
        const value=Number(rawScore),qty=Number(rawCount);
        if(!remove && (!rawScore || !rawCount || !Number.isInteger(value*10) || value<1 || value>5 ||
          !Number.isSafeInteger(qty) || qty<0 || qty>1000000)){
          status.textContent='Điểm phải từ 1.0–5.0, số lượt từ 0–1.000.000.';return;
        }
        const token=localStorage.getItem('duynh_admin_api_token')||localStorage.getItem('duynh_admin_push_token')||'';
        if(!window.isUserAdmin?.() || !token){
          status.textContent='Vui lòng đăng nhập quản trị lại.';return;
        }
        save.disabled=true;reset.disabled=true;status.textContent='Đang lưu…';
        try{
          const response=await fetch('/api/admin/ratings',{method:'POST',cache:'no-store',headers:{
            'Content-Type':'application/json',Authorization:'Bearer '+token
          },body:JSON.stringify({productId:id,score:value,count:qty,version:custom?.version||'',remove})});
          const payload=await response.json();
          if(!response.ok || !payload.success)throw Error(payload.error||'Không lưu được rating.');
          if(payload.entry)editorial[id]=payload.entry;else delete editorial[id];
          loaded=true;await refresh();
          window.MomDrinkRatings?.refresh();
        }catch(error){
          status.textContent=error.message||'Không lưu được rating.';
          save.disabled=false;reset.disabled=!custom;
          // 409: reload versions so the next user edit cannot overwrite an unseen change.
          if(/đã thay đổi/.test(error.message||''))refresh();
        }
      }
      save.addEventListener('click',()=>commit(false));
      reset.addEventListener('click',()=>commit(true));
      actions.append(save,reset,status);
      card.append(fields,actions);target.appendChild(card);
    }
  }
  async function refresh(){
    if(loading)return;
    loading=true;
    const target=root();if(target && panel()?.open && !loaded)target.textContent='Đang tải rating…';
    try{
      const response=await fetch('/api/ratings',{cache:'no-store'});
      if(!response.ok)throw Error('Chưa tải được rating.');
      const payload=await response.json();
      buyer=payload.ratings||{};combined=payload.combined||{};editorial=payload.editorial||{};loaded=true;renderRows();
    }catch(error){if(target && panel()?.open)target.textContent=error.message;}
    finally{loading=false;}
  }
  function render(menu){
    items=Array.isArray(menu)?menu:[];
    if(panel()?.open){if(!loaded)refresh();else renderRows();}
  }
  function start(){
    panel()?.addEventListener('toggle',()=>{if(panel()?.open)refresh();});
  }
  window.MomRatingsAdmin={render,refresh};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
