'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const engine=fs.readFileSync(path.join(__dirname,'../site-i18n.js'),'utf8');
function fixture(markup,lang='vi'){
 const frames=[],dom=new JSDOM(markup,{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
 const w=dom.window;w.localStorage.setItem('duynh_lang',lang);w.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
 w.alert=msg=>msg;w.confirm=()=>true;w.prompt=()=>null;w.eval(engine);
 async function drain(){await Promise.resolve();let count=0;while(frames.length){assert.ok(count++<600,'translation observer must settle');frames.shift()(Date.now());await Promise.resolve();}return count;}
 return {dom,w,frames,drain};
}
test('language switch translates static and newly rendered text, attributes, dialogs and reverts without replacing controls',async()=>{
 const {dom,w,drain}=fixture('<title>Thông Báo</title><body><button id="save">Lưu</button><label>Danh Mục</label><input id="name" value="Nguyễn Văn An" placeholder="Tên món tiếng Anh"><select id="cat"><option value="tea">Trà Trái Cây Tươi</option><option value="coffee">Cà Phê Đuỷnh</option></select><div id="dynamic"></div></body>');
 try{
  const save=w.document.getElementById('save');let clicked=0;save.onclick=()=>clicked++;
  w.document.getElementById('cat').value='coffee';w.DuynhI18n.setLanguage('en');await drain();
  assert.equal(save.textContent,'Save');assert.equal(w.document.querySelector('label').textContent,'Category');
  assert.equal(w.document.getElementById('name').placeholder,'English item name');assert.equal(w.document.getElementById('name').value,'Nguyễn Văn An');
  assert.equal(w.document.getElementById('cat').value,'coffee');assert.equal(w.alert('Không đọc được ảnh'),'Unable to read image');
  w.document.getElementById('dynamic').innerHTML='<p>Đang lưu danh mục...</p><button>↑ Trước</button>';
  await drain();assert.equal(w.document.querySelector('#dynamic p').textContent,'Saving category...');
  w.DuynhI18n.setLanguage('vi');await drain();assert.equal(save.textContent,'Lưu');assert.equal(w.document.querySelector('#dynamic p').textContent,'Đang lưu danh mục...');
  assert.equal(w.document.getElementById('save'),save);save.click();assert.equal(clicked,1);
 }finally{w.close();}
});
test('private names, bank details, URLs, passwords and verification controls are preserved',async()=>{
 const {w,drain}=fixture('<body><p id="customer">Khách: Lưu An</p><p id="pay-bank-holder">DAO KHOI NGUYEN</p><p id="brand">ĐUỶNH TEA &amp; COFFEE</p><input type="password" value="do-not-change"><input id="proof" value="signed-token"><button id="submit">XÁC NHẬN GỬI ĐƠN HÀNG LÊN HỆ THỐNG ➔</button><p id="dish">1x Bánh Tiramisu Hộp Thiếc Đuỷnh</p></body>');
 try{
  w.DuynhI18n.protect(['Lưu An','DAO KHOI NGUYEN']);w.DuynhI18n.setLanguage('en');await drain();
  assert.equal(w.document.getElementById('customer').textContent,'Customer: Lưu An');
  assert.equal(w.document.getElementById('pay-bank-holder').textContent,'DAO KHOI NGUYEN');assert.equal(w.document.getElementById('brand').textContent,'ĐUỶNH TEA & COFFEE');
  assert.equal(w.document.getElementById('proof').value,'signed-token');assert.equal(w.document.querySelector('input[type=password]').value,'do-not-change');assert.equal(w.document.getElementById('submit').disabled,false);
  assert.equal(w.document.getElementById('dish').textContent,'1x Signature Tin-Box Tiramisu');
  assert.equal(w.DuynhI18n.translate('https://example.test/image/Coffee.png','vi'),'https://example.test/image/Coffee.png');
 }finally{w.close();}
});
test('custom bilingual menu and category text can update after live sync',async()=>{
 const {w,drain}=fixture('<body><div id="category">Trà Đặc Biệt</div><p id="description">Mô tả riêng của quán.</p></body>','en');
 try{
  w.DuynhI18n.register({'Trà Đặc Biệt':'House Special Tea','Mô tả riêng của quán.':'A house-made blend with fresh fruit.'});w.DuynhI18n.setLanguage('en');await drain();
  assert.equal(w.document.getElementById('category').textContent,'House Special Tea');assert.equal(w.document.getElementById('description').textContent,'A house-made blend with fresh fruit.');
  w.DuynhI18n.register({'Trà Đặc Biệt':'Updated Special Tea'});w.document.getElementById('category').textContent='Trà Đặc Biệt';await drain();
  assert.equal(w.document.getElementById('category').textContent,'Updated Special Tea');w.DuynhI18n.setLanguage('vi');await drain();assert.equal(w.document.getElementById('category').textContent,'Trà Đặc Biệt');
 }finally{w.close();}
});
test('all current food/drink names and full descriptions translate to English',()=>{
 const api=require('../site-i18n.js');
 assert.equal(api.translate('Ngân Hàng TMCP Ngoại Thương Việt Nam (Vietcombank)','en'),'Joint Stock Commercial Bank for Foreign Trade of Vietnam (Vietcombank)');
 assert.equal(api.translate('Lalamove Giao Nhanh','en'),'Lalamove Express Delivery');
 const source=html.slice(html.indexOf('    const DEFAULT_INITIAL_MENU = '));
 const menu=JSON.parse(source.slice(source.indexOf('['),source.indexOf('];')+1));
 for(const item of menu){
  const name=api.translate(item.name,'en'),desc=api.translate(item.description,'en');
  assert.notEqual(name,item.name);assert.notEqual(desc,item.description);
  assert.ok(!/[À-ỹĐđ]/.test(name.replace(/Đuỷnh/g,'')),name);assert.ok(!/[À-ỹĐđ]/.test(desc.replace(/Đuỷnh/g,'')),desc);
 }
});
test('actual app translates both customer/admin views, preserves category IDs and receipt verification across switching',async()=>{
 const {w,drain}=fixture(html,'en');const writes=[];
 w.fetch=async(url,options={})=>{if(options.method==='POST')writes.push(url);return {ok:true,status:200,json:async()=>({notModified:true})};};
 w.WebSocket=class{constructor(){this.readyState=0;}close(){}};
 try{
  const hooks=';window.__testLanguage={setReceipt:()=>{isReceiptValid=true;receiptVerificationToken="proof";receiptVerificationContext=paymentContext();},getReceipt:()=>({valid:isReceiptValid,token:receiptVerificationToken,context:receiptVerificationContext}),getMenu:()=>JSON.stringify(menu),getCategoryIds:()=>getCategoriesList().map(c=>c.id)};';
  for(const script of w.document.querySelectorAll('script:not([src])'))if(script.textContent.trim())w.eval(script.textContent+hooks);
  await new Promise(resolve=>setImmediate(resolve));
  w.renderAllBackendTabs();w.renderAdminMenuTable();w.setLanguage('en');await drain();
  const snapshot=w.__testLanguage.getMenu(),categoryIds=Array.from(w.__testLanguage.getCategoryIds());
  assert.match(w.document.querySelector('#customer-products-grid').textContent,/Soursop/);
  assert.match(w.document.querySelector('#tbody-admin-menu').textContent,/Soursop/);
  assert.match(w.document.querySelector('#admin-category-order').textContent,/Before/);
  assert.equal(w.document.documentElement.lang,'en');
  await w.openPaymentCheckoutModal(); // Empty cart must not acquire a scroll lock.
  w.quickBuyProductNow(1);await new Promise(resolve=>setImmediate(resolve));
  w.__testLanguage.setReceipt();const receipt=w.__testLanguage.getReceipt();
  w.setLanguage('vi');await drain();assert.equal(w.document.documentElement.lang,'vi');
  assert.match(w.document.querySelector('#customer-products-grid').textContent,/Trà Mãng Cầu/);
  assert.deepEqual(w.__testLanguage.getReceipt(),receipt);assert.equal(w.__testLanguage.getMenu(),snapshot);
  assert.deepEqual(Array.from(w.__testLanguage.getCategoryIds()),categoryIds);assert.equal(writes.length,0);
  w.setLanguage('en');await drain();assert.deepEqual(w.__testLanguage.getReceipt(),receipt);
 }finally{w.close();}
});
test('every static Vietnamese interface label and hint on all pages has an English translation',()=>{
 const api=require('../site-i18n.js');api.protect([]);
 for(const file of ['index.html','backup.html','privacy.html','terms.html']){
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{virtualConsole:new VirtualConsole()}),doc=dom.window.document;
  try{
   const values=[];const walker=doc.createTreeWalker(doc.body,4);let node;
   while(node=walker.nextNode())if(!node.parentElement.closest('script,style,svg'))values.push(node.nodeValue);
   for(const el of doc.querySelectorAll('[placeholder],[title],[aria-label],[alt]'))for(const attr of ['placeholder','title','aria-label','alt'])if(el.hasAttribute(attr))values.push(el.getAttribute(attr));
   for(const text of values){const normalized=text.trim().replace(/\s+/g,' ');if(!normalized)continue;
    const out=api.translate(normalized,'en').replace(/Đuỷnh|ĐUỶNH|Nguyễn Văn A|Tòa Babylon 2, Chung Cư Thủ Thiêm, An Khánh, TP\. Thủ Đức/g,'').replace(/\bđ\b/g,'');
    assert.ok(!/[À-ỹĐđ]/.test(out),file+': '+normalized+' -> '+out);
   }
  }finally{dom.window.close();}
 }
});
test('incremental translation settles without self-triggered observer loops or rescanning unrelated nodes',async()=>{
 const {w,drain}=fixture('<body><div id="stable">Thông Báo</div><div id="live"></div></body>','en');
 try{
  await drain();const stable=w.document.getElementById('stable').firstChild;
  let records=0;const watcher=new w.MutationObserver(changes=>records+=changes.length);watcher.observe(w.document.getElementById('stable'),{subtree:true,characterData:true});
  for(let i=0;i<30;i++)w.document.getElementById('live').textContent='Đang lưu danh mục...';
  const frames=await drain();assert.ok(frames<20);assert.equal(records,0);assert.equal(w.document.getElementById('stable').firstChild,stable);assert.equal(w.document.getElementById('live').textContent,'Saving category...');watcher.disconnect();
 }finally{w.close();}
});
test('receipt and backup server messages are translated without changing server result objects',()=>{
 const api=require('../site-i18n.js');api.protect([]);
 const messages=['Tên người nhận trên biên lai không khớp tên đã cấu hình.','Chưa đọc rõ tên trong vùng người nhận trên biên lai.','Chưa đọc rõ số tiền giao dịch trên biên lai. Hãy tải ảnh gốc rõ nét hơn.','Giỏ hàng hoặc người nhận đã thay đổi. Vui lòng quét lại biên lai','Máy chủ đang đọc nhiều biên lai. Vui lòng thử lại sau.','Backup không đúng định dạng'];
 for(const reason of messages){const result={isValid:false,matchedAmount:true,reason},saved=JSON.stringify(result);assert.ok(!/[À-ỹĐđ]/.test(api.translate(reason,'en')));assert.equal(JSON.stringify(result),saved);}
});
