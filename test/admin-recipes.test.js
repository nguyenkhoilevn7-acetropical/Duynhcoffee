'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {preparationSteps,customerRequests,requestIcon}=require('../admin-recipes');
const code=fs.readFileSync(path.join(__dirname,'../admin-recipes.js'),'utf8');
const recipe={ingredients:[{name:'Cà phê',amount:30,unit:'ml'}],steps:'1. Chuẩn bị 2.5 g bột.\n2. Rót cà phê\n3. Thêm sữa',notes:'Dùng ngay\nKhông đun sôi',version:'v1'};
function client(saved=recipe){
 const dom=new JSDOM('<button id="open">Mở món</button>',{url:'https://example.test',runScripts:'outside-only'}),w=dom.window;
 w.isUserAdmin=()=>true;w.menu=[{id:1,name:'Cafe Trứng Mom'}];w.getCloudApiUrl=p=>p;w.confirm=()=>true;w.AbortSignal.timeout=()=>undefined;
 const writes=[];
 w.fetch=async(url,opts)=>{if(opts.method==='POST'){writes.push(JSON.parse(opts.body));return {ok:true,json:async()=>({recipe:{...JSON.parse(opts.body).recipe,version:'v2'},backup:{connected:false}})};}return {ok:true,json:async()=>({recipe:saved})};};
 w.eval(code);return {dom,w,writes,el:id=>w.document.getElementById(id)};
}
test('recipe steps retain decimals and words, remove old numbering and support inline step markers',()=>{
 assert.deepEqual(preparationSteps(recipe.steps),['Chuẩn bị 2.5 g bột.','Rót cà phê','Thêm sữa']);
 assert.deepEqual(preparationSteps('Bước 1: Ủ trà Bước 2: Lắc đều'),['Ủ trà','Lắc đều']);
 assert.deepEqual(preparationSteps('① Ủ trà\n② Lắc đều'),['Ủ trà','Lắc đều']);
 assert.deepEqual(preparationSteps('Một đoạn chưa có số'),['Một đoạn chưa có số']);
 assert.deepEqual(customerRequests('50% (ít đá) • 50% (ít ngọt)\nThêm trân châu'),['50% (ít đá)','50% (ít ngọt)','Thêm trân châu']);
 assert.equal(requestIcon('50% (ít đá)'),'🧊');assert.equal(requestIcon('50% (ít ngọt)'),'🍬');
});
test('customer requirements are highlighted vertical notes before ingredients; preparation is an ordered list',async()=>{
 const c=client();try{
 await c.w.openDrinkRecipe(1,2,'50% (ít đá) • 50% (ít ngọt)');
 assert.doesNotMatch(c.el('recipe-order').textContent,/Yêu cầu/);
 const list=c.el('recipe-notices').querySelectorAll('.recipe-customer-box li');assert.equal(list.length,2);
 assert.equal(list[0].textContent,'🧊50% (ít đá)');assert.equal(list[1].textContent,'🍬50% (ít ngọt)');
 assert.equal(c.el('recipe-notices').querySelectorAll('.recipe-owner-notes li').length,2);
 assert.equal(c.el('recipe-notices').nextElementSibling.id,'recipe-message');
 assert.equal(c.el('recipe-content').querySelectorAll('ol.recipe-steps li').length,3);
 assert.match(c.el('recipe-content').querySelector('.recipe-table').textContent,/60 ml/);
 c.el('recipe-edit').click();assert.equal(c.el('recipe-steps').value,'1. Chuẩn bị 2.5 g bột.\n2. Rót cà phê\n3. Thêm sữa');
 await c.el('recipe-form').onsubmit({preventDefault(){}});
 assert.equal(c.writes[0].recipe.steps,'Chuẩn bị 2.5 g bột.\nRót cà phê\nThêm sữa');
 assert.doesNotMatch(c.writes[0].recipe.notes,/ít đá|ít ngọt/);
 }finally{c.dom.window.close();}
});
test('untrusted notes and step content render as text, with no injected elements',async()=>{
 const c=client({...recipe,steps:'1. <img src=x onerror=alert(1)>',notes:'<script>bad()</script>'});try{
 await c.w.openDrinkRecipe(1,1,'<img src=x>');
 assert.equal(c.el('recipe-notices').querySelectorAll('img,script').length,0);
 assert.equal(c.el('recipe-content').querySelectorAll('img,script').length,0);
 assert.match(c.el('recipe-content').querySelector('.recipe-steps').textContent,/<img/);
 }finally{c.dom.window.close();}
});
test('photo draft populates the correct fields, highlights unknown quantity and separates OCR warnings',async()=>{
 const c=client(null);try{
 await c.w.openDrinkRecipe(1,1,'Ít đá',true);
 c.w.URL.createObjectURL=()=> 'blob:test';c.w.URL.revokeObjectURL=()=>{};
 c.w.Image=class{constructor(){this.naturalWidth=100;this.naturalHeight=100;}set src(v){queueMicrotask(()=>this.onload());}};
 c.w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});
 c.w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,aGVsbG8=';
 c.w.fetch=async()=>({ok:true,json:async()=>({ingredients:[{name:'Trứng',amount:'1',unit:'quả'},{name:'Sữa',amount:'',unit:'ml'}],steps:'Đánh trứng\nRót cà phê',notes:'Dùng ngay',warnings:['Định lượng sữa bị mờ']})});
 const file=new c.w.File(['image'],'recipe.png',{type:'image/png'}),input=c.el('recipe-file');
 await input.onchange({target:{files:[file],value:'recipe.png'}});
 const rows=c.el('recipe-rows').children;assert.equal(rows.length,2);
 assert.equal(rows[0].querySelector('[data-field=name]').value,'Trứng');assert.equal(rows[0].querySelector('[data-field=unit]').value,'quả');
 assert.equal(rows[1].querySelector('[data-field=amount]').getAttribute('aria-invalid'),'true');
 assert.equal(c.el('recipe-steps').value,'1. Đánh trứng\n2. Rót cà phê');assert.equal(c.el('recipe-notes').value,'Dùng ngay');
 assert.match(c.el('recipe-scan-warnings').textContent,/sữa bị mờ/);assert.doesNotMatch(c.el('recipe-notes').value,/bị mờ|Ít đá/);
 assert.equal(c.el('recipe-source-preview').querySelector('img').src,'data:image/jpeg;base64,aGVsbG8=');
 await c.el('recipe-form').onsubmit({preventDefault(){}});assert.match(c.el('recipe-save-message').textContent,/định lượng lớn hơn 0/);
 }finally{c.dom.window.close();}
});
