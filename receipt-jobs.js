'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// The caller validates the image/cart and derives key from the validated input.
// Jobs keep running independently of the HTTP request that created them.
function createReceiptJobs({ verify, now = Date.now, dir, maxPending = 3, maxQueuedBytes = 128 * 1024 * 1024 }) {
  if (typeof verify !== 'function') throw new TypeError('verify is required');
  const jobs = new Map(), keys = new Map(), queue = [];
  const ttl = 10 * 60 * 1000;
  let draining = false, queuedBytes = 0;
  const spool = dir ? path.join(dir, '.receipt-queue') : null;
  if (spool) fs.mkdirSync(spool,{recursive:true,mode:0o700});
  const fileFor = id => path.join(spool,id+'.json');
  function deleteBody(job) {
    if (spool) { try { fs.unlinkSync(fileFor(job.id)); } catch {} }
    queuedBytes=Math.max(0,queuedBytes-(job.bytes||0));job.bytes=0;
  }
  function schedule() {
    if (!draining && queue.length) { draining=true; Promise.resolve().then(drain); }
  }

  function remove(job) {
    jobs.delete(job.id);
    if (keys.get(job.key) === job.id) keys.delete(job.key);
  }
  function prune() {
    for (const job of jobs.values()) {
      if (job.status !== 'pending' && now() - job.finishedAt >= ttl) remove(job);
    }
    const finished = [...jobs.values()].filter(job => job.status !== 'pending');
    while (finished.length > Math.max(20,maxPending*2)) remove(finished.shift());
  }
  function snapshot(job) {
    if (!job) return null;
    const result = { status: job.status, jobId: job.id };
    if (job.status === 'complete') { result.result = job.result; result.queueMs = Math.max(0, job.startedAt - job.createdAt); }
    if (spool && job.status === 'pending') result.queuePosition = job.startedAt === undefined ? Math.max(1,queue.indexOf(job)+1) : 0;
    if (job.status === 'pending' && job.progress) result.progress = {...job.progress};
    if (job.status === 'error') result.error = job.error;
    return result;
  }
  async function drain() {
    try {
      while (queue.length) {
        const job = queue.shift();
        job.startedAt = now();
        try {
          const body=spool?JSON.parse(fs.readFileSync(fileFor(job.id),'utf8')).body:job.body;
          job.result = await verify(body, update => {
            if (job.status!=='pending' || !update || !Number.isFinite(update.percent)) return;
            const phase=['starting','preparing','recognizing','rereading','comparing'].includes(update.phase) ? update.phase : 'recognizing';
            job.progress={percent:Math.max(job.progress?.percent || 0, Math.min(99, Math.max(0,Math.round(update.percent)))),phase};
          });
          job.status = 'complete';
        } catch (error) {
          job.error = error instanceof Error ? error.message : 'Không đọc được biên lai. Vui lòng thử lại.';
          job.status = 'error';
        } finally {
          job.body = null;
          deleteBody(job);
          job.finishedAt = now();
          // Map insertion order must represent completion order for eviction.
          jobs.delete(job.id);
          jobs.set(job.id, job);
          for (const notify of job.waiters || []) notify();
          prune();
        }
      }
    } finally { draining = false; }
  }
  function start(body, key) {
    if (typeof key !== 'string' || !key) throw new Error('Validated receipt key is required');
    prune();
    const existing = jobs.get(keys.get(key));
    if (existing && existing.status !== 'error') return snapshot(existing);
    // Transient OCR failures remain readable by old pollers, but a fresh
    // start request can retry immediately rather than waiting for expiry.
    if ([...jobs.values()].filter(job => job.status === 'pending').length >= maxPending) {
      throw Object.assign(new Error('Máy chủ đang đọc nhiều biên lai. Vui lòng thử lại sau.'),{status:429});
    }
    const bytes=Buffer.byteLength(JSON.stringify(body));
    if (queuedBytes+bytes>maxQueuedBytes) throw Object.assign(new Error('Hàng đợi ảnh đang đầy. Vui lòng thử lại sau.'),{status:429});
    const job = { id: crypto.randomBytes(24).toString('hex'), key, body, status: 'pending', createdAt:now(), bytes };
    if (spool) {
      const temp=fileFor(job.id)+'.tmp';
      try { fs.writeFileSync(temp,JSON.stringify({id:job.id,key,body,createdAt:job.createdAt}),{mode:0o600});fs.renameSync(temp,fileFor(job.id)); }
      catch(error) {try{fs.unlinkSync(temp);}catch{}throw Object.assign(new Error('Chưa lưu được tác vụ quét. Vui lòng thử lại.'),{status:503});}
      job.body=null;
    }
    queuedBytes+=bytes;
    jobs.set(job.id, job);
    keys.set(key, job.id);
    queue.push(job);
    schedule();
    return snapshot(job);
  }
  function get(id) {
    prune();
    return snapshot(jobs.get(id));
  }
  function wait(id, timeoutMs = 0, signal) {
    prune();
    const job = jobs.get(id);
    const duration = Math.min(4000, Math.max(0, Number(timeoutMs) || 0));
    if (!job || job.status !== 'pending' || !duration || signal?.aborted) return Promise.resolve(snapshot(job));
    job.waiters ||= new Set();
    // Bound listeners even when a client retries repeatedly while OCR is busy.
    if (job.waiters.size >= 20) return Promise.resolve(snapshot(job));
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        job.waiters.delete(done);
        signal?.removeEventListener('abort', done);
        resolve(snapshot(job));
      };
      const timer = setTimeout(done, duration);
      job.waiters.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }
  // Recover accepted work on a process restart when the filesystem survives.
  // Finished proofs are intentionally not restored across verifier secret changes.
  if (spool) {
    for (const name of fs.readdirSync(spool)) {
      if (/^[0-9a-f]{48}\.json\.tmp$/.test(name)) {try{fs.unlinkSync(path.join(spool,name));}catch{}continue;}
      if (!/^[0-9a-f]{48}\.json$/.test(name)) continue;
      try {
        const file=path.join(spool,name),bytes=fs.statSync(file).size;
        if(bytes>6*1024*1024+100000) {fs.unlinkSync(file);continue;}
        const saved=JSON.parse(fs.readFileSync(file,'utf8'));
        if(saved.id+'.json'!==name || typeof saved.key!=='string' || !saved.body || !Number.isFinite(saved.createdAt) || now()-saved.createdAt>86400000) {fs.unlinkSync(file);continue;}
        const job={id:saved.id,key:saved.key,status:'pending',createdAt:saved.createdAt,body:null,bytes};
        jobs.set(job.id,job);keys.set(job.key,job.id);queue.push(job);queuedBytes+=bytes;
      } catch {try{fs.unlinkSync(path.join(spool,name));}catch{}}
    }
    queue.sort((a,b)=>a.createdAt-b.createdAt);schedule();
  }
  return { start, get, wait };
}
module.exports = { createReceiptJobs };

