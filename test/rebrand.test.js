'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('brand migration updates live bilingual menu and store copy once while preserving order, prices, stock, images and payment credentials',()=>{
 const item={id:4,name:'Cafe Trứng Đuỷnh',name_en:'Duynh Egg Coffee',category:'coffee',price:45000,stock:0,image:'original-image'};
 const config={storeName:'ĐUỶNH TEA & COFFEE',storeSlogan:'Đuỷnh — Ngon đến giọt cuối cùng',banner:{tagline:'✨ ĐUỶNH TEA & COFFEE ✨',images:['original-banner'],promoCode:'DUYNH20'},categories:[{id:'coffee',name:'Cà Phê Đuỷnh'}],bankConfig:{accountHolder:'DAO KHOI NGUYEN'},adminAccount:{username:'duynh',password:'secret'}};
 const writes=[];const s={menuCache:[item],configCache:config,MENU_FILE:'menu',CONFIG_FILE:'config',writeJsonFile:p=>writes.push(p)};
 vm.createContext(s);const code=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
 vm.runInContext(code.slice(code.indexOf('function rebrandMenuAndConfig()'),code.indexOf('const receiptVerifier =')),s);
 assert.equal(item.name,'Cafe Trứng Mom');assert.equal(item.name_en,'Mom Egg Coffee');
 assert.equal(config.storeName,'Mom’s Tea & Coffee');assert.equal(config.categories[0].name,'Cà Phê Mom');
 assert.equal(item.stock,0);assert.equal(item.price,45000);assert.equal(item.image,'original-image');assert.equal(item.category,'coffee');assert.equal(item.id,4);
 assert.equal(config.bankConfig.accountHolder,'DAO KHOI NGUYEN');assert.equal(config.adminAccount.username,'duynh');assert.equal(config.adminAccount.password,'secret');assert.equal(config.banner.promoCode,'DUYNH20');assert.deepEqual(config.banner.images,['original-banner']);
 assert.deepEqual(writes,['menu','config']);s.rebrandMenuAndConfig();assert.equal(writes.length,2);
});
