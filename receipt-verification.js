'use strict';
const crypto = require('node:crypto');
const {getOptions}=require('./menu-options');
function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'D').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
function compareReceipt(text, amount, holder) {
  const successLabel = /^(?:GIAO DICH|CHUYEN TIEN|CHUYEN KHOAN|THANH TOAN) THANH CONG\b|^(?:TRANSFER SUCCESSFUL|SUCCESSFUL TRANSFER|PAYMENT SUCCESSFUL)\b/;
  const allRows = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const successAt = allRows.findIndex(row => successLabel.test(normalize(row)));
  // Locate payment evidence inside its own receipt, never in surrounding
  // checkout instructions or a second transaction shown in the same image.
  const rawRows = successAt >= 0 ? allRows.slice(successAt) : allRows;
  const secondSuccess = rawRows.findIndex((row,i) => i > 0 && successLabel.test(normalize(row)));
  const rows = secondSuccess >= 0 ? rawRows.slice(0,secondSuccess) : rawRows;
  const lines = rows.map(normalize);
  const name = normalize(holder);
  const recipientLabel = /^(?:THONG TIN NGUOI (?:NHAN|THU HUONG)|TEN (?:NGUOI )?(?:THU HUONG|NHAN|HUONG)|TEN CHU TAI KHOAN|TEN TAI KHOAN|CHU TAI KHOAN|NGUOI (?:THU HUONG|NHAN|HUONG)|TAI KHOAN (?:THU HUONG|NHAN)|TK (?:THU HUONG|NHAN)|BENEFICIARY NAME|RECIPIENT NAME|BENEFICIARY|RECIPIENT|TO ACCOUNT|DEN TAI KHOAN)\b/;
  const senderLabel = /^(?:THONG TIN NGUOI (?:GUI|CHUYEN)|NGUOI (?:GUI|CHUYEN)|TAI KHOAN (?:NGUON|TRICH NO)|TK TRICH NO|NGUON TIEN|TU TAI KHOAN|FROM ACCOUNT|SENDER)\b/;
  const otherField = /^(?:SO (?:THE|TK|TAI KHOAN|DU|TIEN)|NGAN HANG|TIN NHAN|LUU|NOI DUNG|NGUOI GUI|BANK|ACCOUNT|AMOUNT|SENDER|CONTENT|PHI|MA GIAO DICH|THOI GIAN)\b/;
  const personName = field => /^[A-Z]{2,}(?: [A-Z]{2,}){1,6}$/.test(field) && !otherField.test(field);
  let inSender = false;
  const recipientFields = [];
  for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    if (senderLabel.test(line)) { inSender=true; continue; }
    if (!recipientLabel.test(line)) continue;
    const genericOwner = /^(?:CHU TAI KHOAN|TEN (?:CHU )?TAI KHOAN)\b/.test(line);
    if (inSender && genericOwner) continue;
    inSender=false;
    const inline=line.replace(recipientLabel,'').trim();
    if (inline && !/^\d[\d ]*$/.test(inline)) {
      if (!otherField.test(inline)) recipientFields.push(inline);
      continue;
    }
    // Account-number rows may precede the name in bank recipient cards.
    for (let j=i+1;j<Math.min(lines.length,i+4);j++) {
      if (/^\d[\d ]*$/.test(lines[j])) continue;
      if (senderLabel.test(lines[j]) || otherField.test(lines[j]) || recipientLabel.test(lines[j])) break;
      if (personName(lines[j])) recipientFields.push(lines[j]);
      break;
    }
  }
  const numberPattern = '\\d+(?:(?:[.,]|[ \\t])\\d{3})*(?:[.,]00)?';
  const currencyPattern = new RegExp('^(' + numberPattern + ')\\s*(?:VND|VNĐ|₫|đ|d|dong)\\s*[^\\p{L}\\p{N}]*$', 'iu');
  const barePattern = new RegExp('^(' + numberPattern + ')\\s*[^\\p{L}\\p{N}]*$', 'u');
  const clean = row => row.replace(/\u00a0|\u202f/g,' ').replace(/(\d)\s*([.,])\s*(?=\d)/g,'$1$2').replace(/^[:：]\s*/,'').trim();
  const parseMoney = (row,allowBare=false) => {
    const match=clean(row).match(currencyPattern) || (allowBare && clean(row).match(barePattern));
    if (!match) return null;
    const value=Number(match[1].replace(/[.,]00$/,'').replace(/[^0-9]/g,''));
    return Number.isSafeInteger(value) && value>0 ? value : null;
  };
  const amountLabel = /^(?:SO TIEN(?: (?:CHUYEN|GIAO DICH|THANH TOAN))?|TONG TIEN THANH TOAN|TRANSFER AMOUNT|TRANSACTION AMOUNT|AMOUNT)\b/;
  const metadata = /^(?:MA GIAO DICH|MA THAM CHIEU|THOI GIAN|NGAY|NOI DUNG|TIN NHAN|PHI|SO DU|TRANSACTION ID|REFERENCE|DATE|TIME|CONTENT|FEE|BALANCE)\b/;
  const payments = [], totals = [];
  for (let i=0;i<rows.length;i++) {
    if (!amountLabel.test(lines[i]) || /\b(?:PHI|GIAM GIA|FEE|DISCOUNT)\b/.test(lines[i])) continue;
    const rawValue=rows[i].normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'D').toUpperCase()
      .replace(amountLabel,'').replace(/^\s*(?:\((?:VND|D|₫)\))?\s*[:：]?\s*/,'');
    let value=parseMoney(rawValue,true),index=i;
    if (value===null && rows[i+1] && !metadata.test(lines[i+1])) { value=parseMoney(rows[i+1],true);index=i+1; }
    if (value!==null) (/^TONG TIEN/.test(lines[i]) ? totals : payments).push({index,value});
  }
  if (!payments.length) payments.push(...totals);
  if (!payments.length && successAt>=0) {
    for (let i=1;i<Math.min(rows.length,11);i++) {
      if (metadata.test(lines[i]) || (i>1 && metadata.test(lines[i-1]) && !/\d/.test(rows[i-1]))) continue;
      let value=parseMoney(rows[i]),index=i;
      if (value===null && /^(?:VND|D|₫)$/.test(lines[i+1]||'')) { value=parseMoney(rows[i]+' '+rows[i+1]);index=i+1; }
      if (value===null && /[.,]\d{3}/.test(clean(rows[i]))) value=parseMoney(rows[i],true);
      if (value!==null) { payments.push({index,value});break; }
    }
  }
  if (!payments.length && successAt<0) {
    for (let i=0;i<rows.length;i++) {
      if (metadata.test(lines[i]) || otherField.test(lines[i])) continue;
      const value=parseMoney(rows[i]);
      if (value!==null) payments.push({index:i,value});
    }
  }
  // ZaloPay-style recipient card: amount, alphabetic name, adjacent bank row.
  // Bank/account details locate the card; they are not extra match criteria.
  if (!recipientFields.length && payments.length===1 && successAt>=0) {
    const i=payments[0].index;
    if (personName(lines[i+1]||'') && /^(?:NGAN HANG|BANK)\b/.test(lines[i+2]||'')) recipientFields.push(lines[i+1]);
  }
  const names=recipientFields.filter(field => personName(field));
  const conflictingNames=new Set(names).size>1;
  const matchedRecipient = !conflictingNames && !!name && recipientFields.some(field => field===name);
  const recipientReadable=names.length>0 && !conflictingNames;
  const amounts=[...new Set(payments.map(p=>p.value))];
  const amountReadable=amounts.length===1;
  const matchedAmount=Number.isSafeInteger(amount) && amount>0 && amountReadable && amounts[0]===amount;
  return { isValid:matchedRecipient&&matchedAmount,matchedRecipient,matchedAmount,recipientReadable,amountReadable,
    matchedHolder:matchedRecipient?holder:null,detectedAmount:amountReadable?amounts[0]:null,
    reason:!matchedRecipient?(recipientReadable?'Tên người nhận trên biên lai không khớp tên đã cấu hình.':'Chưa đọc rõ tên trong vùng người nhận trên biên lai.'):
      !matchedAmount?(amountReadable?'Số tiền trên biên lai không khớp tiền nước cần thanh toán.':'Chưa đọc rõ số tiền giao dịch trên biên lai. Hãy tải ảnh gốc rõ nét hơn.') : '' };
}

// This triage never approves a payment. It only avoids repeated OCR on
// clearly unrelated documents; ambiguous/photographed receipts retain fallback.
function classifyReceiptText(text) {
  const rows=String(text || '').split(/\r?\n/).map(normalize).filter(Boolean);
  const whole=rows.join(' ');
  const success=/\b(?:GIAO DICH|CHUYEN TIEN|CHUYEN KHOAN|THANH TOAN) THANH CONG\b|\b(?:TRANSFER SUCCESSFUL|SUCCESSFUL TRANSFER|PAYMENT SUCCESSFUL)\b/.test(whole);
  const recipient=rows.some(row=>/^(?:TEN (?:NGUOI )?(?:NHAN|THU HUONG)|NGUOI (?:NHAN|THU HUONG)|RECIPIENT|BENEFICIARY)\b/.test(row));
  const bank=/(?:VIETCOMBANK|VCB DIGIBANK|SACOMBANK|TECHCOMBANK|MBBANK|BIDV|VIETINBANK|ZALOPAY|MOMO|NGAN HANG|BANK)\b/.test(whole);
  const transfer=rows.some(row=>/^(?:MA GIAO DICH|THOI GIAN (?:GIAO DICH|THANH TOAN)|TAI KHOAN NHAN|SO TIEN (?:CHUYEN|GIAO DICH)|TRANSACTION ID|TRANSFER AMOUNT)\b/.test(row));
  if(success || recipient || transfer || bank) return 'possible_receipt';
  if (/THANH TOAN DON HANG/.test(whole) && /CHUA XAC MINH DUOC/.test(whole) && /CHAM DE DOI ANH|VUI LONG QUET LAI/.test(whole)) return 'unrelated';
  const menuSignals=[/\bCOFFEE\b/,/\bTEA\b/,/\bCART\b/,/\bBUY NOW\b/,/\bADD\b/,/\bMENU\b/,/\bGIO HANG\b/,/\bMUA NGAY\b/,/\bCA PHE\b/,/\bTOPPING\b/,/\bTHANH TOAN DON HANG\b/].filter(pattern=>pattern.test(whole)).length;
  return menuSignals>=3 ? 'unrelated' : 'unclear';
}
function shouldRetryOcr(comparison, confidence) {
  if (comparison.isValid) return false;
  // A readable mismatch is already a decision. Reread only uncertain fields,
  // regardless of whether the first decision would approve or reject.
  const readable = (comparison.matchedRecipient || comparison.recipientReadable) && (comparison.matchedAmount || comparison.amountReadable);
  return !readable || !Number.isFinite(confidence) || confidence < 70;
}
function unitPrice(entry,item) {
  const options=getOptions(item);
  const available=new Map(options.toppings.map(t=>[t.id,t]));
  const toppings=entry.toppings===undefined?[]:entry.toppings;
  if(!Array.isArray(toppings)||toppings.length>available.size)throw new Error('Topping không hợp lệ');
  let extras=0;const seen=new Set();
  for(const topping of toppings){
    const id=topping&&typeof topping==='object'?(topping.id||topping.name):'';
    const option=available.get(id);
    if(!option||seen.has(id))throw new Error('Topping không hợp lệ hoặc không còn bán cho món này');
    seen.add(id);extras+=option.price;
  }
  return Number(item.price)+extras;
}
function calculateAmount(items, menu, discounts, code) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('Giỏ hàng không hợp lệ');
  let total = 0;
  for (const entry of items) {
    const item = menu.find(m => String(m.id) === String(entry.id));
    if (!item || !Number.isInteger(entry.qty) || entry.qty < 1 || entry.qty > 100 || !Number.isSafeInteger(Number(item.price)) || Number(item.price) < 0) throw new Error('Món hoặc số lượng không hợp lệ');
    total += unitPrice(entry,item) * entry.qty;
  }
  if (code) {
    const discount = discounts.find(d => String(d.code).toUpperCase() === String(code).toUpperCase());
    if (!discount || (discount.active === false || discount.isActive === false) || !Number.isFinite(Number(discount.percent)) || discount.percent < 0 || discount.percent > 100) throw new Error('Mã giảm giá không còn hợp lệ');
    total -= Math.round(total * Number(discount.percent) / 100);
  }
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Số tiền không hợp lệ');
  return total;
}
function createReceiptVerifier({ readState, recognize, now = Date.now, deadlineMs = 45000, cacheOcr = !recognize }) {
  const secret = crypto.randomBytes(32);
  const readings = new Map(); // Text only, bounded and short-lived; never cache approval or payment totals.
  let worker, workerReady, resetReady, busy = false, workerGeneration = 0;
  let activeProgress = null, progressBase = 5, progressSpan = 0;
  const progress = (percent,phase) => { if(activeProgress) activeProgress({percent,phase}); };
  const hash = image => crypto.createHash('sha256').update(image).digest('hex');
  const sign = encoded => crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  async function warmup() {
    if (recognize) return;
    if (workerReady) return workerReady;
    const generation = workerGeneration;
    workerReady = (async () => {
    const { createWorker } = require('tesseract.js');
      // Ship language data through npm so the first receipt does not need a
      // runtime CDN download. Both languages must share one local langPath.
      const fs = require('node:fs'), path = require('node:path');
      const languageDir = path.join(require('node:os').tmpdir(), 'duynh-receipt-ocr');
      fs.mkdirSync(languageDir, { recursive: true });
      for (const language of ['eng', 'vie']) {
        const data = require('@tesseract.js-data/' + language);
        // Integer models are bundled in the existing packages and much smaller
        // than the floating-point models used by default.
        const source = language === 'vie' ? path.join(__dirname, 'ocr-data', 'vie.traineddata.gz') : path.join(data.langPath + '_best_int', language + '.traineddata.gz');
        fs.copyFileSync(source, path.join(languageDir, language + '.traineddata.gz'));
      }
      const initialized = await createWorker('vie', 1, { langPath: languageDir, gzip: true, cacheMethod: 'none', logger: event => { if (generation === workerGeneration && event.status === 'recognizing text' && Number.isFinite(event.progress)) progress(progressBase + Math.round(event.progress * progressSpan), 'recognizing'); }, errorHandler: () => {} });
      if (generation !== workerGeneration) { await initialized.terminate(); throw new Error('OCR initialization cancelled'); }
      worker = initialized;
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
    })().catch(error => { if (generation === workerGeneration) workerReady = null; throw error; });
    return workerReady;
  }
  async function ocr(image, amount, holder) {
    if (recognize) return { text: await recognize(image), passes: 1 };
    if (resetReady) await resetReady;
    await warmup();
    const activeWorker = worker;
    progress(8,'preparing');
    const textOnly = { text:true, blocks:false, hocr:false, tsv:false, box:false, unlv:false, osd:false, pdf:false };
    const { prepareReceipt } = require('./receipt-image');
    const prepared = prepareReceipt(Buffer.from(image.split(',')[1], 'base64'), image.match(/^data:image\/(\w+)/)[1]);
    await activeWorker.setParameters({ tessedit_pageseg_mode: '6' });
    // A small first look can identify a menu/page without decoding it three times.
    // Never use this low-resolution screening result to approve a receipt.
    const screening = prepared.screening;
    if (screening) {
      progressBase=10; progressSpan=20;
      const peek=await activeWorker.recognize(screening,{},textOnly);
      if (classifyReceiptText(peek.data.text)==='unrelated') return {text:peek.data.text,passes:1,nonReceipt:true};
    }
    progressBase=screening ? 30 : 10; progressSpan=screening ? 40 : 60;
    // Keep full-resolution field rows on screenshots; normalize shadows on photos.
    const first = await activeWorker.recognize(prepared.cleaned, {}, textOnly);
    const comparison = compareReceipt(first.data.text, amount, holder);
    const kind = classifyReceiptText(first.data.text);
    if (kind==='unrelated') return {text:first.data.text,passes:1,nonReceipt:true};
    // No payment cues after a complete first read: stop rather than spend two
    // more passes on photos/blank images. An enclosed photographed screen keeps
    // its original crop fallback for glare and low light.
    if (!comparison.isValid && kind==='unclear' && !comparison.recipientReadable && !prepared.photo) return {text:first.data.text,passes:1,unreadable:true};
    if (!shouldRetryOcr(comparison, first.data.confidence)) return { text: first.data.text, passes: 1 };
    // Sparse-text mode tolerates photographed screens and separated bank fields.
    // Each pass is compared as one complete receipt; never join matching fields
    // from different passes or infer missing text from the expected recipient.
    progress(72,'rereading');
    await activeWorker.reinitialize('eng+vie', 1);
    progressBase=72; progressSpan=13;
    try {
      await activeWorker.setParameters({ tessedit_pageseg_mode: '11' });
      const fallback = await activeWorker.recognize(prepared.photo || prepared.original, {}, textOnly);
      const next=compareReceipt(fallback.data.text,amount,holder);
      if(next.isValid || !shouldRetryOcr(next,fallback.data.confidence))return {text:fallback.data.text,passes:2};
      // Retain unfiltered color text when glare/lighting normalization is unhelpful.
      await activeWorker.setParameters({ tessedit_pageseg_mode: '6' });
      progressBase=85; progressSpan=10;
      const last=await activeWorker.recognize(prepared.original, {}, textOnly);
      const candidates=[{text:first.data.text,passes:1,result:comparison},{text:fallback.data.text,passes:2,result:next},
        {text:last.data.text,passes:3,result:compareReceipt(last.data.text,amount,holder)}];
      const score=x=>Number(x.result.recipientReadable)+Number(x.result.amountReadable);
      candidates.sort((a,b)=>score(b)-score(a));
      return {text:candidates[0].text,passes:3};
    } finally {
      // Restore the exact first-pass model in the background. Next OCR waits for
      // it; the current result does not wait for model initialization again.
      const generation = workerGeneration;
      resetReady = activeWorker.reinitialize('vie', 1).catch(() => {
        if (generation === workerGeneration && worker === activeWorker) { worker = null; workerReady = null; }
        activeWorker.terminate().catch(() => {});
      });
    }
  }
  async function verify(body, onProgress) {
    const image = body.image || body.receiptImage;
    if (typeof image !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 6 * 1024 * 1024) throw new Error('Hãy tải ảnh PNG, JPEG hoặc WebP dưới 4 MB');
    const state = readState();
    const amount = calculateAmount(body.items, state.menu, state.discounts, body.discountCode);
    if (body.payableAmount !== undefined && body.payableAmount !== amount) throw new Error('Tổng tiền giỏ hàng chưa khớp giá món và topping trên máy chủ. Vui lòng tải lại trang và quét lại biên lai');
    const holder = state.config.bankConfig && state.config.bankConfig.accountHolder;
    if (!normalize(holder)) throw new Error('Chưa cấu hình tên người nhận');
    if (busy) throw new Error('Máy chủ đang đọc một biên lai khác. Vui lòng thử lại sau');
    busy = true;
    activeProgress = typeof onProgress === 'function' ? onProgress : null;
    progress(5,'starting');
    let timer;
    const processingStarted = Date.now();
    try {
      const imageKey = hash(image);
      for (const [key, entry] of readings) if (now() - entry.at >= 120000) readings.delete(key);
      const cached = cacheOcr && readings.get(imageKey);
      const text = cached ? { text: cached.text, passes: 0 } : await Promise.race([ocr(image, amount, holder), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Máy chủ chưa đọc xong biên lai. Chưa thể kết luận số tiền hoặc tên người nhận sai; vui lòng thử lại.')), deadlineMs); })]);
      progress(97,'comparing');
      const result = compareReceipt(text.text, amount, holder);
      if (text.nonReceipt || text.unreadable) {
        result.isValid=false;
        result.nonReceipt=!!text.nonReceipt;
        result.unreadable=!!text.unreadable;
        result.reason=text.nonReceipt ? 'Ảnh này không phải biên lai chuyển khoản ngân hàng. Vui lòng tải ảnh giao dịch thành công.' : 'Chưa đọc được thông tin chuyển khoản trong ảnh. Hãy tải biên lai ngân hàng rõ nét hơn.';
      }
      if (cacheOcr && !text.nonReceipt && !text.unreadable && result.recipientReadable && result.amountReadable && !cached) {
        if (readings.size >= 8) readings.delete(readings.keys().next().value);
        readings.set(imageKey, {text: text.text, at: now()});
      }
      result.expectedAmount = amount;
      result.ocrPasses = text.passes;
      result.processingMs = Date.now() - processingStarted;
      if (result.isValid) {
        const encoded = Buffer.from(JSON.stringify({ image: hash(image), amount, holder: normalize(holder), expires: now() + 15 * 60000 })).toString('base64url');
        result.verificationToken = encoded + '.' + sign(encoded);
      }
      return result;
    } catch (error) {
      workerGeneration++;
      workerReady = null;
      if (worker) { const oldWorker = worker; worker = null; oldWorker.terminate().catch(() => {}); }
      throw new Error(recognize || error.message.includes('chưa đọc xong') ? error.message : 'Không đọc được biên lai trên máy chủ. Vui lòng thử ảnh rõ nét hơn');
    } finally { clearTimeout(timer); activeProgress = null; busy = false; }
  }
  function assertVerified(order) {
    const parts = String(order.verificationToken || '').split('.');
    if (parts.length !== 2) throw new Error('Hóa đơn chưa được máy chủ xác minh');
    const expected = Buffer.from(sign(parts[0])), supplied = Buffer.from(parts[1]);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new Error('Xác minh hóa đơn không hợp lệ');
    const proof = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const state = readState();
    const amount = calculateAmount(order.items, state.menu, state.discounts, order.discount && order.discount.code);
    for (const entry of order.items) {
      const price=unitPrice(entry,state.menu.find(m=>String(m.id)===String(entry.id)));
      if ((entry.price!==undefined && Number(entry.price)!==price) || (entry.total!==undefined && Number(entry.total)!==price*entry.qty)) throw new Error('Giá món hoặc topping đã thay đổi. Vui lòng kiểm tra giỏ hàng và quét lại biên lai');
    }
    if (proof.expires < now() || proof.image !== hash(String(order.receiptImage || '')) || proof.amount !== amount || Number(order.total) !== amount || proof.holder !== normalize(state.config.bankConfig && state.config.bankConfig.accountHolder)) throw new Error('Giỏ hàng hoặc người nhận đã thay đổi. Vui lòng quét lại biên lai');
    return true;
  }
  function requestKey(body) {
    const image = body.image || body.receiptImage;
    if (typeof image !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 6 * 1024 * 1024) throw new Error('Hãy tải ảnh PNG, JPEG hoặc WebP dưới 4 MB');
    const state = readState();
    const amount = calculateAmount(body.items, state.menu, state.discounts, body.discountCode);
    if (body.payableAmount !== undefined && body.payableAmount !== amount) throw new Error('Tổng tiền giỏ hàng chưa khớp giá món và topping trên máy chủ. Vui lòng tải lại trang và quét lại biên lai');
    const holder = normalize(state.config.bankConfig && state.config.bankConfig.accountHolder);
    if (!holder) throw new Error('Chưa cấu hình tên người nhận');
    return hash(image + ':' + amount + ':' + holder);
  }
  return { verify, assertVerified, warmup, requestKey };
}
module.exports = { normalize, compareReceipt, calculateAmount, createReceiptVerifier, shouldRetryOcr, classifyReceiptText };
