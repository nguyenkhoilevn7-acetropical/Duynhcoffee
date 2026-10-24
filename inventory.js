'use strict';
// Stock purchasing is private admin data; no public menu or order side effects.
const crypto=require('node:crypto');
const MAX_ITEMS=150;
const STATUSES=new Set(['need','planned','ordered','received']);
const photoPattern=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
function fail(message,status=422){const e=new Error(message);e.status=status;throw e;}
function emptyInventory(){return {version:'',items:[]};}
function text(value,max,label){
  if(value===undefined||value===null)return '';
  if(typeof value!=='string')fail(label+' không hợp lệ');
  const s=value.trim();if(s.length>max)fail(label+' quá dài');return s;
}
function count(value,label){
  if(value===''||value===undefined||value===null)return 0;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000000||Math.round(value*1000)!==value*1000)
    fail(label+' phải là số từ 0 đến 1.000.000 (tối đa 3 số thập phân)');
  return value;
}
function date(value,label){
  const s=text(value,10,label);
  if(!s)return '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)fail(label+' không đúng định dạng');
  return s;
}
function image(value){
  if(value===undefined||value===null||value==='')return '';
  if(typeof value!=='string'||value.length>175000)fail('Ảnh phải là JPEG, PNG hoặc WebP, tối đa 120 KB');
  const m=photoPattern.exec(value);
  if(!m||m[2].length%4!==0||Buffer.byteLength(m[2],'base64')>120*1024)fail('Ảnh không hợp lệ hoặc quá 350 KB');
  const b=Buffer.from(m[2],'base64');
  const sig={jpeg:b[0]===0xff&&b[1]===0xd8,png:b.slice(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),webp:b.slice(0,4).toString()==='RIFF'&&b.slice(8,12).toString()==='WEBP'};
  if(!sig[m[1]])fail('Nội dung ảnh không khớp định dạng');
  return value;
}
function validateItem(input){
  if(!input||Array.isArray(input)||typeof input!=='object')fail('Sản phẩm không hợp lệ');
  const name=text(input.name,120,'Tên sản phẩm');if(!name)fail('Vui lòng nhập tên sản phẩm');
  const status=text(input.status||'need',12,'Trạng thái');
  if(!STATUSES.has(status))fail('Trạng thái mua hàng không hợp lệ');
  return {
    name,category:text(input.category,80,'Nhóm hàng'),unit:text(input.unit,30,'Đơn vị')||'cái',
    stock:count(input.stock,'Tồn kho'),minimum:count(input.minimum,'Mức cảnh báo'),
    buyQuantity:count(input.buyQuantity,'Số lượng cần mua'),
    purchaseDate:date(input.purchaseDate,'Ngày dự kiến mua'),
    lastPurchasedDate:date(input.lastPurchasedDate,'Ngày mua gần nhất'),
    supplier:text(input.supplier,120,'Nhà cung cấp'),
    supplierPhone:text(input.supplierPhone,40,'Liên hệ nhà cung cấp'),
    purchaseLocation:text(input.purchaseLocation,220,'Nơi mua'),
    status,notes:text(input.notes,1200,'Ghi chú'),image:image(input.image)
  };
}
function validateInventory(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||!Array.isArray(data.items)||data.items.length>MAX_ITEMS)fail('Kho hàng không hợp lệ');
  if(typeof data.version!=='string'||data.version.length>100)fail('Phiên bản kho hàng không hợp lệ');
  const ids=new Set();
  for(const item of data.items){
    if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(item.id)||ids.has(item.id))fail('Mã sản phẩm trùng hoặc không hợp lệ');
    ids.add(item.id);validateItem(item);
  }
  return data;
}
function mutateInventory(source,request){
  const current=validateInventory(source||emptyInventory());
  if(!request||typeof request!=='object'||Array.isArray(request))fail('Dữ liệu không hợp lệ');
  if(request.version!==current.version)fail('Kho vừa thay đổi trên thiết bị khác. Tải lại trước khi lưu.',409);
  const action=request.action,items=current.items.slice();
  if(action==='save'){
    const row=validateItem(request.item);
    const id=request.item.id;
    if(id){
      const index=items.findIndex(x=>x.id===id);
      if(index<0)fail('Không tìm thấy sản phẩm cần sửa',404);
      items[index]={...row,id,createdAt:items[index].createdAt,updatedAt:new Date().toISOString()};
    }else{
      if(items.length>=MAX_ITEMS)fail('Tối đa '+MAX_ITEMS+' sản phẩm');
      items.unshift({...row,id:crypto.randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    }
  }else if(action==='delete'){
    const idx=items.findIndex(x=>x.id===request.id);
    if(idx===-1)fail('Không tìm thấy sản phẩm cần xóa',404);
    items.splice(idx,1);
  }else fail('Hành động không được hỗ trợ',400);
  return {version:crypto.randomUUID(),items};
}
module.exports={emptyInventory,validateInventory,validateItem,mutateInventory};
