/**
 * ============================================================================
 * ĐUỶNH TEA & COFFEE - MÁY CHỦ BÁN HÀNG & POS THỜI GIAN THỰC (NODE.JS SERVER)
 * ============================================================================
 * Phiên bản: 1.0.0 (Triển khai Render Web Service & Localhost)
 * Thiết kế: Zero-Dependency (100% thuần Node.js tiêu chuẩn, không cần npm install).
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Cấu hình cổng mạng (Render tự động cấp PORT qua biến môi trường)
const PORT = process.env.PORT || 3000;
const DATA_DIR = __dirname;
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const CONFIG_FILE = path.join(DATA_DIR, 'store_config.json');

// Khởi tạo tệp lưu trữ đơn hàng ban đầu nếu chưa tồn tại
if (!fs.existsSync(ORDERS_FILE)) {
  const initialOrders = [
    {
      id: "ORD-1001",
      time: "09:30",
      table: "Bàn 01 (Tầng trệt)",
      phone: "0988776655",
      note: "Ít đường, nhiều đá",
      paymentMethod: "vietqr",
      paymentMethodName: "Chuyển khoản VietQR (Napas 24/7)",
      paymentStatus: "paid",
      paymentRef: "TXN-882101",
      items: [
        { id: 1, name: "Cà phê Sữa Đá Sài Gòn", qty: 2, price: 35000, total: 70000 }
      ],
      subtotal: 70000,
      vat: 5600,
      total: 75600,
      status: "prep"
    }
  ];
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(initialOrders, null, 2), 'utf8');
  } catch (e) {
    console.error('Không thể tạo orders.json:', e.message);
  }
}

// Khởi tạo cấu hình mặc định của quán
if (!fs.existsSync(CONFIG_FILE)) {
  const initialConfig = {
    name: "ĐUỶNH TEA & COFFEE",
    slogan: "Ngon đến giọt cuối cùng",
    address: "TP. Hồ Chí Minh",
    phone: "0988 776 655",
    vatRate: 8,
    footer: "Đuỷnh Tea & Coffee - Ngon đến giọt cuối cùng! Cảm ơn Quý khách & Hẹn gặp lại!",
    bankId: "MB",
    bankName: "MBBank (Ngân hàng Quân Đội)",
    bankAccount: "0988776655",
    bankAccountName: "DUYNH TEA COFFEE"
  };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('Không thể tạo store_config.json:', e.message);
  }
}

// Danh sách các kết nối Server-Sent Events (SSE) đang hoạt động
let sseClients = [];

// Phát thông báo thời gian thực tới tất cả máy khách đang kết nối
function broadcastSSE(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try {
      res.write(message);
    } catch (err) {
      // Bỏ qua lỗi kết nối máy khách đã đóng
    }
  });
}

// Hàm đọc danh sách đơn hàng từ tệp JSON có bảo vệ chống lỗi
function readOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const content = fs.readFileSync(ORDERS_FILE, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (err) {
    console.error('Lỗi khi đọc tệp orders.json:', err.message);
  }
  return [];
}

// Hàm lưu danh sách đơn hàng an toàn
function writeOrders(orders) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Lỗi khi ghi tệp orders.json:', err.message);
    return false;
  }
}

// Bảng tra cứu định dạng MIME của các tệp tĩnh
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
  '.ico': 'image/x-icon'
};

// Khởi tạo máy chủ HTTP
const server = http.createServer((req, res) => {
  // Thiết lập CORS Headers cho phép kết nối chéo miền an toàn
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  // Phản hồi yêu cầu kiểm tra quyền truy cập (OPTIONS)
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. Endpoint kiểm tra trạng thái hoạt động (Health Check)
  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', service: 'duynh-tea-coffee', time: new Date().toISOString() }));
    return;
  }

  // 2. Kênh phát thông báo đơn hàng tức thì qua Server-Sent Events (SSE)
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('retry: 5000\n\n');
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // 3. API lấy danh sách đơn hàng: GET /api/orders
  if (pathname === '/api/orders' && req.method === 'GET') {
    const orders = readOrders();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(orders));
    return;
  }

  // 4. API tạo hoặc cập nhật đơn hàng: POST /api/orders
  if (pathname === '/api/orders' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const orderData = JSON.parse(body);
        if (!orderData || !orderData.id) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Đơn hàng không hợp lệ (thiếu trường id)' }));
          return;
        }

        const orders = readOrders();
        const existingIdx = orders.findIndex(o => o.id === orderData.id);
        if (existingIdx !== -1) {
          orders[existingIdx] = { ...orders[existingIdx], ...orderData };
        } else {
          orders.unshift(orderData);
        }

        writeOrders(orders);
        broadcastSSE({ type: 'ORDER_UPDATE', order: orderData });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, order: orderData }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Lỗi xử lý dữ liệu: ' + err.message }));
      }
    });
    return;
  }

  // 5. API cập nhật trạng thái đơn hàng: PUT /api/orders/:id
  if (pathname.startsWith('/api/orders/') && req.method === 'PUT') {
    const orderId = pathname.replace('/api/orders/', '');
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const updateData = JSON.parse(body);
        const orders = readOrders();
        const idx = orders.findIndex(o => o.id === orderId);
        if (idx === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Không tìm thấy đơn hàng' }));
          return;
        }
        orders[idx] = { ...orders[idx], ...updateData };
        writeOrders(orders);
        broadcastSSE({ type: 'ORDER_STATUS_CHANGED', order: orders[idx] });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, order: orders[idx] }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Lỗi cập nhật: ' + err.message }));
      }
    });
    return;
  }

  // 6. API dọn dẹp đơn hàng đã hủy: DELETE /api/orders/cancelled
  if (pathname === '/api/orders/cancelled' && req.method === 'DELETE') {
    const orders = readOrders();
    const remaining = orders.filter(o => o.status !== 'cancelled');
    writeOrders(remaining);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, count: remaining.length }));
    return;
  }

  // 7. API lấy và cập nhật thông tin quán: /api/config
  if (pathname === '/api/config') {
    if (req.method === 'GET') {
      let cfg = {};
      try {
        if (fs.existsSync(CONFIG_FILE)) {
          cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
      } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(cfg));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const newCfg = JSON.parse(body);
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(newCfg, null, 2), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, config: newCfg }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // 8. Phục vụ tệp tĩnh (Single Page Application routing)
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  let filePath = path.join(DATA_DIR, relativePath);

  fs.stat(filePath, (err, stats) => {
    // Nếu đường dẫn không tồn tại tệp vật lý, tự động chuyển về index.html
    if (err || !stats.isFile()) {
      filePath = path.join(DATA_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Lỗi máy chủ: ' + readErr.message);
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

// Bắt đầu lắng nghe yêu cầu mạng
server.listen(PORT, () => {
  console.log('================================================================');
  console.log(`☕ ĐUỶNH TEA & COFFEE Server đang hoạt động trên cổng: ${PORT}`);
  console.log(`👉 Đường dẫn truy cập nội bộ: http://localhost:${PORT}`);
  console.log('================================================================');
});
