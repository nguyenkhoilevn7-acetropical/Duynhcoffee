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
  const scale = Math.min(1, 900 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const original = new PNG({ width, height }), cleaned = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.min(image.height - 1, Math.floor(y / scale)) * image.width + Math.min(image.width - 1, Math.floor(x / scale))) * 4;
    const target = (y * width + x) * 4;
    const alpha = image.data[source + 3] / 255;
    const colors = [0,1,2].map(c => Math.round(image.data[source + c] * alpha + 255 * (1 - alpha)));
    const value = colors[0] * 0.299 + colors[1] * 0.587 + colors[2] * 0.114 < 190 ? 0 : 255;
    for (let c = 0; c < 3; c++) { original.data[target + c] = colors[c]; cleaned.data[target + c] = value; }
    original.data[target + 3] = cleaned.data[target + 3] = 255;
  }
  const options = { deflateLevel: 1 };
  return { cleaned: PNG.sync.write(cleaned, options), original: PNG.sync.write(original, options) };
}
module.exports = { prepareReceipt };
