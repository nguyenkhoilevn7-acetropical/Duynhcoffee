// ============================================================================
// HỆ THỐNG MÁY CHỦ BÁN HÀNG & POS ĐUỶNH TEA & COFFEE ("Ngon Đến Giọt Cuối Cùng")
// Kiến trúc: Node.js Thuần Zero-Dependency (Tương thích 100% Render.com)
// Hỗ trợ: Static Server, REST API Đơn Hàng & Menu, AI OCR Webhook, WebSocket Real-time
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

// Danh sách tài xế đối tác giao hàng (Ahamove / Lalamove)
const SHIPPERS_POOL = [
  {
    name: 'Nguyễn Văn Tuấn',
    phone: '0907123456',
    plate: '59-T1 839.24',
    vehicleModel: 'Honda Wave Alpha 110',
    vehicleColor: 'Đỏ Đen',
    rating: '5.0 ⭐ (1.280 chuyến)',
    provider: 'Ahamove'
  },
  {
    name: 'Trần Minh Hoàng',
    phone: '0938567890',
    plate: '59-S2 945.18',
    vehicleModel: 'Yamaha Sirius Fi',
    vehicleColor: 'Trắng Bạc',
    rating: '4.9 ⭐ (950 chuyến)',
    provider: 'Lalamove'
  },
  {
    name: 'Lê Quốc Bảo',
    phone: '0912349876',
    plate: '59-X3 712.56',
    vehicleModel: 'Honda Vision',
    vehicleColor: 'Xanh Đen',
    rating: '5.0 ⭐ (1.520 chuyến)',
    provider: 'Ahamove'
  },
  {
    name: 'Phạm Đức Trọng',
    phone: '0978901234',
    plate: '59-P1 654.89',
    vehicleModel: 'Honda Future 125',
    vehicleColor: 'Đen Nhám',
    rating: '4.9 ⭐ (840 chuyến)',
    provider: 'Lalamove'
  }
];

// Danh sách sản phẩm thực đơn ban đầu
let products = [
  {
    id: 'p1',
    name: 'Trà Mãng Cầu Đuỷnh (Signature)',
    category: 'tea',
    price: 45000,
    desc: 'Mãng cầu xiêm tươi dầm nhuyễn, kết hợp cốt trà lài thơm ngát đặc trưng.',
    img: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&auto=format&fit=crop&q=80',
    signature: true
  },
  {
    id: 'p2',
    name: 'Trà Dâu Tươi Đuỷnh',
    category: 'tea',
    price: 42000,
    desc: 'Dâu tây Đà Lạt ngâm đường phèn, vị chua ngọt thanh mát giải nhiệt.',
    img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&auto=format&fit=crop&q=80',
    signature: false
  },
  {
    id: 'p3',
    name: 'Trà Đào Cam Sả Hoàng Gia',
    category: 'tea',
    price: 45000,
    desc: 'Hương sả tươi thanh khiết hòa quyện cùng cam vàng và đào giòn.',
    img: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=500&auto=format&fit=crop&q=80',
    signature: false
  },
  {
    id: 'p4',
    name: 'Trà Sữa Oolong Nướng Trân Châu',
    category: 'milk-tea',
    price: 48000,
    desc: 'Vị trà Oolong nướng đậm đà, kem béo ngậy kèm trân châu hoàng kim dai giòn.',
    img: 'https://images.unsplash.com/photo-1558857563-b37fe78a9c58?w=500&auto=format&fit=crop&q=80',
    signature: true
  },
  {
    id: 'p5',
    name: 'Cà Phê Muối Đuỷnh Béo Ngậy',
    category: 'coffee',
    price: 35000,
    desc: 'Cà phê Robusta mộc pha phin truyền thống phủ lớp kem muối béo mặn cuốn hút.',
    img: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500&auto=format&fit=crop&q=80',
    signature: true
  },
  {
    id: 'p6',
    name: 'Bạc Xỉu Kem Trứng Cháy',
    category: 'coffee',
    price: 38000,
    desc: 'Nhiều sữa ít cà phê, bồng bềnh lớp kem trứng nướng thơm lừng.',
    img: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=500&auto=format&fit=crop&q=80',
    signature: false
  },
  {
    id: 'p7',
    name: 'Cà Phê Sữa Đá Sài Gòn',
    category: 'coffee',
    price: 29000,
    desc: 'Đậm vị Robusta cao nguyên, sữa đặc béo ngậy chuẩn gu Sài Gòn xưa.',
    img: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=500&auto=format&fit=crop&q=80',
    signature: false
  },
  {
    id: 'p8',
    name: 'Trà Trái Cây Nhiệt Đới Đuỷnh',
    category: 'tea',
    price: 45000,
    desc: 'Tổng hợp chanh dây, dưa hấu, táo, ổi hồng tươi mát thanh lọc cơ thể.',
    img: 'https://images.unsplash.com/photo-1497534446932-c925b458314e?w=500&auto=format&fit=crop&q=80',
    signature: false
  }
];

// Bộ nhớ lưu trữ đơn hàng trong phiên làm việc
let orders = [];

// Quản lý kết nối WebSocket Client
const wsClients = new Set();

// Tạo mã vận đơn ngẫu nhiên
function generateTrackingCode(prefix) {
  const p = prefix || 'AHA';
  return p + '-' + Math.floor(100000 + Math.random() * 900000);
}

// Gán tài xế ngẫu nhiên cho đơn hàng
function assignRandomShipper(partner) {
  const p = partner || 'Ahamove';
  const filtered = SHIPPERS_POOL.filter(s => s.provider.toLowerCase() === p.toLowerCase());
  const pool = filtered.length > 0 ? filtered : SHIPPERS_POOL;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return {
    name: chosen.name,
    phone: chosen.phone,
    plate: chosen.plate,
    vehicleModel: chosen.vehicleModel,
    vehicleColor: chosen.vehicleColor,
    rating: chosen.rating,
    provider: chosen.provider,
    trackingCode: generateTrackingCode(chosen.provider === 'Ahamove' ? 'AHA' : 'LALA'),
    assignedAt: new Date().toISOString()
  };
}

// Khởi tạo một số đơn hàng mẫu để giao diện POS & Theo dõi luôn sinh động
function initSampleOrders() {
  orders = [
    {
      id: 'ORD-1001',
      customerName: 'Anh Khôi',
      customerPhone: '0909123456',
      address: 'Chung cư Sala Sarimi, 74 Nguyễn Cơ Thạch, P. An Lợi Đông, TP. Thủ Đức',
      distanceKm: 2.1,
      items: [
        { name: 'Trà Mãng Cầu Đuỷnh (Signature)', qty: 2, price: 45000, ice: '100% Đá', sugar: '70% Đường' },
        { name: 'Cà Phê Muối Đuỷnh Béo Ngậy', qty: 1, price: 35000, ice: '100% Đá', sugar: '100% Đường' }
      ],
      totalAmount: 125000,
      deliveryFee: 16000,
      partner: 'Ahamove',
      status: 'done',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      deliveredAt: new Date(Date.now() - 1800000).toISOString(),
      driver: {
        name: 'Trần Minh Hoàng',
        phone: '0938567890',
        plate: '59-S2 945.18',
        vehicleModel: 'Yamaha Sirius Fi',
        vehicleColor: 'Trắng Bạc',
        rating: '4.9 ⭐ (950 chuyến)',
        provider: 'Lalamove',
        trackingCode: 'LALA-945180'
      }
    },
    {
      id: 'ORD-1002',
      customerName: 'Chị Mị',
      customerPhone: '0707176669',
      address: '96/41 Tôn Đản, Phường 10, Quận 4, TP. Hồ Chí Minh',
      distanceKm: 4.5,
      items: [
        { name: 'Trà Mãng Cầu Đuỷnh (Signature)', qty: 1, price: 45000, ice: '100% Đá', sugar: '100% Đường' }
      ],
      totalAmount: 45000,
      deliveryFee: 22000,
      partner: 'Ahamove',
      status: 'shipping',
      createdAt: new Date(Date.now() - 1200000).toISOString(),
      driver: {
        name: 'Nguyễn Văn Tuấn',
        phone: '0907123456',
        plate: '59-T1 839.24',
        vehicleModel: 'Honda Wave Alpha 110',
        vehicleColor: 'Đỏ Đen',
        rating: '5.0 ⭐ (1.280 chuyến)',
        provider: 'Ahamove',
        trackingCode: 'AHA-839241'
      }
    }
  ];
}

initSampleOrders();

// Hàm phát sóng dữ liệu WebSocket đến mọi client
function broadcast(messageObj) {
  const payload = Buffer.from(JSON.stringify(messageObj));
  const frame = encodeWebSocketFrame(payload);
  for (const client of wsClients) {
    try {
      if (client.writable) {
        client.write(frame);
      }
    } catch (e) {
      wsClients.delete(client);
    }
  }
}

// Mã hóa WebSocket Frame (RFC 6455)
function encodeWebSocketFrame(data) {
  const length = data.length;
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
  return Buffer.concat([header, data]);
}

// Giải mã WebSocket Frame (RFC 6455)
function decodeWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;
  const isFinal = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const isMasked = (buffer[1] & 0x80) !== 0;
  let payloadLength = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  if (opcode === 0x08) return { type: 'close' };
  if (opcode === 0x09) return { type: 'ping' };
  if (opcode === 0x0A) return { type: 'pong' };

  let maskKey = null;
  if (isMasked) {
    if (buffer.length < offset + 4) return null;
    maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLength) return null;
  const payload = buffer.slice(offset, offset + payloadLength);
  if (isMasked && maskKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  return { type: 'text', data: payload.toString('utf8') };
}

// Xử lý Request HTTP
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. API: Kiểm tra trạng thái máy chủ
  if (req.method === 'GET' && pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString(), totalOrders: orders.length }));
  }

  // 2. API: Lấy danh sách sản phẩm (Menu)
  if (req.method === 'GET' && pathname === '/api/products') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, products }));
  }

  // 3. API: Thêm món mới vào Menu (Hỗ trợ upload ảnh từ điện thoại)
  if (req.method === 'POST' && pathname === '/api/products') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const item = JSON.parse(body);
        if (!item.name || !item.price) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Thiếu tên món hoặc giá tiền' }));
        }

        const newProduct = {
          id: 'p_' + Date.now(),
          name: item.name.trim(),
          category: item.category || 'tea',
          price: parseInt(item.price, 10) || 40000,
          desc: item.desc ? item.desc.trim() : 'Món mới thơm ngon tại Đuỷnh Tea & Coffee',
          img: item.img || 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&auto=format&fit=crop&q=80',
          signature: !!item.signature
        };

        products.unshift(newProduct);
        broadcast({ type: 'MENU_UPDATED', products });

        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, product: newProduct, products }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Dữ liệu sản phẩm không hợp lệ' }));
      }
    });
    return;
  }

  // 4. API: Xóa món khỏi Menu
  const deleteProductMatch = pathname.match(/^\/api\/products\/([^\/]+)$/);
  if (req.method === 'DELETE' && deleteProductMatch) {
    const prodId = deleteProductMatch[1];
    products = products.filter(p => p.id !== prodId);
    broadcast({ type: 'MENU_UPDATED', products });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, message: 'Đã xóa món khỏi thực đơn' }));
  }

  // 5. API: Lấy danh sách đơn hàng
  if (req.method === 'GET' && pathname === '/api/orders') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, orders }));
  }

  // 6. API: Tạo đơn hàng mới (Kích hoạt âm thanh nổ đơn trên các thiết bị)
  if (req.method === 'POST' && pathname === '/api/orders') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const orderData = JSON.parse(body);
        const newId = 'ORD-' + (1000 + orders.length + 1);
        const newOrder = {
          id: orderData.id || newId,
          customerName: orderData.customerName || 'Khách hàng',
          customerPhone: orderData.customerPhone || '',
          address: orderData.address || '',
          distanceKm: orderData.distanceKm || 0,
          items: orderData.items || [],
          totalAmount: orderData.totalAmount || 0,
          deliveryFee: orderData.deliveryFee || 0,
          partner: orderData.partner || 'Ahamove',
          receiptImage: orderData.receiptImage || null,
          status: 'new', // Khởi đầu là đơn mới
          createdAt: new Date().toISOString()
        };
        orders.unshift(newOrder);

        // Phát sóng nổ đơn mới qua WebSocket
        broadcast({ type: 'NEW_ORDER', order: newOrder });

        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, order: newOrder }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Dữ liệu đơn hàng không hợp lệ' }));
      }
    });
    return;
  }

  // 7. API: Cập nhật trạng thái đơn hàng (Quản trị viên / Barista)
  const updateStatusMatch = pathname.match(/^\/api\/orders\/([^\/]+)\/status$/);
  if (req.method === 'PUT' && updateStatusMatch) {
    const orderId = updateStatusMatch[1];
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { status, partner } = JSON.parse(body);
        const orderIndex = orders.findIndex(o => o.id === orderId);
        if (orderIndex === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Không tìm thấy đơn hàng' }));
        }

        const targetOrder = orders[orderIndex];

        // Nếu chuyển sang trạng thái shipping (Đã bàn giao shipper) -> Gán tài xế đầy đủ thông tin
        if (status === 'shipping' && !targetOrder.driver) {
          targetOrder.driver = assignRandomShipper(partner || targetOrder.partner || 'Ahamove');
        }

        // Cập nhật trạng thái
        targetOrder.status = status;
        if (status === 'done') {
          targetOrder.deliveredAt = new Date().toISOString();
        }

        orders[orderIndex] = targetOrder;
        broadcast({ type: 'ORDER_UPDATED', order: targetOrder });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, order: targetOrder }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Dữ liệu cập nhật lỗi' }));
      }
    });
    return;
  }

  // 8. API: Webhook cập nhật từ hệ thống đối tác Shipper (Ahamove / Lalamove)
  const webhookDeliveryMatch = pathname.match(/^\/api\/orders\/([^\/]+)\/delivery-status$/);
  if (req.method === 'POST' && webhookDeliveryMatch) {
    const orderId = webhookDeliveryMatch[1];
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const orderIndex = orders.findIndex(o => o.id === orderId);
        if (orderIndex === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Không tìm thấy đơn hàng' }));
        }

        const targetOrder = orders[orderIndex];
        // Khi shipper bấm Hoàn Thành trên app của họ
        targetOrder.status = 'done';
        targetOrder.deliveredAt = payload.deliveredAt || new Date().toISOString();
        if (payload.driver) {
          targetOrder.driver = { ...targetOrder.driver, ...payload.driver };
        }

        orders[orderIndex] = targetOrder;
        broadcast({ type: 'DELIVERY_COMPLETED', order: targetOrder });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, order: targetOrder, message: 'Đã xác nhận giao hàng thành công từ Shipper' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Lỗi xử lý webhook' }));
      }
    });
    return;
  }

  // 9. API: Kiểm duyệt hóa đơn AI (Dự phòng Server-side)
  if (req.method === 'POST' && pathname === '/api/verify-receipt') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { ocrText, expectedAmount } = JSON.parse(body);
        const norm = (ocrText || '').toUpperCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const hasBeneficiary = norm.includes('DAO KHOI NGUYEN') || norm.includes('KHOI NGUYEN') || norm.includes('9911989890');
        const amountRegex = new RegExp(expectedAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '[.,]?') + '|' + expectedAmount);
        const hasAmount = amountRegex.test(ocrText || '');

        if (!hasBeneficiary) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ isValid: false, reason: 'Tên người thụ hưởng không khớp ĐÀO KHÔI NGUYÊN (STK: 9911989890)' }));
        }

        if (!hasAmount) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ isValid: false, reason: 'Số tiền không khớp ' + expectedAmount + 'đ' }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ isValid: true, reason: 'Hóa đơn hợp lệ 100%' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ isValid: false, reason: 'Dữ liệu phân tích lỗi' }));
      }
    });
    return;
  }

  // 10. Phục vụ Static Files (index.html, logo, css...)
  let safePath = pathname === '/' ? '/index.html' : pathname;
  safePath = path.normalize(safePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback về index.html cho SPA
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('404 Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(content);
      });
      return;
    }

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

// Nâng cấp giao thức WebSocket thuần RFC 6455
server.on('upgrade', (req, socket, head) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  const hash = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + hash
  ];

  socket.write(headers.join('\r\n') + '\r\n\r\n');
  wsClients.add(socket);

  // Gửi danh sách đơn hàng & sản phẩm ban đầu
  const initMsg = Buffer.from(JSON.stringify({ type: 'INIT_DATA', orders, products }));
  socket.write(encodeWebSocketFrame(initMsg));

  socket.on('data', buffer => {
    const frame = decodeWebSocketFrame(buffer);
    if (!frame) return;
    if (frame.type === 'close') {
      wsClients.delete(socket);
      socket.end();
    } else if (frame.type === 'ping') {
      socket.write(Buffer.from([0x8A, 0x00])); // Pong
    }
  });

  socket.on('close', () => {
    wsClients.delete(socket);
  });

  socket.on('error', () => {
    wsClients.delete(socket);
  });
});

server.listen(PORT, () => {
  console.log(`🍵 ĐUỶNH TEA & COFFEE SERVER ĐANG CHẠY TRÊN PORT ${PORT}`);
});
