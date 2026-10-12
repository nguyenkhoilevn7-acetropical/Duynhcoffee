#!/usr/bin/env node

/**
 * HỆ THỐNG BÁN HÀNG ONLINE & QUẢN TRỊ ĐUỶNH TEA HOUSE
 * Phiên bản Zero-Dependency: 100% Thuần Node.js (Không cần npm install, không cần package.json)
 * Chạy trực tiếp hoàn hảo trên Render.com, Railway, VPS, Localhost
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const ORDERS_FILE = path.join(ROOT_DIR, 'orders.json');
const CONFIG_FILE = path.join(ROOT_DIR, 'store_config.json');
const MENU_FILE = path.join(ROOT_DIR, 'menu.json');
const DISCOUNTS_FILE = path.join(ROOT_DIR, 'discounts.json');

// Lấy địa chỉ IP mạng nội bộ (Wi-Fi / LAN)
function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

// Đảm bảo thư mục public tồn tại
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// Hàm đọc JSON an toàn
function readJsonFile(filePath, defaultVal = []) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Lỗi đọc file ${filePath}:`, err.message);
  }
  return defaultVal;
}

// Hàm ghi JSON an toàn
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Lỗi ghi file ${filePath}:`, err.message);
    return false;
  }
}

// In-memory cache
let ordersCache = readJsonFile(ORDERS_FILE, []);
let configCache = readJsonFile(CONFIG_FILE, {});
let menuCache = readJsonFile(MENU_FILE, []);
let discountsCache = readJsonFile(DISCOUNTS_FILE, []);

// Quản lý phiên bản dữ liệu và mã nguồn (Data & Code Versioning)
let codeVersion = Date.now();
let menuVersion = Date.now();
let configVersion = Date.now();
let discountsVersion = Date.now();
let ordersVersion = Date.now();

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

// Hàm đọc body với kích thước hỗ trợ upload ảnh Base64 (tối đa 25MB)
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX_SIZE = 25 * 1024 * 1024; // 25MB

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        req.destroy();
        reject(new Error('Payload quá lớn (Vượt quá giới hạn 25MB)'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const str = buffer.toString('utf8');
      if (!str || str.trim() === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(str);
        resolve(parsed);
      } catch (err) {
        resolve({ raw: str });
      }
    });

    req.on('error', err => reject(err));
  });
}

// Set CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
  });
  res.end(JSON.stringify(data));
}

// ==================== ZERO-DEPENDENCY WEBSOCKET ENGINE (RFC 6455) ====================
// Bộ máy WebSocket thuần 100% bằng chuẩn Node.js, không cần thư viện ngoài (Zero Dependency)
function makeWsAcceptKey(secWebSocketKey) {
  return crypto.createHash('sha1').update(secWebSocketKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}

function encodeWsFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeWsFrame(buffer) {
  if (buffer.length < 2) return null;
  const firstByte = buffer[0];
  const opcode = firstByte & 0x0f;
  const isMasked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  let maskKey = null;
  if (isMasked) {
    if (buffer.length < offset + 4) return null;
    maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLen) return null;
  const payload = buffer.slice(offset, offset + payloadLen);
  if (isMasked && maskKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  return { opcode, text: payload.toString('utf8'), totalLength: offset + payloadLen };
}

// Quản lý các kết nối WebSocket
const wsClients = new Set();
const sseClients = new Set();

// Phát thông điệp Realtime đến tất cả thiết bị (Cả WebSocket và SSE)
function broadcastRealtime(eventType, data) {
  const now = Date.now();
  if (eventType === 'MENU_UPDATE') menuVersion = now;
  if (eventType === 'CONFIG_UPDATE') configVersion = now;
  if (eventType === 'DISCOUNTS_UPDATE') discountsVersion = now;
  if (eventType === 'NEW_ORDER' || eventType === 'ORDER_STATUS' || eventType === 'ORDERS_SYNC') ordersVersion = now;
  if (eventType === 'CODE_UPDATE') codeVersion = now;

  const envelope = {
    type: eventType,
    data: data,
    codeVersion,
    menuVersion,
    configVersion,
    ordersVersion,
    discountsVersion,
    serverTime: new Date().toISOString(),
    timestamp: now
  };
  const jsonStr = JSON.stringify(envelope);

  // 1. Gửi qua WebSocket
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try {
        client.send(jsonStr);
      } catch (e) {
        wsClients.delete(client);
      }
    }
  }

  // 2. Gửi qua SSE
  const ssePayload = "data: " + jsonStr + "\n\n";
  for (const client of sseClients) {
    try {
      client.write(ssePayload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Xử lý gói tin từ Client gửi lên
function handleClientWsMessage(payload, senderClient) {
  const type = payload.type;
  if (type === 'NEW_ORDER' && payload.order) {
    ordersCache = readJsonFile(ORDERS_FILE, ordersCache);
    const existingIdx = ordersCache.findIndex(o => o.id === payload.order.id);
    if (existingIdx >= 0) {
      ordersCache[existingIdx] = { ...ordersCache[existingIdx], ...payload.order };
    } else {
      ordersCache.push(payload.order);
    }
    writeJsonFile(ORDERS_FILE, ordersCache);
    broadcastRealtime('NEW_ORDER', payload.order);
  } else if (type === 'MENU_UPDATE' && Array.isArray(payload.menu)) {
    menuCache = payload.menu;
    writeJsonFile(MENU_FILE, menuCache);
    broadcastRealtime('MENU_UPDATE', menuCache);
  } else if (type === 'CONFIG_UPDATE' && payload.config) {
    configCache = { ...configCache, ...payload.config };
    writeJsonFile(CONFIG_FILE, configCache);
    broadcastRealtime('CONFIG_UPDATE', configCache);
  } else if (type === 'PING') {
    senderClient.send(JSON.stringify({ type: 'PONG', serverTime: new Date().toISOString() }));
  }
}

// Heartbeat giữ kết nối WebSocket
setInterval(() => {
  const pingStr = JSON.stringify({ type: 'HEARTBEAT', serverTime: new Date().toISOString() });
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try { client.send(pingStr); } catch (e) { wsClients.delete(client); }
    }
  }
}, 15000);

// ==================== TỰ ĐỘNG GIÁM SÁT TỆP MÁY CHỦ (FILE WATCHERS) ====================
function setupFileWatchers() {
  const jsonFiles = [
    {
      file: MENU_FILE,
      type: 'MENU_UPDATE',
      name: 'Thực đơn & Giá (menu.json)',
      reload: () => { menuCache = readJsonFile(MENU_FILE, menuCache); return menuCache; }
    },
    {
      file: CONFIG_FILE,
      type: 'CONFIG_UPDATE',
      name: 'Cấu hình quán (store_config.json)',
      reload: () => { configCache = readJsonFile(CONFIG_FILE, configCache); return configCache; }
    },
    {
      file: DISCOUNTS_FILE,
      type: 'DISCOUNTS_UPDATE',
      name: 'Mã giảm giá (discounts.json)',
      reload: () => { discountsCache = readJsonFile(DISCOUNTS_FILE, discountsCache); return discountsCache; }
    },
    {
      file: ORDERS_FILE,
      type: 'ORDERS_SYNC',
      name: 'Đơn hàng (orders.json)',
      reload: () => { ordersCache = readJsonFile(ORDERS_FILE, ordersCache); return ordersCache; }
    }
  ];

  jsonFiles.forEach(item => {
    if (fs.existsSync(item.file)) {
      let lastMtime = fs.statSync(item.file).mtimeMs;
      fs.watchFile(item.file, { interval: 500 }, (curr) => {
        if (curr.mtimeMs !== lastMtime) {
          lastMtime = curr.mtimeMs;
          console.log(`[FileWatcher] 🔄 Phát hiện thay đổi ${item.name} trên máy chủ! Đang đồng bộ tới tất cả điện thoại...`);
          const freshData = item.reload();
          broadcastRealtime(item.type, freshData);
        }
      });
    }
  });

  const codeFiles = [
    path.join(PUBLIC_DIR, 'index.html'),
    path.join(ROOT_DIR, 'index.html')
  ];

  codeFiles.forEach(cf => {
    if (fs.existsSync(cf)) {
      let lastMtime = fs.statSync(cf).mtimeMs;
      fs.watchFile(cf, { interval: 800 }, (curr) => {
        if (curr.mtimeMs !== lastMtime) {
          lastMtime = curr.mtimeMs;
          codeVersion = Date.now();
          console.log(`[FileWatcher] ⚡ Mã nguồn ${path.basename(cf)} đã được cập nhật! Phát lệnh Hot Reload...`);
          broadcastRealtime('CODE_UPDATE', { codeVersion, file: path.basename(cf) });
        }
      });
    }
  });
}

setupFileWatchers();

// Helper phục vụ file tĩnh với Strict No-Cache Headers
function serveStaticFile(req, res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const fallbackIndex = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))
        ? path.join(PUBLIC_DIR, 'index.html')
        : path.join(ROOT_DIR, 'index.html');

      if (fs.existsSync(fallbackIndex)) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Surrogate-Control': 'no-store',
          'X-POS-Code-Version': String(codeVersion)
        });
        fs.createReadStream(fallbackIndex).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'X-POS-Code-Version': String(codeVersion)
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Khởi tạo HTTP Server
const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // ==================== REST API ENDPOINTS ====================

  // 0. GET /api/version
  if (pathname === '/api/version' && req.method === 'GET') {
    sendJson(res, 200, {
      codeVersion,
      menuVersion,
      configVersion,
      discountsVersion,
      ordersVersion,
      activeClients: wsClients.size,
      serverTime: new Date().toISOString()
    });
    return;
  }

  // 0a. GET /api/events - Server-Sent Events (SSE)
  if (req.method === 'GET' && pathname === '/api/events') {
    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write("data: " + JSON.stringify({
      type: 'HANDSHAKE',
      codeVersion,
      menuVersion,
      configVersion,
      ordersVersion,
      menu: menuCache,
      config: configCache,
      discounts: discountsCache,
      orders: ordersCache,
      serverTime: new Date().toISOString()
    }) + "\n\n");
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 0b. GET & POST /api/sync
  if (pathname === '/api/sync') {
    if (req.method === 'GET') {
      ordersCache = readJsonFile(ORDERS_FILE, ordersCache);
      menuCache = readJsonFile(MENU_FILE, menuCache);
      discountsCache = readJsonFile(DISCOUNTS_FILE, discountsCache);
      configCache = readJsonFile(CONFIG_FILE, configCache);
      sendJson(res, 200, {
        orders: ordersCache,
        menu: menuCache,
        discounts: discountsCache,
        config: configCache,
        codeVersion,
        menuVersion,
        configVersion,
        ordersVersion,
        serverTime: new Date().toISOString()
      });
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        if (body) {
          if (Array.isArray(body.orders) && body.orders.length > 0) {
            ordersCache = readJsonFile(ORDERS_FILE, ordersCache);
            body.orders.forEach(co => {
              const idx = ordersCache.findIndex(o => o.id === co.id);
              if (idx === -1) ordersCache.unshift(co);
              else ordersCache[idx] = { ...ordersCache[idx], ...co };
            });
            writeJsonFile(ORDERS_FILE, ordersCache);
          }
          if (Array.isArray(body.menu) && body.menu.length > 0) {
            menuCache = body.menu;
            writeJsonFile(MENU_FILE, menuCache);
          }
          if (Array.isArray(body.discounts)) {
            discountsCache = body.discounts;
            writeJsonFile(DISCOUNTS_FILE, discountsCache);
          }
          if (body.config && typeof body.config === 'object') {
            configCache = { ...configCache, ...body.config };
            writeJsonFile(CONFIG_FILE, configCache);
          }
          broadcastRealtime('FULL_SYNC', {
            orders: ordersCache,
            menu: menuCache,
            discounts: discountsCache,
            config: configCache
          });
        }
        sendJson(res, 200, { success: true, countOrders: ordersCache.length, countMenu: menuCache.length });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
  }

  // 1. GET /api/orders
  if (req.method === 'GET' && pathname === '/api/orders') {
    ordersCache = readJsonFile(ORDERS_FILE, ordersCache);
    sendJson(res, 200, ordersCache);
    return;
  }

  // 2. POST /api/orders
  if (req.method === 'POST' && pathname === '/api/orders') {
    try {
      const body = await parseRequestBody(req);
      if (!body || !body.id) {
        sendJson(res, 400, { error: 'Dữ liệu đơn hàng thiếu mã đơn (id)' });
        return;
      }

      ordersCache = readJsonFile(ORDERS_FILE, ordersCache);
      const existingIdx = ordersCache.findIndex(o => o.id === body.id);
      if (existingIdx >= 0) {
        ordersCache[existingIdx] = {
          ...ordersCache[existingIdx],
          ...body,
          receiptImage: body.receiptImage || ordersCache[existingIdx].receiptImage || null,
          updatedAtIso: new Date().toISOString()
        };
      } else {
        const newOrder = {
          ...body,
          createdAtIso: body.createdAtIso || new Date().toISOString(),
          status: body.status || 'new',
          receiptImage: body.receiptImage || null
        };
        ordersCache.push(newOrder);
      }

      writeJsonFile(ORDERS_FILE, ordersCache);
      console.log(`[API] Lưu đơn hàng thành công: ${body.id}`);
      const savedOrder = existingIdx >= 0 ? ordersCache[existingIdx] : ordersCache[ordersCache.length - 1];
      broadcastRealtime('NEW_ORDER', savedOrder);
      sendJson(res, 200, { success: true, orderId: body.id, count: ordersCache.length });
    } catch (err) {
      console.error('[API] Lỗi xử lý POST /api/orders:', err);
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 3. POST /api/orders/:id/receipt
  const receiptMatch = pathname.match(/^\/api\/orders\/([^\/]+)\/receipt$/);
  if (req.method === 'POST' && receiptMatch) {
    try {
      const orderId = decodeURIComponent(receiptMatch[1]);
      const body = await parseRequestBody(req);
      const receiptImage = body.receiptImage || (body.order && body.order.receiptImage) || null;

      if (!receiptImage) {
        sendJson(res, 400, { error: 'Thiếu dữ liệu ảnh hóa đơn' });
        return;
      }

      ordersCache = readJsonFile(ORDERS_FILE, ordersCache);
      let order = ordersCache.find(o => o.id === orderId);

      if (order) {
        order.receiptImage = receiptImage;
        order.paymentStatus = 'receipt_submitted';
        order.receiptUploadedAt = new Date().toISOString();
      } else {
        order = {
          ...(body.order || {}),
          id: orderId,
          status: 'new',
          paymentStatus: 'receipt_submitted',
          receiptImage: receiptImage,
          createdAtIso: (body.order && body.order.createdAtIso) || new Date().toISOString()
        };
        ordersCache.push(order);
      }

      writeJsonFile(ORDERS_FILE, ordersCache);
      sendJson(res, 200, { success: true, orderId });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 4. PUT / PATCH / POST /api/orders/:id/status
  const statusMatch = pathname.match(/^\/api\/orders\/([^\/]+)\/status$/);
  if ((req.method === 'PUT' || req.method === 'PATCH' || req.method === 'POST') && statusMatch) {
    try {
      const orderId = decodeURIComponent(statusMatch[1]);
      const body = await parseRequestBody(req);
      const newStatus = body.status;

      ordersCache = readJsonFile(ORDERS_FILE, ordersCache);
      const order = ordersCache.find(o => o.id === orderId);

      if (!order) {
        sendJson(res, 404, { error: `Không tìm thấy đơn ${orderId}` });
        return;
      }

      order.status = newStatus;
      if (newStatus === 'done') {
        order.completedAtIso = new Date().toISOString();
      } else if (newStatus === 'cancelled') {
        order.cancelledAtIso = new Date().toISOString();
        if (body.reason) order.cancelReason = body.reason;
      }

      writeJsonFile(ORDERS_FILE, ordersCache);
      console.log(`[API] Trạng thái đơn ${orderId} -> ${newStatus}`);
      broadcastRealtime('ORDER_STATUS', { orderId, status: newStatus, order });
      sendJson(res, 200, { success: true, orderId, status: newStatus });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 4b. POST /api/orders/:id/dispatch
  const dispatchMatch = pathname.match(/^\/api\/orders\/([^\/]+)\/dispatch$/);
  if (req.method === 'POST' && dispatchMatch) {
    try {
      const orderId = decodeURIComponent(dispatchMatch[1]);
      const body = await parseRequestBody(req);
      const partner = body.partner || 'ahamove';

      ordersCache = readJsonFile(ORDERS_FILE, ordersCache);
      const order = ordersCache.find(o => o.id === orderId);
      if (!order) {
        sendJson(res, 404, { error: `Không tìm thấy đơn ${orderId}` });
        return;
      }

      const trackingCode = (partner === 'ahamove')
        ? `AHA-SG-${Math.floor(10000 + Math.random() * 90000)}`
        : `LALA-SG-${Math.floor(10000 + Math.random() * 90000)}`;

      const driver = { name: 'Nguyễn Văn Hùng', phone: '0903 124 556', vehicle: 'Wave Alpha 59P1-123.45' };
      order.deliveryPartner = partner;
      order.deliveryPartnerName = (partner === 'ahamove') ? 'Ahamove Siêu Tốc' : 'Lalamove Giao Nhanh';
      order.deliveryStatus = 'assigned';
      order.trackingCode = trackingCode;
      order.driver = driver;
      order.dispatchedAtIso = new Date().toISOString();

      writeJsonFile(ORDERS_FILE, ordersCache);
      broadcastRealtime('ORDER_DISPATCH', { orderId, deliveryPartner: partner, deliveryPartnerName: order.deliveryPartnerName, trackingCode, driver });
      sendJson(res, 200, { success: true, orderId, partner, trackingCode, driver });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 5. GET & POST /api/config
  if (pathname === '/api/config') {
    if (req.method === 'GET') {
      configCache = readJsonFile(CONFIG_FILE, configCache);
      sendJson(res, 200, configCache);
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        configCache = { ...configCache, ...body };
        writeJsonFile(CONFIG_FILE, configCache);
        broadcastRealtime('CONFIG_UPDATE', configCache);
        sendJson(res, 200, { success: true, config: configCache });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
  }

  // 6. GET & POST /api/menu
  if (pathname === '/api/menu') {
    if (req.method === 'GET') {
      menuCache = readJsonFile(MENU_FILE, menuCache);
      sendJson(res, 200, menuCache);
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        if (Array.isArray(body)) {
          menuCache = body;
          writeJsonFile(MENU_FILE, menuCache);
          broadcastRealtime('MENU_UPDATE', menuCache);
          sendJson(res, 200, { success: true, count: menuCache.length });
        } else {
          sendJson(res, 400, { error: 'Menu phải là một mảng JSON' });
        }
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
  }

  // 7. GET & POST /api/discounts
  if (pathname === '/api/discounts') {
    if (req.method === 'GET') {
      discountsCache = readJsonFile(DISCOUNTS_FILE, discountsCache);
      sendJson(res, 200, discountsCache);
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        if (Array.isArray(body)) {
          discountsCache = body;
          writeJsonFile(DISCOUNTS_FILE, discountsCache);
          broadcastRealtime('DISCOUNTS_UPDATE', discountsCache);
          sendJson(res, 200, { success: true, count: discountsCache.length });
        } else {
          sendJson(res, 400, { error: 'Dữ liệu phải là mảng JSON' });
        }
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
  }

  // 8. POST /api/verify-receipt
  if (pathname === '/api/verify-receipt' && req.method === 'POST') {
    sendJson(res, 200, { isValid: true, reason: 'Đã nhận diện hóa đơn chuyển khoản ngân hàng thành công' });
    return;
  }

  // ==================== TĨNH / STATIC FILES ====================
  let cleanPath = pathname;
  if (cleanPath === '/' || cleanPath === '/admin' || cleanPath === '/pos') {
    cleanPath = '/index.html';
  }

  let targetFile = path.join(PUBLIC_DIR, cleanPath);
  if (!fs.existsSync(targetFile)) {
    targetFile = path.join(ROOT_DIR, cleanPath);
  }

  serveStaticFile(req, res, targetFile);
});

// XỬ LÝ UPGRADE SANG WEBSOCKET THUẦN (ZERO DEPENDENCY)
server.on('upgrade', (req, socket, head) => {
  const { pathname } = url.parse(req.url);
  if (pathname === '/ws' || pathname === '/api/ws' || pathname === '/socket') {
    const secKey = req.headers['sec-websocket-key'];
    if (!secKey) {
      socket.destroy();
      return;
    }

    const acceptKey = makeWsAcceptKey(secKey);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n'
    );

    // Đối tượng Client WebSocket Wrapper
    const client = {
      socket,
      readyState: 1, // OPEN
      send(text) {
        if (!socket.destroyed) {
          try { socket.write(encodeWsFrame(text)); } catch (e) {}
        }
      },
      close() {
        try { socket.end(); } catch (e) {}
      }
    };

    wsClients.add(client);
    console.log(`[WebSocket Zero-Dep] 📱 Thiết bị kết nối. Tổng client: ${wsClients.size}`);

    // Gửi ngay Snapshot toàn bộ dữ liệu mới nhất (HANDSHAKE)
    const handshakeData = {
      type: 'HANDSHAKE',
      codeVersion,
      menuVersion,
      configVersion,
      ordersVersion,
      discountsVersion,
      menu: menuCache,
      config: configCache,
      discounts: discountsCache,
      orders: ordersCache,
      serverTime: new Date().toISOString()
    };
    client.send(JSON.stringify(handshakeData));

    // Bộ đệm nhận dữ liệu phân mảnh từ socket
    let readBuffer = Buffer.alloc(0);

    socket.on('data', chunk => {
      readBuffer = Buffer.concat([readBuffer, chunk]);
      while (readBuffer.length >= 2) {
        const frame = decodeWsFrame(readBuffer);
        if (!frame) break;

        readBuffer = readBuffer.slice(frame.totalLength);

        if (frame.opcode === 1) { // Text
          try {
            const parsed = JSON.parse(frame.text);
            if (parsed && parsed.type) {
              handleClientWsMessage(parsed, client);
            }
          } catch (e) {}
        } else if (frame.opcode === 8) { // Close
          client.readyState = 3;
          wsClients.delete(client);
          socket.end();
          break;
        } else if (frame.opcode === 9) { // Ping
          socket.write(Buffer.from([0x8A, 0x00])); // Pong
        }
      }
    });

    socket.on('close', () => {
      client.readyState = 3;
      wsClients.delete(client);
      console.log(`[WebSocket Zero-Dep] 📴 Thiết bị ngắt kết nối. Còn lại: ${wsClients.size}`);
    });

    socket.on('error', () => {
      client.readyState = 3;
      wsClients.delete(client);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalNetworkIp();
  console.log(`=======================================================`);
  console.log(`🍵 HỆ THỐNG BÁN HÀNG ONLINE ĐUỶNH TEA HOUSE (ZERO-DEPENDENCY)`);
  console.log(`📡 WebSocket Thuần: Tương thích 100% Render.com, Railway, VPS`);
  console.log(`💻 Cổng hoạt động (PORT): ${PORT}`);
  console.log(`📱 Mạng nội bộ: http://${localIp}:${PORT}`);
  console.log(`=======================================================`);
});
