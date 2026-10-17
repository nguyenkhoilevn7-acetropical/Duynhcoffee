'use strict';

function prepareReceipt(buffer, mime) {
  // Browser uploads are JPEG. Bound decoding memory for direct API uploads too.
  const { PNG } = require('pngjs');
  let image;
  if (mime === 'jpeg') {
    image = require('jpeg-js').decode(buffer, { useTArray: true, maxResolutionInMP: 8, maxMemoryUsageInMB: 128 });
  } else if (mime === 'png') {
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG');
    if (buffer.readUInt32BE(16) * buffer.readUInt32BE(20) > 8000000) throw new Error('Image too large');
    image = PNG.sync.read(buffer);
  } else {
    // Preserve existing WebP compatibility through Tesseract's own decoder.
    return { cleaned: buffer, original: buffer };
  }
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const original = new PNG({ width, height }), cleaned = new PNG({ width, height });
  let colorfulPixels=0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.min(image.height - 1, Math.floor(y / scale)) * image.width + Math.min(image.width - 1, Math.floor(x / scale))) * 4;
    const target = (y * width + x) * 4;
    const alpha = image.data[source + 3] / 255;
    const white = 255 * (1 - alpha);
    const red = image.data[source] * alpha + white;
    const green = image.data[source + 1] * alpha + white;
    const blue = image.data[source + 2] * alpha + white;
    if(Math.max(red,green,blue)-Math.min(red,green,blue)>45) colorfulPixels++;
    original.data[target] = red; original.data[target + 1] = green; original.data[target + 2] = blue;
    original.data[target + 3] = cleaned.data[target + 3] = 255;
  }
  // Normalize lighting locally. A fixed threshold turned shaded/pink phone
  // screens into solid black blocks and erased the small beneficiary text.
  function normalizeLighting(source) {
    const w=source.width,h=source.height,stride=w+1;
    const gray=new Uint8Array(w*h),integral=new Float64Array((w+1)*(h+1));
    for(let y=0;y<h;y++){
      let row=0;
      for(let x=0;x<w;x++){
        const i=y*w+x,p=i*4;
        gray[i]=Math.round(source.data[p]*0.299+source.data[p+1]*0.587+source.data[p+2]*0.114);
        row+=gray[i];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;
      }
    }
    const output=new PNG({width:w,height:h});
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const x0=Math.max(0,x-20),x1=Math.min(w,x+21),y0=Math.max(0,y-20),y1=Math.min(h,y+21);
      const average=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
      const p=(y*w+x)*4,value=Math.max(0,Math.min(255,245+(gray[y*w+x]-average)*3));
      output.data[p]=output.data[p+1]=output.data[p+2]=value;output.data[p+3]=255;
    }
    return output;
  }
  const adjusted=normalizeLighting(original);cleaned.data.set(adjusted.data);
  // Find one bright receipt/screen enclosed by darker surroundings. Ignore
  // components touching the image edge, so checkout instructions around an
  // embedded receipt cannot become the crop. This is independent of names/amounts.
  function screenCrop() {
    const step=Math.max(1,Math.ceil(Math.max(width,height)/320)),w=Math.ceil(width/step),h=Math.ceil(height/step);
    const mask=new Uint8Array(w*h),queue=new Int32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=(Math.min(height-1,y*step)*width+Math.min(width-1,x*step))*4;
      const r=original.data[p],g=original.data[p+1],b=original.data[p+2];
      mask[y*w+x]=(r+g+b)/3>110&&Math.max(r,g,b)-Math.min(r,g,b)<70?1:0;
    }
    let best=null;
    for(let pos=0;pos<mask.length;pos++){
      if(!mask[pos])continue;
      let head=0,tail=1,n=0,x0=w,y0=h,x1=0,y1=0;queue[0]=pos;mask[pos]=0;
      while(head<tail){
        const p=queue[head++],x=p%w,y=Math.floor(p/w);n++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
        for(const q of [x>0?p-1:-1,x+1<w?p+1:-1,y>0?p-w:-1,y+1<h?p+w:-1])if(q>=0&&mask[q]){mask[q]=0;queue[tail++]=q;}
      }
      const area=(x1-x0+1)*(y1-y0+1),ratio=(x1-x0+1)/(y1-y0+1);
      if(x0<2||y0<2||x1>=w-2||y1>=h-2||area<w*h*0.04||area>w*h*0.8||n/area<0.65||ratio<0.3||ratio>2)continue;
      if(!best||n>best.n)best={n,x0,y0,x1,y1};
    }
    if(!best)return null;
    const left=Math.max(0,best.x0*step-8),top=Math.max(0,best.y0*step-8);
    const right=Math.min(width,(best.x1+1)*step+8),bottom=Math.min(height,(best.y1+1)*step+8);
    const factor=Math.min(2,1400/Math.max(right-left,bottom-top));
    const crop=new PNG({width:Math.round((right-left)*factor),height:Math.round((bottom-top)*factor)});
    for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++){
      const p=(Math.min(bottom-1,top+Math.floor(y/factor))*width+Math.min(right-1,left+Math.floor(x/factor)))*4;
      const q=(y*crop.width+x)*4;for(let c=0;c<4;c++)crop.data[q+c]=original.data[p+c];
    }
    return normalizeLighting(crop);
  }
  const options = { deflateLevel: 1 };
  let originalPng,photoPng,photoPrepared=false,screeningPng;
  return { cleaned: PNG.sync.write(cleaned, options),
    get screening() {
      if (Math.max(width,height)<=1000 || colorfulPixels/(width*height)<0.12) return null;
      if (!screeningPng) {
        const factor=Math.min(1,800/Math.max(width,height));
        const small=new PNG({width:Math.max(1,Math.round(width*factor)),height:Math.max(1,Math.round(height*factor))});
        for(let y=0;y<small.height;y++)for(let x=0;x<small.width;x++){
          const p=(Math.min(height-1,Math.floor(y/factor))*width+Math.min(width-1,Math.floor(x/factor)))*4;
          const q=(y*small.width+x)*4;for(let c=0;c<4;c++)small.data[q+c]=original.data[p+c];
        }
        screeningPng=PNG.sync.write(small,options);
      }
      return screeningPng;
    },
    get original() { return originalPng || (originalPng = PNG.sync.write(original, options)); },
    get photo() { if(!photoPrepared){photoPrepared=true;const crop=screenCrop();photoPng=crop?PNG.sync.write(crop,options):null;}return photoPng; }
  };
}
module.exports = { prepareReceipt };
