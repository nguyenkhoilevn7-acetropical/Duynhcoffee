'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TAG = 'duynh-backup-v1';
const MAX_BYTES = 25 * 1024 * 1024;
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/password|secret|token|api.?key|credential|adminAccount|__proto__|constructor|prototype/i.test(key))
    .map(([key, val]) => [key, sanitize(val)]));
  return value;
}
function validate(value) {
  if (!value || value.schema !== TAG || !Array.isArray(value.menu) || !Array.isArray(value.discounts) ||
      !value.config || Array.isArray(value.config) || typeof value.config !== 'object' ||
      !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Backup không đúng định dạng');
  if (value.menu.some(x => !x || typeof x.name !== 'string' || !Number.isFinite(x.price) || x.price < 0))
    throw new Error('Menu trong backup không hợp lệ');
  const clean = sanitize(value);
  if (JSON.stringify(clean) !== JSON.stringify(value)) throw new Error('Backup chứa trường bí mật không được phép');
  return clean;
}
function createBackup({ dir, snapshot, apply, fetchImpl = global.fetch, env = process.env, debounceMs = 1500 }) {
  let refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN || '';
  let accessToken = '', expires = 0, timer, retryTimer, chain = Promise.resolve(), dirty = false;
  let lastSuccess = null, lastError = null, startupRestored = false, revision = 0;
  const states = new Map();
  const enabled = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && refreshToken);
  const ready = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
  const status = () => ({ configured: ready(), connected: enabled(), pending: dirty, lastSuccess, lastError, startupRestored });
  async function request(url, options = {}) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Google API trả mã ' + response.status);
    return response;
  }
  async function token(params) {
    const r = await request('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }).toString() });
    return r.json();
  }
  async function auth() {
    if (!enabled()) throw new Error('Chưa cấu hình Google Drive');
    if (!accessToken || expires < Date.now() + 60000) {
      const data = await token({ grant_type: 'refresh_token', refresh_token: refreshToken });
      if (!data.access_token) throw new Error('Google không trả access token');
      accessToken = data.access_token;
      expires = Date.now() + Number(data.expires_in || 3600) * 1000;
    }
    return { Authorization: 'Bearer ' + accessToken };
  }
  async function list() {
    let result = [], pageToken = '';
    do {
      const params = new URLSearchParams({ q: "trashed = false and appProperties has { key='duynhBackup' and value='" + TAG + "' }",
        spaces: 'drive', fields: 'nextPageToken,files(id,name,createdTime,appProperties)', orderBy: 'createdTime desc', pageSize: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await (await request('https://www.googleapis.com/drive/v3/files?' + params, { headers: await auth() })).json();
      result.push(...(data.files || [])); pageToken = data.nextPageToken || '';
      if (result.length >= 1000) break;
    } while (pageToken);
    return result;
  }
  async function download(file) {
    const r = await request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media', { headers: await auth() });
    if (Number(r.headers.get('content-length')) > MAX_BYTES) throw new Error('Backup quá lớn');
    let size = 0; const chunks = [];
    for await (const chunk of r.body) { size += chunk.length; if (size > MAX_BYTES) throw new Error('Backup quá lớn'); chunks.push(Buffer.from(chunk)); }
    const bytes = Buffer.concat(chunks);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (!file.appProperties || hash !== file.appProperties.sha256) throw new Error('Checksum backup không khớp');
    return validate(JSON.parse(bytes.toString('utf8')));
  }
  async function latest() {
    const files = await list();
    if (!files.length) return null;
    for (const file of files) { try { return await download(file); } catch { /* Try an older valid version. */ } }
    throw new Error('Không đọc được phiên bản backup hợp lệ; không khởi tạo đè dữ liệu');
  }
  function writeLocal(data) {
    // Stage every file before replacing; caches are applied only after all writes succeed.
    let localConfig = {};
    try { localConfig = JSON.parse(fs.readFileSync(path.join(dir, 'store_config.json'), 'utf8')); } catch {}
    function preserveSecrets(clean, previous) {
      if (!clean || typeof clean !== 'object' || Array.isArray(clean)) return clean;
      const result = { ...clean };
      for (const [key, value] of Object.entries(previous || {})) {
        if (/__proto__|constructor|prototype/i.test(key)) continue;
        if (/password|secret|token|api.?key|credential|adminAccount/i.test(key)) result[key] = value;
        else if (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) result[key] = preserveSecrets(result[key], value);
      }
      return result;
    }
    const entries = [['menu.json', data.menu], ['store_config.json', preserveSecrets(data.config, localConfig)], ['discounts.json', data.discounts]];
    const staged = [];
    try {
      for (const [name, value] of entries) {
        const dest = path.join(dir, name), temp = dest + '.restore.tmp';
        fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); staged.push([temp, dest]);
      }
      for (const [temp, dest] of staged) fs.renameSync(temp, dest);
    } finally { for (const [temp] of staged) { if (fs.existsSync(temp)) fs.unlinkSync(temp); } }
  }
  async function initialize() {
    if (!enabled()) return false;
    const data = await latest();
    if (data) { writeLocal(data); startupRestored = true; }
    return startupRestored;
  }
  async function upload() {
    const startRevision = revision;
    const current = snapshot();
    const data = validate({ schema: TAG, createdAt: new Date().toISOString(), menu: sanitize(current.menu),
      config: sanitize(current.config), discounts: sanitize(current.discounts) });
    const bytes = Buffer.from(JSON.stringify(data));
    if (bytes.length > MAX_BYTES) throw new Error('Backup vượt giới hạn 25 MB');
    // Resumable upload also supports menus with embedded images larger than 5 MB.
    const metadata = { name: 'DuynhCoffee-Backup-' + data.createdAt.replace(/[:.]/g, '-') + '.json', mimeType: 'application/json',
      appProperties: { duynhBackup: TAG, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } };
    const start = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'POST', headers: { ...await auth(), 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/json',
        'X-Upload-Content-Length': String(bytes.length) }, body: JSON.stringify(metadata) });
    const location = start.headers.get('location');
    if (!location || new URL(location).origin !== 'https://www.googleapis.com') throw new Error('Địa chỉ upload không hợp lệ');
    await request(location, { method: 'PUT', headers: { ...await auth(), 'Content-Type': 'application/json',
      'Content-Length': String(bytes.length) }, body: bytes });
    lastSuccess = data.createdAt; lastError = null; if (revision === startRevision) dirty = false;
    // Never delete older versions automatically; owner manages retention in Drive.
    return status();
  }
  function enqueue(fn) { const job = chain.then(fn); chain = job.catch(() => {}); return job; }
  function flush() {
    clearTimeout(timer); clearTimeout(retryTimer);
    return enqueue(upload).catch(error => { dirty = true; lastError = error.message;
      if (enabled()) { retryTimer = setTimeout(() => flush().catch(() => {}), 30000); retryTimer.unref(); }
      throw error; });
  }
  function changed() {
    revision++; dirty = true;
    if (!enabled()) return;
    clearTimeout(timer); timer = setTimeout(() => flush().catch(() => {}), debounceMs); timer.unref();
  }
  function authorized(req) {
    const key = env.BACKUP_ADMIN_KEY || '';
    const supplied = (req.headers.authorization || '').replace(/^Bearer /, '');
    return key.length >= 32 && Buffer.byteLength(key) === Buffer.byteLength(supplied) &&
      crypto.timingSafeEqual(Buffer.from(key), Buffer.from(supplied));
  }
  function reply(res, code, value, html = false) {
    res.removeHeader('Access-Control-Allow-Origin');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.writeHead(code, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8' });
    res.end(html ? value : JSON.stringify(value));
  }
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function handle(req, res, parsed) {
    const p = parsed.pathname;
    if (!p.startsWith('/api/backup/')) return false;
    if (p === '/api/backup/google/callback' && req.method === 'GET') {
      const state = parsed.query.state, entry = states.get(state);
      states.delete(state);
      const cookies = req.headers.cookie || '';
      const browserNonce = cookies.split(';').map(x => x.trim()).find(x => x.startsWith('duynh_oauth='));
      if (!entry || entry.expires < Date.now() || !browserNonce || browserNonce.slice(12) !== entry.nonce) {
        reply(res, 400, { error: 'Phiên OAuth không hợp lệ hoặc đã hết hạn' }); return true;
      }
      res.setHeader('Set-Cookie', 'duynh_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/backup/google/callback; Max-Age=0');
      if (parsed.query.error || !parsed.query.code) { reply(res, 400, { error: 'Bạn chưa cấp quyền Google Drive' }); return true; }
      try {
        const data = await token({ grant_type: 'authorization_code', code: parsed.query.code, redirect_uri: env.GOOGLE_REDIRECT_URI });
        if (!data.refresh_token || !String(data.scope || '').split(' ').includes(SCOPE)) throw new Error('Chưa nhận đủ quyền offline drive.file');
        // Do not activate backup until refresh token has been saved securely in Render and server restarted.
        reply(res, 200, '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kết nối Drive</title><body><h1>Đã nhận quyền Drive</h1><p>Thông tin bí mật: sao chép giá trị dưới đây vào biến GOOGLE_DRIVE_REFRESH_TOKEN của Render. Không gửi vào chat hoặc GitHub. Sau khi lưu và khởi động lại, kết nối mới được kích hoạt.</p><textarea readonly rows="6" cols="70">' + escape(data.refresh_token) + '</textarea><p>Đóng trang sau khi lưu. <a href="/backup.html">Quay lại quản trị backup</a></p></body></html>', true);
      } catch { reply(res, 502, { error: 'Không hoàn tất được OAuth; hãy thử kết nối lại' }); }
      return true;
    }
    if (!authorized(req)) { reply(res, 401, { error: 'Cần khóa quản trị backup hợp lệ' }); return true; }
    if (req.headers.origin && req.headers.origin !== new URL(env.GOOGLE_REDIRECT_URI || 'https://invalid.local').origin) {
      reply(res, 403, { error: 'Origin không được phép' }); return true;
    }
    try {
      if (p === '/api/backup/status' && req.method === 'GET') reply(res, 200, status());
      else if (p === '/api/backup/google/start' && req.method === 'POST') {
        if (!ready()) throw new Error('Thiếu cấu hình OAuth trên Render');
        for (const [key, value] of states) if (value.expires < Date.now()) states.delete(key);
        if (states.size > 20) throw new Error('Quá nhiều phiên OAuth');
        const state = crypto.randomBytes(32).toString('hex'), nonce = crypto.randomBytes(32).toString('hex');
        states.set(state, { nonce, expires: Date.now() + 10 * 60000 });
        res.setHeader('Set-Cookie', 'duynh_oauth=' + nonce + '; HttpOnly; Secure; SameSite=Lax; Path=/api/backup/google/callback; Max-Age=600');
        const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.GOOGLE_REDIRECT_URI,
          response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state });
        reply(res, 200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params });
      } else if (p === '/api/backup/save' && req.method === 'POST') reply(res, 200, await flush());
      else if (p === '/api/backup/restore' && req.method === 'POST') {
        if (req.headers['x-backup-confirm'] !== 'RESTORE') { reply(res, 400, { error: 'Cần xác nhận khôi phục' }); return true; }
        const result = await enqueue(async () => {
          const data = await latest(); if (!data) throw new Error('Chưa có backup');
          // Preserve current state before replacement; abort restore if this safety backup fails.
          await upload(); clearTimeout(timer); clearTimeout(retryTimer);
          writeLocal(data); apply({ ...data, config: JSON.parse(fs.readFileSync(path.join(dir, 'store_config.json'), 'utf8')) }); revision++; dirty = true; changed();
          return { restored: true, createdAt: data.createdAt };
        }); reply(res, 200, result);
      } else reply(res, 404, { error: 'Không tìm thấy API backup' });
    } catch (error) { reply(res, 503, { error: error.message }); }
    return true;
  }
  function stop() { clearTimeout(timer); clearTimeout(retryTimer); }
  return { initialize, changed, flush, handle, status, stop };
}
module.exports = { createBackup, sanitize, validate, TAG };
