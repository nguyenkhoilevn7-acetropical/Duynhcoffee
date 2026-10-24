/* Authenticated finance workspace. Costs stay outside public menu/config synchronization. */
(() => {
 'use strict';
 const el=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const en=()=>document.documentElement.lang==='en';
 const t=(vi,english)=>en()?english:vi;
 const amount=v=>v===null||v===undefined?t('Chưa đủ chi phí','Costs incomplete'):new Intl.NumberFormat(en()?'en-US':'vi-VN',{maximumFractionDigits:0}).format(v)+' đ';
 const count=v=>new Intl.NumberFormat(en()?'en-US':'vi-VN').format(v);
 let version='',dirty=false,busy=false,loaded=false,serial=0,currentReport=null,lastLanguage='',polling=false;
 function today(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
 function visible(){return el('tab-profits')?.classList.contains('active') && (typeof isUserAdmin!=='function'||isUserAdmin());}
 function message(text,error=false){const box=el('profit-message');if(box){box.textContent=text;box.classList.toggle('profit-error',error);}}
 async function request(path,options={}){
  const token=localStorage.getItem('duynh_admin_api_token')||localStorage.getItem('duynh_admin_push_token')||'';
  const response=await fetch(getCloudApiUrl('/api/admin/profits'+path),{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(!response.ok){let data;try{data=await response.json();}catch{}throw new Error(data?.error||t('Không tải được báo cáo. Vui lòng thử lại.','Unable to load the report. Please retry.'));}
  return response;
 }
 function init(){
  if(el('profit-date'))return;
  const root=el('tab-profits');if(!root)return;
  root.setAttribute('translate','no');root.setAttribute('data-i18n-preserve','');
  root.innerHTML=`<section class="profit-workspace" aria-labelledby="profit-title"><div class="profit-heading"><div><p class="profit-eyebrow">MOM’S TEA & COFFEE</p><h2 id="profit-title">${t('Doanh thu & Lợi nhuận','Sales & Profit')}</h2></div><div class="profit-toolbar"><label for="profit-date">${t('Ngày báo cáo · giờ Việt Nam','Report date · Vietnam time')}<input id="profit-date" type="date" value="${today()}" required></label><button type="button" id="profit-refresh">${t('Làm mới','Refresh')}</button><button type="button" id="profit-export" class="profit-primary" disabled>${t('Xuất Excel','Export Excel')}</button></div></div><p id="profit-message" role="status" aria-live="polite"></p><div id="profit-totals" class="profit-totals"></div><p class="profit-explanation">${t('Doanh thu và lời chỉ cộng đơn hoàn tất trong ngày. Đơn hủy tính theo ngày hủy; đơn mới nhận tính theo ngày đặt. Phí ship được tách riêng.','Sales and profit include orders completed on this date. Cancellations use the cancellation date; received orders use the order date. Shipping is separate.')}</p><div id="profit-report"></div><section class="profit-cost-section" aria-labelledby="profit-cost-title"><div class="profit-section-heading"><div><h3 id="profit-cost-title">${t('Tỷ lệ chi phí dự phòng từng món','Fallback cost percentage by item')}</h3><p>${t('Nhập 25 nghĩa là chi phí 25%. Món 50.000đ → chi phí 12.500đ → lời 37.500đ nếu không giảm giá.','Enter 25 for a 25% cost. A 50,000đ drink costs 12,500đ and earns 37,500đ before discounts.')}</p></div><button type="button" id="profit-save" class="profit-primary" disabled>${t('Lưu tỷ lệ chi phí','Save cost percentages')}</button></div><p class="profit-note">${t('Tỷ lệ tính trên giá dòng món trước giảm giá, gồm topping đã cộng vào giá. Lần nhập đầu áp dụng cho cả đơn cũ; lần sửa sau chỉ áp dụng đơn đặt từ lúc lưu. Để trống nếu chưa biết; nhập 0 chỉ khi chi phí thực sự bằng 0.','The percentage applies to the full item price before discounts, including toppings already in that price. First entry also covers legacy orders; later changes apply to orders placed after saving. Leave unknown costs blank; enter 0 only for a true zero cost.')}</p><div id="profit-costs" class="profit-costs"></div><p id="profit-save-message" role="status" aria-live="polite"></p></section><p class="profit-note">${t('Giá vốn tự tính khi công thức và giá nhập khớp đủ; nếu chưa đủ thì dùng tỷ lệ chi phí đã nhập. Chi phí nhân công, thuê mặt bằng, thuế và phí khác không được trừ.','Recipe-based costs apply when fully matched; otherwise the configured percentage is used. Payroll, rent, tax and other overhead are not deducted.')}</p></section>`;
  el('profit-date').onchange=()=>refresh(false);
  el('profit-refresh').onclick=async()=>{if(dirty&&!confirm(t('Tải lại sẽ bỏ tỷ lệ chưa lưu. Tiếp tục?','Reloading will discard unsaved percentages. Continue?')))return;dirty=false;await refresh(true);};
  el('profit-export').onclick=download;
  el('profit-save').onclick=save;
  el('profit-costs').addEventListener('input',()=>{dirty=true;el('profit-save').disabled=false;el('profit-save-message').textContent=t('Có thay đổi chưa lưu.','Unsaved changes.');});
  lastLanguage=document.documentElement.lang;
 }
 function totals(s){
  const cards=[['Đơn mới nhận','Orders received',count(s.received)],['Đã hoàn tất','Completed',count(s.completed)],['Bill đã hủy','Cancelled bills',count(s.cancelled)],['Doanh thu tiền món','Beverage sales',amount(s.revenue)],['Chi phí ước tính','Estimated cost',amount(s.cost)],['Lợi nhuận ước tính','Estimated profit',amount(s.profit)],['Biên lợi nhuận','Profit margin',s.profit===null||s.revenue<=0?'—':(s.profit/s.revenue*100).toFixed(1)+'%']];
  el('profit-totals').innerHTML=cards.map(([vi,english,value],i)=>`<div class="profit-stat ${i===5?'profit-stat-emphasis':''}"><span>${t(vi,english)}</span><strong>${esc(value)}</strong></div>`).join('');
 }
 function table(headers,rows,empty){return `<div class="profit-table-wrap"><table><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`;}
 const statuses=()=>({new:t('Đơn mới','New'),prep:t('Đang pha','Preparing'),shipping:t('Đang giao','Delivering'),done:t('Hoàn tất','Completed'),cancelled:t('Đã hủy','Cancelled')});
 function render(report){
  currentReport=report;totals(report.summary);const s=report.summary;
  const warnings=[t('Giá vốn công thức tính theo giá nhập hiện tại trong Inventory (ước tính), không phải giá vốn lịch sử đã chốt. Phí ship, nhân công, mặt bằng và thuế chưa trừ.','Recipe costs use current Inventory prices (estimates), not locked historical costs. Shipping, payroll, rent and taxes are not deducted.'),s.missingOrders?t(`${s.missingOrders} đơn hoàn tất chưa đủ chi phí hoặc dữ liệu hợp lệ. Tổng lời để trống đến khi đủ dữ liệu.`,`${s.missingOrders} completed orders have missing costs or invalid data. Total profit remains blank until complete.`):'',s.legacyDateOrders?t(`${s.legacyDateOrders} đơn cũ thiếu ngày hoàn tất/hủy: tạm dùng ngày đặt đơn.`,`${s.legacyDateOrders} legacy orders have no completion/cancellation timestamp; the order date is used.`):''].filter(Boolean);
  const rows=report.items.map(m=>`<tr><td>${esc(m.name)}</td><td>${count(m.qty)}</td><td>${esc(amount(m.revenue))}</td><td>${esc(amount(m.cost))}</td><td>${esc(amount(m.unitProfit))}</td><td>${esc(amount(m.profit))}</td></tr>`);
  const orderRows=report.orders.map(o=>`<tr><td><details><summary>${esc(o.id)}</summary>${o.lines.length?`<ul class="profit-order-items">${o.lines.map(l=>`<li><strong>${esc(l.name)} × ${esc(l.qty)}</strong><span>${t('Doanh thu','Sales')}: ${esc(amount(l.revenue))}</span><span>${t('Chi phí','Cost')}: ${esc(amount(l.cost))} · ${l.costSource==='recipe'?t('Tự tính từ công thức','Recipe-based'):l.costSource==='percentage'?t('Tỷ lệ dự phòng','Percentage fallback'):'—'}</span><span>${t('Lời','Profit')}: ${esc(amount(l.profit))}</span></li>`).join('')}</ul>`:`<p>${t('Đơn chưa ghi nhận doanh thu.','Sales have not been recognized for this order.')}</p>`}</details></td><td><span class="profit-status profit-status-${esc(['new','prep','shipping','done','cancelled'].includes(o.status)?o.status:'new')}">${esc(statuses()[o.status]||o.status)}</span></td><td>${esc(amount(o.amount))}</td><td>${esc(o.status==='done'?amount(o.revenue):'—')}</td><td>${esc(o.status==='done'?amount(o.cost):'—')}</td><td>${esc(o.status==='done'?amount(o.profit):'—')}</td></tr>`);
  el('profit-report').innerHTML=`${warnings.map(w=>`<p class="profit-warning">${esc(w)}</p>`).join('')}<p class="profit-note">${t('Đơn đặt ngày này đang xử lý','Orders placed on this date still in progress')}: ${count(s.pending)} · ${t('Số món đã bán','Items sold')}: ${count(s.quantity)} · ${t('Phí ship đơn hoàn tất','Completed-order shipping')}: ${esc(amount(s.shipping))}</p><section><h3>${t('Lợi nhuận từng món','Profit by item')}</h3>${table([t('Món','Item'),t('Số lượng','Quantity'),t('Doanh thu sau giảm','Sales after discounts'),t('Chi phí','Cost'),t('Lời TB / món','Avg profit / item'),t('Tổng lời món','Item profit')],rows,t('Chưa có món bán hoàn tất trong ngày này.','No completed sales on this date.'))}</section><section><h3>${t('Lợi nhuận từng đơn','Profit by order')}</h3><p class="profit-note">${t('Bấm mã đơn để xem tiền lời của từng món trong đơn.','Select an order number to see profit for each item in that order.')}</p>${table([t('Mã đơn / Chi tiết','Order / Details'),t('Trạng thái','Status'),t('Tiền món sau giảm','Order amount'),t('Doanh thu ghi nhận','Recognized sales'),t('Chi phí đơn','Order cost'),t('Lời của đơn','Order profit')],orderRows,t('Chưa có đơn trong ngày này.','No orders on this date.'))}</section>`;
 }
 function costs(menu){
  el('profit-costs').innerHTML=menu.length?menu.map((m,i)=>`<label class="profit-cost-row" for="profit-rate-${i}"><span><strong>${esc(en()?(m.name_en||m.name):m.name)}</strong><small>${esc(amount(m.price))}</small><small class="profit-recipe-cost">${m.recipeUnitCost===null?t('Chưa đủ giá vốn công thức','Recipe costing incomplete'):t('Giá vốn nguyên liệu / ly: ','Recipe cost / cup: ')+amount(m.recipeUnitCost)}</small>${m.recipeUnitCost===null&&m.costIssues?.length?`<small class="profit-cost-issues">${esc(m.costIssues.slice(0,2).join(' · '))}</small>`:''}</span><span class="profit-rate"><input id="profit-rate-${i}" data-item-id="${esc(m.id)}" type="number" min="0" max="100" step="0.01" inputmode="decimal" placeholder="—" value="${m.percent===null?'':esc(m.percent)}" aria-label="${esc(t('Chi phí (%) dự phòng cho ','Fallback cost (%) for ')+m.name)}"><span>%</span></span></label>`).join(''):`<p>${t('Chưa có món trong thực đơn.','Your menu is empty.')}</p>`;
  el('profit-save').disabled=true;el('profit-save-message').textContent='';
 }
 async function refresh(reloadCosts=false,quiet=false){
  init();if(!el('profit-date')||busy)return;
  const date=el('profit-date').value;if(!date){message(t('Vui lòng chọn ngày báo cáo.','Please select a report date.'),true);return;}
  const ticket=++serial;
  if(!quiet)message(t('Đang tải báo cáo…','Loading report…'));
  // Disable export until the visible report matches the chosen date.
  if(!quiet)el('profit-export').disabled=true;
  try{
   const result=await(await request('?date='+encodeURIComponent(date))).json();if(ticket!==serial)return;
   render(result.report);
   if(!dirty && (reloadCosts||!loaded)){version=result.version;costs(result.menu);loaded=true;}
   message(t('Đã cập nhật báo cáo. Tự cập nhật khi mục này đang mở.','Report updated. Refreshes automatically while this tab is open.'));el('profit-export').disabled=false;
  }catch(error){if(ticket===serial)message(error.message,true);}
 }
 async function save(){
  if(busy)return;
  const inputs=[...el('profit-costs').querySelectorAll('input')];
  if(inputs.some(input=>!input.checkValidity())){message(t('Tỷ lệ phải từ 0 đến 100%, tối đa 2 số thập phân.','Enter a percentage from 0 to 100 with up to 2 decimal places.'),true);inputs.find(i=>!i.checkValidity())?.reportValidity();return;}
  busy=true;el('profit-save').disabled=true;el('profit-export').disabled=true;inputs.forEach(i=>i.disabled=true);
  try{
   const data=await(await request('/settings',{method:'POST',body:JSON.stringify({version,items:inputs.map(i=>({itemId:i.dataset.itemId,percent:i.value.trim()===''?null:Number(i.value)}))})})).json();
   version=data.version;dirty=false;el('profit-save-message').textContent=t('Đã lưu trên máy chủ. Thiết bị khác sẽ tải cùng tỷ lệ.','Saved on the server. Other devices will load these percentages.');
  }catch(error){message(error.message,true);}finally{busy=false;inputs.forEach(i=>i.disabled=false);el('profit-save').disabled=!dirty;}
  if(!dirty)await refresh(false);else el('profit-export').disabled=false;
 }
 async function download(){
  if(!currentReport || currentReport.date!==el('profit-date').value)return;
  const button=el('profit-export');button.disabled=true;
  try{const date=currentReport.date,response=await request('/export?date='+encodeURIComponent(date)),blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Mom-Profit-'+date+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);message(t('Đã xuất Excel gồm tổng quan, từng món, từng đơn và chi tiết món trong đơn.','Excel exported: summary, items, orders and order item details.'));}catch(error){message(error.message,true);}finally{button.disabled=false;}
 }
 window.DuynhProfits={open(){init();if(lastLanguage!==document.documentElement.lang&&!dirty){el('tab-profits').replaceChildren();loaded=false;init();}refresh(!dirty);if(!polling){polling=true;setInterval(()=>{if(visible()&&!document.hidden&&!busy&&!dirty)refresh(true,true);},15000);}}};
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
})();
