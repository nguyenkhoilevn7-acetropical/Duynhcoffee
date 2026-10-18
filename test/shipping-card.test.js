'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start = html.indexOf('    function createAdminShippingOrderCard(order) {');
const end = html.indexOf('    // DUYỆT ĐƠN (NEW -> PREP)', start);
function makeCard(order) {
  assert.ok(start>=0 && end>start, 'Shipping order card function must exist');
  const context={
    menu:[{id:1,name:'Trà nho',category:'tea',image:'https://example.test/tea.jpg'}],
    escapeDeliveryText(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
    getSafeDrinkImage(image){return image || 'https://example.test/fallback.jpg';},
    cleanCorruptedText:v=>String(v??''),formatMoney:n=>Number(n||0).toLocaleString('vi-VN')+'đ'
  };
  vm.createContext(context);vm.runInContext(html.slice(start,end),context);
  return context.createAdminShippingOrderCard(order);
}
test('shipping cards show real drink photos, quantities, notes, customer, receipt link and courier actions',()=>{
 const output=makeCard({id:'ORD-123',customerName:'Nguyen A',phone:'0900000000',deliveryAddress:'Thu Duc',
 beverageTotal:45000,shippingFee:18000,receiptImage:'data:image/jpeg;base64,example',status:'shipping',
 items:[{id:1,name:'Trà nho',qty:2,price:22000,total:44000,custom:'Ít đá',toppings:['Nha đam']} ]});
 const dom=new JSDOM(output),doc=dom.window.document;
 assert.equal(doc.querySelectorAll('img').length,1);
 assert.equal(doc.querySelector('img').getAttribute('src'),'https://example.test/tea.jpg');
 assert.match(doc.body.textContent,/2 × Trà nho/);
 assert.match(doc.body.textContent,/Ít đá/);assert.match(doc.body.textContent,/Nha đam/);
 assert.match(doc.body.textContent,/Nguyen A/);assert.match(doc.body.textContent,/0900000000/);
 assert.match(doc.body.textContent,/Thu Duc/);
 assert.match(doc.body.textContent,/Xem Bill Chuyển Khoản/);
 assert.match(doc.body.textContent,/Liên kết Ahamove/);
 dom.window.close();
});
test('shipping order text is escaped and receipt stays hidden when not provided',()=>{
 const output=makeCard({id:'ORD-456',customerName:'<img src=x onerror=alert(1)>',items:[
 {id:10,name:'<script>bad()</script>',qty:1,price:1000,custom:'<b>test</b>'}
 ]});
 const dom=new JSDOM(output),doc=dom.window.document;
 assert.equal(doc.querySelector('script'),null);
 assert.equal(doc.querySelectorAll('img').length,1); // product fallback only
 assert.match(doc.body.textContent,/<script>bad\(\)<\/script>/);
 assert.doesNotMatch(doc.body.textContent,/Xem Bill Chuyển Khoản/);
 dom.window.close();
});
