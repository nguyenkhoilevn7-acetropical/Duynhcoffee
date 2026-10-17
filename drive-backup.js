'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {validateRecipeStore} = require('./drink-recipes');
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
  if (value.recipes !== undefined) validateRecipeStore(value.recipes);
  const clean = sanitize(value);
  if (JSON.stringify(clean) !== JSON.stringify(value)) throw new Error('Backup chứa trường bí mật không được phép');
  return clean;
}
function orderArchiveView(orders, updatedAt) {
  const labels = {new:'🆕 CHƯA LÀM',prep:'☕ ĐANG PHA',shipping:'🛵 ĐANG GIAO',done:'✅ ĐÃ HOÀN TẤT',cancelled:'❌ ĐÃ HỦY'};
  const money = n => Number(n || 0).toLocaleString('vi-VN') + ' đ';
  const lines = ['MOM’S TEA & COFFEE — ĐƠN HÀNG DỰ PHÒNG', 'Cập nhật: ' + updatedAt,
    'Đây là trạng thái tại lần đồng bộ cuối. Khi web ngừng hoạt động, hãy ghi riêng những đơn đã xử lý để tránh làm trùng.', ''];
  for (const status of [...Object.keys(labels), 'unknown']) {
    const group = orders.filter(o => (labels[o.status] ? o.status : 'unknown') === status);
    if (!group.length) continue;
    lines.push((labels[status] || '⚠️ CẦN KIỂM TRA TRẠNG THÁI') + ' (' + group.length + ')', '');
    for (const o of group.sort((a,b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))) {
      lines.push(o.id + ' · ' + (o.createdAtIso || ''), 'Khách: ' + (o.customerName || '') + ' · ĐT: ' + (o.phone || ''),
        'Địa chỉ: ' + (o.deliveryAddress || o.address || ''));
      for (const i of o.items || []) lines.push('  • ' + i.qty + ' × ' + (i.name || i.item?.name || i.id) +
        (i.custom ? '\n    ⚠️ Lưu ý: ' + i.custom : '') +
        (i.toppings?.length ? '\n    Thêm: ' + i.toppings.map(t => typeof t === 'string' ? t : t.name || t.id).join(', ') : ''));
      if (o.note) lines.push('⚠️ Ghi chú khách: ' + o.note);
      lines.push('Tiền nước: ' + money(o.total) + ' · Phí giao: ' + money(o.shippingFee),
        'Thanh toán: ' + (o.paymentStatus || 'Kiểm tra trước khi giao'),
        'Giao hàng: ' + (o.deliveryPartnerName || '') + (o.trackingCode ? ' · ' + o.trackingCode : ''), '');
    }
  }
  if (!orders.length) lines.push('Chưa có đơn hàng.');
  return lines.join('\n');
}
function archiveOrder(order) {
  // Keep operational details, without large pictures or payment verification credentials.
  return JSON.parse(JSON.stringify(order, (key, value) =>
    /image|password|secret|token|api.?key|credential|__proto__|constructor|prototype/i.test(key) ? undefined : value));
}
function createBackup({ dir, snapshot, apply, ordersSnapshot, fetchImpl = global.fetch, env = process.env, debounceMs = 1500 }) {
  let refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN || '';
  let accessToken = '', expires = 0, timer, retryTimer, chain = Promise.resolve(), dirty = false;
  let lastSuccess = null, lastError = null, startupRestored = false, revision = 0;
  const states = new Map();
  const enabled = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && refreshToken);
  const ready = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
  const orderState = {pending:false,lastSuccess:null,lastError:null,folderUrl:null,boardUrl:null,count:0};
  let orderTimer, orderRetry, orderJob, orderRevision = 0, orderFolder, orderJson, orderBoard, archive;
  const status = () => ({ configured: ready(), connected: enabled(), pending: dirty, lastSuccess, lastError, startupRestored, orders:{...orderState} });
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
    if (data.recipes !== undefined) entries.push(['drink-recipes.json', data.recipes]);
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
      config: sanitize(current.config), discounts: sanitize(current.discounts), ...(current.recipes !== undefined ? {recipes:sanitize(current.recipes)} : {}) });
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
      } else if (p === '/api/backup/save' && req.method === 'POST') { await flush(); if (ordersSnapshot) await flushOrders(); reply(res, 200, status()); }
      else if (p === '/api/backup/orders/save' && req.method === 'POST') { await flushOrders(); reply(res, 200, status()); }
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
  function stop() { clearTimeout(timer); clearTimeout(retryTimer); clearTimeout(orderTimer); clearTimeout(orderRetry); }
  async function findOrderFile(kind, name, mimeType, parent) {
    const params = new URLSearchParams({q:"trashed = false and appProperties has { key='duynhOrders' and value='" + kind + "' }" +
      (parent ? " and '" + parent.replace(/['\\]/g, '\\$&') + "' in parents" : ''),fields:'files(id)',pageSize:'1'});
    const files = await (await request('https://www.googleapis.com/drive/v3/files?' + params,{headers:await auth()})).json();
    if (files.files?.[0]?.id) return {id:files.files[0].id,existing:true};
    const file = await (await request('https://www.googleapis.com/drive/v3/files?fields=id', {
      method:'POST',headers:{...await auth(),'Content-Type':'application/json'},
      body:JSON.stringify({name,mimeType,appProperties:{duynhOrders:kind},...(parent ? {parents:[parent]} : {})})})).json();
    if (!file.id) throw new Error('Drive chưa tạo được file đơn hàng');
    return {id:file.id,existing:false};
  }
  async function uploadOrders() {
    if (!ordersSnapshot) throw new Error('Chưa cấu hình sao lưu đơn hàng');
    const startRevision = orderRevision;
    if (!orderFolder) orderFolder = (await findOrderFile('folder-v1','Mom - Đơn hàng dự phòng','application/vnd.google-apps.folder')).id;
    orderState.folderUrl = 'https://drive.google.com/drive/folders/' + encodeURIComponent(orderFolder);
    if (!orderJson) {
      const file = await findOrderFile('data-v1','Don-hang-du-phong.json','application/json',orderFolder);
      if (file.existing) {
        const response = await request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media',{headers:await auth()});
        let size=0; const chunks=[];
        for await (const chunk of response.body) {size+=chunk.length;if(size>MAX_BYTES)throw new Error('Lịch sử đơn vượt giới hạn 25 MB');chunks.push(Buffer.from(chunk));}
        const text = Buffer.concat(chunks).toString('utf8');
        // A metadata-only file can remain if the process stops during first setup.
        const previous = text === '' ? {schema:'mom-orders-v1',orders:[]} : JSON.parse(text);
        if (previous.schema !== 'mom-orders-v1' || !Array.isArray(previous.orders) || previous.orders.some(o=>!o || typeof o.id !== 'string' || !Array.isArray(o.items)))
          throw new Error('Lịch sử Drive không hợp lệ; dừng ghi để bảo vệ đơn cũ');
        archive = previous.orders;
      } else archive = [];
      orderJson = file.id;
    }
    if (!orderBoard) orderBoard = (await findOrderFile('board-v1','MO-DAY-XEM-DON-HANG.txt','text/plain',orderFolder)).id;
    const current = ordersSnapshot();
    if (!Array.isArray(current) || current.some(o=>!o || typeof o.id !== 'string' || !Array.isArray(o.items))) throw new Error('Dữ liệu đơn hàng không hợp lệ');
    const merged = new Map((archive || []).map(o=>[o.id,o]));
    for (const order of current) merged.set(order.id,archiveOrder(order));
    const data = {schema:'mom-orders-v1',updatedAt:new Date().toISOString(),orders:[...merged.values()]};
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json)>MAX_BYTES) throw new Error('Lịch sử đơn vượt giới hạn 25 MB');
    const put = async (id,mimeType,body) => request('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(id) + '?uploadType=media',{
      method:'PATCH',headers:{...await auth(),'Content-Type':mimeType + '; charset=utf-8'},body});
    await put(orderJson,'application/json',json);
    archive=data.orders;
    await put(orderBoard,'text/plain',orderArchiveView(data.orders,data.updatedAt));
    orderState.boardUrl='https://drive.google.com/file/d/' + encodeURIComponent(orderBoard) + '/view';
    orderState.lastSuccess=data.updatedAt;orderState.lastError=null;orderState.count=data.orders.length;
    orderState.pending=orderRevision!==startRevision;
  }
  function flushOrders() {
    clearTimeout(orderTimer);orderTimer=null;clearTimeout(orderRetry);
    if (orderJob) return orderJob;
    orderState.pending=true;
    orderJob=uploadOrders().catch(error=>{
      orderState.lastError=error.message;orderState.pending=true;
      if(enabled()){orderRetry=setTimeout(()=>flushOrders().catch(()=>{}),30000);orderRetry.unref();}
      throw error;
    }).finally(()=>{
      orderJob=null;
      if(orderState.pending && !orderState.lastError && enabled()) scheduleOrders();
    });
    return orderJob;
  }
  function scheduleOrders() {
    if(orderTimer || !enabled())return;
    orderTimer=setTimeout(()=>{orderTimer=null;flushOrders().catch(()=>{});},debounceMs);orderTimer.unref();
  }
  function ordersChanged() {orderRevision++;orderState.pending=true;scheduleOrders();}
  // A separate private Drive record: never included in public config or menu backups.
  let pushFileId = null;
  async function loadPushState() {
    if (!enabled()) return null;
    const params = new URLSearchParams({ q: "trashed = false and appProperties has { key='duynhPrivate' and value='admin-push-v1' }",
      fields: 'files(id)', pageSize: '1' });
    const result = await (await request('https://www.googleapis.com/drive/v3/files?' + params, { headers: await auth() })).json();
    pushFileId = result.files?.[0]?.id || null;
    if (!pushFileId) return null;
    const r = await request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(pushFileId) + '?alt=media', { headers: await auth() });
    const text = await r.text();
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Push state too large');
    return JSON.parse(text);
  }
  async function savePushState(data) {
    if (!enabled()) return false;
    return enqueue(async () => {
      if (!pushFileId) {
        const created = await (await request('https://www.googleapis.com/drive/v3/files?fields=id', {
          method: 'POST', headers: { ...await auth(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'DuynhCoffee-Admin-Notifications.json', mimeType: 'application/json', appProperties: { duynhPrivate: 'admin-push-v1' } }) })).json();
        pushFileId = created.id;
      }
      await request('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(pushFileId) + '?uploadType=media', {
        method: 'PATCH', headers: { ...await auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      return true;
    });
  }
  return { initialize, changed, flush, handle, status, stop, loadPushState, savePushState, ordersChanged, flushOrders };
}
module.exports = { createBackup, sanitize, validate, TAG, orderArchiveView, archiveOrder };

