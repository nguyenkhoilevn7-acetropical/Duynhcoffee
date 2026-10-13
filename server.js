/**
 * Đuỷnh Tea & Coffee - Production Cloud POS Server for Render.com
 * Tự động phục vụ Web (index.html, style.css) & Kênh Realtime WebSocket /ws
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'store_data.json');

let codeVersion = "v2.5.0";
let ordersVersion = Date.now();
let menuVersion = Date.now();
let configVersion = Date.now();
let discountsVersion = Date.now();

let orders = [
  {
    "id": "ORD-1001",
    "time": "09:30",
    "createdAtIso": "2026-10-11T09:30:00.000Z",
    "orderType": "delivery",
    "customerName": "Nguyễn Văn An",
    "phone": "0912 345 678",
    "deliveryAddress": "Tòa nhà Bitexco Financial, 2 Hải Triều, P. Bến Nghé, Quận 1, TP. Hồ Chí Minh",
    "distanceKm": 1.2,
    "deliveryPartner": "ahamove",
    "deliveryPartnerName": "Ahamove Siêu Tốc",
    "shippingFee": 18000,
    "beverageTotal": 90000,
    "total": 90000,
    "status": "new",
    "items": [{ "id": 1, "name": "Trà Mãng Cầu Đuỷnh (Signature)", "qty": 2, "price": 45000, "total": 90000, "custom": "Ít ngọt, nhiều đá" }]
  },
  {
    "id": "ORD-1002",
    "time": "09:42",
    "createdAtIso": "2026-10-11T09:42:00.000Z",
    "orderType": "delivery",
    "customerName": "Trần Mai Linh",
    "phone": "0988 123 456",
    "deliveryAddress": "65 Lê Lợi, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh",
    "distanceKm": 0.8,
    "deliveryPartner": "lalamove",
    "deliveryPartnerName": "Lalamove Giao Nhanh",
    "shippingFee": 16000,
    "beverageTotal": 74000,
    "total": 74000,
    "status": "new",
    "items": [
      { "id": 5, "name": "Cà Phê Muối Biển Đuỷnh", "qty": 1, "price": 39000, "total": 39000, "custom": "Bình thường" },
      { "id": 9, "name": "Bánh Croissant Bơ Tỏi Phô Mai", "qty": 1, "price": 35000, "total": 35000 }
    ]
  }
];

let menu = [
  { "id": 1, "name": "Trà Mãng Cầu Đuỷnh (Signature)", "category": "tea", "price": 45000, "description": "Mãng cầu xiêm tươi dầm nhuyễn, vị chua ngọt thanh mát hòa quyện cùng trà lài ủ lạnh.", "stock": 45, "isAvailable": true, "isBestSeller": true },
  { "id": 2, "name": "Trà Dâu Tằm Macchiato Đuỷnh", "category": "tea", "price": 49000, "description": "Dâu tằm Đà Lạt ngâm đường phèn tự nhiên, lớp kem macchiato béo mịn mặn nhẹ phía trên.", "stock": 38, "isAvailable": true, "isBestSeller": true },
  { "id": 3, "name": "Trà Đào Cam Sả Tươi", "category": "tea", "price": 42000, "description": "Trà đen hảo hạng nấu cùng sả tươi, cam vàng mọng nước và từng miếng đào giòn ngọt.", "stock": 60, "isAvailable": true, "isBestSeller": true },
  { "id": 4, "name": "Trà Ổi Hồng Hạt Chia", "category": "tea", "price": 45000, "description": "Nước ép ổi hồng thanh khiết, bổ sung hạt chia organic giàu dinh dưỡng và giải nhiệt.", "stock": 50, "isAvailable": true, "isBestSeller": false },
  { "id": 5, "name": "Cà Phê Muối Biển Đuỷnh", "category": "coffee", "price": 39000, "description": "Cà phê phin truyền thống đậm đà, hòa quyện cùng lớp kem muối biển béo ngậy độc quyền.", "stock": 80, "isAvailable": true, "isBestSeller": true },
  { "id": 6, "name": "Cà Phê Sữa Đá Sài Gòn", "category": "coffee", "price": 35000, "description": "Hạt cà phê Robusta Buôn Ma Thuột rang mộc pha phin, sữa đặc thơm béo chuẩn vị Sài Gòn.", "stock": 100, "isAvailable": true, "isBestSeller": false },
  { "id": 7, "name": "Bạc Xỉu Sữa Tươi 3 Tầng", "category": "coffee", "price": 38000, "description": "Ba tầng phân tầng hoàn hảo: sữa đặc, sữa tươi thanh trùng và lớp cà phê espresso sánh mịn.", "stock": 70, "isAvailable": true, "isBestSeller": false },
  { "id": 8, "name": "Cà Phê Đen Đá Pha Phin", "category": "coffee", "price": 32000, "description": "Nguyên chất 100% không tẩm ướp, hậu vị đắng thanh quyến rũ, tỉnh táo cả ngày dài.", "stock": 90, "isAvailable": true, "isBestSeller": false },
  { "id": 9, "name": "Bánh Croissant Bơ Tỏi Phô Mai", "category": "bakery", "price": 35000, "description": "Bánh sừng bò nướng giòn rụm với bơ Pháp, thơm lừng vị sốt tỏi và phô mai kéo sợi.", "stock": 25, "isAvailable": true, "isBestSeller": false },
  { "id": 10, "name": "Bánh Tiramisu Hộp Thiếc Đuỷnh", "category": "bakery", "price": 45000, "description": "Tiramisu truyền thống Ý với phô mai Mascarpone, lớp bột cacao đắng nhẹ và rượu rum thơm lừng.", "stock": 30, "isAvailable": true, "isBestSeller": false }
];

let discounts = [
  { "id": 1, "code": "DUYNH10", "percent": 10, "active": true, "description": "Giảm 10% tổng đơn hàng đầu tiên" },
  { "id": 2, "code": "FREESHIP", "percent": 20, "active": true, "description": "Giảm 20% hỗ trợ phí ship" }
];

let storeConfig = {
  storeName: "Đuỷnh Tea & Coffee",
  address: "Tòa Babylon 2, Chung Cư Thủ Thiêm, An Khánh, TP. Thủ Đức",
  hotline: "0988 776 655",
  openHours: "07:00 - 22:30 hàng ngày"
};

// Đọc và lưu trữ tệp dữ liệu cục bộ
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (Array.isArray(saved.orders)) orders = saved.orders;
      if (Array.isArray(saved.menu)) menu = saved.menu;
      if (Array.isArray(saved.discounts)) discounts = saved.discounts;
      if (saved.config) storeConfig = saved.config;
    }
  } catch(e) {}
}
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ orders, menu, discounts, config: storeConfig, ordersVersion, menuVersion, configVersion, discountsVersion }, null, 2), 'utf8');
  } catch(e) {}
}
loadData();
orders = orders.filter(o => o && o.id !== 'ORD-1006' && o.id !== '1006' && o.customerName !== 'Đỗ Minh Khang');
saveData();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', service: 'Duynh Cloud POS', uptime: process.uptime() }));
  }

  if (pathname === '/api/sync') {
    const q = parsedUrl.query;
    if (q.ov && parseInt(q.ov) === ordersVersion && q.mv && parseInt(q.mv) === menuVersion && q.cv && parseInt(q.cv) === configVersion && q.dv && parseInt(q.dv) === discountsVersion) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ notModified: true }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ orders, menu, discounts, config: storeConfig, codeVersion, ordersVersion, menuVersion, configVersion, discountsVersion }));
  }

  if (pathname === '/api/orders' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(orders));
  }

  if (pathname === '/api/orders' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const newOrder = JSON.parse(body);
        if (newOrder && newOrder.id) {
          orders.unshift(newOrder);
          ordersVersion = Date.now();
          saveData();
          broadcastWsEvent({ type: 'NEW_ORDER', order: newOrder, menuStock: menu });
        }
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'created', order: newOrder }));
      } catch(err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (pathname.startsWith('/api/orders/') && pathname.endsWith('/status') && req.method === 'PUT') {
    const orderId = pathname.split('/')[3];
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const updateData = JSON.parse(body);
        const order = orders.find(o => o.id === orderId || o.id === 'ORD-' + orderId || o.id.replace(/\D/g, '') === String(orderId).replace(/\D/g, ''));
        if (order) {
          if (updateData.status) order.status = updateData.status;
          if (updateData.reason) order.cancelReason = updateData.reason;
          if (updateData.status === 'done') order.completedAtIso = new Date().toISOString();
          if (updateData.status === 'cancelled') order.cancelledAtIso = new Date().toISOString();
          ordersVersion = Date.now();
          saveData();
          broadcastWsEvent({ type: 'ORDER_STATUS', orderId: order.id, status: order.status, cancelReason: order.cancelReason, menuStock: menu });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'updated', order }));
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Order not found' }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (pathname === '/api/menu' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(menu));
  }

  if (pathname === '/api/discounts') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(discounts));
  }

  if (pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(storeConfig));
  }

  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); return res.end('Forbidden'); }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    return fs.createReadStream(filePath).pipe(res);
  }

  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(indexPath).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// WEBSOCKET REALTIME ENGINE
let wsClients = new Set();
try {
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (url.parse(request.url).pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => { wss.emit('connection', ws, request); });
    } else { socket.destroy(); }
  });

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('message', (msg) => {
      try {
        const payload = JSON.parse(msg.toString());
        if (payload.type === 'PING') { ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() })); return; }
        if (payload.type === 'REQUEST_FULL_SYNC') {
          ws.send(JSON.stringify({ type: 'FULL_SYNC', data: { orders, menu, discounts, config: storeConfig, ordersVersion, menuVersion, configVersion, discountsVersion } }));
          return;
        }
        broadcastWsEvent(payload, ws);
      } catch(e) {}
    });
    ws.on('close', () => { wsClients.delete(ws); });
  });
} catch(e) {}

function broadcastWsEvent(envelope, excludeWs = null) {
  const messageStr = typeof envelope === 'string' ? envelope : JSON.stringify(envelope);
  wsClients.forEach((client) => {
    if (client !== excludeWs && client.readyState === 1) {
      try { client.send(messageStr); } catch(err) {}
    }
  });
}

server.listen(PORT, () => {
  console.log(`🚀 [Đuỷnh Cloud Server] Đang chạy tại cổng ${PORT}`);
});
