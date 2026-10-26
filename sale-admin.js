/* Admin only: automatic product / all-menu SALE campaigns.
 * Stores campaigns alongside existing discount codes for realtime sync + Drive backup. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  const el = id => document.getElementById(id);
  const selected = new Set();
  let editingId = null;
  let busy = false;
  const fmt = value => new Intl.NumberFormat('vi-VN').format(value)+' đ';
  function message(value, error=false) {
    const target=el('mom-sale-message');
    if(target){target.textContent=value;target.style.color=error?'#b42332':'#166534';}
  }
  function admin() { return typeof isUserAdmin === 'function' && isUserAdmin(); }
  function toggleProducts() {
    const box=el('mom-sale-products-wrap');
    if(box)box.hidden=el('mom-sale-scope')?.value==='all';
  }
  function products() {
    const box=el('mom-sale-products');if(!box)return;
    const needle=(el('mom-sale-search')?.value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    box.replaceChildren();
    (typeof menu!=='undefined'&&Array.isArray(menu)?menu:[]).filter(m=>String(m.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(needle))
      .forEach(m => {
        const label=document.createElement('label');label.className='mom-sale-product-row';
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=String(m.id);checkbox.checked=selected.has(checkbox.value);
        checkbox.addEventListener('change',()=>checkbox.checked?selected.add(checkbox.value):selected.delete(checkbox.value));
        const span=document.createElement('span');span.textContent=(m.name||'Món')+' · '+fmt(m.price||0);
        label.append(checkbox,span);box.append(label);
      });
  }
  function status(p) {
    const now=Date.now();
    if(p.active===false)return ['Đã tắt',false];
    if(p.startsAt && Date.parse(p.startsAt)>now)return ['Sắp bắt đầu',false];
    if(p.endsAt && Date.parse(p.endsAt)<=now)return ['Đã kết thúc',false];
    return ['Đang áp dụng',true];
  }
  function render() {
    if (!el('mom-sale-list')) return;
    const all=Array.isArray(discounts)?discounts:[];
    const sales=all.filter(p=>p?.mode==='automatic'&&p.kind==='sale');
    el('mom-sale-count').textContent=sales.length+' chương trình';
    const box=el('mom-sale-list');box.replaceChildren();
    if(!sales.length){const empty=document.createElement('p');empty.textContent='Chưa có chương trình SALE.';box.append(empty);}
    sales.forEach(p=>{
      const row=document.createElement('article');row.className='mom-sale-card';
      const copy=document.createElement('div');copy.className='mom-sale-card-text';
      const title=document.createElement('strong');title.textContent=p.title+' · '+(p.type==='percent'?'-'+p.value+'%':'-'+fmt(p.value)+'/ly');
      const details=document.createElement('small');
      const scope=p.scope==='all'?'Toàn bộ menu':p.productIds.length+' sản phẩm';
      const range=(p.startsAt?new Date(p.startsAt).toLocaleString('vi-VN'):'Ngay')+' → '+(p.endsAt?new Date(p.endsAt).toLocaleString('vi-VN'):'Không giới hạn');
      details.textContent=scope+' · '+range;
      const tag=document.createElement('span');const st=status(p);tag.className='mom-sale-pill'+(st[1]?'':' off');tag.textContent=st[0];
      copy.append(title,details,tag);row.append(copy);
      const actions=document.createElement('div');actions.className='mom-sale-card-actions';
      [['Sửa',()=>edit(p.id)],[(p.active===false?'Bật':'Tắt'),()=>toggle(p.id)],['Xóa',()=>remove(p.id)]].forEach(([label,fn])=>{
        const b=document.createElement('button');b.type='button';b.textContent=label;
        if(label==='Xóa')b.classList.add('mom-sale-danger');
        b.disabled=busy;b.addEventListener('click',fn);actions.append(b);
      });
      row.append(actions);box.append(row);
    });
    toggleProducts();products();
  }
  const inputDate = iso => iso ? new Date(new Date(iso).getTime()-new Date(iso).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  function edit(id) {
    const p=discounts.find(x=>x.id===id&&x.mode==='automatic');if(!p)return;
    editingId=p.id;selected.clear();(p.productIds||[]).forEach(id=>selected.add(String(id)));
    el('mom-sale-title-input').value=p.title;el('mom-sale-type').value=p.type;el('mom-sale-value').value=p.value;
    el('mom-sale-scope').value=p.scope;el('mom-sale-start').value=inputDate(p.startsAt);el('mom-sale-end').value=inputDate(p.endsAt);
    el('mom-sale-enabled').checked=p.active!==false;el('mom-sale-save').textContent='💾 Lưu thay đổi SALE';message('Đang chỉnh sửa: '+p.title);
    render();el('mom-sale-title-input').scrollIntoView({behavior:'smooth',block:'center'});
  }
  async function save(next) {
    const token=localStorage.getItem('duynh_admin_api_token')||localStorage.getItem('duynh_admin_push_token')||'';
    if(!token){message('Chưa có quyền quản trị API. Vui lòng đăng nhập Admin và kết nối quyền quản trị.',true);return false;}
    busy=true;el('mom-sale-save').disabled=true;
    try{
      const response=await fetch(getCloudApiUrl('/api/discounts'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(next)});
      const result=await response.json();
      if(!response.ok||!result.success)throw Error(result.error||'Không lưu được chương trình SALE.');
      discounts=next;saveLocalDiscounts(false);
      if(typeof broadcastMeshEvent==='function')broadcastMeshEvent('DISCOUNTS_UPDATE',{discounts});
      if(typeof renderAdminDiscountsTable==='function')renderAdminDiscountsTable();
      if(typeof renderCustomerProducts==='function')renderCustomerProducts();
      if(typeof updateCheckoutFinancials==='function' && el('checkout-modal')?.style.display==='flex')updateCheckoutFinancials();
      return true;
    }catch(error){message('Lưu thất bại: '+error.message,true);return false;}
    finally{busy=false;el('mom-sale-save').disabled=false;render();}
  }
  async function create() {
    if(!admin()||busy)return;
    const title=(el('mom-sale-title-input')?.value||'').trim();
    const scope=el('mom-sale-scope').value,type=el('mom-sale-type').value;
    const start=el('mom-sale-start').value,end=el('mom-sale-end').value;
    const p={id:editingId===null?Date.now():editingId,kind:'sale',mode:'automatic',title,scope,type,
      value:Number(el('mom-sale-value').value),productIds:scope==='selected'?[...selected]:[],
      startsAt:start?new Date(start).toISOString():'',endsAt:end?new Date(end).toISOString():'',
      active:el('mom-sale-enabled').checked};
    try{window.MomSalePricing.validateCampaign(p,menu)}catch(error){message(error.message,true);return;}
    const next=editingId===null?[...discounts,p]:discounts.map(x=>x.id===editingId?p:x);
    if(await save(next)){
      editingId=null;selected.clear();['mom-sale-title-input','mom-sale-value','mom-sale-start','mom-sale-end','mom-sale-search'].forEach(id=>{if(el(id))el(id).value='';});
      el('mom-sale-enabled').checked=true;el('mom-sale-save').textContent='＋ Tạo chương trình SALE';
      message('✅ Đã lưu chương trình SALE và đồng bộ với máy chủ.');render();
    }
  }
  async function toggle(id) {
    if(!admin()||busy)return;const p=discounts.find(d=>d.id===id&&d.mode==='automatic');if(!p)return;
    const next=discounts.map(d=>d===p?{...d,active:d.active===false}:d);
    if(await save(next))message('✅ Đã cập nhật trạng thái chương trình.');
  }
  async function remove(id) {
    if(!admin()||busy)return;
    if(!confirm('Xóa chương trình SALE này?'))return;
    if(await save(discounts.filter(d=>d.id!==id))){if(editingId===id)editingId=null;message('✅ Đã xóa chương trình.');}
  }
  window.toggleSaleProducts=toggleProducts;window.renderSaleProducts=products;window.createAutomaticSale=create;
  window.MomSaleAdmin={render};
})();
