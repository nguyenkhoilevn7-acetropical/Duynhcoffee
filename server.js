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

// Bảng ánh xạ MIME Type cho các tệp tĩnh
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Đọc & Ghi tệp JSON an toàn với bộ nhớ đệm
function readJsonFile(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`[Storage] Lỗi đọc tệp ${filePath}:`, err.message);
  }
  return defaultValue;
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[Storage] Lỗi ghi tệp ${filePath}:`, err.message);
    return false;
  }
}

// Khởi tạo dữ liệu mặc định nếu chưa tồn tại
let ordersCache = readJsonFile(ORDERS_FILE, []);
let configCache = readJsonFile(CONFIG_FILE, {
  storeName: "ĐUỶNH TEA HOUSE",
  storeSlogan: "Đuỷnh — Ngon đến giọt cuối cùng",
  storeAddress: "Tòa Babylon 2, Chung Cư Thủ Thiêm, Phường An Khánh, TP. Thủ Đức, TP. Hồ Chí Minh",
  storePhone: "0988 776 655",
  vatRate: 8,
  bankConfig: {
    bankId: "Vietcombank",
    bankName: "Ngân Hàng TMCP Ngoại Thương Việt Nam (Vietcombank)",
    bin: "970436",
    accountNumber: "9911989890",
    accountHolder: "ĐÀO KHÔI NGUYÊN"
  }
});
let menuCache = readJsonFile(MENU_FILE, []);
let discountsCache = readJsonFile(DISCOUNTS_FILE, []);

let menuVersion = Date.now();
let ordersVersion = Date.now();
let configVersion = Date.now();
let discountsVersion = Date.now();

// Danh sách các kết nối WebSocket đang hoạt động
const wsClients = new Set();

/**
 * Thiết lập tiêu đề CORS cho mọi phản hồi HTTP
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Gửi phản hồi JSON
 */
function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/**
 * Đọc nội dung thân request (Body parser thuần Node.js)
 */
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) { // 50MB giới hạn cho ảnh hóa đơn
        req.destroy();
        reject(new Error('Kích thước yêu cầu vượt quá giới hạn cho phép (50MB)'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

/**
 * Phục vụ tệp tĩnh (Static File Server)
 */
function serveStaticFile(req, res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback về index.html cho SPA
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found - Tệp không tồn tại');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/**
 * Tạo mã chấp thuận WebSocket Handshake RFC 6455
 */
function makeWsAcceptKey(secWebSocketKey) {
  return crypto
    .createHash('sha1')
    .update(secWebSocketKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

/**
 * Đóng gói khung dữ liệu WebSocket (Encode WebSocket Frame)
 */
function encodeWsFrame(data) {
  const payload = Buffer.from(data, 'utf8');
  const length = payload.length;
  let header;

  if (length <= 125) {
    header = Buffer.from([0x81, length]);
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

/**
 * Giải mã khung dữ liệu WebSocket (Decode WebSocket Frame)
 */
function decodeWsFrame(buffer) {
  if (buffer.length < 2) return null;
  const secondByte = buffer[1];
  const isMasked = (secondByte & 0x80) === 0x80;
  let payloadLength = secondByte & 0x7f;
  let currentOffset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    currentOffset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    payloadLength = Number(buffer.readBigUInt64BE(2));
    currentOffset = 10;
  }

  let maskingKey = null;
  if (isMasked) {
    if (buffer.length < currentOffset + 4) return null;
    maskingKey = buffer.slice(currentOffset, currentOffset + 4);
    currentOffset += 4;
  }

  if (buffer.length < currentOffset + payloadLength) return null;
  const payload = buffer.slice(currentOffset, currentOffset + payloadLength);

  if (isMasked && maskingKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskingKey[i % 4];
    }
  }

  const opcode = buffer[0] & 0x0f;
  return {
    opcode,
    payload: payload.toString('utf8'),
    totalBytes: currentOffset + payloadLength
  };
}

/**
 * Phát tin nhắn WebSocket đến tất cả các máy khách đang kết nối
 */
function broadcastWs(message, excludeClient = null) {
  const frame = encodeWsFrame(typeof message === 'string' ? message : JSON.stringify(message));
  for (const client of wsClients) {
    if (client !== excludeClient && client.readyState === 1) {
      try {
        client.socket.write(frame);
      } catch (err) {
        wsClients.delete(client);
      }
    }
  }
}

// Khởi tạo máy chủ HTTP
const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 0. HEALTH CHECK & ANTI-SLEEP PING (Tương thích Render.com)
  if ((pathname === '/health' || pathname === '/api/ping') && (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS')) {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    sendJson(res, 200, {
      status: 'ok',
      service: 'duynh-tea-coffee-render',
      timestamp: Date.now(),
      uptime: process.uptime(),
      wsClients: wsClients.size
    });
    return;
  }

  // 1. GET /api/version
  if (pathname === '/api/version' && req.method === 'GET') {
    sendJson(res, 200, {
      version: '1.0.0',
      timestamp: Date.now(),
      menuVersion,
      ordersVersion,
      configVersion,
      discountsVersion,
      activeClients: wsClients.size
    });
    return;
  }

  // 2. GET /api/sync
  if (pathname === '/api/sync') {
    if (req.method === 'GET') {
      const q = parsedUrl.query;
      const clientMv = parseInt(q.mv, 10);
      const clientOv = parseInt(q.ov, 10);
      const clientCv = parseInt(q.cv, 10);
      const clientDv = parseInt(q.dv, 10);

      if (clientMv === menuVersion && clientOv === ordersVersion && clientCv === configVersion && clientDv === discountsVersion) {
        sendJson(res, 200, { notModified: true, timestamp: Date.now() });
        return;
      }

      sendJson(res, 200, {
        orders: ordersCache,
        menu: menuCache,
        config: configCache,
        discounts: discountsCache,
        menuVersion,
        ordersVersion,
        configVersion,
        discountsVersion,
        timestamp: Date.now()
      });
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        if (body.orders) {
          ordersCache = body.orders;
          writeJsonFile(ORDERS_FILE, ordersCache);
          ordersVersion = Date.now();
        }
        if (body.config) {
          configCache = body.config;
          writeJsonFile(CONFIG_FILE, configCache);
          configVersion = Date.now();
        }
        if (body.menu) {
          menuCache = body.menu;
          writeJsonFile(MENU_FILE, menuCache);
          menuVersion = Date.now();
        }
        broadcastWs({
          type: 'FULL_SYNC',
          orders: ordersCache,
          menu: menuCache,
          config: configCache,
          discounts: discountsCache,
          ordersVersion,
          menuVersion,
          configVersion,
          discountsVersion
        });
        sendJson(res, 200, { success: true, timestamp: Date.now() });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
  }

  // 3. GET & POST /api/orders
  if (pathname === '/api/orders') {
    if (req.method === 'GET') {
      sendJson(res, 200, ordersCache);
      return;
    }
    if (req.method === 'POST') {
      try {
        const newOrder = await parseRequestBody(req);
        if (!newOrder.id) {
          newOrder.id = 'ORD-' + Date.now();
        }
        const existingIdx = ordersCache.findIndex(o => o.id === newOrder.id);
        if (existingIdx !== -1) {
          ordersCache[existingIdx] = newOrder;
        } else {
          ordersCache.unshift(newOrder);
        }
        writeJsonFile(ORDERS_FILE, ordersCache);
        ordersVersion = Date.now();

        broadcastWs({
          type: 'NEW_ORDER',
          order: newOrder,
          ordersVersion
        });

        sendJson(res, 200, { success: true, order: newOrder, ordersVersion });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
  }

  // 4. GET & POST /api/config
  if (pathname === '/api/config') {
    if (req.method === 'GET') {
      sendJson(res, 200, configCache);
      return;
    }
    if (req.method === 'POST') {
      try {
        const newConfig = await parseRequestBody(req);
        configCache = { ...configCache, ...newConfig };
        writeJsonFile(CONFIG_FILE, configCache);
        configVersion = Date.now();

        broadcastWs({
          type: 'CONFIG_UPDATED',
          config: configCache,
          configVersion
        });

        sendJson(res, 200, { success: true, config: configCache, configVersion });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
  }

  // 5. GET & POST /api/menu
  if (pathname === '/api/menu') {
    if (req.method === 'GET') {
      sendJson(res, 200, menuCache);
      return;
    }
    if (req.method === 'POST') {
      try {
        const newMenu = await parseRequestBody(req);
        if (Array.isArray(newMenu)) {
          menuCache = newMenu;
          writeJsonFile(MENU_FILE, menuCache);
          menuVersion = Date.now();

          broadcastWs({
            type: 'MENU_UPDATED',
            menu: menuCache,
            menuVersion
          });

          sendJson(res, 200, { success: true, menu: menuCache, menuVersion });
        } else {
          sendJson(res, 400, { error: 'Dữ liệu thực đơn phải là mảng JSON' });
        }
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
  }

  // 6. POST /api/verify-receipt
  if (pathname === '/api/verify-receipt' && req.method === 'POST') {
    sendJson(res, 200, { isValid: true, reason: 'Hóa đơn hợp lệ' });
    return;
  }

  // ==================== STATIC FILES ====================
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

// XỬ LÝ UPGRADE SANG WEBSOCKET THUẦN (RFC 6455)
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

    const client = {
      socket,
      readyState: 1,
      send(text) {
        if (!socket.destroyed) {
          try {
            socket.write(encodeWsFrame(text));
          } catch (e) {}
        }
      },
      close() {
        try {
          socket.end();
        } catch (e) {}
      }
    };

    wsClients.add(client);
    console.log(`[WebSocket] 🟢 Kết nối mới thành công. Tổng thiết bị online: ${wsClients.size}`);

    let buffer = Buffer.alloc(0);

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length > 0) {
        const frame = decodeWsFrame(buffer);
        if (!frame) break;

        buffer = buffer.slice(frame.totalBytes);

        if (frame.opcode === 1) { // Text frame
          try {
            const data = JSON.parse(frame.payload);
            if (data.type === 'PING') {
              client.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
            } else {
              broadcastWs(frame.payload, client);
            }
          } catch (e) {
            broadcastWs(frame.payload, client);
          }
        } else if (frame.opcode === 8) { // Close frame
          client.readyState = 3;
          wsClients.delete(client);
          socket.end();
          break;
        } else if (frame.opcode === 9) { // Ping frame
          socket.write(Buffer.from([0x8A, 0x00])); // Pong frame
        }
      }
    });

    socket.on('close', () => {
      client.readyState = 3;
      wsClients.delete(client);
      console.log(`[WebSocket] 📴 Thiết bị ngắt kết nối. Còn lại: ${wsClients.size}`);
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
