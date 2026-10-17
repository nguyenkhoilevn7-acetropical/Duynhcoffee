'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compareReceipt}=require('../receipt-verification');
// Synthetic examples exercise field/layout families, not official bank screenshots.
const layouts={
 'MoMo labeled recipient':'Giao dịch thành công\n39.000đ\nNgười nhận DAO KHOI NGUYEN\nNgân hàng Vietcombank\nTin nhắn ORD1001',
 'ZaloPay bank recipient card':'Giao dịch thành công\nMã giao dịch 9201000532345\nThời gian 22:07 14/10/2026\nORD1001\n39.000đ\nDAO KHOI NGUYEN\nNgân hàng TMCP Ngoại Thương Việt Nam 9911989890',
 'VCB beneficiary fields':'Chuyển tiền thành công\nSố tiền:39,000 VND\nNgười thụ hưởng\nDAO KHOI NGUYEN\nNgân hàng thụ hưởng Vietcombank\nMã giao dịch 39000',
 'Sacombank owner fields':'Giao dịch thành công\nSố tiền thanh toán (VND):39.000\nTài khoản thụ hưởng\n9911989890\nDAO KHOI NGUYEN\nDiễn giải ORD39000',
 'MB recipient block':'Chuyển khoản thành công\n39,000 VND\nThông tin người nhận\n9911989890\nDAO KHOI NGUYEN\nNgân hàng Vietcombank',
 'Other bank English fields':'Transfer successful\nTransfer amount: 39,000.00 VND\nBeneficiary name: DAO KHOI NGUYEN\nSender TRAN VAN AN',
 'Other bank multiline amount':'Số tiền giao dịch\n39 000 ₫\nTên người nhận: DAO KHOI NGUYEN\nSố dư 100000 VND'
};
for(const [layout,text] of Object.entries(layouts)) test(layout+' accepts only exact amount and recipient',()=>{
 assert.equal(compareReceipt(text,39000,'DAO KHOI NGUYEN').isValid,true);
 assert.equal(compareReceipt(text,40000,'DAO KHOI NGUYEN').isValid,false);
 assert.equal(compareReceipt(text,39000,'DAO KHUE NGUYEN').isValid,false);
});
test('wallet metadata or promo numbers cannot replace the main transaction amount',()=>{
 const text='Giao dịch thành công\nMã giao dịch 39000\nThời gian 22:07 14/10/2026\nORD39000\n40.000đ\nDAO KHOI NGUYEN\nNgân hàng Vietcombank 9911989890\nƯu đãi 39.000đ';
 assert.equal(compareReceipt(text,39000,'DAO KHOI NGUYEN').isValid,false);
 assert.equal(compareReceipt(text,40000,'DAO KHOI NGUYEN').isValid,true);
});
test('unlabeled wallet names require the adjacent bank card, not content or advertisements',()=>{
 for(const tail of ['DAO KHOI NGUYEN\nƯu đãi ngân hàng', 'Nội dung DAO KHOI NGUYEN\nNgân hàng Vietcombank', 'DAO KHOI NGUYEN\nTin nhắn ORD1001'])
   assert.equal(compareReceipt('Giao dịch thành công\n39.000đ\n'+tail,39000,'DAO KHOI NGUYEN').isValid,false);
});
test('sender owner fields and checkout instructions cannot override actual recipient',()=>{
 const bank='Người gửi TRAN VAN AN\nChủ tài khoản DAO KHOI NGUYEN\nSố tiền 39.000đ\nNgười nhận TRAN VAN AN';
 assert.equal(compareReceipt(bank,39000,'DAO KHOI NGUYEN').isValid,false);
 assert.equal(compareReceipt(bank.replace('Người gửi TRAN VAN AN','Tài khoản trích nợ 123456'),39000,'DAO KHOI NGUYEN').isValid,false);
 const checkout='Chủ tài khoản DAO KHOI NGUYEN\nSố tiền chuyển 39.000đ\nGiao dịch thành công\n40.000đ\nTRAN VAN AN\nNgân hàng Vietcombank';
 assert.equal(compareReceipt(checkout,39000,'DAO KHOI NGUYEN').isValid,false);
});
test('explicit conflicting recipient and a second transaction cannot be combined',()=>{
 const wrong='Giao dịch thành công\n39.000đ\nDAO KHOI NGUYEN\nNgân hàng Vietcombank\nNgười nhận TRAN VAN AN';
 assert.equal(compareReceipt(wrong,39000,'DAO KHOI NGUYEN').isValid,false);
 const multi='Giao dịch thành công\n39.000đ\nTRAN VAN AN\nNgân hàng Vietcombank\nGiao dịch thành công\n40.000đ\nDAO KHOI NGUYEN\nNgân hàng Vietcombank';
 assert.equal(compareReceipt(multi,39000,'DAO KHOI NGUYEN').isValid,false);
});
test('fees and balances cannot turn an incorrect amount into a match',()=>{
 const receipt='Số tiền:40.000đ\nSố tiền phí:39.000đ\nSố dư 39.000đ\nNgười nhận DAO KHOI NGUYEN';
 assert.equal(compareReceipt(receipt,39000,'DAO KHOI NGUYEN').isValid,false);
});
test('separate currency rows and total including fees preserve the transferred amount',()=>{
 assert.equal(compareReceipt('Giao dịch thành công\nMã giao dịch 39000\n39.000\nđ\nDAO KHOI NGUYEN\nNgân hàng Vietcombank',39000,'DAO KHOI NGUYEN').isValid,true);
 assert.equal(compareReceipt('Giao dịch thành công\nSố tiền 39.000đ\nPhí chuyển tiền 1.000đ\nTổng tiền thanh toán 40.000đ\nTên thụ hưởng DAO KHOI NGUYEN',39000,'DAO KHOI NGUYEN').isValid,true);
});
test('a longer or different recipient name cannot match a substring of its tokens',()=>{
 for(const wrong of ['NGUYEN DAO KHOI NGUYEN','DAO KHOI NGUYEN AN','NGUYEN DAO KHOI NGUYEN AN'])
   assert.equal(compareReceipt('Giao dịch thành công\n39.000đ\nNgười nhận '+wrong,39000,'DAO KHOI NGUYEN').isValid,false);
});
module.exports=layouts;

test('iPhone VCB layout reads 42000 VND and payee independently of sender text and transaction ID',()=>{
 const text='VCB Digibank\nGiao dịch thành công!\n42,000 VND\n19:23 Thứ Hai 12/10/2026\nTài khoản nhận 9911989890\nTên người nhận DAO KHOI NGUYEN\nNgân hàng nhận Vietcombank\nNội dung TRAN THI KIM MAI chuyen tien\nPhí chuyển tiền Miễn phí\nMã giao dịch 16502422734';
 assert.equal(compareReceipt(text,42000,'DAO KHOI NGUYEN').isValid,true);assert.equal(compareReceipt(text,45000,'DAO KHOI NGUYEN').isValid,false);assert.equal(compareReceipt(text,42000,'TRAN THI KIM MAI').isValid,false);
});
