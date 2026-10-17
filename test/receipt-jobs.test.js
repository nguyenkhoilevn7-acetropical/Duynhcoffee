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
