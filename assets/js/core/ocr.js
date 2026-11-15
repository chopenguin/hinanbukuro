/**
 * 有效期限 OCR：延遲載入 Tesseract.js（只在按下「讀取期限」時下載）。
 *
 * 作法：
 * 1. 先把照片放大到約 1800px 並轉成灰階（必要時溫和拉對比）——
 *    包裝上的日期通常很小，原圖直接丟給 Tesseract 很容易把 13 讀成 1B。
 * 2. 最多跑三次，逐次放寬，結果合併：
 *      ① 只認數字 + 區塊模式（最準，大多數情況第一次就結束）
 *      ② 只認數字 + 稀疏文字模式（日期只佔畫面一小角時很有用）
 *      ③ 一般模式（順便讀到「賞味期限 / 製造」來判斷哪個才是到期日）
 *    只跑一次常常會漏掉或誤讀單一數字。
 */
import { findDates } from './dates.js';

const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

const DIGIT_CHARS = '0123456789./- ';

const PASSES = [
  { label: '數字', params: { tessedit_char_whitelist: DIGIT_CHARS, tessedit_pageseg_mode: '6', user_defined_dpi: '300', preserve_interword_spaces: '1' } },
  { label: '稀疏文字', params: { tessedit_char_whitelist: DIGIT_CHARS, tessedit_pageseg_mode: '11', user_defined_dpi: '300', preserve_interword_spaces: '1' } },
  { label: '一般', params: { tessedit_char_whitelist: '', tessedit_pageseg_mode: '3', user_defined_dpi: '300' } },
];

const RESET_PARAMS = { tessedit_char_whitelist: '', tessedit_pageseg_mode: '3', user_defined_dpi: '300' };

let scriptPromise = null;
let workerPromise = null;
let progressHandler = null;
let passLabel = '';

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
        if (progressHandler && msg) progressHandler({ ...msg, pass: passLabel });
      },
    });
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

async function recognize(dataUrl, params) {
  const worker = await getWorker();
  if (params) await worker.setParameters(params);
  const { data } = await worker.recognize(dataUrl);
  return data.text || '';
}

/* ---------------------------------------------------------------- 影像前處理 */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('無法讀取照片'));
    img.src = src;
  });
}

/**
 * 放大 + 灰階 +「溫和」拉對比，讓包裝上的小字更容易被辨識。
 *
 * 注意：這裡不能直接把 5% / 95% 百分位硬拉伸成 0–255。
 * 包裝照片裡文字只佔畫面一小塊（通常不到 5%），
 * 5% 百分位會落在背景上，整張圖就被壓成全黑，OCR 直接讀不到東西。
 * 所以改成：1% / 99% 百分位 + 亮度增益上限（最多 2.2 倍）。
 */
async function prepareImage(dataUrl, { targetWidth = 1800 } = {}) {
  const img = await loadImage(dataUrl);
  const natural = Math.max(img.naturalWidth || img.width, 1);
  const scale = Math.min(4, Math.max(1, targetWidth / natural));
  const width = Math.min(2400, Math.round(natural * scale));
  const height = Math.max(1, Math.round((img.naturalHeight || img.height) * (width / natural)));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;

  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    d[i] = g;
    hist[g] += 1;
  }

  const total = d.length / 4;
  const percentile = (p) => {
    let acc = 0;
    for (let v = 0; v < 256; v += 1) {
      acc += hist[v];
      if (acc >= total * p) return v;
    }
    return 255;
  };
  const lo = percentile(0.01);
  const hi = percentile(0.99);

  /* 對比本來就夠（或整張幾乎同色）就不要動，避免把小字糊掉 */
  const span = hi - lo;
  if (span >= 40) {
    const gain = Math.min(2.2, 255 / span);
    const mid = (lo + hi) / 2;
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v += 1) {
      lut[v] = Math.max(0, Math.min(255, mid + (v - mid) * gain));
    }
    for (let i = 0; i < d.length; i += 4) {
      const v = lut[d[i]];
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    }
  }
  /* 就算沒拉對比，灰階版本還是要寫回去 */
  ctx.putImageData(image, 0, 0);

  return canvas.toDataURL('image/jpeg', 0.95);
}

/* ---------------------------------------------------------------- 對外 */

function mergeCandidates(texts) {
  const byIso = new Map();
  for (const text of texts) {
    for (const item of findDates(text)) {
      const prev = byIso.get(item.iso);
      if (!prev || item.score > prev.score) byIso.set(item.iso, item);
    }
  }
  return [...byIso.values()].sort((a, b) => b.score - a.score);
}

/**
 * 讀取照片中的日期文字，回傳候選日期。
 * @returns {Promise<{text:string, candidates:Array, pass:number}>}
 */
export async function recognizeExpiry(dataUrl, { onProgress } = {}) {
  progressHandler = onProgress || null;
  const texts = [];

  try {
    let prepared = dataUrl;
    passLabel = '前處理';
    onProgress?.({ status: 'recognizing text', progress: 0, pass: passLabel });
    try {
      prepared = await prepareImage(dataUrl);
    } catch {
      prepared = dataUrl;
    }

    let candidates = [];
    let i = 0;

    while (i < PASSES.length) {
      const step = PASSES[i];
      passLabel = `${step.label} ${i + 1}/${PASSES.length}`;
      const text = await recognize(prepared, step.params);
      texts.push(text);

      candidates = mergeCandidates(texts);
      const strong = candidates.filter((c) => c.score >= 70);

      /* 只抓到一個明確的完整日期 → 收工，不必再跑 */
      if (strong.length === 1) {
        return { text: texts.join('\n'), candidates, pass: i + 1 };
      }

      /* 同時出現兩個以上日期（通常是「製造」和「賞味期限」），
         需要文字上下文才能判斷哪個是到期日 → 直接跳去一般模式 */
      if (strong.length > 1 && step.params.tessedit_pageseg_mode !== '3') {
        i = PASSES.length - 1;
        continue;
      }

      i += 1;
    }

    return { text: texts.join('\n'), candidates, pass: PASSES.length };
  } finally {
    passLabel = '';
    progressHandler = null;
    try {
      const worker = await getWorker();
      await worker.setParameters(RESET_PARAMS).catch(() => {});
    } catch {
      /* noop */
    }
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
  const stage = msg.pass ? `（${msg.pass}）` : '';
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
      return `辨識中${stage} ${Math.round((msg.progress || 0) * 100)}%`;
    default:
      return msg.status || '處理中…';
  }
}
