'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReceiptJobs } = require('../receipt-jobs');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('serializes OCR, deduplicates retries, and exposes no uploaded input', async () => {
  const calls = [], releases = [];
  const jobs = createReceiptJobs({ verify: body => {
    calls.push(body.image);
    return new Promise(resolve => releases.push(resolve));
  } });
  const first = jobs.start({ image: 'private-one' }, 'key-one');
  const second = jobs.start({ image: 'private-two' }, 'key-two');
  assert.equal(first.jobId.length, 48);
  assert.match(first.jobId, /^[0-9a-f]+$/);
  assert.deepEqual(jobs.start({ image: 'private-one' }, 'key-one'), first);
  assert.deepEqual(Object.keys(jobs.get(first.jobId)).sort(), ['jobId', 'status']);
  await tick();
  assert.deepEqual(calls, ['private-one']);
  releases.shift()({ isValid: true });
  await tick();
  assert.deepEqual(calls, ['private-one', 'private-two']);
  const finished=jobs.get(first.jobId);assert.ok(Number.isFinite(finished.queueMs) && finished.queueMs>=0);
  assert.deepEqual({...finished,queueMs:undefined}, { jobId: first.jobId, status: 'complete', result: { isValid: true },queueMs:undefined });
  assert.equal(jobs.start({}, 'key-one').jobId, first.jobId);
  releases.shift()({ isValid: false });
  await tick();
  assert.equal(jobs.get(second.jobId).status, 'complete');
  assert.equal(JSON.stringify(jobs.get(first.jobId)).includes('private-one'), false);
  assert.equal(jobs.get('unknown'), null);
});

test('allows at most three pending jobs but accepts duplicate pending requests', async () => {
  const releases = [];
  const jobs = createReceiptJobs({ verify: () => new Promise(resolve => releases.push(resolve)) });
  const first = jobs.start({}, 'one');
  jobs.start({}, 'two'); jobs.start({}, 'three');
  assert.throws(() => jobs.start({}, 'four'), /nhiều biên lai/);
  assert.equal(jobs.start({}, 'one').jobId, first.jobId);
  for (let i = 0; i < 3; i++) { await tick(); releases.shift()({}); }
  await tick();
  assert.equal(jobs.start({}, 'four').status, 'pending');
  await tick(); releases.shift()({}); await tick();
});

test('expiry starts at completion, preserves pending work, and permits rescanning', async () => {
  let time = 0, release;
  const jobs = createReceiptJobs({ now: () => time, verify: () => new Promise(resolve => { release = resolve; }) });
  const first = jobs.start({}, 'one');
  await tick();
  time = 20 * 60000;
  assert.equal(jobs.get(first.jobId).status, 'pending');
  release({ isValid: true }); await tick();
  time += 10 * 60000 - 1;
  assert.equal(jobs.get(first.jobId).status, 'complete');
  time++;
  assert.equal(jobs.get(first.jobId), null);
  const next = jobs.start({}, 'one');
  assert.notEqual(next.jobId, first.jobId);
  await tick(); release({}); await tick();
});

test('retains only the last twenty completed jobs', async () => {
  const jobs = createReceiptJobs({ verify: async () => ({ isValid: true }) });
  const ids = [];
  for (let i = 0; i < 21; i++) { ids.push(jobs.start({}, String(i)).jobId); await tick(); }
  assert.equal(jobs.get(ids[0]), null);
  assert.equal(jobs.get(ids[1]).status, 'complete');
  assert.equal(jobs.get(ids[20]).status, 'complete');
});

test('failed OCR is readable and does not stop the queue', async () => {
  const jobs = createReceiptJobs({ verify: async body => {
    if (body.fail) throw new Error('OCR unavailable');
    return { isValid: true };
  } });
  const failed = jobs.start({ fail: true }, 'bad');
  const valid = jobs.start({}, 'good');
  await tick();
  assert.deepEqual(jobs.get(failed.jobId), { status: 'error', jobId: failed.jobId, error: 'OCR unavailable' });
  assert.equal(jobs.get(valid.jobId).result.isValid, true);
  const retried = jobs.start({}, 'bad');
  assert.notEqual(retried.jobId, failed.jobId);
  await tick();
  assert.equal(jobs.get(retried.jobId).status, 'complete');
  assert.equal(jobs.get(failed.jobId).status, 'error');
  assert.throws(() => jobs.start({}, ''), /Validated receipt key/);
});

test('queue timing measures waiting independently of recognition time',async()=>{
 let clock=0;const releases=[];const jobs=createReceiptJobs({now:()=>clock,verify:()=>new Promise(resolve=>releases.push(resolve))});
 const first=jobs.start({},'first');await tick();clock=10;const second=jobs.start({},'second');clock=110;releases.shift()({processingMs:110});await tick();clock=120;releases.shift()({processingMs:10});await tick();
 assert.equal(jobs.get(first.jobId).queueMs,0);assert.equal(jobs.get(second.jobId).queueMs,100);assert.equal(jobs.get(second.jobId).result.processingMs,10);
});

test('pending progress is sanitized, monotonic and cannot change a finished job',async()=>{
 let report,release;const jobs=createReceiptJobs({verify:(body,update)=>{report=update;return new Promise(resolve=>release=resolve);}});const job=jobs.start({},'progress');await tick();
 report({percent:30,phase:'recognizing',private:'hidden'});assert.deepEqual(jobs.get(job.jobId).progress,{percent:30,phase:'recognizing'});
 report({percent:10,phase:'unknown'});assert.equal(jobs.get(job.jobId).progress.percent,30);report({percent:NaN});assert.equal(jobs.get(job.jobId).progress.percent,30);
 report({percent:1000,phase:'comparing'});assert.equal(jobs.get(job.jobId).progress.percent,99);release({isValid:false});await tick();report({percent:1});assert.equal(jobs.get(job.jobId).status,'complete');assert.equal(jobs.get(job.jobId).progress,undefined);
});

test('bounded wait delivers completion to all waiting clients without another OCR run',async()=>{
 let release,calls=0;const jobs=createReceiptJobs({verify:()=>{calls++;return new Promise(r=>release=r);}});
 const job=jobs.start({image:'private'},'inline');await tick();
 const waits=[jobs.wait(job.jobId,4000),jobs.wait(job.jobId,4000)];
 release({isValid:false,nonReceipt:true});
 for(const result of await Promise.all(waits)){assert.equal(result.status,'complete');assert.equal(result.result.nonReceipt,true);assert.equal(JSON.stringify(result).includes('private'),false);}
 assert.equal(calls,1);assert.equal((await jobs.wait(job.jobId,4000)).status,'complete');assert.equal(await jobs.wait('missing',4000),null);
});

test('wait timeout and disconnected client preserve the accepted job for later retrieval',async()=>{
 let release;const jobs=createReceiptJobs({verify:()=>new Promise(r=>release=r)});const job=jobs.start({},'timeout');await tick();
 assert.equal((await jobs.wait(job.jobId,10)).status,'pending');
 const controller=new AbortController(),waiting=jobs.wait(job.jobId,4000,controller.signal);controller.abort();assert.equal((await waiting).status,'pending');
 assert.equal((await jobs.wait(job.jobId,4000,controller.signal)).status,'pending');
 release({isValid:true});await tick();assert.equal(jobs.get(job.jobId).result.isValid,true);
});

test('failed OCR wakes waiting clients and excessive waiters do not accumulate',async()=>{
 let reject;const jobs=createReceiptJobs({verify:()=>new Promise((_,r)=>reject=r)});const job=jobs.start({},'failed');await tick();
 const waits=Array.from({length:20},()=>jobs.wait(job.jobId,4000));assert.equal((await jobs.wait(job.jobId,4000)).status,'pending');
 reject(Error('temporary failure'));
 for(const result of await Promise.all(waits)){assert.equal(result.status,'error');assert.equal(result.error,'temporary failure');}
});


test('disk queue accepts 100 unique scans, reports position, bounds storage, and removes image bodies after work',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-spool-'));const releases=[];
 const jobs=createReceiptJobs({dir,maxPending:100,verify:body=>new Promise(resolve=>releases.push(()=>resolve({number:body.number}))) });
 try{
 const ids=Array.from({length:100},(_,number)=>jobs.start({number,image:'private-image'},'k'+number).jobId);
 assert.equal(jobs.get(ids[99]).queuePosition,100);assert.equal(fs.readdirSync(path.join(dir,'.receipt-queue')).length,100);
 assert.throws(()=>jobs.start({},'overflow'),e=>e.status===429);assert.equal(jobs.start({},'k0').jobId,ids[0]);
 await tick();for(let i=0;i<100;i++){assert.equal(releases.length,1);releases.shift()();await tick();}
 for(let i=0;i<100;i++){assert.equal(jobs.get(ids[i]).status,'complete');assert.equal(jobs.get(ids[i]).result.number,i);}
 assert.equal(fs.readdirSync(path.join(dir,'.receipt-queue')).length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('disk queue recovers accepted pending scans with stable ids and respects its byte budget',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-recover-')),id='a'.repeat(48);
 try{
 const spool=path.join(dir,'.receipt-queue');fs.mkdirSync(spool);fs.writeFileSync(path.join(spool,id+'.json'),JSON.stringify({id,key:'restored',createdAt:Date.now(),body:{value:42}}));
 const jobs=createReceiptJobs({dir,maxPending:100,maxQueuedBytes:500,verify:async body=>({value:body.value})});assert.equal(jobs.get(id).status,'pending');await tick();assert.equal(jobs.get(id).result.value,42);
 assert.throws(()=>jobs.start({image:'x'.repeat(501)},'too-big'),e=>e.status===429);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
