'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const {validateRecipe,validateRecipeStore}=require('../drink-recipes');
const recipe={ingredients:[{name:'Trà lài',amount:120,unit:'ml'},{name:'Đường',amount:12.5,unit:'g'}],steps:'1. Ủ trà\n2. Lắc với đá',notes:'Đường theo yêu cầu khách'};
test('recipe validation rejects incomplete quantities, unknown structure and unsafe IDs',()=>{
 assert.deepEqual(validateRecipe(recipe),recipe);
 for(const amount of ['',0,-1,'oops',Infinity]) assert.throws(()=>validateRecipe({...recipe,ingredients:[{name:'Tea',amount,unit:'ml'}]}));
 assert.throws(()=>validateRecipe({...recipe,ingredients:[{name:'',amount:2,unit:'g'}]}));
 assert.throws(()=>validateRecipeStore(JSON.parse('{"__proto__":{}}')));
});
test('private recipe HTTP CRUD, stale edit protection, persistence and public-data isolation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'drink-recipes-'));
 for(const name of ['server.js','inventory.js','profit-report.js','profit-excel.js','menu-options.js','menu-ai.js','delivery.js','admin-push.js','drive-backup.js','receipt-verification.js','receipt-jobs.js','receipt-image.js','drink-recipes.js'])fs.copyFileSync(path.join(__dirname,'..',name),path.join(dir,name));
 fs.writeFileSync(path.join(dir,'menu.json'),JSON.stringify([{id:1,name:'Tea',price:45000}]));
 const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
 let child;const base='http://127.0.0.1:'+port;
 async function start(){child=spawn(process.execPath,['server.js'],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port)}});await new Promise((resolve,reject)=>{child.stdout.on('data',()=>resolve());child.on('exit',code=>reject(Error('Exit '+code)));setTimeout(()=>reject(Error('Timeout')),5000).unref();});}
 async function stop(){if(child?.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
 const get=(route,headers)=>fetch(base+route,{headers});
 let headers;
 const post=(data)=>fetch(base+'/api/drink-recipes',{method:'POST',headers,body:JSON.stringify(data)});
 try {
 await start();
 assert.equal((await get('/api/drink-recipes?itemId=1')).status,401);
 const signed=await(await fetch(base+'/api/admin-push/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'duynh2026'})})).json();
 headers={'Content-Type':'application/json',Authorization:'Bearer '+signed.token};
 assert.equal((await(await get('/api/drink-recipes?itemId=1',headers)).json()).recipe,null);
 let result=await post({itemId:1,recipe});assert.equal(result.status,200);const saved=(await result.json()).recipe;
 assert.ok(saved.version);assert.deepEqual(saved.ingredients,recipe.ingredients);
 assert.equal((await post({itemId:1,recipe,version:''})).status,409);
 assert.equal((await post({itemId:1,recipe:{ingredients:[{}]},version:saved.version})).status,400);
 assert.equal((await get('/api/drink-recipes?itemId=missing',headers)).status,404);
 for(const file of ['/drink-recipes.json','/drink-recipes.js','/%64rink-recipes.json'])assert.equal((await get(file)).status,404);
 for(const route of ['/api/menu','/api/config','/api/sync'])assert.doesNotMatch(await(await get(route)).text(),/Ủ trà|Trà lài/);
 await stop();await start();
 const restored=await(await get('/api/drink-recipes?itemId=1',headers)).json();assert.deepEqual(restored.recipe,saved);
 result=await post({itemId:1,recipe:{...recipe,ingredients:[]},version:saved.version});assert.equal(result.status,200);
 } finally {await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
const {createRecipeScanner,validateSourceImage}=require('../drink-recipes');
const image='data:image/png;base64,aGVsbG8=';
const candidate=(result,finishReason='STOP')=>Response.json({candidates:[{finishReason,content:{parts:[{text:JSON.stringify(result)}]}}]});
const extracted={isRecipe:true,ingredients:[{name:'Sữa',amount:'12.5',unit:'ml'}],steps:'Lắc đều',notes:'',warnings:[]};
test('photo extraction sends image securely, preserves missing values and never invents amounts',async()=>{
 let request;
 const scanner=createRecipeScanner({env:{GEMINI_API_KEY:'private'},fetchImpl:async(url,opts)=>{request={url,opts};return candidate({...extracted,ingredients:[...extracted.ingredients,{name:'Trà',amount:'không rõ',unit:''}],warnings:['Thiếu định lượng trà']});}});
 const result=await scanner.scan({image});assert.equal(result.ingredients[1].amount,'');assert.equal(result.ingredients[1].unit,'');assert.equal(result.warnings[0],'Thiếu định lượng trà');assert.match(result.warnings[1],/định lượng, đơn vị/);
 assert.equal(request.opts.headers['x-goog-api-key'],'private');assert.match(request.url,/gemini-flash-latest/);assert.equal(JSON.parse(request.opts.body).contents[0].parts[1].inlineData.data,'aGVsbG8=');assert.doesNotMatch(JSON.stringify(result),/private/);
 assert.deepEqual(validateRecipe({...recipe,sourceImage:image}).sourceImage,image);
 for(const invalid of ['https://example.test/a.jpg','data:image/svg+xml;base64,aA==','x'.repeat(2000001)])assert.throws(()=>validateSourceImage(invalid));
});
test('unrelated/batch photos, quota, no key and malformed AI output fail without saving',async()=>{
 await assert.rejects(createRecipeScanner({env:{}}).scan({image}),/Chưa cấu hình/);
 for(const [response,pattern] of [
  [()=>candidate({...extracted,isRecipe:false,warnings:['Nhiều công thức']}),/1 ly/],
  [()=>new Response('',{status:429}),/hạn mức/],
  [()=>candidate(extracted,'MAX_TOKENS'),/chưa đọc đủ/],
  [()=>candidate({...extracted,ingredients:[{name:'Bad'}]}),/chưa đọc đủ/]
 ])await assert.rejects(createRecipeScanner({env:{GEMINI_API_KEY:'private'},fetchImpl:async()=>response()}).scan({image}),pattern);
});

test('structured OCR separates actions, notes and quantities; numeric comma and count units survive',async()=>{
 let body;
 const scanner=createRecipeScanner({env:{GEMINI_API_KEY:'private'},fetchImpl:async(url,opts)=>{body=JSON.parse(opts.body);return candidate({isRecipe:true,ingredients:[{name:'Trứng',amount:'1',unit:'quả'},{name:'Sữa',amount:'12,5',unit:'ml'},{name:'Trà',amount:'10-15',unit:'g'}],steps:['Đánh trứng trong 2 phút','Rót cà phê vào ly'],notes:['Dùng ngay sau khi pha','Không đun sôi'],warnings:[]});}});
 const result=await scanner.scan({image});
 assert.deepEqual(result.ingredients[0],{name:'Trứng',amount:'1',unit:'quả'});
 assert.equal(result.ingredients[1].amount,'12.5');assert.equal(result.ingredients[2].amount,'');
 assert.equal(result.steps,'Đánh trứng trong 2 phút\nRót cà phê vào ly');
 assert.equal(result.notes,'Dùng ngay sau khi pha\nKhông đun sôi');assert.doesNotMatch(result.notes,/cần kiểm tra/);
 assert.match(result.warnings[0],/dòng 3/);assert.equal(body.generationConfig.responseSchema.properties.steps.type,'ARRAY');
});
const {createRecipeTranslator,recipeSourceHash}=require('../drink-recipes');
const enValue={ingredients:[{name:'Jasmine tea',unit:'ml'},{name:'Sugar',unit:'g'}],steps:'1. Brew tea\n2. Shake with ice',notes:'Sugar to customer preference',custom:'50% ice • 50% sugar'};
test('English translation preserves quantities, uses cache, saves with matching source and invalidates edited Vietnamese',async()=>{
 let count=0;
 const translator=createRecipeTranslator({env:{GEMINI_API_KEY:'private'},fetchImpl:async()=>{count++;return candidate(enValue);}});
 const input={recipe,custom:'50% đá • 50% đường'};
 const [a,b]=await Promise.all([translator.translate(input),translator.translate(input)]);assert.deepEqual(a,b);assert.equal(count,1);
 await translator.translate(input);assert.equal(count,1);
 assert.equal(a.english.sourceHash,recipeSourceHash(recipe));
 const saved=validateRecipe({...recipe,english:a.english});assert.equal(saved.english.ingredients[0].name,'Jasmine tea');assert.equal(saved.ingredients[0].amount,120);
 assert.equal(validateRecipe({...saved,notes:'Đã đổi lưu ý'}).english,undefined);
 const changed={...recipe,ingredients:recipe.ingredients.map((r,i)=>({...r,amount:i?13:120}))};assert.equal(validateRecipe({...changed,english:a.english}).english,undefined);
});
test('translation refuses modified times, incomplete ingredient rows and changed customer percentages',async()=>{
 for(const value of [{...enValue,steps:'1. Brew tea for 10 minutes\n2. Shake with ice'},{...enValue,ingredients:[]},{...enValue,ingredients:[{name:'Jasmine tea',unit:'oz'},{name:'Sugar',unit:'g'}]},{...enValue,custom:'100% ice • 50% sugar'}]){
  const translator=createRecipeTranslator({env:{GEMINI_API_KEY:'private'},fetchImpl:async()=>candidate(value)});
  await assert.rejects(translator.translate({recipe,custom:'50% đá • 50% đường'}),/khác số liệu/);
 }
 await assert.rejects(createRecipeTranslator({env:{}}).translate({recipe}),/Chưa cấu hình/);
});
