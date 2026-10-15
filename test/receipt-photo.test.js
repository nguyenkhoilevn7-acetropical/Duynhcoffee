'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PNG}=require('pngjs');
const {prepareReceipt}=require('../receipt-image');
function fixture(width,height,background=[180,155,170]){
 const image=new PNG({width,height});
 for(let p=0;p<image.data.length;p+=4){image.data[p]=background[0];image.data[p+1]=background[1];image.data[p+2]=background[2];image.data[p+3]=255;}
 return image;
}
function rect(image,x0,y0,w,h,color){for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){const p=(y*image.width+x)*4;for(let c=0;c<3;c++)image.data[p+c]=color[c];}}
test('phone photo keeps small text resolution and removes colored shading without erasing dark strokes',()=>{
 const input=fixture(1200,1500);rect(input,500,700,6,60,[30,25,30]);
 const prepared=prepareReceipt(PNG.sync.write(input),'png'),clean=PNG.sync.read(prepared.cleaned),original=PNG.sync.read(prepared.original);
 assert.equal(clean.width,1200);assert.equal(clean.height,1500);assert.equal(original.height,1500);
 assert.ok(clean.data[(705*clean.width+502)*4]<80);assert.ok(clean.data[(705*clean.width+470)*4]>220);
 assert.equal(prepared.photo,null); // Full-frame screenshots must not invent an embedded screen.
});
test('enclosed pale receipt is isolated from a darker camera background, bounded and cached',()=>{
 const input=fixture(900,1200,[70,50,30]);rect(input,200,160,500,850,[180,155,170]);
 rect(input,300,300,120,8,[30,25,30]);rect(input,300,460,200,8,[30,25,30]);
 const prepared=prepareReceipt(PNG.sync.write(input),'png'),photo=PNG.sync.read(prepared.photo);
 assert.ok(photo.width>500);assert.ok(photo.width<900);assert.ok(photo.height<=1400);assert.equal(prepared.photo,prepared.photo);
 assert.equal(PNG.sync.read(prepared.original).width,900);
});
test('large images remain bounded for server memory and all original colors are retained for fallback',()=>{
 const input=fixture(2000,1000,[220,210,200]);const prepared=prepareReceipt(PNG.sync.write(input),'png');
 const raw=PNG.sync.read(prepared.original);assert.equal(raw.width,1600);assert.equal(raw.height,800);assert.equal(raw.data[0],220);assert.equal(raw.data[1],210);
});
