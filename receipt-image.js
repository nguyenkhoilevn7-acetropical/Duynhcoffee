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
    const white = 255 * (1 - alpha);
    const red = image.data[source] * alpha + white;
    const green = image.data[source + 1] * alpha + white;
    const blue = image.data[source + 2] * alpha + white;
    const value = red * 0.299 + green * 0.587 + blue * 0.114 < 190 ? 0 : 255;
    original.data[target] = red; original.data[target + 1] = green; original.data[target + 2] = blue;
    cleaned.data[target] = cleaned.data[target + 1] = cleaned.data[target + 2] = value;
    original.data[target + 3] = cleaned.data[target + 3] = 255;
  }
  const options = { deflateLevel: 1 };
  let originalPng;
  return { cleaned: PNG.sync.write(cleaned, options), get original() { return originalPng || (originalPng = PNG.sync.write(original, options)); } };
}
module.exports = { prepareReceipt };
