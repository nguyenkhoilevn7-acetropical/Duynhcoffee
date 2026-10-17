/* Private drink preparation recipes; loaded only on an explicit admin action. */
(() => {
  'use strict';
  let state = null, opener = null, requestId = 0;
  const ingredientIcon = name => /trà/i.test(name)?'🍃':/cà phê|coffee/i.test(name)?'☕':/sữa|kem/i.test(name)?'🥛':/đá|nước/i.test(name)?'💧':/chanh|cam/i.test(name)?'🍋':/dâu/i.test(name)?'🍓':'🥄';
  const el = id => document.getElementById(id);
  const txt = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => Number(value).toLocaleString('vi-VN', {maximumFractionDigits:3});
  async function api(method, body) {
    const token = localStorage.getItem('duynh_admin_api_token') || localStorage.getItem('duynh_admin_push_token') || '';
    const url = '/api/drink-recipes' + (body?.scan ? '/scan' : '') + (method === 'GET' ? '?itemId='+encodeURIComponent(state.id) : '');
    const response = await fetch(getCloudApiUrl(url), {method, headers:{'Content-Type':'application/json', Authorization:'Bearer '+token},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(body?.scan?40000:15000)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không tải được công thức. Vui lòng thử lại.');
    return result;
  }
  function createModal() {
    if (el('drink-recipe-modal')) return;
    const root = document.createElement('div'); root.id='drink-recipe-modal'; root.className='modal-overlay';
    root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.setAttribute('aria-labelledby','recipe-title');
    root.innerHTML='<div class="modal-card recipe-card"><div class="modal-header"><h2 id="recipe-title">Công thức pha chế</h2><button type="button" class="modal-close" aria-label="Đóng công thức" id="recipe-close">✕</button></div><div class="modal-body"><div id="recipe-photo"></div><p id="recipe-order"></p><p id="recipe-message" role="status" aria-live="polite"></p><div id="recipe-content"></div></div></div>';
    document.body.append(root); el('recipe-close').onclick=close;
    root.addEventListener('keydown', e => {
      if(e.key==='Escape') {e.preventDefault();close();}
      if(e.key==='Tab') {
        const nodes=[...root.querySelectorAll('button,input,textarea')].filter(n=>!n.disabled && n.getClientRects().length);
        if(!nodes.length)return;
        if(e.shiftKey && document.activeElement===nodes[0]) {e.preventDefault();nodes.at(-1).focus();}
        else if(!e.shiftKey && document.activeElement===nodes.at(-1)) {e.preventDefault();nodes[0].focus();}
      }
    });
  }
  function close() {
    if ((state?.saving || state?.scanning)) return;
    if (state?.editing && state.dirty && !confirm('Bỏ các thay đổi công thức chưa lưu?')) return;
    requestId++; el('drink-recipe-modal').style.display='none'; state=null; opener?.focus();
  }
  window.openDrinkRecipe = async (id, qty=1, custom='', edit=false) => {
    if (!isUserAdmin() || state?.saving || state?.scanning) return;
    createModal(); opener=document.activeElement;
    const item=menu.find(m=>String(m.id)===String(id));
    state={id:String(id), qty:Math.max(1, Number(qty)||1), custom:String(custom||''), recipe:null, editing:false,dirty:false};
    const serial=++requestId;
    el('recipe-title').textContent=item?.name || 'Công thức món';
    el('recipe-photo').replaceChildren();
    if(item?.image) {
      const image=document.createElement('img'); image.src=getSafeDrinkImage(item.image,item.category,item.name); image.alt=item.name; image.className='recipe-image';
      image.onerror=()=>{el('recipe-photo').textContent='Chưa có ảnh món';}; el('recipe-photo').append(image);
    } else el('recipe-photo').textContent='Chưa có ảnh món';
    el('recipe-order').textContent='Định lượng chuẩn cho 1 ly · Số lượng: '+number(state.qty)+' ly'+(custom?' · Yêu cầu khách: '+custom:'');
    el('recipe-content').replaceChildren();el('recipe-message').textContent='Đang tải công thức…';
    el('drink-recipe-modal').style.display='flex';el('recipe-close').focus();
    try {
      const result=await api('GET'); if(serial!==requestId)return;
      state.recipe=result.recipe;state.sourceImage=result.recipe?.sourceImage || '';el('recipe-message').textContent='';
      if(edit) renderEditor();else renderView();
    } catch(error) {
      if(serial!==requestId)return;
      el('recipe-message').textContent=error.message;
      const retry=document.createElement('button');retry.className='nav-btn';retry.textContent='Thử tải lại';retry.onclick=()=>window.openDrinkRecipe(id,qty,custom,edit);el('recipe-content').append(retry);
    }
  };
  function renderView() {
    state.editing=false;state.dirty=false;state.sourceImage=state.recipe?.sourceImage || '';
    const recipe=state.recipe, rows=recipe?.ingredients || [];
    el('recipe-content').innerHTML=(recipe ? '<h3>Nguyên liệu</h3>'+(rows.length ? '<div class="recipe-table-wrap"><table class="recipe-table"><thead><tr><th>Nguyên liệu</th><th>1 ly</th>'+(state.qty>1?'<th>'+number(state.qty)+' ly</th>':'')+'</tr></thead><tbody>'+rows.map(r=>'<tr><td><span aria-hidden="true">'+ingredientIcon(r.name)+'</span> '+txt(r.name)+'</td><td>'+number(r.amount)+' '+txt(r.unit)+'</td>'+(state.qty>1?'<td>'+number(r.amount*state.qty)+' '+txt(r.unit)+'</td>':'')+'</tr>').join('')+'</tbody></table></div>' : '<p>Chưa nhập nguyên liệu.</p>')+
      '<h3>Cách pha</h3><p class="recipe-text">'+txt(recipe.steps||'Chưa nhập cách pha.')+'</p>'+(recipe.notes?'<h3>Lưu ý</h3><p class="recipe-text">'+txt(recipe.notes)+'</p>':'') : '<p>Chưa có công thức. Anh nhập nguyên liệu và cách pha cho món này nhé.</p>')+
      '<p class="recipe-hint">Định lượng nhân theo số ly; điều chỉnh đá, độ ngọt và topping theo yêu cầu khách.</p><button type="button" class="nav-btn" id="recipe-edit">'+(recipe?'Chỉnh sửa công thức':'Thiết lập công thức')+'</button>';
    if(state.sourceImage){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Xem ảnh công thức gốc';const image=document.createElement('img');image.src=state.sourceImage;image.alt='Ảnh công thức gốc';image.className='recipe-source-image';details.append(summary,image);el('recipe-content').append(details);}
    el('recipe-edit').onclick=renderEditor;
  }
  function addRow(row={}) {
    const block=document.createElement('div');block.className='recipe-row';
    block.innerHTML='<label>Nguyên liệu<input data-field="name" maxlength="200" placeholder="Tên nguyên liệu" value="'+txt(row.name)+'"></label><label>Định lượng<input data-field="amount" type="number" inputmode="decimal" min="0.001" step="any" placeholder="Số lượng" value="'+txt(row.amount)+'"></label><label>Đơn vị<input data-field="unit" maxlength="40" placeholder="ml, g, muỗng…" value="'+txt(row.unit)+'"></label><button type="button" class="nav-btn" aria-label="Xóa dòng nguyên liệu">Xóa</button>';
    block.querySelector('button').onclick=()=>{block.remove();state.dirty=true;};
    el('recipe-rows').append(block);
    return block;
  }
  function renderEditor() {
    state.editing=true;const recipe=state.recipe || {ingredients:[],steps:'',notes:''};
    el('recipe-content').innerHTML='<form id="recipe-form"><section class="recipe-upload"><label for="recipe-file">Đọc công thức từ hình ảnh</label><input id="recipe-file" type="file" accept="image/jpeg,image/png,image/webp"><p>Chọn ảnh công thức cho 1 ly. AI điền bản nháp; anh kiểm tra lại trước khi lưu.</p><p id="recipe-scan-message" role="status" aria-live="polite"></p><div id="recipe-source-preview"></div></section><p>Nhập công thức chuẩn cho <b>1 ly</b>. Ảnh món lấy từ phần quản lý thực đơn.</p><div id="recipe-rows"></div><button type="button" class="nav-btn" id="recipe-add-row">+ Thêm nguyên liệu</button><label class="recipe-label">Cách pha từng bước<textarea id="recipe-steps" rows="6" maxlength="10000"></textarea></label><label class="recipe-label">Lưu ý pha chế<textarea id="recipe-notes" rows="3" maxlength="3000"></textarea></label><p id="recipe-save-message" role="status" aria-live="polite"></p><div class="recipe-actions"><button type="button" class="nav-btn" id="recipe-cancel">Quay lại</button><button type="submit" class="nav-btn recipe-primary" id="recipe-save">Lưu công thức</button></div></form>';
    (recipe.ingredients.length?recipe.ingredients:[{}]).forEach(addRow);
    el('recipe-steps').value=recipe.steps;el('recipe-notes').value=recipe.notes;
    showSourcePreview();
    el('recipe-file').onchange=scanImage;
    el('recipe-form').oninput=()=>{state.dirty=true;};
    el('recipe-add-row').onclick=()=>{const row=addRow();state.dirty=true;row.querySelector('input').focus();};
    el('recipe-cancel').onclick=()=>{if(!state.dirty || confirm('Bỏ các thay đổi chưa lưu?')){el('recipe-message').textContent='';renderView();}};
    el('recipe-form').onsubmit=save;
  }
  function showSourcePreview() {
    const root=el('recipe-source-preview');if(!root)return;
    root.replaceChildren();
    if(state.sourceImage){const image=document.createElement('img');image.src=state.sourceImage;image.alt='Ảnh công thức gốc để đối chiếu';image.className='recipe-source-image';root.append(image);}
  }
  async function prepareImage(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw Error('Chọn ảnh JPG, PNG hoặc WebP dưới 20 MB.');
    const url=URL.createObjectURL(file),image=new Image();
    try {
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Không mở được ảnh. Vui lòng chọn lại.'));image.src=url;});
      const ratio=Math.min(1,1800/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
      canvas.width=Math.round(image.naturalWidth*ratio);canvas.height=Math.round(image.naturalHeight*ratio);
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of [0.85,0.7,0.5]){const data=canvas.toDataURL('image/jpeg',quality);if(data.length<=2000000)return data;}
      throw Error('Ảnh còn quá lớn. Vui lòng cắt gọn phần công thức và thử lại.');
    } finally {URL.revokeObjectURL(url);}
  }
  async function scanImage(event) {
    const file=event.target.files?.[0];if(!file||state.scanning)return;
    const nonempty=state.dirty || [...el('recipe-rows').querySelectorAll('input')].some(n=>n.value.trim()) || el('recipe-steps').value.trim() || el('recipe-notes').value.trim();
    if(nonempty && !confirm('Dùng nội dung đọc từ ảnh thay cho bản công thức đang hiển thị? Bản đã lưu chỉ đổi khi anh nhấn Lưu công thức.')){event.target.value='';return;}
    state.scanning=true;
    const controls=[...el('recipe-form').querySelectorAll('button,input,textarea')];controls.forEach(n=>n.disabled=true);el('recipe-close').disabled=true;
    const message=el('recipe-scan-message');message.textContent='Đang chuẩn bị ảnh…';message.classList.add('recipe-reading');
    try {
      const image=await prepareImage(file);message.textContent='Đang đọc nguyên liệu, định lượng và cách pha…';
      const result=await api('POST',{scan:true,image});
      el('recipe-rows').replaceChildren();(result.ingredients.length?result.ingredients:[{}]).forEach(addRow);
      el('recipe-steps').value=result.steps;
      el('recipe-notes').value=[result.notes,...result.warnings.map(x=>'Cần kiểm tra: '+x)].filter(Boolean).join('\n');
      state.sourceImage=image;state.dirty=true;showSourcePreview();
      message.textContent='Đã đọc ảnh. Anh kiểm tra nội dung và bổ sung ô còn thiếu trước khi lưu.'+(result.warnings.length?' '+result.warnings.join(' '):'');
    } catch(error){message.textContent=error.message;}
    finally{state.scanning=false;message.classList.remove('recipe-reading');controls.forEach(n=>n.disabled=false);el('recipe-close').disabled=false;event.target.value='';}
  }
  async function save(event) {
    event.preventDefault();if(state.saving || state.scanning)return;
    const ingredients=[];
    for(const row of el('recipe-rows').children){
      const value=Object.fromEntries([...row.querySelectorAll('input')].map(input=>[input.dataset.field,input.value.trim()]));
      if(!value.name&&!value.amount&&!value.unit)continue;
      if(!value.name||!value.unit||!Number.isFinite(Number(value.amount))||Number(value.amount)<=0){el('recipe-save-message').textContent='Nhập đủ tên, định lượng lớn hơn 0 và đơn vị cho từng nguyên liệu.';return;}
      ingredients.push({...value,amount:Number(value.amount)});
    }
    state.saving=true;el('recipe-save-message').textContent='Đang lưu công thức…';
    const controls=[...el('recipe-form').querySelectorAll('button,input,textarea')];controls.forEach(n=>n.disabled=true);el('recipe-close').disabled=true;
    try {
      const result=await api('POST',{itemId:state.id,version:state.recipe?.version || '',recipe:{ingredients,steps:el('recipe-steps').value,notes:el('recipe-notes').value,sourceImage:state.sourceImage || ''}});
      state.recipe=result.recipe;renderView();
      el('recipe-message').textContent='Đã lưu công thức.'+(result.backup?.connected?' Đã lên lịch sao lưu Google Drive.':'');
    } catch(error) {el('recipe-save-message').textContent=error.message;}
    finally{state.saving=false;controls.forEach(n=>n.disabled=false);el('recipe-close').disabled=false;}
  }
  function activate(event) {
    const target=event.target.closest('[data-drink-recipe]');if(!target)return;
    if(event.type==='keydown' && !['Enter',' '].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    window.openDrinkRecipe(target.dataset.drinkRecipe,target.dataset.recipeQty,target.dataset.recipeCustom,target.dataset.recipeEdit==='1');
  }
  document.addEventListener('click',activate);document.addEventListener('keydown',activate);
  window.addEventListener('beforeunload',event=>{if(state?.dirty){event.preventDefault();event.returnValue='';}});
})();
