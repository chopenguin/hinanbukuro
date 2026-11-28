/* eslint-env worker */
/* Classic Worker：把耗 CPU 的 ZXing 一維條碼解碼移出主執行緒 */

let reader = null;
let initError = null;

try {
  importScripts('../../vendor/zxing.min.js');
  const ZXing = self.ZXing;
  if (!ZXing) throw new Error('ZXing unavailable in worker');

  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.ITF,
    ZXing.BarcodeFormat.CODABAR,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

  reader = new ZXing.MultiFormatReader();
  reader.setHints(hints);
} catch (err) {
  initError = err?.message || 'Worker init failed';
}

function toLuminance(rgba, width, height) {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p += 1) {
    out[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}

function rotateLuminance(lum, width, height) {
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      out[x * height + (height - 1 - y)] = lum[row + x];
    }
  }
  return out;
}

function decodeBuffer(buffer, width, height, rotate) {
  const ZXing = self.ZXing;
  if (!reader || !ZXing || !buffer) return null;

  const rgba = new Uint8ClampedArray(buffer);
  let lum = toLuminance(rgba, width, height);
  let w = width;
  let h = height;

  if (rotate) {
    lum = rotateLuminance(lum, w, h);
    const swap = w;
    w = h;
    h = swap;
  }

  const source = new ZXing.RGBLuminanceSource(lum, w, h);
  for (const frame of [source, new ZXing.InvertedLuminanceSource(source)]) {
    try {
      const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(frame));
      const result = reader.decode(bitmap);
      const text = result?.getText?.();
      if (text) return text;
    } catch {
      /* NotFoundException：此影格沒有條碼 */
    }
  }
  return null;
}

self.onmessage = (event) => {
  const { id, buffer, width, height, rotate } = event.data || {};
  if (initError) {
    self.postMessage({ id, text: null, error: initError });
    return;
  }
  try {
    const text = decodeBuffer(buffer, width, height, Boolean(rotate));
    self.postMessage({ id, text });
  } catch {
    self.postMessage({ id, text: null });
  }
};
