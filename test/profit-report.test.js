'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const p=require('../profit-report'),{exportReport}=require('../profit-excel');
const menu=[{id:1,name:'Tea',price:50000},{id:2,name:'Coffee',price:30000}];
const first=p.updateSettings(p.emptySettings(),{version:'',items:[{itemId:'1',percent:25},{itemId:'2',percent:40}]},menu,'2026-10-18T02:00:00.000Z');
const base={id:'ORD-12345',status:'done',createdAtIso:'2026-10-18T01:00:00Z',completedAtIso:'2026-10-18T02:00:00Z',beverageTotal:50000,shippingFee:18000,items:[{id:1,name:'Tea',qty:1,price:50000,total:50000}]};
test('50k drink at25% earns37.5k per item, per order and per day; shipping excluded',()=>{
 const r=p.buildReport([base],first,'2026-10-18');assert.equal(r.items[0].unitProfit,37500);assert.equal(r.orders[0].cost,12500);assert.equal(r.orders[0].profit,37500);assert.equal(r.summary.profit,37500);assert.equal(r.summary.shipping,18000);
});
test('multi-item discounted orders allocate every dong and reconcile item/order/daily profit',()=>{
 const o={...base,beverageTotal:104003,items:[base.items[0],{id:2,name:'Coffee',qty:3,price:30000,total:90000}]};
 const r=p.buildReport([o],first,'2026-10-18');assert.equal(r.orders[0].cost,48500);assert.equal(r.summary.profit,55503);assert.equal(r.items.reduce((s,m)=>s+m.profit,0),55503);assert.equal(r.orders[0].lines.reduce((s,l)=>s+l.revenue,0),104003);assert.equal(r.summary.quantity,4);
 const a=p.allocate(10,[1,1,1]);assert.deepEqual(a,[4,3,3]);
});
test('zero cost distinct from missing: missing data never shows 100% profit',()=>{
 const empty=p.buildReport([base],p.emptySettings(),'2026-10-18');assert.equal(empty.summary.profit,null);assert.equal(empty.orders[0].profit,null);assert.equal(empty.items[0].profit,null);assert.equal(empty.summary.missingOrders,1);
 const z=p.updateSettings(p.emptySettings(),{version:'',items:[{itemId:'1',percent:0}]},menu);assert.equal(p.buildReport([base],z,'2026-10-18').summary.profit,50000);
});
test('completed and cancelled use event dates in Vietnam; received/pending use creation dates',()=>{
 const r=p.buildReport([{...base,createdAtIso:'2026-10-17T10:00:00Z',completedAtIso:'2026-10-17T17:00:00Z'},{...base,id:'ORD-2',status:'cancelled',cancelledAtIso:'2026-10-18T02:00:00Z'},{...base,id:'ORD-3',status:'prep'}],first,'2026-10-18');
 assert.equal(r.summary.completed,1);assert.equal(r.summary.cancelled,1);assert.equal(r.summary.pending,1);assert.equal(r.summary.received,2);assert.equal(r.summary.revenue,50000);assert.equal(r.summary.profit,37500);assert.equal(r.orders.find(o=>o.id==='ORD-2').profit,null);assert.equal(p.vnDay('2026-10-18T17:00:00Z'),'2026-10-19');assert.throws(()=>p.buildReport([],first,'2026-02-30'));
});
test('first configured rate covers legacy; later edits preserve historical order costs and deleted items',()=>{
 const second=p.updateSettings(first,{version:first.version,items:[{itemId:'1',percent:50}]},menu,'2026-10-18T03:00:00.000Z');
 assert.equal(p.buildReport([base],second,'2026-10-18').summary.profit,37500);
 const newer={...base,createdAtIso:'2026-10-18T04:00:00Z'};assert.equal(p.buildReport([newer],second,'2026-10-18').summary.profit,25000);
 assert.throws(()=>p.updateSettings(second,{version:first.version,items:[]},menu),/thiết bị khác/);
 const third=p.updateSettings(second,{version:second.version,items:[{itemId:'1',percent:null}]},menu,'2026-10-18T05:00:00.000Z');assert.equal(p.buildReport([newer],third,'2026-10-18').summary.profit,25000);assert.equal(p.buildReport([{...newer,createdAtIso:'2026-10-18T06:00:00Z'}],third,'2026-10-18').summary.profit,null);
});
test('invalid rates, malicious ids, malformed orders and old timestamps are explicit',()=>{
 for(const percent of [-1,101,'25',25.123,NaN])assert.throws(()=>p.updateSettings(first,{version:first.version,items:[{itemId:'1',percent}]},menu));
 assert.throws(()=>p.validateSettings({version:'',rates:JSON.parse('{"__proto__":[]}')}));
 for(const items of [[],[{id:1,name:'Bad',qty:0,price:50000,total:50000}],[{id:1,name:'Bad',qty:1,price:50000,total:-1}]])assert.equal(p.buildReport([{...base,items}],first,'2026-10-18').summary.profit,null);
 const r=p.buildReport([{...base,completedAtIso:undefined}],first,'2026-10-18');assert.equal(r.summary.legacyDateOrders,1);
});
test('XLSX has four sheets, typed numbers, cached profit formulas, literal text and no customer data',()=>{
 const r=p.buildReport([{...base,customerName:'private-customer',items:[{...base.items[0],name:'=HYPERLINK("malicious") & Tea'}]}],first,'2026-10-18');
 const b=exportReport(r);assert.equal(b.readUInt32LE(0),0x04034b50);const text=b.toString();assert.match(text,/Tong quan/);assert.match(text,/Tung don/);assert.match(text,/<f>F2-G2<\/f><v>37500<\/v>/);assert.match(text,/t="inlineStr"/);assert.match(text,/&amp; Tea/);assert.doesNotMatch(text,/private-customer/);
 fs.writeFileSync('/tmp/profit-qa-check.xlsx',b);
});
