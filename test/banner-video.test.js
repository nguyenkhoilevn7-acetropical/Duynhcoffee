'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function fixture(){
 const dom=new JSDOM(html),document=dom.window.document;let id=0;const timers=new Map();
 const videos=['data:video/mp4;base64,YWJj','data:image/png;base64,YWJj','data:video/webm;base64,YWJj'];
 const s={window:{},document,orderText:x=>String(x).replace(/"/g,'&quot;'),getBannerConfig:()=>({images:videos,autoplaySpeed:3.5}),bannerUploadedImages:videos,bannerActiveSlideIndex:0,previewActiveSlideIndex:0,bannerSlideTimer:null,previewSlideTimer:null,
 nextFrontendBannerSlide(){s.bannerActiveSlideIndex=(s.bannerActiveSlideIndex+1)%3;s.activateBannerMedia();},nextPreviewSlide(){},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
 vm.createContext(s);vm.runInContext(html.slice(html.indexOf('    function isBannerVideo'),html.indexOf('    async function readBannerVideo')),s);
 const root=document.getElementById('hero-banner-image-container');root.innerHTML='<div id="frontend-slider-track">'+videos.map((v,i)=>'<div class="hero-slider-slide">'+s.bannerMediaHtml(v,i,i===0)+'</div>').join('')+'</div>';
 for(const v of root.querySelectorAll('video')){v.play=()=>{v.plays=(v.plays||0)+1;return Promise.resolve();};v.pause=()=>{v.pauses=(v.pauses||0)+1;};}
 return {s,dom,document,timers};
}
test('mixed banner plays the whole active video muted, releases hidden media and advances images on schedule',()=>{
 const f=fixture();try{
 const videos=f.document.querySelectorAll('#frontend-slider-track video');f.s.activateBannerMedia();
 assert.equal(videos[0].muted,true);assert.equal(videos[0].plays,1);assert.equal(videos[1].hasAttribute('src'),false);assert.equal(f.timers.size,0);
 videos[0].onended();assert.equal(f.s.bannerActiveSlideIndex,1);assert.equal(videos[0].hasAttribute('src'),false);assert.ok(videos[0].pauses);assert.equal(f.document.querySelector('#frontend-slider-track img').getAttribute('src'),'data:image/png;base64,YWJj');
 assert.equal([...f.timers.values()][0].ms,3500);[...f.timers.values()][0].fn();assert.equal(f.s.bannerActiveSlideIndex,2);assert.equal(videos[1].plays,1);assert.equal(videos[1].muted,true);assert.equal(f.document.querySelector('#frontend-slider-track img').hasAttribute('src'),false);
 }finally{f.dom.window.close();}
});
test('banner save waits for server acknowledgement; errors retain existing saved banner and draft',async()=>{
 const f=fixture();let ack;const old={images:['old']};Object.assign(f.s,{storeConfig:{banner:old},bannerUploadBusy:false,bannerSaveBusy:false,fetch:()=>new Promise(r=>ack=r),getCloudApiUrl:x=>x,showSmsToast(){},localStorage:{setItem(){}},saveLocalData(){},renderFrontendBanner(){},broadcastMeshEvent(){},playSuccessChime(){},lastConfigVersion:0});
 vm.runInContext(html.slice(html.indexOf('    async function saveBannerSettings'),html.indexOf('    window.saveBannerSettings')),f.s);
 try{
 const pending=f.s.saveBannerSettings();assert.equal(f.s.storeConfig.banner,old);ack({ok:false,json:async()=>({error:'Network failure'})});await pending;assert.equal(f.s.storeConfig.banner,old);
 const good=f.s.saveBannerSettings();ack({ok:true,json:async()=>({success:true})});await good;assert.equal(f.s.storeConfig.banner.images[0],f.s.bannerUploadedImages[0]);
 }finally{f.dom.window.close();}
});
test('video upload rejects unsupported or oversized files before reading metadata',async()=>{
 const f=fixture();vm.runInContext(html.slice(html.indexOf('    async function readBannerVideo'),html.indexOf('    // UPLOAD NHIỀU ẢNH / VIDEO')),f.s);
 try{await assert.rejects(f.s.readBannerVideo({type:'video/quicktime',size:2}),/MP4/);await assert.rejects(f.s.readBannerVideo({type:'video/mp4',size:5*1024*1024}),/4 MB/);}finally{f.dom.window.close();}
});
