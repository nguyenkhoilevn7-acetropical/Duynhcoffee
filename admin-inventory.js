/* Mom inventory: authenticated purchase planning, separate from public drinks stock. */
(()=>{
'use strict';
const byId=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const en=()=>document.documentElement.lang==='en';
const t=(vi,english)=>en()?english:vi;
const statusText={
  need:['Cần mua','To buy'],planned:['Lên kế hoạch','Planned'],
  ordered:['Đã đặt mua','Ordered'],received:['Đã mua / nhận','Purchased / received']
};
let version='',items=[],activeId='',photo='',dirty=false,busy=false,ready=false,language='',timer=null;
let query='',filter='all';
const labels={
  name:['Tên sản phẩm *','Product name *'],category:['Nhóm hàng','Category'],unit:['Đơn vị','Unit'],
  stock:['Tồn hiện tại','On hand'],minimum:['Báo gần hết khi ≤','Low-stock threshold'],
  buyQuantity:['Số lượng cần mua','Quantity to purchase'],
  purchaseDate:['Ngày dự kiến mua','Planned purchase date'],lastPurchasedDate:['Ngày mua gần nhất','Last purchased'],
  supplier:['Nhà cung cấp (supplier)','Supplier'],supplierPhone:['SĐT / liên hệ','Supplier contact'],
  purchaseLocation:['Mua tại đâu?','Purchase location'],
  status:['Trạng thái mua','Purchase status'],notes:['Ghi chú','Notes']
};
function visible(){return byId('tab-inventory')?.classList.contains('active') && (typeof isUserAdmin!=='function'||isUserAdmin());}
function message(txt,error=false){
 const node=byId('inventory-message');if(node){node.textContent=txt;node.classList.toggle('inv-error',error);}
}
async function request(method='GET',body){
 const token=localStorage.getItem('duynh_admin_api_token')||localStorage.getItem('duynh_admin_push_token')||'';
 const response=await fetch(getCloudApiUrl('/api/admin/inventory'),{
   method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||t('Không kết nối được kho hàng','Unable to load inventory'));
 return data;
}
const field=(key,type='text',extras='')=>`<label class="inv-field"><span>${t(...labels[key])}</span><input name="${key}" id="inv-${key}" type="${type}" ${extras}></label>`;
function init(){
 if(ready)return;
 const root=byId('tab-inventory');if(!root)return;
 root.setAttribute('translate','no');root.setAttribute('data-i18n-preserve','');
 root.innerHTML=`<section class="inv-root" aria-label="Inventory">
 <div class="inv-heading"><div><p>MOM’S TEA & COFFEE · ADMIN</p><h2>📦 ${t('Inventory & Mua hàng','Inventory & Purchasing')}</h2><small>${t('Nguyên liệu, vật tư, bao bì và kế hoạch mua. Không tự động trừ tồn theo đơn bán.','Ingredients, supplies and purchasing plans. Sales do not automatically deduct stock.')}</small></div><button id="inv-refresh" type="button" class="inv-secondary">↻ ${t('Làm mới','Refresh')}</button></div>
 <div class="inv-summary" id="inv-summary"></div>
 <div class="inv-toolbar"><input id="inv-search" type="search" placeholder="${t('Tìm sản phẩm, nhà cung cấp, nơi mua…','Search items, suppliers, stores…')}" aria-label="${t('Tìm trong kho','Search inventory')}"><select id="inv-filter" aria-label="${t('Lọc tình trạng','Filter status')}">
 <option value="all">${t('Tất cả sản phẩm','All items')}</option>
 <option value="low">${t('Gần hết / hết hàng','Low / out of stock')}</option>
 <option value="buy">${t('Cần mua','To buy')}</option>
 <option value="due">${t('Đến hạn mua','Purchase due')}</option>
 <option value="ordered">${t('Đã đặt mua','Ordered')}</option>
 </select><button id="inv-add" type="button" class="inv-primary">+ ${t('Thêm sản phẩm','Add item')}</button></div>
 <div class="inv-grid"><div class="inv-list" id="inv-list" aria-live="polite"></div>
 <section class="inv-editor" aria-labelledby="inv-form-title"><h3 id="inv-form-title">${t('Thêm sản phẩm cần quản lý','Add inventory item')}</h3>
 <form id="inv-form" autocomplete="off"><div class="inv-fields">
 ${field('name','text','required maxlength="120"')}
 ${field('category','text','maxlength="80" placeholder="Trà, sữa, topping, bao bì…"')}
 ${field('stock','number','min="0" max="1000000" step="0.001" required')}
 ${field('minimum','number','min="0" max="1000000" step="0.001" required')}
 ${field('buyQuantity','number','min="0" max="1000000" step="0.001" required')}
 ${field('unit','text','maxlength="30" placeholder="kg, lít, hộp, chai…"')}
 ${field('purchaseDate','date')}
 ${field('lastPurchasedDate','date')}
 ${field('supplier','text','maxlength="120"')}
 ${field('supplierPhone','tel','maxlength="40"')}
 ${field('purchaseLocation','text','maxlength="220" placeholder="Cửa hàng, chợ, địa chỉ, website…"')}
 <label class="inv-field"><span>${t(...labels.status)}</span><select name="status" id="inv-status">${Object.entries(statusText).map(([key,value])=>`<option value="${key}">${t(...value)}</option>`).join('')}</select></label>
 <label class="inv-field inv-span"><span>${t(...labels.notes)}</span><textarea name="notes" id="inv-notes" rows="2" maxlength="1200"></textarea></label>
 <div class="inv-field inv-span"><span>${t('Ảnh sản phẩm','Product photo')}</span><div class="inv-photo-line"><img id="inv-photo" alt="" hidden><div><input type="file" id="inv-file" accept="image/jpeg,image/png,image/webp"><small>${t('Ảnh tự giảm kích thước để lưu và đồng bộ.','Image is resized before saving and syncing.')}</small><button id="inv-remove-photo" type="button" class="inv-secondary">${t('Gỡ ảnh','Remove photo')}</button></div></div></div>
 </div><div class="inv-actions"><button id="inv-save" type="submit" class="inv-primary">${t('Lưu sản phẩm','Save item')}</button><button id="inv-delete" type="button" class="inv-danger" hidden>${t('Xóa sản phẩm','Delete item')}</button></div>
 </form><p class="inv-hint">${t('Tồn kho và ngày mua được nhập thủ công. Đánh dấu “Đã mua” không tự cộng tồn để tránh tính hai lần.','Stock counts and purchase dates are manual. Marking received does not change quantities automatically.')}</p></section></div>
 <p id="inventory-message" class="inv-message" role="status" aria-live="polite"></p>
 </section>`;
 byId('inv-refresh').onclick=()=>reload(true);
 byId('inv-add').onclick=()=>{if(!confirmLeave())return;activeId='';fill(null);drawList();};
 byId('inv-search').oninput=e=>{query=e.target.value.trim().toLocaleLowerCase();drawList();};
 byId('inv-filter').onchange=e=>{filter=e.target.value;drawList();};
 byId('inv-form').addEventListener('input',()=>dirty=true);
 byId('inv-form').onsubmit=save;
 byId('inv-file').onchange=uploadPhoto;
 byId('inv-remove-photo').onclick=()=>{photo='';renderPhoto();dirty=true;};
 byId('inv-delete').onclick=remove;
 ready=true;language=document.documentElement.lang;fill(null);
}
function confirmLeave(){return !dirty||confirm(t('Bỏ các thay đổi chưa lưu?','Discard unsaved changes?'));}
function formValue(row,key,fallback=''){return row?.[key]??fallback;}
function fill(row){
 const form=byId('inv-form');if(!form)return;
 for(const input of form.elements){
   if(!input.name)continue;
   let value=formValue(row,input.name,['stock','minimum','buyQuantity'].includes(input.name)?0:(input.name==='unit'?'cái':input.name==='status'?'need':''));
   input.value=String(value);
 }
 photo=row?.image||'';renderPhoto();byId('inv-file').value='';
 byId('inv-form-title').textContent=row?t('Sửa thông tin sản phẩm','Edit inventory item'):t('Thêm sản phẩm cần quản lý','Add inventory item');
 byId('inv-delete').hidden=!row;dirty=false;
}
function renderPhoto(){
 const preview=byId('inv-photo');preview.hidden=!photo;
 if(photo)preview.src=photo;else preview.removeAttribute('src');
}
function low(item){return Number(item.stock)<=Number(item.minimum);}
function due(item){
 if(!item.purchaseDate||item.status==='received')return false;
 return item.purchaseDate<=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
}
function summary(){
 const counts=[
 [t('Tổng mặt hàng','Total items'),items.length],
 [t('Gần hết / hết hàng','Low stock'),items.filter(low).length],
 [t('Cần mua','To buy'),items.filter(x=>x.status==='need').length],
 [t('Đến hạn mua','Purchase due'),items.filter(due).length]
 ];
 byId('inv-summary').innerHTML=counts.map(([name,value])=>`<div><span>${esc(name)}</span><strong>${value}</strong></div>`).join('');
}
function drawList(){
 if(!ready)return;summary();
 const filtered=items.filter(item=>{
   if(filter==='low'&&!low(item))return false;
   if(filter==='buy'&&item.status!=='need')return false;
   if(filter==='due'&&!due(item))return false;
   if(filter==='ordered'&&item.status!=='ordered')return false;
   return [item.name,item.supplier,item.category,item.purchaseLocation].join(' ').toLocaleLowerCase().includes(query);
 }).sort((a,b)=>Number(low(b))-Number(low(a))||String(a.name).localeCompare(String(b.name),'vi'));
 byId('inv-list').innerHTML=filtered.length?filtered.map(item=>`<button class="inv-item ${item.id===activeId?'selected':''}" data-id="${esc(item.id)}" type="button">
 <span class="inv-thumb">${item.image?`<img src="${item.image}" alt="">`:'📦'}</span>
 <span class="inv-item-info"><strong>${esc(item.name)}</strong><small>${esc(item.supplier||t('Chưa có nhà cung cấp','No supplier'))}</small>
 <small>${esc(t('Tồn: ','Stock: '))}${esc(item.stock)} ${esc(item.unit)} · ${esc(t('Mua: ','Buy: '))}${esc(item.buyQuantity)} ${esc(item.unit)}</small>
 <span class="inv-flags"><em class="inv-pill">${esc(t(...statusText[item.status]))}</em>${low(item)?`<em class="inv-pill inv-alert">${esc(t('⚠ Gần hết hàng','⚠ Low stock'))}</em>`:''}${due(item)?`<em class="inv-pill inv-due">${esc(t('📅 Đến hạn mua','📅 Due'))}</em>`:''}</span>
 ${item.purchaseDate?`<small>${esc(t('Dự kiến: ','Planned: '))}${esc(item.purchaseDate)}</small>`:''}
 </span></button>`).join(''):`<p class="inv-empty">${t('Chưa có sản phẩm phù hợp. Nhấn “Thêm sản phẩm” để bắt đầu.','No matching items. Select “Add item” to get started.')}</p>`;
 byId('inv-list').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{if(!confirmLeave())return;activeId=b.dataset.id;fill(items.find(x=>x.id===activeId));drawList();});
}
async function reload(forced=false){
 if(!ready)return;if(busy)return;
 if(forced&&!confirmLeave())return;if(dirty)return;
 busy=true;try{
   const data=await request();version=data.version;items=data.items||[];
   if(!items.some(x=>x.id===activeId))activeId='';
   fill(activeId?items.find(x=>x.id===activeId):null);drawList();
   if(forced)message(t('Đã tải dữ liệu mới nhất từ máy chủ.','Loaded latest server data.'));
 }catch(e){message(e.message,true);}finally{busy=false;}
}
function dataFromForm(){
 const data=Object.fromEntries(new FormData(byId('inv-form')).entries());
 for(const key of ['stock','minimum','buyQuantity'])data[key]=Number(data[key]);
 data.image=photo;return data;
}
async function save(event){
 event.preventDefault();if(busy||!byId('inv-form').reportValidity())return;
 busy=true;byId('inv-save').disabled=true;
 try{
  const item={...dataFromForm(),id:activeId||''};
  const result=await request('POST',{version,action:'save',item});
  version=result.version;items=result.items;dirty=false;
  activeId=(activeId||items[0]?.id||'');fill(items.find(x=>x.id===activeId));drawList();
  message(t('Đã lưu lên máy chủ. Đồng bộ Drive sẽ thực hiện theo cấu hình backup.','Saved on server. Drive sync follows the backup configuration.'));
 }catch(e){message(e.message,true);}finally{busy=false;byId('inv-save').disabled=false;}
}
async function remove(){
 if(!activeId||busy)return;
 if(!confirm(t('Xóa sản phẩm này khỏi danh sách mua hàng?','Delete this inventory item?')))return;
 busy=true;try{
  const result=await request('POST',{action:'delete',version,id:activeId});
  version=result.version;items=result.items;activeId='';fill(null);drawList();
  message(t('Đã xóa sản phẩm.','Item deleted.'));
 }catch(e){message(e.message,true);}finally{busy=false;}
}
async function uploadPhoto(event){
 const file=event.target.files?.[0];if(!file)return;
 if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>15*1024*1024){message(t('Chỉ nhận JPEG, PNG, WebP tối đa 15 MB trước nén.','JPEG, PNG, WebP only; up to 15 MB before resize.'),true);return;}
 try{
  const bitmap=await createImageBitmap(file);
  const canvas=document.createElement('canvas');let scale=Math.min(1,900/Math.max(bitmap.width,bitmap.height));
  for(let attempt=0;attempt<6;attempt++){
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const result=canvas.toDataURL('image/jpeg',0.76);
   if(result.length<460000){photo=result;dirty=true;renderPhoto();message(t('Đã chuẩn bị ảnh. Nhấn Lưu sản phẩm để cập nhật.','Photo ready. Save item to upload.'));return;}
   scale*=0.7;
  }
  throw Error(t('Ảnh quá lớn, vui lòng chọn ảnh khác.','Image too large. Choose another.'));
 }catch(err){message(err.message,true);}finally{event.target.value='';}
}
window.MomInventory={open(){
 init();
 if(language!==document.documentElement.lang){
   if(dirty&&!confirmLeave())return;
   ready=false;byId('tab-inventory').replaceChildren();init();
 }
 reload();if(!timer)timer=setInterval(()=>{if(visible()&&!document.hidden&&!dirty&&!busy)reload();},15000);
}};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
})();
