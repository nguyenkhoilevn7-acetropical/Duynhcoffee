'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
test('every static click/change/input handler resolves to an available function in the actual app',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>({notModified:true})});w.alert=()=>{};w.confirm=()=>false;w.prompt=()=>null;
 w.WebSocket=class{constructor(){this.readyState=0;}close(){}};
 try{
  for(const file of ['menu-options.js','site-i18n.js','admin-notifications.js'])w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  for(const script of w.document.querySelectorAll('script:not([src])'))if(script.textContent.trim())w.eval(script.textContent);
  const missing=new Set();let controls=0;
  for(const el of w.document.querySelectorAll('[onclick],[onchange],[oninput]')){
   controls++;
   for(const attr of ['onclick','onchange','oninput'])for(const match of (el.getAttribute(attr)||'').matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)){
    const name=match[1];if((el.getAttribute(attr)||'')[match.index-1]==='.'||name.startsWith('this.'))continue;if(['if','this.click','event.stopPropagation','event.preventDefault'].includes(name))continue;
    let value=w;for(const part of name.split('.'))value=value?.[part];if(typeof value!=='function')missing.add(name);
   }
  }
  assert.ok(controls>100);assert.deepEqual([...missing],[]);
 }finally{w.close();}
});
