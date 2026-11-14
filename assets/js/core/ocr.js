/**
 * 有效期限 OCR：延遲載入 Tesseract.js（只在按下「讀取期限」時下載）。
 * 第一次使用約需下載 8–10 MB，之後瀏覽器會快取。
 */
import { findDates } from './dates.js';

const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let scriptPromise = null;
let workerPromise = null;
let progressHandler = null;

function loadScript() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CDN;
      script.async = true;
      script.onload = () => {
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error('OCR 元件載入失敗'));
      };
      script.onerror = () => reject(new Error('OCR 元件載入失敗'));
      document.head.appendChild(script);
    });
    scriptPromise.catch(() => {
      scriptPromise = null;
    });
  }
  return scriptPromise;
}

async function getWorker() {
  const T = await loadScript();
  if (!workerPromise) {
    workerPromise = T.createWorker('eng', 1, {
      logger: (msg) => {
        if (progressHandler && msg) progressHandler(msg);
      },
    });
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

async function recognize(dataUrl, onProgress, params) {
  progressHandler = onProgress || null;
  const worker = await getWorker();
  if (params) await worker.setParameters(params);
  const { data } = await worker.recognize(dataUrl);
  return data.text || '';
}

/**
 * 讀取照片中的日期文字，回傳候選日期。
 * 先跑一次一般辨識；抓不到日期時，改用「數字白名單 + 單一區塊」再試一次。
 */
export async function recognizeExpiry(dataUrl, { onProgress } = {}) {
  let text = '';
  try {
    text = await recognize(dataUrl, onProgress);
    let candidates = findDates(text);
    if (candidates.length) return { text, candidates, pass: 1 };

    try {
      text = await recognize(dataUrl, onProgress, {
        tessedit_char_whitelist: '0123456789./- ',
        tessedit_pageseg_mode: '6',
      });
    } finally {
      const worker = await getWorker();
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' }).catch(() => {});
    }
    candidates = findDates(text);
    return { text, candidates, pass: 2 };
  } finally {
    progressHandler = null;
  }
}

export async function terminateOCR() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    /* noop */
  }
  workerPromise = null;
}

export function ocrStatusText(msg) {
  if (!msg) return '準備中…';
  switch (msg.status) {
    case 'loading tesseract core':
      return '載入 OCR 引擎…';
    case 'initializing tesseract':
      return '初始化 OCR…';
    case 'loading language traineddata':
      return '載入語言資料…';
    case 'initializing api':
      return '準備辨識…';
    case 'recognizing text':
      return `辨識中 ${Math.round((msg.progress || 0) * 100)}%`;
    default:
      return msg.status || '處理中…';
  }
}
