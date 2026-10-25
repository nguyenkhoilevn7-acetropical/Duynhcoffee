/* Private drink preparation recipes; loaded only on an explicit admin action. */
(() => {
  'use strict';
  function textLines(value) {
    return String(value || '').replace(/\r\n?/g,'\n').split(/\n+|\s*[•·]\s*|;\s*/).map(line=>line.trim()).filter(Boolean);
  }
  function preparationSteps(value) {
    const text=String(value || '').replace(/\r\n?/g,'\n')
      .replace(/(^|\s)(?:bước\s*\d+\s*[:.)-]\s*|\d+[.)]\s+|[①②③④⑤⑥⑦⑧⑨⑩]\s*)/gi,'\n');
    return textLines(text).map(line=>line.replace(/^[-–—]\s+/, '').trim()).filter(Boolean);
  }
  function customerRequests(value) {
    return textLines(value).flatMap(line=>line.split(/,\s*(?=(?:không|ít|thêm|nhiều|bớt|tách|đá|đường|ngọt|topping|no|less|extra|more|without|ice|sugar|sweetness)\b)/iu)).map(x=>x.trim()).filter(Boolean);
  }
  function requestIcon(value) {
    const text=String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
    if(/\b(?:da|ice)\b/.test(text))return '🧊';
    if(/ngot|đuong|duong|sweet|sugar/.test(text))return '🍬';
    if(/topping|tran chau|thach/.test(text))return '🧋';
    if(/sua|milk/.test(text))return '🥛';
    if(/nong|hot/.test(text))return '♨️';
    return '📣';
  }
  if(typeof module==='object' && module.exports)module.exports={textLines,preparationSteps,customerRequests,requestIcon};
  if(typeof document==='undefined')return;
  let state = null, opener = null, requestId = 0;
  const ingredientIcon = name => /trà/i.test(name)?'🍃':/cà phê|cafe|café|coffee/i.test(name)?'☕':/trứng/i.test(name)?'🥚':/sữa|kem/i.test(name)?'🥛':/đá|nước/i.test(name)?'💧':/chanh|cam/i.test(name)?'🍋':/dâu/i.test(name)?'🍓':'🥄';
  const el = id => document.getElementById(id);
  const txt = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => Number(value).toLocaleString(state?.lang==='en'?'en-US':'vi-VN', {maximumFractionDigits:3});
  async function api(method, body) {
    const token = localStorage.getItem('duynh_admin_api_token') || localStorage.getItem('duynh_admin_push_token') || '';
    const url = '/api/drink-recipes' + (body?.scan ? '/scan' : body?.translate ? '/translate' : '') + (method === 'GET' ? '?itemId='+encodeURIComponent(state.id) : '');
    const response = await fetch(getCloudApiUrl(url), {method, headers:{'Content-Type':'application/json', Authorization:'Bearer '+token},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout((body?.scan||body?.translate)?40000:15000)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không tải được công thức. Vui lòng thử lại.');
    return result;
  }
  function createModal() {
    if (el('drink-recipe-modal')) return;
    const root = document.createElement('div'); root.id='drink-recipe-modal'; root.className='modal-overlay';
    root.setAttribute('translate','no');root.setAttribute('data-i18n-preserve','');
    root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.setAttribute('aria-labelledby','recipe-title');
    root.innerHTML='<div class="modal-card recipe-card"><div class="modal-header"><h2 id="recipe-title">Công thức pha chế</h2><button type="button" class="modal-close" aria-label="Đóng công thức" id="recipe-close">✕</button></div><div class="modal-body"><div class="recipe-language" role="group" aria-label="Ngôn ngữ công thức"><button type="button" class="nav-btn" id="recipe-lang-vi" aria-pressed="true">🇻🇳 Tiếng Việt</button><button type="button" class="nav-btn" id="recipe-lang-en" aria-pressed="false">🇬🇧 English</button></div><section class="recipe-upload-toolbar"><button type="button" class="nav-btn recipe-primary" id="recipe-upload-open" disabled>📷 Tải ảnh công thức – AI tự điền</button><p>Chọn ảnh → AI đọc nguyên liệu, định lượng và cách pha theo từng bước → Kiểm tra rồi lưu.</p></section><div id="recipe-photo"></div><p id="recipe-order"></p><div id="recipe-notices"></div><p id="recipe-message" role="status" aria-live="polite"></p><div id="recipe-content"></div></div></div>';
    document.body.append(root); el('recipe-close').onclick=close;
    el('recipe-lang-vi').onclick=()=>setRecipeLanguage('vi');
    el('recipe-lang-en').onclick=()=>setRecipeLanguage('en');
    el('recipe-upload-open').onclick=()=>{
      if(!state?.loaded || state.saving || state.scanning)return;
      if(!state.editing)renderEditor();
      el('recipe-file').click();
    };
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
    state={id:String(id), qty:Math.max(1, Number(qty)||1), custom:String(custom||''), recipe:null, loaded:false, lang:'vi', langRevision:0, translating:false, translation:null, editing:false,dirty:false};
    const serial=++requestId;
    el('recipe-upload-open').disabled=true;
    el('recipe-lang-en').disabled=true;
    updateRecipeLanguageUI();
    el('recipe-title').textContent=item?.name || 'Công thức món';
    el('recipe-photo').replaceChildren();
    if(item?.image) {
      const image=document.createElement('img'); image.src=getSafeDrinkImage(item.image,item.category,item.name); image.alt=item.name; image.className='recipe-image';
      image.onerror=()=>{el('recipe-photo').textContent='Chưa có ảnh món';}; el('recipe-photo').append(image);
    } else el('recipe-photo').textContent='Chưa có ảnh món';
    el('recipe-order').textContent='Định lượng chuẩn cho 1 ly · Số lượng: '+number(state.qty)+' ly';
    renderNotices();
    el('recipe-content').replaceChildren();el('recipe-message').textContent='Đang tải công thức…';
    el('drink-recipe-modal').style.display='flex';el('recipe-close').focus();
    try {
      const result=await api('GET'); if(serial!==requestId)return;
      state.recipe=result.recipe;state.sourceImage=result.recipe?.sourceImage || '';state.loaded=true;el('recipe-upload-open').disabled=false;el('recipe-lang-en').disabled=false;el('recipe-message').textContent='';
      if(edit) renderEditor();else {renderView();if((localStorage.getItem('duynh_recipe_lang') || document.documentElement.lang)==='en')await setRecipeLanguage('en');}
    } catch(error) {
      if(serial!==requestId)return;
      el('recipe-message').textContent=error.message;
      const retry=document.createElement('button');retry.className='nav-btn';retry.textContent='Thử tải lại';retry.onclick=()=>window.openDrinkRecipe(id,qty,custom,edit);el('recipe-content').append(retry);
    }
  };
  const t=(vi,en)=>state?.lang==='en'?en:vi;
  function updateRecipeLanguageUI() {
    if(!state)return;
    el('recipe-lang-vi').setAttribute('aria-pressed',String(state.lang==='vi'));
    el('recipe-lang-en').setAttribute('aria-pressed',String(state.lang==='en'));
    el('recipe-upload-open').textContent=t('📷 Tải ảnh công thức – AI tự điền','📷 Upload recipe photo – AI fill');
    el('recipe-upload-open').nextElementSibling.textContent=t('Chọn ảnh → AI đọc nguyên liệu, định lượng và cách pha theo từng bước → Kiểm tra rồi lưu.','Choose photo → AI extracts ingredients, quantities and preparation steps → Review and save.');
    el('recipe-order').textContent=t('Định lượng chuẩn cho 1 ly · Số lượng: ','Standard recipe for 1 cup · Quantity: ')+number(state.qty)+t(' ly',' cups');
    const item=menu.find(m=>String(m.id)===state.id);
    el('recipe-title').textContent=(state.lang==='en'?item?.name_en:item?.name) || item?.name || t('Công thức món','Drink recipe');
  }
  function visibleRecipe() {
    if(state.lang!=='en'||!state.translation?.english||!state.recipe)return state.recipe;
    const original=state.recipe,english=state.translation.english;
    return {...original,ingredients:original.ingredients.map((row,i)=>({...row,...english.ingredients[i]})),steps:english.steps,notes:english.notes};
  }
  async function setRecipeLanguage(lang) {
    if(!state?.loaded || state.saving || state.scanning)return;
    if(state.editing){
      if(state.dirty){el('recipe-save-message').textContent='Lưu hoặc quay lại để xem bản dịch; nội dung đang nhập được giữ nguyên.';return;}
      renderView();
    }
    const current=state,serial=requestId,revision=++state.langRevision;
    if(lang==='vi'){state.lang='vi';state.translating=false;localStorage.setItem('duynh_recipe_lang','vi');el('recipe-message').textContent='';renderView();return;}
    // English must remain usable even before a recipe has been saved. If there
    // are customer requests, translate those through the existing verified API.
    if(!state.recipe && !state.custom.trim()){
      state.lang='en';state.translating=false;
      localStorage.setItem('duynh_recipe_lang','en');
      el('recipe-message').textContent='';renderView();return;
    }
    if(!state.translation && state.recipe?.english && !state.custom)state.translation={english:state.recipe.english,custom_en:''};
    if(!state.translation){
      state.translating=true;el('recipe-message').textContent='Đang dịch nguyên liệu, cách pha và lưu ý sang tiếng Anh…';
      try {
        const recipe=state.recipe || {ingredients:[],steps:'',notes:''};
        const result=await api('POST',{translate:true,itemId:state.id,version:recipe.version,recipe:{ingredients:recipe.ingredients,steps:recipe.steps,notes:recipe.notes},custom:state.custom});
        if(state!==current||serial!==requestId||revision!==state.langRevision)return;
        state.translation=result;if(state.recipe)state.recipe.english=result.english;
      }catch(error){if(state===current&&serial===requestId&&revision===state.langRevision){state.translating=false;el('recipe-message').textContent=error.message;}return;}
    }
    if(state!==current||serial!==requestId||revision!==state.langRevision)return;
    state.translating=false;state.lang='en';localStorage.setItem('duynh_recipe_lang','en');el('recipe-message').textContent='';renderView();
  }
  function renderNotices() {
    const recipe=visibleRecipe(),custom=state.lang==='en'?(state.translation?.custom_en || state.custom):state.custom;
    const requests=customerRequests(custom), notes=textLines(recipe?.notes);
    el('recipe-notices').innerHTML=(!requests.length&&!notes.length)?'':
      '<section class="recipe-notices" aria-label="'+t('Lưu ý pha chế','Preparation notes')+'"><h3>⚠️ '+t('Lưu ý','Notes')+'</h3>'+
      (requests.length?'<div class="recipe-customer-box"><h4>'+t('Yêu cầu của khách','Customer requests')+'</h4><ul class="recipe-note-list">'+requests.map((line,i)=>'<li><span aria-hidden="true">'+requestIcon(customerRequests(state.custom)[i] || line)+'</span><strong>'+txt(line)+'</strong></li>').join('')+'</ul></div>':'')+
      (notes.length?'<ul class="recipe-note-list recipe-owner-notes">'+notes.map(line=>'<li><span aria-hidden="true">📌</span><span>'+txt(line)+'</span></li>').join('')+'</ul>':'')+'</section>';
  }
  function renderView() {
    state.editing=false;state.dirty=false;state.sourceImage=state.recipe?.sourceImage || '';
    const recipe=visibleRecipe(), rows=recipe?.ingredients || [];
    updateRecipeLanguageUI();renderNotices();
    el('recipe-content').innerHTML=(recipe ? '<h3>'+t('Nguyên liệu','Ingredients')+'</h3>'+(rows.length ? '<div class="recipe-table-wrap"><table class="recipe-table"><thead><tr><th>'+t('Nguyên liệu','Ingredient')+'</th><th>'+t('1 ly','1 cup')+'</th>'+(state.qty>1?'<th>'+number(state.qty)+t(' ly',' cups')+'</th>':'')+'</tr></thead><tbody>'+rows.map((r,i)=>'<tr><td><span aria-hidden="true">'+ingredientIcon(state.recipe.ingredients[i].name)+'</span> '+txt(r.name)+'</td><td>'+number(r.amount)+' '+txt(r.unit)+'</td>'+(state.qty>1?'<td>'+number(r.amount*state.qty)+' '+txt(r.unit)+'</td>':'')+'</tr>').join('')+'</tbody></table></div>' : '<p>'+t('Chưa nhập nguyên liệu.','No ingredients entered.')+'</p>')+
      '<h3>'+t('Cách pha','Preparation')+'</h3>'+(preparationSteps(recipe.steps).length?'<ol class="recipe-steps">'+preparationSteps(recipe.steps).map(step=>'<li>'+txt(step)+'</li>').join('')+'</ol>':'<p>'+t('Chưa nhập cách pha.','No preparation steps entered.')+'</p>') : '<p>'+t('Chưa có công thức. Anh nhập nguyên liệu và cách pha cho món này nhé.','No recipe yet. Enter ingredients and preparation steps or upload a recipe photo.')+'</p>')+
      '<p class="recipe-hint">'+t('Định lượng nhân theo số ly; điều chỉnh đá, độ ngọt và topping theo yêu cầu khách.','Quantities scale with cup count; adjust ice, sweetness and toppings to customer requests.')+'</p><button type="button" class="nav-btn" id="recipe-edit">'+(recipe?t('Chỉnh sửa công thức','Edit Vietnamese source'):t('Thiết lập công thức','Set up recipe'))+'</button>';
    if(state.sourceImage){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=t('Xem ảnh công thức gốc','View original recipe photo');const image=document.createElement('img');image.src=state.sourceImage;image.alt=t('Ảnh công thức gốc','Original recipe photo');image.className='recipe-source-image';details.append(summary,image);el('recipe-content').append(details);}
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
    state.langRevision++;state.translating=false;state.lang='vi';updateRecipeLanguageUI();
    state.editing=true;const recipe=state.recipe || {ingredients:[],steps:'',notes:''};
    el('recipe-content').innerHTML='<form id="recipe-form"><section class="recipe-upload"><label for="recipe-file">Đọc công thức từ hình ảnh</label><input id="recipe-file" type="file" accept="image/jpeg,image/png,image/webp"><p>Chọn ảnh công thức cho 1 ly. AI điền bản nháp; anh kiểm tra lại trước khi lưu.</p><p id="recipe-scan-message" role="status" aria-live="polite"></p><ul id="recipe-scan-warnings" class="recipe-scan-warnings"></ul><div id="recipe-source-preview"></div></section><p>Nhập công thức chuẩn cho <b>1 ly</b>. Ảnh món lấy từ phần quản lý thực đơn.</p><div id="recipe-rows"></div><button type="button" class="nav-btn" id="recipe-add-row">+ Thêm nguyên liệu</button><label class="recipe-label">Cách pha từng bước<textarea id="recipe-steps" rows="6" maxlength="10000" placeholder="Mỗi bước một dòng:&#10;1. Chuẩn bị nguyên liệu&#10;2. Pha theo công thức"></textarea></label><label class="recipe-label">Lưu ý pha chế<textarea id="recipe-notes" rows="3" maxlength="3000"></textarea></label><p id="recipe-save-message" role="status" aria-live="polite"></p><div class="recipe-actions"><button type="button" class="nav-btn" id="recipe-cancel">Quay lại</button><button type="submit" class="nav-btn recipe-primary" id="recipe-save">Lưu công thức</button></div></form>';
    (recipe.ingredients.length?recipe.ingredients:[{}]).forEach(addRow);
    el('recipe-steps').value=preparationSteps(recipe.steps).map((step,index)=>(index+1)+'. '+step).join('\n');el('recipe-notes').value=recipe.notes;
    renderNotices();
    showSourcePreview();
    el('recipe-file').onchange=scanImage;
    el('recipe-form').oninput=event=>{state.dirty=true;const input=event.target;if(input?.matches('input[data-field]') && input.value.trim()){input.classList.remove('recipe-needs-review');input.removeAttribute('aria-invalid');}};
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
    const controls=[...el('recipe-form').querySelectorAll('button,input,textarea')];controls.forEach(n=>n.disabled=true);el('recipe-close').disabled=true;el('recipe-upload-open').disabled=true;
    el('recipe-scan-warnings').replaceChildren();
    const message=el('recipe-scan-message');message.textContent='Đang chuẩn bị ảnh…';message.classList.add('recipe-reading');
    try {
      const image=await prepareImage(file);message.textContent='Đang đọc nguyên liệu, định lượng và cách pha…';
      const result=await api('POST',{scan:true,image});
      el('recipe-rows').replaceChildren();(result.ingredients.length?result.ingredients:[{}]).forEach(addRow);
      el('recipe-steps').value=preparationSteps(result.steps).map((step,index)=>(index+1)+'. '+step).join('\n');
      el('recipe-notes').value=result.notes;
      const warnings=[...(result.warnings || [])];
      for(const row of el('recipe-rows').children){for(const input of row.querySelectorAll('input')){if(!input.value.trim()){input.classList.add('recipe-needs-review');input.setAttribute('aria-invalid','true');}}}
      el('recipe-scan-warnings').innerHTML=warnings.map(line=>'<li>⚠️ '+txt(line)+'</li>').join('');
      state.translation=null;state.sourceImage=image;state.dirty=true;showSourcePreview();
      message.textContent='Đã điền nguyên liệu, định lượng, cách pha và lưu ý vào từng ô. Anh kiểm tra các ô được đánh dấu trước khi lưu.';
    } catch(error){message.textContent=error.message;}
    finally{state.scanning=false;message.classList.remove('recipe-reading');controls.forEach(n=>n.disabled=false);el('recipe-close').disabled=false;el('recipe-upload-open').disabled=false;event.target.value='';}
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
    const controls=[...el('recipe-form').querySelectorAll('button,input,textarea')];controls.forEach(n=>n.disabled=true);el('recipe-close').disabled=true;el('recipe-upload-open').disabled=true;
    try {
      const result=await api('POST',{itemId:state.id,version:state.recipe?.version || '',recipe:{ingredients,steps:preparationSteps(el('recipe-steps').value).join('\n'),notes:el('recipe-notes').value,english:state.recipe?.english,sourceImage:state.sourceImage || ''}});
      state.translation=null;state.recipe=result.recipe;renderView();
      el('recipe-message').textContent='Đã lưu công thức.'+(result.backup?.connected?' Đã lên lịch sao lưu Google Drive.':'');
    } catch(error) {el('recipe-save-message').textContent=error.message;}
    finally{state.saving=false;controls.forEach(n=>n.disabled=false);el('recipe-close').disabled=false;el('recipe-upload-open').disabled=false;}
  }
  function activate(event) {
    const target=event.target.closest('[data-drink-recipe]');if(!target)return;
    if(event.type==='keydown' && !['Enter',' '].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    window.openDrinkRecipe(target.dataset.drinkRecipe,target.dataset.recipeQty,target.dataset.recipeCustom,target.dataset.recipeEdit==='1');
  }
  new MutationObserver(()=>{if(state?.loaded&&!state.editing)setRecipeLanguage(document.documentElement.lang==='en'?'en':'vi');}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  document.addEventListener('click',activate);document.addEventListener('keydown',activate);
  window.addEventListener('beforeunload',event=>{if(state?.dirty){event.preventDefault();event.returnValue='';}});
})();
