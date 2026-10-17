'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { compareReceipt, createReceiptVerifier, calculateAmount, shouldRetryOcr } = require('../receipt-verification');
const text = 'Số tiền: 45.000 VND\nNgười nhận:\nĐÀO KHÔI NGUYÊN\nNgười gửi: TRAN VAN AN';
test('readable wrong recipient or amount returns immediately without a second OCR pass', () => {
  for (const sample of [text, text.replace('45.000','46.000'), text.replace('ĐÀO KHÔI NGUYÊN','TRAN VAN AN'), text.replace('45.000','46.000').replace('ĐÀO KHÔI NGUYÊN','TRAN VAN AN')]) {
    const result=compareReceipt(sample,45000,'DAO KHOI NGUYEN');
    assert.equal(result.recipientReadable,true);
    assert.equal(result.amountReadable,true);
    assert.equal(shouldRetryOcr(result,95),false);
  }
});
test('low-confidence or missing fields retain fallback; reminder text is not a recipient field', () => {
  const wrong=compareReceipt(text.replace('ĐÀO KHÔI NGUYÊN','TRAN VAN AN'),45000,'DAO KHOI NGUYEN');
  assert.equal(shouldRetryOcr(wrong,40),true);
  const missing=compareReceipt('45.000đ\nLưu người nhận để tìm lại nhanh hơn vào lần sau.',45000,'DAO KHOI NGUYEN');
  assert.equal(missing.recipientReadable,false);assert.equal(shouldRetryOcr(missing,95),true);
  const labelOnly=compareReceipt('45.000đ\nNgười nhận\nSố thẻ TK',45000,'DAO KHOI NGUYEN');
  assert.equal(labelOnly.recipientReadable,false);
  assert.equal(compareReceipt('45.000đ\nLưu người nhận DAO KHOI NGUYEN',45000,'DAO KHOI NGUYEN').isValid,false);
  assert.equal(compareReceipt('45.000đ\nNgười nhận\nNgân hàng Vietcombank',45000,'DAO KHOI NGUYEN').recipientReadable,false);
  assert.equal(compareReceipt('45.000đ\nNgười nhận\n9911989890',45000,'DAO KHOI NGUYEN').recipientReadable,false);
});
test('matches accented recipient with unaccented settings and exact VND amount', () => {
  assert.equal(compareReceipt(text,45000,'DAO KHOI NGUYEN').isValid,true);
  assert.equal(compareReceipt(text.replace('45.000','45,000.00'),45000,'DAO KHOI NGUYEN').isValid,true);
  assert.equal(compareReceipt(text.replace('45.000','145.000'),45000,'DAO KHOI NGUYEN').isValid,false);
  assert.equal(compareReceipt(text,45000,'DAO KHUE NGUYEN').isValid,false);
});
test('does not approve sender name or scattered/out of order recipient tokens', () => {
  assert.equal(compareReceipt(text,45000,'TRAN VAN AN').matchedRecipient,false);
  assert.equal(compareReceipt(text.replace('ĐÀO KHÔI NGUYÊN','NGUYEN KHOI DAO'),45000,'DAO KHOI NGUYEN').isValid,false);
  assert.equal(compareReceipt('DAO\nKHOI\nNGUYEN\n45000',45000,'DAO KHOI NGUYEN').isValid,false);
});
test('reads wallet success amounts and OCR currency/spacing variants', () => {
  for (const money of ['45.000đ', '45.000d', '45 . 000 đ', '45,000.00 VND', '45\u202f000 ₫', '45000 VND']) {
    const receipt = `Giao dịch thành công\n${money}\nNgười nhận: DAO KHOI NGUYEN\nSố dư 900.000đ`;
    assert.equal(compareReceipt(receipt, 45000, 'DAO KHOI NGUYEN').isValid, true, money);
  }
  assert.equal(compareReceipt('45.000d\nNgười nhận: DAO KHOI NGUYEN', 45000, 'DAO KHOI NGUYEN').isValid, true);
});
test('does not take matching balances, fees or reference numbers as payment', () => {
  for (const receipt of [
    'Giao dịch thành công\n145.000đ\nSố dư 45.000đ',
    'Số tiền: 145.000đ\nPhí: 45.000đ',
    'Số dư 45.000đ\nMã giao dịch 45000',
    'Tin nhắn ORD45000\nSố tài khoản 45000'
  ]) assert.equal(compareReceipt(receipt + '\nNgười nhận: DAO KHOI NGUYEN', 45000, 'DAO KHOI NGUYEN').isValid, false);
});
test('proof binds server prices, image, recipient, cart total and expiry', async () => {
  const state={menu:[{id:1,price:45000}],config:{bankConfig:{accountHolder:'DAO KHOI NGUYEN'}},discounts:[]};
  let clock=1000;
  const service=createReceiptVerifier({readState:()=>state,recognize:async()=>text,now:()=>clock});
  const image='data:image/png;base64,YWJj';
  const result=await service.verify({image,items:[{id:1,qty:1,price:1}],expectedAmount:1,expectedHolder:'TRAN VAN AN'});
  assert.equal(result.isValid,true);
  const order={verificationToken:result.verificationToken,receiptImage:image,items:[{id:1,qty:1}],total:45000};
  assert.equal(service.assertVerified(order),true);
  assert.throws(()=>service.assertVerified({...order,total:1}));
  assert.throws(()=>service.assertVerified({...order,receiptImage:image+'x'}));
  assert.throws(()=>service.assertVerified({...order,verificationToken:result.verificationToken+'x'}));
  assert.throws(()=>service.assertVerified({...order,items:[{id:1,qty:2}],total:90000}));
  state.config.bankConfig.accountHolder='ANOTHER NAME';assert.throws(()=>service.assertVerified(order));
  state.config.bankConfig.accountHolder='DAO KHOI NGUYEN';clock+=16*60000;assert.throws(()=>service.assertVerified(order));
});
test('fails closed on OCR outage, bad images and disabled discounts', async () => {
  const state={menu:[{id:1,price:45000}],config:{bankConfig:{accountHolder:'DAO KHOI NGUYEN'}},discounts:[{code:'OFF',percent:20,active:false}]};
  const service=createReceiptVerifier({readState:()=>state,recognize:async()=>{throw Error('OCR unavailable');}});
  await assert.rejects(service.verify({image:'data:image/png;base64,YWJj',items:[{id:1,qty:1}]}));
  await assert.rejects(service.verify({image:'data:image/svg+xml;base64,YWJj',items:[{id:1,qty:1}]}));
  assert.throws(()=>calculateAmount([{id:1,qty:1}],state.menu,state.discounts,'OFF'));
});
test('OCR deadline reports unavailable, allows retry and does not issue verification proof', async () => {
  const state={menu:[{id:1,price:45000}],config:{bankConfig:{accountHolder:'DAO KHOI NGUYEN'}},discounts:[]};
  let stall=true;
  const service=createReceiptVerifier({readState:()=>state,deadlineMs:50,recognize:()=>stall ? new Promise(()=>{}) : Promise.resolve(text)});
  const body={image:'data:image/png;base64,YWJj',items:[{id:1,qty:1}]};
  const started=Date.now();
  await assert.rejects(service.verify(body), /Chưa thể kết luận/);
  assert.ok(Date.now()-started < 1000);
  stall=false;
  assert.equal((await service.verify(body)).isValid,true);
});
test('wallet OCR text reads the actual 45000 amount and ignores the balance notification', () => {
  const receipt='Thông báo VCB Số dư TK VCB 9911989890 -45,000 VND\nGiao dich thanh cong\n45.000d\nGiao dich 151227712371 >\nThời gian thanh toán 23:45 - 11/10/2026\nBiên lai chuyển tiền\nNgười nhận DAO KHOI NGUYEN\nSố thẻ/TK 9911989890\nNgân hàng Vietcombank\nTin nhắn ORD1005';
  assert.equal(compareReceipt(receipt,45000,'DAO KHOI NGUYEN').isValid,true);
  assert.equal(compareReceipt(receipt.replace('45.000d','46.000d'),45000,'DAO KHOI NGUYEN').isValid,false);
  assert.equal(compareReceipt(receipt,45000,'DAO KHUE NGUYEN').isValid,false);
});

test('45000 receipt cannot approve 53000 drink with 8000 topping; correct amount and recipient can',async()=>{
 const state={menu:[{id:1,price:45000,category:'tea'}],config:{bankConfig:{accountHolder:'DAO KHOI NGUYEN'}},discounts:[]};
 let recognized=text;const service=createReceiptVerifier({readState:()=>state,recognize:async()=>recognized});
 const image='data:image/png;base64,YWJj',items=[{id:1,qty:1,toppings:[{id:'Trân Châu Trắng',price:0}]}];
 assert.equal(calculateAmount(items,state.menu,[],null),53000);
 const wrong=await service.verify({image,items});assert.equal(wrong.isValid,false);assert.equal(wrong.detectedAmount,45000);assert.equal(wrong.expectedAmount,53000);assert.equal(wrong.verificationToken,undefined);
 recognized=text.replace('45.000','53.000');const good=await service.verify({image,items});assert.equal(good.isValid,true);
 const order={items:[{...items[0],price:53000,total:53000}],total:53000,receiptImage:image,verificationToken:good.verificationToken};assert.equal(service.assertVerified(order),true);
 assert.throws(()=>service.assertVerified({...order,items:[{id:1,qty:1}],total:45000}));
 const base=await service.verify({image,items:[{id:1,qty:1}]});assert.equal(base.isValid,false);
 recognized=text;const baseGood=await service.verify({image,items:[{id:1,qty:1}]});
 assert.throws(()=>service.assertVerified({...order,items:[{id:1,qty:1,price:53000,total:53000}],total:45000,verificationToken:baseGood.verificationToken}));
 recognized=text.replace('45.000','53.000').replace('ĐÀO KHÔI NGUYÊN','TRAN VAN AN');assert.equal((await service.verify({image,items})).isValid,false);
 assert.equal(calculateAmount([{...items[0],qty:2}],state.menu,[{code:'OFF',percent:10}], 'OFF'),95400);
 for (const toppings of [[{id:'unknown'}],[{id:'Trân Châu Trắng'},{id:'Trân Châu Trắng'}],null]) assert.throws(()=>calculateAmount([{id:1,qty:1,toppings}],state.menu,[],null));
});

test('cached OCR text saves a reread but always rechecks current topping price, recipient and expiry',async()=>{
 let calls=0,clock=1000;const state={menu:[{id:1,category:'tea',price:45000}],discounts:[],config:{bankConfig:{accountHolder:'DAO KHOI NGUYEN'}}};
 const ai=createReceiptVerifier({readState:()=>state,now:()=>clock,cacheOcr:true,recognize:async()=>{calls++;return 'Giao dịch thành công\n45.000đ\nNgười nhận DAO KHOI NGUYEN';}});
 const image='data:image/png;base64,YWJj',base={image,items:[{id:1,qty:1}],payableAmount:45000};
 assert.equal((await ai.verify(base)).isValid,true);
 const mismatch=await ai.verify({image,items:[{id:1,qty:1,toppings:[{id:'Trân Châu Trắng'}]}],payableAmount:53000});assert.equal(mismatch.isValid,false);assert.equal(mismatch.verificationToken,undefined);assert.equal(mismatch.ocrPasses,0);assert.equal(calls,1);
 state.config.bankConfig.accountHolder='TRAN VAN AN';assert.equal((await ai.verify(base)).isValid,false);assert.equal(calls,1);
 clock+=120001;await ai.verify(base);assert.equal(calls,2);
});

test('triage rejects menus and failed checkout screenshots but preserves bank and photographed receipt cues',()=>{
 const {classifyReceiptText}=require('../receipt-verification');
 for(const text of ['Coffee Tea Menu Add Buy Now Cart 42,000 VND','Thanh Toán Đơn Hàng\nChưa xác minh được biên lai\nChạm để đổi ảnh khác\nVui lòng quét lại'])assert.equal(classifyReceiptText(text),'unrelated');
 for(const text of ['Giao dịch thành công\n42,000 VND\nTên người nhận DAO KHOI NGUYEN','ZaloPay\n39.000đ\nDAO KHOI NGUYEN','Ảnh tối\nNgân hàng nhận Vietcombank\nMenu'])assert.equal(classifyReceiptText(text),'possible_receipt');
 assert.equal(classifyReceiptText(''),'unclear');
});
