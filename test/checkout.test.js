'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function setup() {
  const elements=new Map();
  for(const id of ['pay-bank-name','pay-bank-account','pay-bank-holder','setting-store-name','setting-store-slogan','setting-store-address','setting-store-phone','setting-bank-account','setting-bank-holder','setting-bank-name','btn-submit-customer-order','checkout-modal','smart-validation-status','receipt-upload-preview-state','receipt-upload-idle-state','receipt-upload-box']) elements.set(id,{value:'',textContent:'',style:{display:'none'}});
  const sandbox={console,document:{activeElement:null,getElementById:id=>elements.get(id)},
    localStorage:{setItem(){}},storeConfig:{bankConfig:{bin:'970436',accountNumber:'123',accountHolder:'ĐÀO KHÔI NGUYÊN'},banner:{images:['saved']}},
    cart:[{item:{id:1,price:45000},qty:1}],activeDiscount:null,isReceiptValid:false,bannerUploadedImages:[],lastConfigVersion:1,
    saveLocalData(){},renderFrontendBanner(){},showSmsToast(){},getCloudApiUrl:p=>p,updateCheckoutFinancials(){}};
  vm.createContext(sandbox);
  vm.runInContext(html.slice(html.indexOf('    let receiptVerificationToken'),html.indexOf('    // ==================== WEBSOCKET CLIENT')),sandbox);
  const start=html.indexOf('    async function saveStoreSettings()');
  vm.runInContext(html.slice(start,html.indexOf('    // ==================== KHÁCH HÀNG',start)),sandbox);
  return {sandbox,elements};
}
test('saved unaccented name replaces payment display and keeps bank metadata/banner',async()=>{
  const {sandbox:s,elements:e}=setup();
  e.get('setting-bank-holder').value='DAO KHOI NGUYEN';e.get('setting-bank-account').value='456';
  let sent;
  s.fetch=async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({success:true,config:{...s.storeConfig,...sent,bankConfig:{...s.storeConfig.bankConfig,...sent.bankConfig}},configVersion:22})};};
  await s.saveStoreSettings();
  assert.equal(e.get('pay-bank-holder').textContent,'DAO KHOI NGUYEN');
  assert.equal(e.get('pay-bank-account').textContent,'456');
  assert.equal(s.storeConfig.bankConfig.bin,'970436');assert.equal(s.storeConfig.banner.images[0],'saved');
  assert.equal(s.lastConfigVersion,22);assert.equal(sent.banner,undefined);
  s.applyServerConfig({bankConfig:{accountHolder:'SECOND DEVICE'},banner:{images:[]}},23);
  assert.equal(e.get('pay-bank-holder').textContent,'SECOND DEVICE');assert.equal(s.bannerUploadedImages.length,0);
  s.applyServerConfig({bankConfig:{accountHolder:'STALE'}},21);assert.equal(e.get('pay-bank-holder').textContent,'SECOND DEVICE');
});
test('failed save keeps acknowledged settings; recipient changes invalidate prior receipt',async()=>{
  const {sandbox:s,elements:e}=setup();e.get('setting-bank-holder').value='DAO KHOI NGUYEN';
  s.fetch=async()=>({ok:false,status:500,json:async()=>({error:'disk error'})});await s.saveStoreSettings();
  assert.equal(s.storeConfig.bankConfig.accountHolder,'ĐÀO KHÔI NGUYÊN');
  vm.runInContext("receiptVerificationToken='proof';receiptVerificationContext=paymentContext();isReceiptValid=true;",s);
  e.get('smart-validation-status').style.display='block';e.get('smart-validation-status').textContent='OLD MATCH';e.get('receipt-upload-preview-state').style.display='block';
  s.applyServerConfig({bankConfig:{accountHolder:'NEW NAME'}},2);
  assert.equal(e.get('smart-validation-status').style.display,'none');assert.equal(e.get('smart-validation-status').textContent,'');assert.equal(e.get('receipt-upload-preview-state').style.display,'none');
  assert.equal(s.isReceiptValid,false);assert.equal(e.get('btn-submit-customer-order').disabled,true);
});
test('HTML scripts parse, expected payment fields exist, and export is complete',()=>{
  for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1]);
  for(const id of ['pay-bank-holder','pay-bank-account','pay-bank-name'])assert.ok(html.includes('id="'+id+'"'));
  assert.match(html,/<\/body>\s*<\/html>\s*$/);
  assert.ok(!/data:image\/[^"']*;base64,[A-Za-z0-9+/=]{500}/.test(html.slice(0,html.indexOf('</head>'))));
});
