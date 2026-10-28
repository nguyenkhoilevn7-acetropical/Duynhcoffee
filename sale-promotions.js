/* Shared deterministic automatic-sale pricing for Mom's Tea & Coffee.
 * Same module is executed by the storefront and receipt-verification server.
 * Promotions never reduce shipping and cannot stack with a coupon. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MomSalePricing = api;
})(typeof window !== 'undefined' ? window : undefined, function () {
  'use strict';
  const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
  const sale = p => p && p.mode === 'automatic' && p.kind === 'sale';
  const positiveInteger = v => Number.isSafeInteger(Number(v)) && Number(v) >= 0;
  function validateCampaign(p, menu) {
    if (!sale(p)) throw new Error('Chương trình SALE không hợp lệ.');
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 100) throw new Error('Cần tên chương trình SALE.');
    if (p.scope !== 'all' && p.scope !== 'selected') throw new Error('Chọn phạm vi giảm giá.');
    if (p.reason!==undefined && (typeof p.reason!=='string'||p.reason.length>240))
      throw new Error('Thông điệp SALE tối đa 240 ký tự.');
    if (p.type !== 'percent' && p.type !== 'amount') throw new Error('Chọn kiểu giảm giá.');
    const value = Number(p.value);
    if (!Number.isSafeInteger(value) || value < 1 || (p.type === 'percent' && value > 99) || (p.type === 'amount' && value > 1000000))
      throw new Error('Mức giảm phải hợp lệ (1–99% hoặc 1–1.000.000đ).');
    const ids = Array.isArray(p.productIds) ? p.productIds.map(String) : [];
    if (p.scope === 'selected' && (!ids.length || ids.length > 500 || new Set(ids).size !== ids.length ||
      (Array.isArray(menu) && ids.some(id => !menu.some(item => String(item.id) === id)))))
      throw new Error('Chọn ít nhất một sản phẩm hợp lệ.');
    for (const field of ['startsAt','endsAt']) {
      if (p[field] && (typeof p[field] !== 'string' || !Number.isFinite(Date.parse(p[field]))))
        throw new Error('Thời gian SALE không hợp lệ.');
    }
    if (p.startsAt && p.endsAt && Date.parse(p.startsAt) >= Date.parse(p.endsAt))
      throw new Error('Thời gian kết thúc phải sau lúc bắt đầu.');
    return true;
  }
  function isActive(p, now=Date.now()) {
    if (!sale(p) || p.active === false || p.isActive === false) return false;
    const date = Number(now);
    if (p.startsAt && (!Number.isFinite(Date.parse(p.startsAt)) || date < Date.parse(p.startsAt))) return false;
    if (p.endsAt && (!Number.isFinite(Date.parse(p.endsAt)) || date >= Date.parse(p.endsAt))) return false;
    try {validateCampaign(p);return true;}catch{return false;}
  }
  function campaignAmount(rows,p,now=Date.now()) {
    if (!isActive(p,now)) return 0;
    let savings=0;
    for (const row of rows) {
      if (p.scope === 'selected' && !p.productIds.map(String).includes(String(row.id))) continue;
      const line = row.unitPrice*row.qty;
      const off = p.type === 'percent' ? Math.round(line*Number(p.value)/100)
        : Math.min(Number(p.value)*row.qty, Math.max(0,line-row.qty));
      savings += Math.min(Math.max(0,off), Math.max(0,line-row.qty));
    }
    return savings;
  }
  function calculate(items,discounts=[],code='',now=Date.now()) {
    if (!Array.isArray(items) || items.length > 100) throw new Error('Giỏ hàng không hợp lệ.');
    const rows = items.map(i => {
      const unitPrice=Number(i.unitPrice ?? i.price),qty=Number(i.qty);
      if (!positiveInteger(unitPrice) || !Number.isSafeInteger(qty) || qty<1 || qty>100)
        throw new Error('Giá hoặc số lượng không hợp lệ.');
      return {id:String(i.id),unitPrice,qty};
    });
    const rawTotal=rows.reduce((sum,r)=>sum+r.unitPrice*r.qty,0);
    if (!Number.isSafeInteger(rawTotal)) throw new Error('Tổng tiền không hợp lệ.');
    const current=Array.isArray(discounts)?discounts:[];
    let best={amount:0,discount:null};
    for (const p of current) {
      if (!isActive(p,now)) continue;
      const amount=campaignAmount(rows,p,now);
      if (amount > best.amount) best={amount,discount:{mode:'automatic',id:p.id,code:null,title:p.title,
        type:p.type,value:p.value,scope:p.scope,amount,desc:p.title}};
    }
    if (code) {
      const coupon=current.find(d => !sale(d) && typeof d?.code === 'string' &&
        d.code.toUpperCase() === String(code).toUpperCase());
      if (!coupon || coupon.active === false || coupon.isActive === false ||
        !Number.isFinite(Number(coupon.percent)) || Number(coupon.percent)<0 || Number(coupon.percent)>100)
        throw new Error('Mã giảm giá không còn hợp lệ.');
      const amount=Math.round(rawTotal * Number(coupon.percent)/100);
      if (amount >= best.amount) best={amount,discount:{code:coupon.code,mode:'code',percent:Number(coupon.percent),
        amount,desc:coupon.desc}};
    }
    return {rawTotal,total:Math.max(0,rawTotal-best.amount),amount:best.amount,discount:best.discount};
  }
  return {calculate,validateCampaign,isActive,campaignAmount};
});
