'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PNG}=require('pngjs');
const {prepareReceipt,prepareReceiptAsync}=require('../receipt-image');
test('background image preparation preserves every lazy image variant and leaves timers responsive',async()=>{
  const png=new PNG({width:1200,height:1600});png.data.fill(255);
  for(let y=200;y<1400;y++)for(let x=250;x<950;x++){
    const p=(y*png.width+x)*4;png.data[p]=190;png.data[p+1]=120;png.data[p+2]=160;
  }
  const bytes=PNG.sync.write(png),expected=prepareReceipt(bytes,'png'),prepared=prepareReceiptAsync(bytes,'png');
  let ticks=0;const timer=setInterval(()=>ticks++,5);
  try {
    for(const name of ['cleaned','screening','photo','original'])assert.deepEqual(await prepared.get(name),expected[name]||null);
    assert.ok(ticks>2,'HTTP event loop must remain available during pixel processing');
    assert.equal(prepared.get('cleaned'),prepared.get('cleaned'));
  }finally{clearInterval(timer);await prepared.close();}
});
test('invalid image rejects callers and closing the worker prevents further allocations',async()=>{
  const prepared=prepareReceiptAsync(Buffer.from('not a png'),'png');
  try{await assert.rejects(prepared.get('cleaned'),/Invalid PNG/);}
  finally{await prepared.close();}
  await assert.rejects(prepared.get('original'));
});
