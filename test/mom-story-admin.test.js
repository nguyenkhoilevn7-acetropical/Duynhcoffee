'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'mom-story-admin.css'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const {MOM_STORY_DEFAULTS,validateMomStory}=require('../mom-story-config');

test('story editor preserves all 10 bilingual fields and original menu navigation',()=>{
  const dom=new JSDOM(html),d=dom.window.document;
  try {
    for(const key of Object.keys(MOM_STORY_DEFAULTS)) {
      const id='story-'+key.replace(/_en$/,'-en');
      const node=d.getElementById(id);
      assert.ok(node,id);
      assert.ok(node.hasAttribute('maxlength'));
      assert.equal(node.hasAttribute('oninput'),true,id);
    }
    for(const id of ['mom-story-eyebrow','mom-story-headline','mom-story-description','mom-story-slogan','mom-story-cta',
      'story-preview-eyebrow','story-preview-headline','story-preview-description','story-preview-slogan','story-preview-cta']){
      assert.ok(d.getElementById(id),id);
    }
    assert.equal(d.querySelector('#mom-story a').getAttribute('href'),'#mom-menu-section');
    assert.ok(d.getElementById('btn-save-mom-story'));
    assert.equal(d.getElementById('btn-save-mom-story').getAttribute('onclick'),'saveMomStorySettings()');
    assert.ok(d.getElementById('mom-story-preview-language'));
    assert.ok(d.getElementById('setting-store-name'),'existing general settings remain');
  } finally {dom.window.close();}
});

test('server validates story fields, lengths, controls and untrusted markup without touching ordering',()=>{
  const valid={...MOM_STORY_DEFAULTS,headline:'  Trà ngon mới  ',description:'Dòng 1\r\nDòng 2'};
  const result=validateMomStory(valid);
  assert.equal(result.headline,'Trà ngon mới');
  assert.equal(result.description,'Dòng 1\nDòng 2');
  assert.deepEqual(Object.keys(result).sort(),Object.keys(MOM_STORY_DEFAULTS).sort());
  for(const bad of [null,[],{headline:'x'},{...valid,cta:''},{...valid,description:'x'.repeat(801)},
    {...valid,cta:'X\u202Etôi'},{...valid,notAllowed:'x'}]){
    assert.throws(()=>validateMomStory(bad),e=>e.status===422);
  }
  const escaped=validateMomStory({...valid,headline:'<img src=x onerror=alert(1)>'});
  assert.equal(escaped.headline,'<img src=x onerror=alert(1)>','text is retained literally for safe textContent rendering');
  assert.match(html,/function renderMomStory\(\)[\s\S]*?el\.textContent=story\[/);
  assert.match(html,/function previewMomStoryEditor\(\)[\s\S]*?node\.textContent=key\(/);
  assert.doesNotMatch(html.slice(html.indexOf('function renderMomStory()'),html.indexOf('function renderMomStoryEditor(')),/innerHTML/);
});

test('story writes require valid owner session and public config cannot modify story',()=>{
  assert.match(server,/pathname === '\/api\/admin\/story'/);
  const endpoint=server.slice(server.indexOf("if (pathname === '/api/admin/story')"),server.indexOf("if (pathname === '/api/drink-recipes/translate'"));
  assert.match(endpoint,/adminPush\.verify\(/);
  assert.match(endpoint,/validateMomStory\(body\.storyContent\)/);
  assert.match(endpoint,/writeJsonFile\(CONFIG_FILE,next\)/);
  assert.match(endpoint,/broadcastRealtime\('CONFIG_UPDATE',configCache\)/);
  const merge=server.slice(server.indexOf('function mergeConfig('),server.indexOf('function visibleCategoryIds('));
  assert.match(merge,/hasOwnProperty\.call\(patch,'storyContent'\)/);
  assert.match(merge,/status:403/);
  assert.match(html,/getCloudApiUrl\('\/api\/admin\/story'\)/);
  assert.match(html,/Authorization:'Bearer '\+token/);
  assert.match(html,/localStorage\.getItem\('duynh_admin_api_token'\)/);
});

test('language switching and realtime configuration render public story without HTML injection',()=>{
  assert.match(html,/function setLanguage\(lang\)[\s\S]*?renderMomStory\(\)/);
  assert.match(html,/function applyServerConfig\(config, version\)[\s\S]*?renderMomStory\(\)/);
  const dom=new JSDOM(html),d=dom.window.document;
  const slice=html.slice(html.indexOf('const MOM_STORY_DEFAULTS = {'),html.indexOf('function renderMomStoryEditor('));
  const context={document:d,storeConfig:{storyContent:{...MOM_STORY_DEFAULTS,headline:'<b>Safe</b>',headline_en:'English head'}},currentLang:'vi'};
  vm.createContext(context);
  vm.runInContext(slice+';renderMomStory();',context);
  assert.equal(d.getElementById('mom-story-headline').textContent,'<b>Safe</b>');
  assert.equal(d.getElementById('mom-story-headline').querySelector('b'),null);
  context.currentLang='en';
  vm.runInContext('renderMomStory();',context);
  assert.equal(d.getElementById('mom-story-headline').textContent,'English head');
  dom.window.close();
});

test('transparent-look logo is presentation only; story editor adapts to small devices',()=>{
  assert.match(css,/#mom-story \.mom-story-art img\s*\{[^}]*mix-blend-mode: screen !important;/s);
  assert.match(css,/header \.mom-logo-frame \.header-logo-img\s*\{[^}]*mix-blend-mode: multiply;/s);
  assert.match(css,/@media \(max-width: 680px\)/);
  assert.match(css,/\.mom-story-editor-cols\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});
