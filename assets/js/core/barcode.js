/**
 * 條碼掃描
 *
 * 設計重點（都是實際掃不到的原因）：
 * 1. 相機串流只開一次，原生偵測與 ZXing 共用；切換解碼器時不重開，
 *    否則 iOS / Android 常常直接吐 NotReadableError（相機被占用）。
 * 2. 要求連續對焦（focusMode: continuous）並拉高解析度，不然條碼永遠是糊的。
 * 3. ZXing 只解畫面中央區域：快很多，也比較不會被背景雜訊干擾。
 * 4. 原生 BarcodeDetector 3.5 秒沒結果就自動換 ZXing，並支援手電筒。
 */

const NATIVE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
  'codabar',
];

const BASE_VIDEO = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

/* 解碼時取畫面中央這塊（比例），和畫面上的取景框大致對齊 */
const CROP = { x: 0.12, y: 0.19, w: 0.76, h: 0.62 };

const NATIVE_INTERVAL = 130;
const NATIVE_FALLBACK_MS = 3500;
const ZXING_GAP = 70;
const DECODE_MAX_W = 960;

let zxingPromise = null;

export function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../../vendor/zxing.min.js', import.meta.url).href;
      script.async = true;
      script.onload = () => {
        if (window.ZXing) resolve(window.ZXing);
        else reject(new Error('掃碼元件載入失敗'));
      };
      script.onerror = () => reject(new Error('掃碼元件載入失敗'));
      document.head.appendChild(script);
    });
    zxingPromise.catch(() => {
      zxingPromise = null;
    });
  }
  return zxingPromise;
}

export async function cameraSupported() {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  if (!window.isSecureContext) return false;
  return true;
}

function friendlyCameraError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '相機權限被拒絕。請在瀏覽器設定允許相機，或改用「手動輸入 / 上傳照片」。';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '找不到可用的相機。可以改用「手動輸入 / 上傳照片」。';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return '相機被其他程式占用中，請關閉其他相機 App 再試。';
  }
  return '無法啟動相機：' + (err?.message || '未知錯誤');
}

/** 依序嘗試幾組约束，愈前面愈好（連續對焦最關鍵） */
async function openCameraStream() {
  const attempts = [
    { audio: false, video: { ...BASE_VIDEO, advanced: [{ focusMode: 'continuous' }] } },
    { audio: false, video: { ...BASE_VIDEO } },
    {
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    },
    { audio: false, video: { facingMode: { ideal: 'environment' } } },
    { audio: false, video: true },
  ];

  let lastError = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      const name = err?.name;
      /* 使用者拒絕、沒有裝置就別再試了 */
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') {
        throw err;
      }
    }
  }
  throw lastError || new Error('無法啟動相機');
}

/** 把 RGBA 轉成灰階（ZXing 的 RGBLuminanceSource 在亮度陣列下才正確） */
function toLuminance(rgba, width, height) {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p += 1) {
    out[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}

export class BarcodeScanner {
  constructor(video, { onDetect, onError, onStatus } = {}) {
    this.video = video;
    this.onDetect = onDetect || (() => {});
    this.onError = onError || (() => {});
    this.onStatus = onStatus || (() => {});
    this.running = false;
    this.stopped = false;
    this.lastCode = '';
    this.lastAt = 0;
    this.timer = 0;
    this.fallbackTimer = 0;
    this.detector = null;
    this.reader = null;
    this.zxing = null;
    this.canvas = null;
    this.ctx = null;
    this.stream = null;
    this.mode = null;
    this.nativeHits = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.stopped = false;

    try {
      const stream = await openCameraStream();
      if (this.stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.stream = stream;
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.setAttribute('playsinline', 'true');
      this.video.setAttribute('autoplay', 'true');
      await this.video.play().catch(() => {});
      await this.#waitForFrame();

      const nativeStarted = await this.#startNative();
      if (!nativeStarted) await this.#startZXing();
    } catch (err) {
      this.running = false;
      this.stop();
      throw new Error(friendlyCameraError(err));
    }
  }

  #waitForFrame(timeout = 2000) {
    if (this.video.videoWidth) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.video.removeEventListener('loadedmetadata', done);
        this.video.removeEventListener('resize', done);
        resolve();
      };
      const timer = setTimeout(done, timeout);
      this.video.addEventListener('loadedmetadata', done, { once: true });
      this.video.addEventListener('resize', done);
    });
  }

  /* ------------------------------------------------------------ 原生 */

  async #startNative() {
    if (!('BarcodeDetector' in window)) return false;

    let formats = [];
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    } catch {
      formats = NATIVE_FORMATS;
    }
    if (!formats.length) return false;

    try {
      this.detector = new window.BarcodeDetector({ formats });
    } catch {
      return false;
    }

    this.mode = 'native';
    this.onStatus({ mode: 'native' });

    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.#nativeTick(), NATIVE_INTERVAL);
    this.fallbackTimer = window.setTimeout(() => {
      if (this.stopped || this.mode !== 'native' || this.nativeHits) return;
      this.#switchToZXing();
    }, NATIVE_FALLBACK_MS);

    return true;
  }

  async #nativeTick() {
    if (this.stopped || !this.detector || !this.video.videoWidth) return;
    try {
      const codes = await this.detector.detect(this.video);
      const hit = codes.find((c) => c.rawValue);
      if (hit) {
        this.nativeHits += 1;
        this.#emit(hit.rawValue);
      }
    } catch {
      this.#switchToZXing();
    }
  }

  async #switchToZXing() {
    if (this.stopped || this.mode === 'zxing') return;
    clearInterval(this.timer);
    this.timer = 0;
    clearTimeout(this.fallbackTimer);
    this.fallbackTimer = 0;
    this.detector = null;
    try {
      await this.#startZXing();
    } catch {
      /* 換不過去就先留著原生結果 */
    }
  }

  /* ------------------------------------------------------------ ZXing */

  async #startZXing() {
    const ZXing = await loadZXing();
    if (this.stopped) return;

    this.zxing = ZXing;
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

    this.reader = new ZXing.MultiFormatReader();
    this.reader.setHints(hints);

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.mode = 'zxing';
    this.onStatus({ mode: 'zxing' });
    this.#zxingLoop();
  }

  #zxingLoop() {
    if (this.stopped || this.mode !== 'zxing') return;

    const started = performance.now();
    let text = null;
    /* 一格解橫式、一格解直式：包裝上的直式條碼也掃得到 */
    this.frameNo = (this.frameNo || 0) + 1;
    try {
      text = this.#decodeFrame(this.frameNo % 2 === 0);
    } catch {
      /* 單一幀失敗就跳過 */
    }
    if (text) this.#emit(text);

    const spent = performance.now() - started;
    this.timer = window.setTimeout(() => this.#zxingLoop(), Math.max(20, ZXING_GAP - spent));
  }

  #decodeFrame(rotate = false) {
    const v = this.video;
    const { ctx } = this;
    if (!v.videoWidth || !ctx || !this.reader) return null;

    const sw = Math.max(40, Math.round(v.videoWidth * CROP.w));
    const sh = Math.max(40, Math.round(v.videoHeight * CROP.h));
    const sx = Math.round(v.videoWidth * CROP.x);
    const sy = Math.round(v.videoHeight * CROP.y);

    /* 手機的 1080p 影格丟給 ZXing 太慢（每張要幾百毫秒），
       縮到 960px 寬以內仍然遠大於條碼所需的解析度，解碼快很多 */
    const scale = Math.min(1, DECODE_MAX_W / sw);
    const dw = Math.max(40, Math.round(sw * scale));
    const dh = Math.max(40, Math.round(sh * scale));

    const canvas = this.canvas;
    if (canvas.width !== dw) canvas.width = dw;
    if (canvas.height !== dh) canvas.height = dh;

    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, dw, dh);
    const { data } = ctx.getImageData(0, 0, dw, dh);
    return decodePixels(data, dw, dh, this.reader, this.zxing, { rotate });
  }

  /* ------------------------------------------------------------ 共用 */

  #emit(raw) {
    const code = String(raw || '').trim();
    if (!code) return;
    const now = Date.now();
    if (code === this.lastCode && now - this.lastAt < 2000) return;
    this.lastCode = code;
    this.lastAt = now;
    this.onDetect(code);
  }

  torchSupported() {
    try {
      const track = this.stream?.getVideoTracks?.()[0];
      return Boolean(track?.getCapabilities?.().torch);
    } catch {
      return false;
    }
  }

  async setTorch(on) {
    try {
      const track = this.stream?.getVideoTracks?.()[0];
      if (!track) return false;
      await track.applyConstraints({ advanced: [{ torch: Boolean(on) }] });
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    this.stopped = true;
    this.running = false;

    clearInterval(this.timer);
    clearTimeout(this.timer);
    clearTimeout(this.fallbackTimer);
    this.timer = 0;
    this.fallbackTimer = 0;

    this.detector = null;
    this.reader = null;
    this.canvas = null;
    this.ctx = null;

    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* noop */
        }
      });
      this.stream = null;
    }

    if (this.video) {
      try {
        this.video.pause();
      } catch {
        /* noop */
      }
      this.video.srcObject = null;
    }
  }
}

/** 把灰階影像旋轉 90 度（直式條碼用） */
function rotateLuminance(lum, width, height) {
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) out[x * height + (height - 1 - y)] = lum[row + x];
  }
  return out;
}

/**
 * 單張影格解碼（純函式，方便測試）：失敗回傳 null。
 * 直式條碼（常見於日本包裝）需要 rotate: true。
 */
export function decodePixels(rgba, width, height, reader, ZXing, { rotate = false } = {}) {
  if (!reader || !ZXing) return null;

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
      /* NotFoundException：這一格沒有條碼 */
    }
  }
  return null;
}

/** 從照片檔解碼條碼（相機不可用時的備援） */
export async function decodeImageFile(file) {
  if (!file) return null;

  const ZXing = await loadZXing();

  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      if (formats.length) {
        const bitmap = await createImageBitmap(file);
        const detector = new window.BarcodeDetector({ formats });
        const codes = await detector.detect(bitmap);
        bitmap.close?.();
        const hit = codes.find((c) => c.rawValue);
        if (hit) return hit.rawValue;
      }
    } catch {
      /* 換 ZXing */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('無法讀取照片'));
      image.src = url;
    });

    /* 太大的照片先縮到 1600px，解碼快很多 */
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

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
    const reader = new ZXing.MultiFormatReader();
    reader.setHints(hints);

    const whole = decodePixels(data, w, h, reader, ZXing);
    if (whole) return whole;

    /* 直式條碼：轉 90 度再試一次 */
    const rotated = decodePixels(data, w, h, reader, ZXing, { rotate: true });
    if (rotated) return rotated;

    /* 整張掃不到，改成只看中央區域（條碼通常在中間） */
    const cw = Math.round(w * 0.86);
    const ch = Math.round(h * 0.86);
    const cx = Math.round((w - cw) / 2);
    const cy = Math.round((h - ch) / 2);
    const crop = ctx.getImageData(cx, cy, cw, ch);
    const cropHit = decodePixels(crop.data, cw, ch, reader, ZXing);
    if (cropHit) return cropHit;
    return decodePixels(crop.data, cw, ch, reader, ZXing, { rotate: true });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
