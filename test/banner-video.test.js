'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function fixture(){
 const dom=new JSDOM(html),document=dom.window.document;
 const s={window:{},document,bannerUploadedImages:[],bannerUploadBusy:false,bannerSaveBusy:false,showSmsToast(){},renderBannerThumbnailsGrid(){},updateBannerLivePreview(){},setTimeout,clearTimeout};vm.createContext(s);
 vm.runInContext(html.slice(html.indexOf('    function bannerImagesOnly'),html.indexOf('    function getBannerConfig')),s);
 vm.runInContext(html.slice(html.indexOf('    async function handleBannerMultiImageUpload'),html.indexOf('    window.handleBannerMultiImageUpload')),s);
 return {s,dom,document};
}
test('banner is image-only and filters legacy embedded clips and video URLs from local fallback',async()=>{
 const f=fixture();try{
 assert.equal(f.document.getElementById('banner-setting-image-file').accept,'image/*');assert.equal(f.document.querySelectorAll('video').length,0);assert.equal(html.includes('readBannerVideo'),false);
 const img='data:image/jpeg;base64,YWJj';assert.deepEqual(Array.from(f.s.bannerImagesOnly({images:[img,'data:video/mp4;base64,YWJj','https://example.test/ad.webm?x=1','https://example.test/photo.jpg']}).images),[img,'https://example.test/photo.jpg']);
 let encodes=0;f.s.compressImageFile=()=>encodes++;
 for(const file of [{type:'video/mp4',name:'ad.mp4'},{type:'',name:'ad.mp4'},{type:'image/jpeg',name:'ad.mov'}])await f.s.handleBannerMultiImageUpload({target:{files:[file],value:'x'}});
 assert.equal(encodes,0);assert.equal(f.s.bannerUploadedImages.length,0);
 }finally{f.dom.window.close();}
});
test('banner photos are compressed one at a time, retain selection order and release the upload guard',async()=>{
 const f=fixture();try{
 const callbacks=[];let encodes=0;f.s.compressImageFile=(file,width,quality,cb)=>{assert.equal(width,750);assert.equal(quality,0.72);encodes++;callbacks.push(()=>cb('data:image/jpeg;base64,'+file.name));};
 const pending=f.s.handleBannerMultiImageUpload({target:{files:[{name:'one',type:'image/png'},{name:'two',type:'image/jpeg'}],value:'x'}});
 assert.equal(encodes,1);assert.equal(f.s.bannerUploadBusy,true);callbacks.shift()();await Promise.resolve();assert.equal(encodes,2);callbacks.shift()();await pending;
 assert.equal(f.s.bannerUploadBusy,false);assert.deepEqual(Array.from(f.s.bannerUploadedImages),['data:image/jpeg;base64,one','data:image/jpeg;base64,two']);
 }finally{f.dom.window.close();}
});
test('banner save waits for acknowledgement; errors retain saved images and draft',async()=>{
 const f=fixture();let ack;const old={images:['old']};Object.assign(f.s,{storeConfig:{banner:old},fetch:()=>new Promise(r=>ack=r),getCloudApiUrl:x=>x,localStorage:{setItem(){}},saveLocalData(){},renderFrontendBanner(){},broadcastMeshEvent(){},playSuccessChime(){},lastConfigVersion:0});
 f.s.bannerUploadedImages=['https://example.test/photo.jpg'];
 vm.runInContext(html.slice(html.indexOf('    async function saveBannerSettings'),html.indexOf('    window.saveBannerSettings')),f.s);
 try{
 const pending=f.s.saveBannerSettings();assert.equal(f.s.storeConfig.banner,old);ack({ok:false,json:async()=>({error:'Network failure'})});await pending;assert.equal(f.s.storeConfig.banner,old);
 const good=f.s.saveBannerSettings();ack({ok:true,json:async()=>({success:true})});await good;assert.equal(f.s.storeConfig.banner.images[0],f.s.bannerUploadedImages[0]);
 }finally{f.dom.window.close();}
});
