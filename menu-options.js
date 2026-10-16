(function(factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(typeof window!=='undefined')window.MenuOptions=api;})(function(){
 'use strict';
 const groups=['ice','sugar','toppings'];
 const choice=(name,name_en,price=0)=>({id:name,name,name_en,price});
 const defaults={ice:[choice('100% Đá','100% ice'),choice('70% Đá','70% ice'),choice('50% Đá','50% ice'),choice('Không Đá','No ice')],sugar:[choice('100% Ngọt','100% sugar'),choice('70% Ngọt','70% sugar'),choice('50% Ngọt','50% sugar'),choice('Không Đường','No sugar')],toppings:[choice('Trân Châu Trắng','White pearls',8000),choice('Kem Macchiato','Macchiato cream',12000),choice('Thạch Củ Năng','Water chestnut jelly',8000),choice('Đào Miếng Giòn','Peach pieces',10000)]};
 function invalid(){throw Object.assign(new Error('Tùy chọn món không hợp lệ. Kiểm tra tên, mã và giá topping.'),{status:422});}
 function validateOptions(input){
  if(!input||typeof input!=='object'||Array.isArray(input))invalid();
  const out={};
  for(const group of groups){
   const list=input[group];if(!Array.isArray(list)||list.length>20)invalid();const ids=new Set(),names=new Set();
   out[group]=list.map(row=>{
    if(!row||typeof row!=='object')invalid();
    const id=typeof row.id==='string'?row.id.trim():'',name=typeof row.name==='string'?row.name.trim():'',name_en=typeof row.name_en==='string'?row.name_en.trim():'';
    const price=group==='toppings'?row.price:0;
    if(!id||id.length>120||!name||name.length>100||name_en.length>160||/[<>]/.test(id+name+name_en)||ids.has(id)||names.has(name.toLocaleLowerCase('vi'))||!Number.isSafeInteger(price)||price<0||price>1000000)invalid();
    ids.add(id);names.add(name.toLocaleLowerCase('vi'));return{id,name,name_en,price};
   });
  }
  return out;
 }
 function getOptions(item){return item&&item.options!==undefined?validateOptions(item.options):validateOptions(item&&item.category==='bakery'?{ice:[],sugar:[],toppings:[]}:defaults);}
 return {getOptions,validateOptions};
});
