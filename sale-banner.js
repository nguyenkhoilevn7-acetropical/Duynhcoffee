/* Mom's Tea & Coffee — live SALE banners within the storefront hero.
 * No independent pricing: uses the same active campaigns as the checkout.
 * Everything is rendered with textContent to prevent admin-supplied HTML injection. */
(function(root, create) {
  const api=create();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MomSaleBanner=api;
})(typeof window==='undefined'?undefined:window,function(){
  'use strict';

  const isSale=p=>!!p&&p.kind==='sale'&&p.mode==='automatic';
  const validDate=s=>{const t=s?Date.parse(s):NaN;return Number.isFinite(t)?t:null;};
  function evaluateCampaigns(discounts, now=Date.now()) {
    const rows=[];
    for(const p of Array.isArray(discounts)?discounts:[]){
      if(!isSale(p)||p.active===false||p.isActive===false)continue;
      if(typeof p.title!=='string'||!p.title.trim()||!['all','selected'].includes(p.scope))continue;
      if(!['amount','percent'].includes(p.type)||!Number.isSafeInteger(Number(p.value))||Number(p.value)<=0)continue;
      if(p.type==='percent'&&Number(p.value)>=100)continue;
      const start=p.startsAt?validDate(p.startsAt):null;
      const end=p.endsAt?validDate(p.endsAt):null;
      if(p.startsAt&&start===null||p.endsAt&&end===null)continue;
      if(start!==null&&end!==null&&end<=start)continue;
      if(end!==null&&now>=end)continue;
      if(p.scope==='selected'&&(!Array.isArray(p.productIds)||p.productIds.length===0))continue;
      rows.push({campaign:p,status:start!==null&&now<start?'upcoming':'live',start,end});
    }
    rows.sort((a,b)=>Number(b.status==='live')-Number(a.status==='live')||
      ((a.status==='live'?(a.end??Infinity):(a.start??Infinity))-
       (b.status==='live'?(b.end??Infinity):(b.start??Infinity)))||
      String(a.campaign.id).localeCompare(String(b.campaign.id)));
    return rows;
  }
  function formatDuration(ms,lang='vi') {
    if(ms===null||!Number.isFinite(ms))return lang==='en'?'No end date':'Không giới hạn';
    const sec=Math.max(0,Math.floor(ms/1000));
    const d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60),s=sec%60;
    const pad=n=>String(n).padStart(2,'0');
    return d>0?d+(lang==='en'?'d ':' ngày ')+pad(h)+':'+pad(m)+':'+pad(s)
      :pad(h)+':'+pad(m)+':'+pad(s);
  }
  const el=(tag,cls,text)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!==undefined)node.textContent=String(text);
    return node;
  };
  const locale=()=>document.documentElement.lang?.toLowerCase().startsWith('en')?'en':'vi';
  const fmt=(n,language)=>new Intl.NumberFormat(language==='en'?'en-US':'vi-VN').format(n)+' ₫';
  const when=(date,language)=>new Intl.DateTimeFormat(language==='en'?'en-GB':'vi-VN',
    {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(date));
  const eligible=(campaign,products)=>(Array.isArray(products)?products:[]).filter(m=>
    m&&Number.isFinite(Number(m.price))&&Number(m.price)>0&&
    (campaign.scope==='all'||campaign.productIds?.map(String).includes(String(m.id))));
  function priceInfo(p,products,language) {
    const chosen=eligible(p,products);
    const scope=p.scope==='all'
      ? (language==='en'?'All drinks':'Toàn bộ sản phẩm')
      : (language==='en'?chosen.length+' selected drinks':chosen.length+' sản phẩm được chọn');
    const amount=p.type==='percent'
      ? '-'+Number(p.value)+'%'
      : (language==='en'?'Save ':'Giảm ')+fmt(Number(p.value),language)+(language==='en'?' / cup':' / ly');
    let base=null,after=null;
    for(const item of chosen) {
      const v=Number(item.price);
      const value=p.type==='percent'?Math.round(v*Number(p.value)/100):
        Math.min(Number(p.value),Math.max(0,v-1));
      const current=v-value;
      if(after===null||current<after){base=v;after=current;}
    }
    return {scope,amount,base,after};
  }

  let rootNode=null,signature='',timer=null,expanded=false,lastPhase='';
  function list(){try{return window.getMomPublicSales?.()||[];}catch{return [];}}
  function menu(){try{return window.getMomPublicMenu?.()||[];}catch{return [];}}
  function sig(rows,language,products){
    // Only re-render when campaign data, language, eligibility or phase changes.
    const chosen=products.map(i=>[i.id,i.price,i.name]);
    return JSON.stringify([language,chosen,rows.map(r=>[
      r.status,r.campaign.id,r.campaign.title,r.campaign.reason,r.campaign.value,
      r.campaign.type,r.campaign.scope,r.campaign.productIds,r.start,r.end
    ])]);
  }
  function hide(){
    if(!rootNode)return;
    rootNode.hidden=true;
    rootNode.replaceChildren();
    signature='';
  }
  function card(row,language,products){
    const p=row.campaign,info=priceInfo(p,products,language);
    const article=el('article','mom-sale-hero-card '+(row.status==='live'?'is-live':'is-upcoming'));
    const head=el('div','mom-sale-hero-card-head');
    const state=el('span','mom-sale-hero-state',row.status==='live'
      ?(language==='en'?'🔴 LIVE FLASH SALE':'🔴 FLASH SALE ĐANG DIỄN RA')
      :(language==='en'?'📅 UPCOMING SALE':'📅 SẮP CÓ SALE'));
    const offer=el('strong','mom-sale-hero-offer',info.amount);
    head.append(state,offer);
    const title=el('h3','mom-sale-hero-title',p.title.trim());
    const reason=el('p','mom-sale-hero-reason',
      typeof p.reason==='string'&&p.reason.trim()?p.reason.trim():p.title.trim());
    const items=el('p','mom-sale-hero-scope',info.scope);
    article.append(head,title,reason,items);
    if(info.after!==null){
      const price=el('p','mom-sale-hero-price');
      price.append(
        el('span','mom-sale-hero-price-caption',language==='en'?'Sale price from: ':'Giá SALE từ: '),
        el('s','mom-sale-hero-old-price',fmt(info.base,language)),
        el('b','mom-sale-hero-new-price',fmt(info.after,language))
      );
      article.append(price);
    }
    const range=el('p','mom-sale-hero-range');
    const start=language==='en'?'Starts':'Bắt đầu',end=language==='en'?'Ends':'Kết thúc';
    range.textContent=start+': '+(row.start!==null?when(row.start,language):(language==='en'?'Immediately':'Ngay'))+
      ' · '+end+': '+(row.end!==null?when(row.end,language):(language==='en'?'No end date':'Không giới hạn'));
    article.append(range);
    const countdown=el('p','mom-sale-hero-countdown');
    const label=el('span','mom-sale-hero-countdown-label',row.status==='live'
      ?(language==='en'?'⏳ Ends in':'⏳ Kết thúc sau')
      :(language==='en'?'⏳ Starts in':'⏳ Bắt đầu sau'));
    const value=el('strong','mom-sale-hero-timer');
    value.setAttribute('data-sale-end',row.status==='live'?(row.end===null?'':String(row.end)):String(row.start));
    value.textContent=formatDuration(row.status==='live'?(row.end===null?null:row.end-Date.now()):row.start-Date.now(),language);
    countdown.append(label,value);article.append(countdown);
    return article;
  }
  function render(now=Date.now()){
    if(typeof document==='undefined')return;
    rootNode=document.getElementById('mom-sale-hero');
    if(!rootNode)return;
    const rows=evaluateCampaigns(list(),now),language=locale(),products=menu();
    if(!rows.length){hide();return;}
    const key=sig(rows,language,products);
    if(key===signature&&!rootNode.hidden)return;
    rootNode.replaceChildren();
    const label=el('div','mom-sale-hero-heading',language==='en'?'🎉 MOM’S SPECIAL OFFERS':'🎉 ƯU ĐÃI ĐẶC BIỆT TẠI MOM');
    rootNode.append(label);
    const live=rows.filter(r=>r.status==='live');
    const upcoming=rows.filter(r=>r.status==='upcoming');
    for(const [kind,group] of [['live',live],['upcoming',upcoming]]){
      if(!group.length)continue;
      const section=el('section','mom-sale-hero-group');
      const heading=el('h2','mom-sale-hero-group-heading',kind==='live'
        ?(language==='en'?'On sale now':'Đang giảm giá')
        :(language==='en'?'Scheduled sales':'Lịch SALE sắp tới'));
      const scroller=el('div','mom-sale-hero-track');
      group.forEach(r=>scroller.append(card(r,language,products)));
      section.append(heading,scroller);rootNode.append(section);
    }
    rootNode.hidden=false;signature=key;
  }
  function tick(now=Date.now()){
    if(typeof document==='undefined')return;
    const previous=rootNode&&!rootNode.hidden
      ?new Set([...rootNode.querySelectorAll('.mom-sale-hero-card')].map(x=>x.classList.contains('is-live')?'live':'upcoming'))
      :new Set();
    const priorSignature=signature;
    render(now);
    if(!rootNode||rootNode.hidden)return;
    const language=locale();
    for(const node of rootNode.querySelectorAll('.mom-sale-hero-timer')){
      const target=node.dataset.saleEnd?Number(node.dataset.saleEnd):null;
      node.textContent=formatDuration(target===null?null:target-now,language);
    }
    // A scheduled boundary may change product prices. Only the actual transition triggers recalc.
    if(priorSignature && signature!==priorSignature && typeof window.refreshMomSaleBoundary==='function')
      window.refreshMomSaleBoundary();
  }
  function start(){
    if(typeof document==='undefined'||timer!==null)return;
    render();timer=setInterval(()=>tick(),1000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
    window.addEventListener('pageshow',()=>tick());
    const observer=new MutationObserver(()=>render());
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  }
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
  return {evaluateCampaigns,formatDuration,priceInfo,refresh:()=>render(),tick};
});
