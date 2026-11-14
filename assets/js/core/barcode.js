/**
 * 條碼掃描：
 * 1. 優先使用瀏覽器原生 BarcodeDetector（Android Chrome / 新版 Edge，速度快）
 * 2. 不支援時才延遲載入本地 ZXing（iOS Safari 靠它）
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

const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

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
  if (name === 'NotReadableError') {
    return '相機被其他程式占用中，請關閉其他相機 App 再試。';
  }
  return '無法啟動相機：' + (err?.message || '未知錯誤');
}

export class BarcodeScanner {
  constructor(video, { onDetect, onError } = {}) {
    this.video = video;
    this.onDetect = onDetect || (() => {});
    this.onError = onError || (() => {});
    this.running = false;
    this.stopped = false;
    this.lastCode = '';
    this.lastAt = 0;
    this.timer = 0;
    this.detector = null;
    this.reader = null;
    this.stream = null;
    this.mode = null;
    this.nativeFails = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.stopped = false;

    try {
      const native = await this.#startNative();
      if (native) {
        this.mode = 'native';
        return;
      }
      await this.#startZXing();
      this.mode = 'zxing';
    } catch (err) {
      this.running = false;
      this.stop();
      throw new Error(friendlyCameraError(err));
    }
  }

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

    const detector = new window.BarcodeDetector({ formats });
    const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    if (this.stopped) return true;

    this.stream = stream;
    this.detector = detector;
    this.video.srcObject = stream;
    this.video.setAttribute('playsinline', 'true');
    this.video.muted = true;
    await this.video.play().catch(() => {});

    this.timer = window.setInterval(() => this.#tick(), 180);
    return true;
  }

  async #tick() {
    if (!this.running || this.stopped || !this.detector) return;
    if (!this.video.videoWidth) return;
    try {
      const codes = await this.detector.detect(this.video);
      this.nativeFails = 0;
      const hit = codes.find((c) => c.rawValue);
      if (hit) this.#emit(hit.rawValue);
    } catch {
      this.nativeFails += 1;
      if (this.nativeFails > 6) {
        // 原生偵測一直失敗 → 換 ZXing 再試一次
        this.nativeFails = 0;
        clearInterval(this.timer);
        this.timer = 0;
        this.detector = null;
        try {
          await this.#startZXing();
          this.mode = 'zxing';
        } catch (err) {
          this.onError(friendlyCameraError(err));
        }
      }
    }
  }

  async #startZXing() {
    const ZXing = await loadZXing();
    if (this.stopped) return;

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

    const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    this.stream = stream;
    this.video.setAttribute('playsinline', 'true');
    this.video.muted = true;

    const reader = new ZXing.BrowserMultiFormatReader(hints);
    this.reader = reader;
    reader.decodeFromStream(stream, this.video, (result) => {
      if (result) this.#emit(result.getText());
    });
  }

  #emit(raw) {
    const code = String(raw).trim();
    if (!code) return;
    const now = Date.now();
    if (code === this.lastCode && now - this.lastAt < 2000) return;
    this.lastCode = code;
    this.lastAt = now;
    this.onDetect(code);
  }

  stop() {
    this.stopped = true;
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
    this.detector = null;

    if (this.reader) {
      try {
        this.reader.reset();
      } catch {
        /* noop */
      }
      this.reader = null;
    }

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

/** 從照片檔解碼條碼（相機不可用時的備援） */
export async function decodeImageFile(file) {
  if (!file) return null;

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

  const ZXing = await loadZXing();
  const url = URL.createObjectURL(file);
  const reader = new ZXing.BrowserMultiFormatReader();
  try {
    const result = await reader.decodeFromImageUrl(url);
    return result ? result.getText() : null;
  } catch {
    return null;
  } finally {
    try {
      reader.reset();
    } catch {
      /* noop */
    }
    URL.revokeObjectURL(url);
  }
}
