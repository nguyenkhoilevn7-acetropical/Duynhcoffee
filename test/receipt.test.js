'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { compareReceipt, createReceiptVerifier, calculateAmount } = require('../receipt-verification');
const text = 'Số tiền: 45.000 VND\nNgười nhận:\nĐÀO KHÔI NGUYÊN\nNgười gửi: TRAN VAN AN';
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
