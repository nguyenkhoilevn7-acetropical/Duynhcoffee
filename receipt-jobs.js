'use strict';
const crypto = require('node:crypto');

// The caller validates the image/cart and derives key from the validated input.
// Jobs keep running independently of the HTTP request that created them.
function createReceiptJobs({ verify, now = Date.now }) {
  if (typeof verify !== 'function') throw new TypeError('verify is required');
  const jobs = new Map(), keys = new Map(), queue = [];
  const ttl = 10 * 60 * 1000;
  let draining = false;

  function remove(job) {
    jobs.delete(job.id);
    if (keys.get(job.key) === job.id) keys.delete(job.key);
  }
  function prune() {
    for (const job of jobs.values()) {
      if (job.status !== 'pending' && now() - job.finishedAt >= ttl) remove(job);
    }
    const finished = [...jobs.values()].filter(job => job.status !== 'pending');
    while (finished.length > 20) remove(finished.shift());
  }
  function snapshot(job) {
    if (!job) return null;
    const result = { status: job.status, jobId: job.id };
    if (job.status === 'complete') { result.result = job.result; result.queueMs = Math.max(0, job.startedAt - job.createdAt); }
    if (job.status === 'error') result.error = job.error;
    return result;
  }
  async function drain() {
    try {
      while (queue.length) {
        const job = queue.shift();
        job.startedAt = now();
        try {
          job.result = await verify(job.body);
          job.status = 'complete';
        } catch (error) {
          job.error = error instanceof Error ? error.message : 'Không đọc được biên lai. Vui lòng thử lại.';
          job.status = 'error';
        } finally {
          job.body = null;
          job.finishedAt = now();
          // Map insertion order must represent completion order for eviction.
          jobs.delete(job.id);
          jobs.set(job.id, job);
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
    if ([...jobs.values()].filter(job => job.status === 'pending').length >= 3) {
      throw new Error('Máy chủ đang đọc nhiều biên lai. Vui lòng thử lại sau.');
    }
    const job = { id: crypto.randomBytes(24).toString('hex'), key, body, status: 'pending', createdAt:now() };
    jobs.set(job.id, job);
    keys.set(key, job.id);
    queue.push(job);
    if (!draining) {
      draining = true;
      Promise.resolve().then(drain);
    }
    return snapshot(job);
  }
  function get(id) {
    prune();
    return snapshot(jobs.get(id));
  }
  return { start, get };
}
module.exports = { createReceiptJobs };
