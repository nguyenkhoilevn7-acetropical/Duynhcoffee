'use strict';
// Independent local prototype. Does not import or modify Mom's production server.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOST = process.env.AI_MANAGER_HOST || '127.0.0.1';
const PORT = Number(process.env.AI_MANAGER_PORT || 3107);
const API_KEY = process.env.XAI_API_KEY || '';
const MODEL = process.env.XAI_MODEL || 'grok-4.3';
const ACCESS_TOKEN = process.env.AI_MANAGER_ACCESS_TOKEN || '';
const MAX_BODY_BYTES = 8192;
const DEMO = Object.freeze({
  moms: { name: "Mom's Tea & Coffee", orders: 12, revenueVnd: 564000, pending: 3, scope: 'DỮ LIỆU MẪU - không phải đơn hàng thật' },
  satori: { name: 'Minh Satori', unpaidInvoices: 5, unpaidTotalVnd: 3450000, scope: 'DỮ LIỆU MẪU - không phải công nợ thật' }
});
function json(res, code, obj) {
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(obj));
}
function authorized(req) {
  if (!ACCESS_TOKEN) return HOST === '127.0.0.1' || HOST === '::1';
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(supplied), b = Buffer.from(ACCESS_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
function answerLocally(question, business) {
  const data = business === 'satori' ? DEMO.satori : DEMO.moms;
  if (business === 'satori') return 'Bản thử nghiệm Minh Satori: 5 hóa đơn chưa thanh toán, tổng công nợ 3.450.000đ. Đây là DỮ LIỆU MẪU, chưa kết nối hóa đơn thật. Em không thể đánh dấu thanh toán hoặc sửa công nợ.';
  return 'Bản thử nghiệm Mom\'s Tea & Coffee: 12 đơn, doanh thu 564.000đ, 3 đơn chờ xử lý. Đây là DỮ LIỆU MẪU, chưa kết nối website thật. Em không thể duyệt đơn hoặc thay đổi trạng thái.';
}
async function grokAnswer(message, business) {
  if (!API_KEY) return {reply:answerLocally(message,business), engine:'demo'};
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),12000);
  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions',{
      method:'POST',signal:controller.signal,
      headers:{'Authorization':'Bearer '+API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:MODEL,temperature:0.2,max_tokens:350,
        messages:[
          {role:'system',content:'Bạn là trợ lý kinh doanh tiếng Việt. Đang chạy CHẾ ĐỘ THỬ NGHIỆM CHỈ ĐỌC; KHÔNG truy cập hệ thống thật, KHÔNG dùng công cụ và KHÔNG thực hiện thay đổi. Tất cả số liệu gửi đến là DỮ LIỆU MẪU. Phải nói rõ đây là dữ liệu mẫu mỗi khi đề cập con số. Không bịa dữ liệu thật, không khẳng định đã thực hiện hành động. Khi người dùng yêu cầu thao tác như xóa hóa đơn, sửa công nợ, xác nhận thanh toán, duyệt đơn: từ chối thực hiện và giải thích chế độ demo.'},
          {role:'user',content:'Doanh nghiệp được chọn: '+(business==='satori'?'Minh Satori':"Mom's Tea & Coffee")+'. Dữ liệu mô phỏng: '+JSON.stringify(business==='satori'?DEMO.satori:DEMO.moms)+'\nYêu cầu: '+message}
        ]
      })
    });
    if(!response.ok) throw new Error('Grok API trả mã '+response.status);
    const output=await response.json();
    const reply=output?.choices?.[0]?.message?.content;
    if(typeof reply!=='string'||!reply.trim()) throw new Error('Grok không trả nội dung hợp lệ');
    return {reply,engine:'grok'};
  } finally { clearTimeout(timer); }
}
const file=path.join(__dirname,'index.html');
const server=http.createServer(async (req,res)=>{
  if(req.url==='/health'&&req.method==='GET') return json(res,200,{status:'ok',mode:'demo-read-only',grokConfigured:!!API_KEY});
  if(req.url==='/'&&req.method==='GET') {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
    return fs.createReadStream(file).pipe(res);
  }
  if(req.url==='/chat'&&req.method==='POST'){
    if(!authorized(req)) return json(res,401,{error:'Chưa được cấp quyền'});
    let raw='';
    try {
      for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>MAX_BODY_BYTES) return json(res,413,{error:'Nội dung quá lớn'});}
      const body=JSON.parse(raw);
      const message=String(body.message||'').trim();
      const business=body.business==='satori'?'satori':'moms';
      if(!message||message.length>1200) return json(res,400,{error:'Câu hỏi phải dài 1–1200 ký tự'});
      const result=await grokAnswer(message,business);
      return json(res,200,{...result,mode:'demo-read-only'});
    }catch(e){return json(res,502,{error:'Chưa thể trả lời: '+String(e.message||'lỗi').slice(0,140)});}
  }
  json(res,404,{error:'Không tìm thấy chức năng'});
});
server.listen(PORT,HOST,()=>console.log('AI Manager demo: http://'+HOST+':'+PORT+' (READ ONLY, SAMPLE DATA)'));
