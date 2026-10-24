'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {recipeUnitCost,compatibleQuantity}=require('../inventory-cost');
const report=require('../profit-report');
const basic={id:'milk',name:'Sữa đặc',unit:'kg',purchaseUnitPrice:50000};
const inv={items:[basic,{id:'tea',name:'Trà lài',unit:'hộp',purchaseUnitPrice:40000,costQuantity:1000,costUnit:'g'}]};
const recipes={'1':{ingredients:[{name:'Sữa đặc',amount:20,unit:'g'},{name:'Trà lài',amount:10,unit:'g'}]}};
const order={id:'ORD-1',status:'done',createdAtIso:'2026-10-24T03:00:00.000Z',completedAtIso:'2026-10-24T03:30:00.000Z',beverageTotal:100000,items:[{id:1,name:'Trà sữa',price:50000,qty:2,total:100000}]};
test('auto price: 20g of 50k/kg plus 10g of 40k/1000g = 1400 per drink',()=>{
 const x=recipeUnitCost(recipes['1'],inv);assert.equal(x.cost,1400);assert.deepEqual(x.missing,[]);
 const f=report.orderFinancials(order,report.emptySettings(),recipes,inv);
 assert.equal(f.lines[0].cost,2800);assert.equal(f.lines[0].profit,97200);assert.equal(f.lines[0].costSource,'recipe');
 const day=report.buildReport([order],report.emptySettings(),'2026-10-24',recipes,inv);
 assert.equal(day.summary.cost,2800);assert.equal(day.summary.profit,97200);assert.equal(day.summary.recipeLines,1);
});
test('packages, per-liter conversion and explicit zero-cost items are handled without guessing',()=>{
 assert.equal(compatibleQuantity(150,'ml',1,'l'),0.15);
 assert.equal(compatibleQuantity(150,'ml',1,'hộp'),null);
 const priced={items:[{id:'box',name:'Sữa',unit:'hộp',costQuantity:1000,costUnit:'ml',purchaseUnitPrice:40000}]};
 assert.equal(recipeUnitCost({ingredients:[{name:'sữa',amount:150,unit:'ml'}]},priced).cost,6000);
 assert.equal(recipeUnitCost({ingredients:[{name:'sữa',amount:150,unit:'ml'}]},{items:[{...priced.items[0],purchaseUnitPrice:0}]}).cost,0);
 assert.equal(recipeUnitCost({ingredients:[{name:'sữa',amount:150,unit:'ml'}]},{items:[{...priced.items[0],costQuantity:null,costUnit:''}]}).cost,null);
});
test('missing ingredient, ambiguous names and units do not invent zero costs',()=>{
 assert.equal(recipeUnitCost(null,inv).cost,null);
 assert.equal(recipeUnitCost({ingredients:[{name:'Đường',amount:10,unit:'g'}]},inv).cost,null);
 assert.equal(recipeUnitCost(recipes['1'],{items:[...inv.items,{...basic,id:'milk2'}]}).cost,null);
 assert.equal(recipeUnitCost({ingredients:[{name:'Sữa đặc',amount:1,unit:'muỗng'}]},inv).cost,null);
 assert.equal(recipeUnitCost(recipes['1'],{items:[{...basic,purchaseUnitPrice:null},inv.items[1]]}).cost,null);
});
test('fallback percentage remains available, never overrides complete recipe cost',()=>{
 const m=[{id:1,name:'Trà sữa',price:50000}];
 const setting=report.updateSettings(report.emptySettings(),{version:'',items:[{itemId:'1',percent:30}]},m,'2026-10-24T03:00:00.000Z');
 const auto=report.orderFinancials(order,setting,recipes,inv);
 assert.equal(auto.lines[0].cost,2800);assert.equal(auto.lines[0].costSource,'recipe');
 const fallback=report.orderFinancials(order,setting,recipes,{items:[]});
 assert.equal(fallback.lines[0].cost,30000);assert.equal(fallback.lines[0].costSource,'percentage');
 const extras={...order,items:[{...order.items[0],toppings:[{name:'Thạch'}]}]};
 assert.equal(report.orderFinancials(extras,setting,recipes,inv).lines[0].costSource,'percentage');
 const missing=report.orderFinancials(order,report.emptySettings(),recipes,{items:[]});
 assert.equal(missing.cost,null);assert.equal(missing.profit,null);
});
test('discounts are allocated before profit and invalid quantity never yields profit',()=>{
 const discounted={...order,beverageTotal:80000};
 const r=report.buildReport([discounted],report.emptySettings(),'2026-10-24',recipes,inv);
 assert.equal(r.summary.revenue,80000);assert.equal(r.summary.cost,2800);assert.equal(r.summary.profit,77200);
 const invalid={...order,items:[{...order.items[0],qty:0}]};
 assert.equal(report.buildReport([invalid],report.emptySettings(),'2026-10-24',recipes,inv).summary.profit,null);
});
