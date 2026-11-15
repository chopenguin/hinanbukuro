/**
 * 有效期限 OCR：延遲載入 Tesseract.js（只在按下「讀取期限」時下載）。
 *
 * 認得台灣包裝上的中文（有效日期／保存期限／年／月／日），也認得西元與民國年。
 * 用的是 eng + chi_tra 雙語模型：中文交給 chi_tra，數字交給 eng，
 * 兩邊一起投票，數字信心值明顯比純中文模型高。
 *
 * 作法：
 * 1. 先把照片放大到約 1800px 並轉成灰階（必要時溫和拉對比）——
 *    包裝上的日期通常很小，原圖直接丟給 Tesseract 很容易把 13 讀成 1B。
 * 2. 最多跑三次，逐次放寬，結果合併：
 *      ① 區塊模式（最準，大多數情況第一次就結束）
 *      ② 稀疏文字模式（日期只佔畫面一小角時很有用）
 *      ③ 一般模式（整張圖重新排版，處理斜拍或斷行）
 *    只跑一次常常會漏掉或誤讀單一數字。
 */
import { findDates } from './dates.js';

const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

/** 台灣商品的日期幾乎都跟中文一起出現，所以一定要有 chi_tra；eng 負責把數字讀準。
 *  用 `_fast` 版模型：兩個語言加起來約 3.5 MB（完整版要 36 MB），
 *  辨識結果幾乎一樣，手機第一次載入也還算快。下載後瀏覽器會快取起來。 */
const LANGS = 'eng+chi_tra';
const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0_fast';

const PASSES = [
  { label: '區塊', params: { tessedit_char_whitelist: '', tessedit_pageseg_mode: '6', user_defined_dpi: '300', preserve_interword_spaces: '1' } },
  { label: '稀疏文字', params: { tessedit_char_whitelist: '', tessedit_pageseg_mode: '11', user_defined_dpi: '300', preserve_interword_spaces: '1' } },
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
    workerPromise = T.createWorker(LANGS, 1, {
      langPath: LANG_PATH,
      gzip: true,
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

/**
 * Tesseract 每個字詞都有信心值。包裝上有外語、花紋或反光時，
 * 它會「讀出」一堆根本不存在數字（例如把希伯來文讀成 305.470），
 * 再由這些垃圾湊出假日期。信心值可以可靠地把這種情況分開：
 * 真的印在包裝上的日期，數字信心值通常 90 以上；亂讀的大多 0～30。
 */
const TRUST_CONF = 60;

async function recognize(dataUrl, params) {
  const worker = await getWorker();
  if (params) await worker.setParameters(params);
  const { data } = await worker.recognize(dataUrl);
  const words = Array.isArray(data.words) ? data.words : [];
  const trusted = words
    .filter((w) => w && w.text && (w.confidence ?? 0) >= TRUST_CONF)
    .map((w) => w.text)
    .join(' ');
  return { text: data.text || '', trusted };
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

function mergeCandidates(passes) {
  const byIso = new Map();

  const put = (item, trusted) => {
    const prev = byIso.get(item.iso);
    const cand = {
      iso: item.iso,
      raw: item.raw,
      kind: item.kind,
      score: item.score,
      trusted,
      ambiguous: !!item.ambiguous,
    };
    if (!prev) {
      byIso.set(cand.iso, cand);
      return;
    }
    /* 高信心的版本優先；同等信心才比分數；非歧義的版本優先 */
    if (trusted && !prev.trusted) byIso.set(cand.iso, cand);
    else if (trusted === prev.trusted && cand.ambiguous !== prev.ambiguous) {
      if (prev.ambiguous) byIso.set(cand.iso, cand);
    } else if (trusted === prev.trusted && cand.score > prev.score) byIso.set(cand.iso, cand);
  };

  for (const pass of passes) {
    for (const item of findDates(pass.text)) put(item, false);
    if (pass.trusted) for (const item of findDates(pass.trusted)) put(item, true);
  }

  return [...byIso.values()].sort((a, b) => Number(b.trusted) - Number(a.trusted) || b.score - a.score);
}

/**
 * 讀取照片中的日期文字，回傳候選日期。
 * 每個候選都帶 `trusted`：true 代表數字本身的辨識信心夠高，可以自動填入。
 * @returns {Promise<{text:string, candidates:Array, pass:number}>}
 */
export async function recognizeExpiry(dataUrl, { onProgress } = {}) {
  progressHandler = onProgress || null;
  const passes = [];

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
      passes.push(await recognize(prepared, step.params));

      candidates = mergeCandidates(passes);
      const strong = candidates.filter((c) => c.score >= 70);
      const text = passes.map((p) => p.text).join('\n');

      /* 已經抓到「一個明確又可信」的完整日期 → 收工 */
      if (strong.length === 1 && strong[0].trusted) {
        return { text, candidates, pass: i + 1 };
      }

      /* 同時出現多個日期（通常是「製造」和「賞味期限」），
         需要文字上下文才能判斷哪個是到期日 → 直接跳去一般模式 */
      if (strong.length > 1 && step.params.tessedit_pageseg_mode !== '3') {
        i = PASSES.length - 1;
        continue;
      }

      i += 1;
    }

    return { text: passes.map((p) => p.text).join('\n'), candidates, pass: PASSES.length };
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
      return `載入語言資料（第一次約 3.5 MB）… ${Math.round((msg.progress || 0) * 100)}%`;
    case 'initializing api':
      return '準備辨識…';
    case 'recognizing text':
      return `辨識中${stage} ${Math.round((msg.progress || 0) * 100)}%`;
    default:
      return msg.status || '處理中…';
  }
}
