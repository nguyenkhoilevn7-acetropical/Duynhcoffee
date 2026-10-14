'use strict';
const crypto = require('node:crypto');
function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'D').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
function compareReceipt(text, amount, holder) {
  const lines = String(text || '').split(/\r?\n/).map(normalize).filter(Boolean);
  const name = normalize(holder);
  const recipientLabel = /(?:NGUOI (?:NHAN|THU HUONG|HUONG)|TEN (?:NGUOI NHAN|TAI KHOAN|THU HUONG)|CHU TAI KHOAN|BENEFICIARY|RECIPIENT|TO ACCOUNT)/;
  const stopLabel = /(?:NGUOI GUI|NGUOI CHUYEN|SENDER|FROM ACCOUNT|SO TIEN|AMOUNT|NOI DUNG|CONTENT|MA GIAO DICH|TRANSACTION)/;
  let recipientLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (!recipientLabel.test(lines[i])) continue;
    recipientLines.push(lines[i].replace(recipientLabel, '').trim());
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      if (stopLabel.test(lines[j])) break;
      recipientLines.push(lines[j]);
    }
  }
  // Require the complete ordered name in the recipient field, not scattered
  // tokens or the sender's name elsewhere in the receipt.
  const matchedRecipient = !!name && recipientLines.some(line => (' ' + line + ' ').includes(' ' + name + ' '));
  const rawLines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let moneyLines = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (/\b(?:SO TIEN|AMOUNT|TRANSFER AMOUNT)\b/.test(normalize(rawLines[i]))) {
      moneyLines.push(rawLines[i]);
      if (rawLines[i + 1] && !/\d/.test(rawLines[i])) moneyLines.push(rawLines[i + 1]);
    }
  }
  if (!moneyLines.length) moneyLines = rawLines.filter(s => /(?:VND|VNĐ|₫|đ|dong)(?:\s|$)/i.test(s));
  const detected = moneyLines.flatMap(line => (line.match(/\d+(?:(?:[.,]|[ \t])\d{3})*(?:[.,]00)?/g) || []).map(s => {
    // VND banks can display a trailing decimal .00 or ,00.
    const integer = s.replace(/[.,]00$/, '');
    return Number(integer.replace(/[^0-9]/g, ''));
  }));
  const matchedAmount = Number.isSafeInteger(amount) && amount > 0 && detected.includes(amount);
  return { isValid: matchedRecipient && matchedAmount, matchedRecipient, matchedAmount,
    matchedHolder: matchedRecipient ? holder : null, detectedAmount: matchedAmount ? amount : null,
    reason: !matchedRecipient ? 'Không đọc được đúng tên người nhận đã cấu hình trên biên lai.' : !matchedAmount ? 'Số tiền trên biên lai không khớp tiền nước cần thanh toán.' : '' };
}
function calculateAmount(items, menu, discounts, code) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('Giỏ hàng không hợp lệ');
  let total = 0;
  for (const entry of items) {
    const item = menu.find(m => String(m.id) === String(entry.id));
    if (!item || !Number.isInteger(entry.qty) || entry.qty < 1 || entry.qty > 100 || !Number.isSafeInteger(Number(item.price)) || Number(item.price) < 0) throw new Error('Món hoặc số lượng không hợp lệ');
    total += Number(item.price) * entry.qty;
  }
  if (code) {
    const discount = discounts.find(d => String(d.code).toUpperCase() === String(code).toUpperCase());
    if (!discount || (discount.active === false || discount.isActive === false) || !Number.isFinite(Number(discount.percent)) || discount.percent < 0 || discount.percent > 100) throw new Error('Mã giảm giá không còn hợp lệ');
    total -= Math.round(total * Number(discount.percent) / 100);
  }
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Số tiền không hợp lệ');
  return total;
}
function createReceiptVerifier({ readState, recognize, now = Date.now }) {
  const secret = crypto.randomBytes(32);
  let worker, busy = false;
  const hash = image => crypto.createHash('sha256').update(image).digest('hex');
  const sign = encoded => crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  async function ocr(image) {
    if (recognize) return recognize(image);
    const { createWorker } = require('tesseract.js');
    if (!worker) {
      // Ship language data through npm so the first receipt does not need a
      // runtime CDN download. Both languages must share one local langPath.
      const fs = require('node:fs'), path = require('node:path');
      const languageDir = path.join(require('node:os').tmpdir(), 'duynh-receipt-ocr');
      fs.mkdirSync(languageDir, { recursive: true });
      for (const language of ['eng', 'vie']) {
        const data = require('@tesseract.js-data/' + language);
        fs.copyFileSync(path.join(data.langPath, language + '.traineddata.gz'), path.join(languageDir, language + '.traineddata.gz'));
      }
      worker = await createWorker('eng+vie', 1, { langPath: languageDir, gzip: true, cacheMethod: 'none', errorHandler: () => {} });
    }
    const result = await worker.recognize(Buffer.from(image.split(',')[1], 'base64'));
    return result.data.text;
  }
  async function verify(body) {
    const image = body.image || body.receiptImage;
    if (typeof image !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 6 * 1024 * 1024) throw new Error('Hãy tải ảnh PNG, JPEG hoặc WebP dưới 4 MB');
    const state = readState();
    const amount = calculateAmount(body.items, state.menu, state.discounts, body.discountCode);
    const holder = state.config.bankConfig && state.config.bankConfig.accountHolder;
    if (!normalize(holder)) throw new Error('Chưa cấu hình tên người nhận');
    if (busy) throw new Error('Máy chủ đang đọc một biên lai khác. Vui lòng thử lại sau');
    busy = true;
    let timer;
    try {
      const text = await Promise.race([ocr(image), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Đọc ảnh quá lâu. Hãy thử ảnh rõ hơn')), 90000); })]);
      const result = compareReceipt(text, amount, holder);
      if (result.isValid) {
        const encoded = Buffer.from(JSON.stringify({ image: hash(image), amount, holder: normalize(holder), expires: now() + 15 * 60000 })).toString('base64url');
        result.verificationToken = encoded + '.' + sign(encoded);
      }
      return result;
    } catch (error) {
      if (worker) { await worker.terminate().catch(() => {}); worker = null; }
      throw new Error(recognize ? error.message : 'Không đọc được biên lai trên máy chủ. Vui lòng thử ảnh rõ nét hơn');
    } finally { clearTimeout(timer); busy = false; }
  }
  function assertVerified(order) {
    const parts = String(order.verificationToken || '').split('.');
    if (parts.length !== 2) throw new Error('Hóa đơn chưa được máy chủ xác minh');
    const expected = Buffer.from(sign(parts[0])), supplied = Buffer.from(parts[1]);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new Error('Xác minh hóa đơn không hợp lệ');
    const proof = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const state = readState();
    const amount = calculateAmount(order.items, state.menu, state.discounts, order.discount && order.discount.code);
    if (proof.expires < now() || proof.image !== hash(String(order.receiptImage || '')) || proof.amount !== amount || Number(order.total) !== amount || proof.holder !== normalize(state.config.bankConfig && state.config.bankConfig.accountHolder)) throw new Error('Giỏ hàng hoặc người nhận đã thay đổi. Vui lòng quét lại biên lai');
    return true;
  }
  return { verify, assertVerified };
}
module.exports = { normalize, compareReceipt, calculateAmount, createReceiptVerifier };
