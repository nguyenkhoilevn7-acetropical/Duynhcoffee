'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sale=require('../sale-promotions');
const {calculateAmount}=require('../receipt-verification');
const menu=[{id:1,name:'Trà Mãng Cầu',price:45000},{id:2,name:'Trà Tắc',price:49000},{id:3,name:'Coffee',price:39000}];
const now=Date.parse('2026-10-26T05:00:00.000Z');
const base={id:101,kind:'sale',mode:'automatic',title:'Happy Hour',scope:'selected',type:'percent',value:20,productIds:['1'],active:true};
const items=[{id:1,qty:2,unitPrice:45000},{id:2,qty:1,unitPrice:49000}];
const simple=(promos,code='',moment=now)=>sale.calculate(items,promos,code,moment);
test('selected 20% applies to selected line only, not other products',()=>{
 const p=simple([base]);
 assert.equal(p.rawTotal,139000);
 assert.equal(p.amount,18000);
 assert.equal(p.total,121000);
 assert.equal(p.discount.id,101);
});
test('all-product promotion applies to complete beverage subtotal',()=>{
 const p=simple([{...base,scope:'all',productIds:[]}]);
 assert.equal(p.amount,27800);
 assert.equal(p.total,111200);
});
test('fixed amount is per eligible cup and cannot make the cart negative',()=>{
 const p=simple([{...base,type:'amount',value:5000}]);
 assert.equal(p.amount,10000);
 assert.equal(p.total,129000);
 const q=sale.calculate([{id:1,qty:2,unitPrice:1000}],[{...base,type:'amount',value:1000000}],'',now);
 assert.equal(q.total,2);
});
test('best offer wins; voucher and SALE never stack',()=>{
 const coupon={id:2,code:'VIP30',percent:30,active:true};
 const low=simple([base,coupon],'VIP30');
 assert.equal(low.amount,41700);
 assert.equal(low.total,97300);
 assert.equal(low.discount.mode,'code');
 const big=simple([{...base,scope:'all',productIds:[],value:50},coupon],'VIP30');
 assert.equal(big.amount,69500);
 assert.equal(big.discount.mode,'automatic');
});
test('scheduled sales start and end at exact instants',()=>{
 const p={...base,startsAt:'2026-10-26T05:00:00Z',endsAt:'2026-10-26T05:10:00Z'};
 assert.equal(simple([p],'',now-1).amount,0);
 assert.equal(simple([p],'',now).amount,18000);
 assert.equal(simple([p],'',now+600000).amount,0);
 assert.equal(simple([{...p,active:false}],'',now).amount,0);
});
test('campaign validation rejects empty product selection, invalid dates and discount',()=>{
 assert.throws(()=>sale.validateCampaign({...base,productIds:[]},menu),/sản phẩm/);
 assert.throws(()=>sale.validateCampaign({...base,productIds:['999']},menu),/sản phẩm/);
 assert.throws(()=>sale.validateCampaign({...base,value:100},menu),/Mức giảm/);
 assert.throws(()=>sale.validateCampaign({...base,startsAt:'2026-10-30',endsAt:'2026-10-29'},menu),/kết thúc/);
 assert.equal(sale.validateCampaign(base,menu),true);
});
test('receipt server charges same SALE amount as shared storefront rules',()=>{
 const order=[{id:1,qty:2,toppings:[]},{id:2,qty:1,toppings:[]}];
 const p={...base,startsAt:'',endsAt:''};
 const current=sale.calculate(items,[p]).total;
 assert.equal(calculateAmount(order,menu,[p],''),current);
 assert.equal(calculateAmount(order,menu,[p,{code:'VIP30',percent:30,active:true}],'VIP30'),97300);
});
test('new promotion UI keeps old coupon fields, sync and API source unchanged',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'../sale-admin.js'),'utf8');
 assert.match(html,/id="mom-sale-scope"/);
 assert.match(html,/id="mom-sale-products"/);
 assert.match(html,/id="new-discount-code"/);
 assert.match(html,/sale-promotions\.js\?v=20261026-1/);
 assert.match(html,/sale-admin\.js\?v=20261026-1/);
 assert.match(html,/getSaleCheckoutResult\(\)/);
 assert.match(js,/\/api\/discounts/);
 assert.match(js,/Authorization/);
});
