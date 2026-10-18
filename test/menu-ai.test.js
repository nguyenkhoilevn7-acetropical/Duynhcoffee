'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createMenuAI}=require('../menu-ai');
const output={name_en:'Mango Tea',description:'Trà xoài với hương vị trái cây.',description_en:'Mango tea with a fruity character.'};
const success=()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]})});
test('Gemini sends name and image together, deduplicates concurrent requests, caches and never exposes credentials',async()=>{
 const calls=[];const ai=createMenuAI({env:{GEMINI_API_KEY:'test-secret'},fetchImpl:async(u,o)=>{calls.push({u,o});await new Promise(r=>setImmediate(r));return success();}});
 const input={name:'Trà xoài',image:'data:image/jpeg;base64,YWJj'};
 const results=await Promise.all([ai.generate(input),ai.generate(input)]);assert.deepEqual(results,[output,output]);
 assert.deepEqual(await ai.generate(input),output);assert.equal(calls.length,1);
 const request=JSON.parse(calls[0].o.body);assert.equal(request.contents[0].parts[1].inlineData.mimeType,'image/jpeg');assert.match(request.contents[0].parts[0].text,/Trà xoài/);
 assert.match(request.contents[0].parts[0].text,/Never invent/);assert.doesNotMatch(JSON.stringify(ai.status()),/test-secret/);
 await ai.generate({...input,name:'Trà đào'});assert.equal(calls.length,2);
});
test('missing credentials, remote URLs, quota and malformed output fail honestly without changing providers',async()=>{
 await assert.rejects(createMenuAI({env:{}}).generate({name:'Tea'}),/GEMINI_API_KEY/);
 const urls=[];const ai=createMenuAI({env:{GEMINI_API_KEY:'test'},fetchImpl:async u=>{urls.push(u);return {ok:false,status:429};}});
 await assert.rejects(ai.generate({name:'Tea',image:'http://127.0.0.1/secret'}),/tải ảnh/);assert.equal(urls.length,0);
 await assert.rejects(ai.generate({name:'Tea'}),error=>error.code==='GEMINI_RATE_LIMIT');assert.equal(urls.length,2);
 const bad=createMenuAI({env:{GEMINI_API_KEY:'test'},fetchImpl:async()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"name_en":"Tea"}'}]}}]})})});
 await assert.rejects(bad.generate({name:'Tea'}),/chưa trả đủ/);
});
test('quota cooldown prevents repeated upstream calls and expires without caching failure',async()=>{
 let count=0,t=0;const ai=createMenuAI({env:{GEMINI_API_KEY:'test'},now:()=>t,fetchImpl:async()=>{count++;return {ok:false,status:429};}});
 for(let i=0;i<4;i++)await assert.rejects(ai.generate({name:'Tea'}),e=>e.code==='GEMINI_RATE_LIMIT' && e.retryAfterSeconds>0);
 assert.equal(count,2);t=61000;await assert.rejects(ai.generate({name:'Tea'}));assert.equal(count,4);
});
test('application request limit is separate from provider quota and cached results are reusable',async()=>{
 const ai=createMenuAI({env:{GEMINI_API_KEY:'test'},fetchImpl:async()=>success()});
 for(let i=0;i<12;i++)await ai.generate({name:'Tea '+i});
 await assert.rejects(ai.generate({name:'Other'}),e=>e.code==='APP_RATE_LIMIT');assert.deepEqual(await ai.generate({name:'Tea 0'}),output);
});
test('Google overload falls back once to Flash-Lite with the same deadline',async()=>{
 const calls=[];const ai=createMenuAI({env:{GEMINI_API_KEY:'test'},fetchImpl:async(u,o)=>{calls.push({u,o});return calls.length===1?{ok:false,status:503}:success();}});
 assert.deepEqual(await ai.generate({name:'Trà xoài'}),output);
 assert.equal(calls.length,2);assert.match(calls[1].u,/gemini-3\.5-flash-lite:generateContent$/);
 assert.equal(calls[0].o.signal,calls[1].o.signal);
});
function client(){
 const elements={};for(const field of ['name','name-en','desc','desc-en','image-url','ai-status','ai-manual'])elements['edit-menu-'+field]={value:'',textContent:'',style:{}};
 elements['edit-menu-name'].value='Trà xoài';elements['edit-menu-name-en'].value='Old Tea';
 const pending=[];const timers=new Map();let next=0;
 const context={console,window:{},Image:class{},AbortSignal,localStorage:{getItem:()=> 'token'},getCloudApiUrl:p=>p,
 document:{getElementById:id=>elements[id],addEventListener(){}},setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),
 fetch:async()=>new Promise(resolve=>pending.push(result=>resolve({ok:true,json:async()=>result})))};
 vm.createContext(context);const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 vm.runInContext(html.slice(html.indexOf('    const menuAIStates'),html.indexOf('    function openEditMenuModal(itemId)')),context);
 return {s:context,e:elements,pending};
}
test('renaming replaces stale English; earlier responses and responses after close/reopen cannot overwrite the draft',async()=>{
 const {s,e,pending}=client();s.resetMenuAI('edit');
 e['edit-menu-name'].value='Trà đào';s.scheduleMenuAI('edit','name');assert.equal(e['edit-menu-name-en'].value,'');
 const first=s.generateMenuAI('edit');await new Promise(resolve=>setImmediate(resolve));
 e['edit-menu-name'].value='Trà vải';s.scheduleMenuAI('edit','name');
 const second=s.generateMenuAI('edit');await new Promise(resolve=>setImmediate(resolve));
 pending[1]({...output,name_en:'Lychee Tea'});assert.equal(await second,true);
 pending[0]({...output,name_en:'Peach Tea'});assert.equal(await first,false);assert.equal(e['edit-menu-name-en'].value,'Lychee Tea');
 e['edit-menu-name'].value='Trà sen';s.scheduleMenuAI('edit','name');const old=s.generateMenuAI('edit');await new Promise(resolve=>setImmediate(resolve));
 s.closeMenuAI('edit');s.resetMenuAI('edit');e['edit-menu-name-en'].value='New modal';pending[2](output);assert.equal(await old,false);assert.equal(e['edit-menu-name-en'].value,'New modal');
});
test('AI preserves a manual English edit in flight and an owner-written Vietnamese description',async()=>{
 const {s,e,pending}=client();s.resetMenuAI('edit');e['edit-menu-desc'].value='Công thức riêng của quán.';s.scheduleMenuAI('edit','desc');
 const job=s.generateMenuAI('edit');await new Promise(resolve=>setImmediate(resolve));e['edit-menu-name-en'].value='My special tea';pending[0](output);assert.equal(await job,true);
 assert.equal(e['edit-menu-name-en'].value,'My special tea');assert.equal(e['edit-menu-desc'].value,'Công thức riêng của quán.');assert.equal(e['edit-menu-desc-en'].value,output.description_en);
});

test('save closes add/edit modals after server acknowledgement even if Gemini is unavailable; failed save stays open',async()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 for(const context of ['add','edit'])for(const serverOK of [true,false]){
  const elements={};for(const field of ['id','name','name-en','desc','desc-en','image-url','price','stock','category','status','position','save'])elements[context+'-menu-'+field]={value:'',textContent:'Lưu',dataset:{},style:{}};
  const set=(field,value)=>elements[context+'-menu-'+field].value=value;
  set('id','1');set('name','Trà xoài');set('price','45000');set('stock','0');set('category','tea');set('status','1');set('image-url','data:image/jpeg;base64,'+'A'.repeat(80));elements[context+'-menu-bestseller']={checked:false};
  let closeCount=0,saveCount=0,acknowledge;
  const s={window:{location:{host:'example.test'}},document:{getElementById:id=>elements[id]},menuAISaving:false,menu:[{id:1,name:'Old Tea',description:'Old description'}],
   ensureMenuAI:async()=>false,cancelMenuAIWork(){},menuSaveBusy(){},translateFnbText:t=>t,cleanMenuEnglish:t=>t || '',positionMenuItem:a=>a,
   generateUniqueMenuItemId:()=>2,getCategoryFallbackSvg:()=>'',alert(){},playSuccessChime(){},showSmsToast(){},
   closeAddMenuModal(){closeCount++;},closeEditMenuModal(){closeCount++;},
   saveOrderedMenu:async()=>{saveCount++;return new Promise(resolve=>acknowledge=resolve);}};
  vm.createContext(s);
  const method=context==='add'?'executeAddNewProduct':'saveProductChanges';
  const end=context==='add'?'    function openQuickRestockModal':'    function openAddMenuModal';
  vm.runInContext(html.slice(html.indexOf('    async function '+method),html.indexOf(end)),s);
  const saving=s[method]();await new Promise(resolve=>setImmediate(resolve));assert.equal(saveCount,1,context);assert.equal(closeCount,0,'must wait for real persistence');
  const duplicate=s[method]();await duplicate;assert.equal(saveCount,1,'duplicate save blocked');
  acknowledge(serverOK);await saving;assert.equal(closeCount,serverOK?1:0);assert.equal(s.menuAISaving,false);
 }
});

test('retry AI regenerates an unchanged existing item instead of returning an old translation',async()=>{
 const {s,e,pending}=client();s.resetMenuAI('edit');
 const job=s.window.retryMenuAI('edit');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(pending.length,1);pending[0](output);assert.equal(await job,true);assert.equal(e['edit-menu-name-en'].value,output.name_en);
});


test('provider rate limit can fall back, daily quota is distinguished, and RetryInfo is respected',async()=>{
 const {createGeminiClient}=require('../menu-ai');let calls=0,t=0;
 const rate=()=>({ok:false,status:429,headers:{get:()=>null},json:async()=>({error:{status:'RESOURCE_EXHAUSTED',details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'12.5s'}]}})});
 const fallback=createGeminiClient({env:{GEMINI_API_KEY:'test'},now:()=>t,fetchImpl:async()=>++calls===1?rate():success()});
 await fallback.generate({});assert.equal(calls,2);await fallback.generate({});assert.equal(calls,3,'blocked first model is skipped');
 let dailyCalls=0;
 const daily=createGeminiClient({env:{GEMINI_API_KEY:'test'},now:()=>t,fetchImpl:async()=>{dailyCalls++;return{...rate(),json:async()=>({error:{details:[{violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel'}]},{retryDelay:'120s'}]}})};}});
 await assert.rejects(daily.generate({}),e=>e.code==='GEMINI_DAILY_QUOTA' && e.quotaScope==='day' && !e.retryable && e.retryAfterSeconds===120 && !/miễn phí/.test(e.message));
 await assert.rejects(daily.generate({}));assert.equal(dailyCalls,2);t=121000;await assert.rejects(daily.generate({}));assert.equal(dailyCalls,4);
});
test('invalid API key stops immediately; mixed-language output is rejected rather than cached',async()=>{
 let calls=0;const invalid=createMenuAI({env:{GEMINI_API_KEY:'never-expose'},fetchImpl:async()=>{calls++;return{ok:false,status:400,json:async()=>({error:{details:[{reason:'API_KEY_INVALID'}]}})};}});
 await assert.rejects(invalid.generate({name:'Tea'}),e=>e.code==='GEMINI_KEY_ERROR' && !/never-expose/.test(e.message));assert.equal(calls,1);
 const mixed=createMenuAI({env:{GEMINI_API_KEY:'test'},fetchImpl:async()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...output,description_en:'Item trà nhiệt đới mang hương vị nho thanh sweetness.'})}]}}]})})});
 await assert.rejects(mixed.generate({name:'Trà nho'}),/chưa dịch đầy đủ/);
});
test('editing text sends the original description without loading the image; cooldown retains the draft',async()=>{
 const {s,e}=client();s.resetMenuAI('edit');e['edit-menu-desc'].value='Trà nho cùng nha đam.';e['edit-menu-image-url'].value='https://example.test/blocked.jpg';
 let imageCalls=0,requests=0;s.menuAIImage=async()=>{imageCalls++;throw Error('CORS');};
 s.fetch=async(_url,opts)=>{requests++;const body=JSON.parse(opts.body);assert.equal(body.description,'Trà nho cùng nha đam.');assert.equal(body.image,'');return{ok:false,json:async()=>({error:'Rate limited',retryAfterSeconds:30})};};
 assert.equal(await s.generateMenuAI('edit'),false);assert.equal(e['edit-menu-desc'].value,'Trà nho cùng nha đam.');assert.equal(imageCalls,0);
 assert.equal(await s.window.retryMenuAI('edit'),false);assert.equal(requests,1);assert.equal(e['edit-menu-ai-manual'].style.display,'');
});
