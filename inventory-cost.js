'use strict';
// Private ingredient valuation. No unit conversion is guessed for a carton/bag/box.
const units=new Map([
 ['g',['mass',1]],['gr',['mass',1]],['gam',['mass',1]],['gram',['mass',1]],['kg',['mass',1000]],
 ['mg',['mass',0.001]],['ml',['volume',1]],['l',['volume',1000]],['lit',['volume',1000]],['lít',['volume',1000]]
]);
function normalized(value){
 return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'d').toLowerCase().trim().replace(/\s+/g,' ');
}
function unitInfo(value){
 const key=normalized(value).replace(/\./g,'');
 return units.get(key)||[key,1];
}
function compatibleQuantity(amount,recipeUnit,purchaseAmount,purchaseUnit){
 const a=unitInfo(recipeUnit),b=unitInfo(purchaseUnit);
 if(a[0]!==b[0] || !a[0] || !Number.isFinite(purchaseAmount) || purchaseAmount<=0)return null;
 const used=Number(amount)*a[1], available=purchaseAmount*b[1];
 if(!Number.isFinite(used)||used<=0||!Number.isFinite(available)||available<=0)return null;
 return used/available;
}
function recipeUnitCost(recipe,inventory){
 if(!recipe||!Array.isArray(recipe.ingredients)||recipe.ingredients.length===0)
  return {cost:null,missing:['Chưa có công thức định lượng'],ingredients:[]};
 const stock=Array.isArray(inventory?.items)?inventory.items:[];
 let sum=0;const missing=[],ingredients=[];
 for(const row of recipe.ingredients){
  const name=String(row?.name||'').trim(),matches=stock.filter(i=>normalized(i.name)===normalized(name));
  if(!name||matches.length!==1){missing.push(name?matches.length>1?'Trùng tên nguyên liệu: '+name:'Thiếu nguyên liệu trong Inventory: '+name:'Thiếu tên nguyên liệu');continue;}
  const item=matches[0],price=item.purchaseUnitPrice;
  if(!Number.isSafeInteger(price)||price<0){missing.push('Chưa có giá nhập: '+name);continue;}
  const explicit=item.costQuantity!==undefined && item.costQuantity!==null && item.costQuantity!=='';
  const denominator=explicit?Number(item.costQuantity):1;
  const basis=explicit?item.costUnit:item.unit;
  const ratio=compatibleQuantity(row.amount,row.unit,denominator,basis);
  if(ratio===null){missing.push('Chưa quy đổi được '+name+' ('+String(row.unit||'')+' ↔ '+String(basis||'')+')');continue;}
  const value=price*ratio;
  if(!Number.isFinite(value)||value<0||value>1e12){missing.push('Giá vốn không hợp lệ: '+name);continue;}
  sum+=value;
  ingredients.push({name,amount:Number(row.amount),unit:row.unit,cost:Math.round(value)});
 }
 return {cost:missing.length?null:Math.round(sum),missing,ingredients};
}
module.exports={normalized,compatibleQuantity,recipeUnitCost};
