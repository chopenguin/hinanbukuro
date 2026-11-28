/**
 * 品名／有效期限 OCR：延遲載入 PaddleOCR.js（PP-OCRv6 Small）。
 *
 * 優化重點：
 * 1. 移除模組級全域進度回呼，全面以參數傳遞 `onProgress`，徹底杜絕並發競態。
 * 2. `prepareImage` 支援 File / Blob（直接 `createImageBitmap`，免除雙重 JPEG 編解碼損失）、
 *    HTMLCanvasElement 與 Data URL 字串。
 * 3. 新增 `recognizeLabel`：單拍一張標籤只執行一次推論，同時萃取出「品名」與「有效期限」候選。
 */
import { findDates } from './dates.js';

const SDK_URL = 'https://esm.sh/@paddleocr/paddleocr-js@0.4.2';
const MODEL_TOTAL_BYTES = 30 * 1024 * 1024;

/** rec 分數低於這個值就不當作「可信」日期，只列出來讓使用者挑 */
const TRUST_SCORE = 0.78;

let sdkPromise = null;
let ocrPromise = null;
const initSubscribers = new Set();
const downloads = new Map();

/* ---------------------------------------------------------------- 載入模型 */

function notifyInit(payload) {
  initSubscribers.forEach((fn) => {
    try {
      fn(payload);
    } catch {
      /* noop */
    }
  });
}

function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import(SDK_URL).catch((err) => {
      sdkPromise = null;
      throw new Error(`無法載入 OCR 元件，請確認網路連線後再試（${err?.message || '載入失敗'}）`);
    });
  }
  return sdkPromise;
}

function reportModelProgress() {
  if (!initSubscribers.size) return;
  let received = 0;
  let total = 0;
  for (const entry of downloads.values()) {
    received += entry.received;
    total += entry.total;
  }
  const expected = total || MODEL_TOTAL_BYTES;
  const ratio = Math.min(1, received / expected);
  notifyInit({ status: ratio >= 1 ? 'init' : 'models', progress: ratio, received, total: expected });
}

/**
 * 包住 fetch，邊下載邊回報進度。
 */
async function trackedFetch(input, init) {
  const response = await fetch(input, init);
  if (!response.ok || !response.body) return response;

  const length = Number(response.headers.get('content-length')) || 0;
  const key = typeof input === 'string' ? input : input?.url || String(input);
  const entry = { received: 0, total: length || MODEL_TOTAL_BYTES / 2 };
  downloads.set(key, entry);
  reportModelProgress();

  const reader = response.body.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        entry.received += value.byteLength;
        reportModelProgress();
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });

  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 單一 OCR 實例，重複使用。
 * `backend: 'auto'` 會先試 WebGPU，不支援或初始化失敗時 SDK 會退回 WASM。
 */
function getOcr(onProgress) {
  if (onProgress) initSubscribers.add(onProgress);

  if (ocrPromise) {
    return ocrPromise.finally(() => {
      if (onProgress) initSubscribers.delete(onProgress);
    });
  }

  notifyInit({ status: 'sdk', progress: 0 });

  ocrPromise = loadSdk()
    .then(({ PaddleOCR }) => {
      notifyInit({ status: 'models', progress: 0 });
      return PaddleOCR.create({
        lang: 'chinese_cht',
        ocrVersion: 'PP-OCRv6',
        textRecognitionBatchSize: 8,
        ortOptions: { backend: 'auto', numThreads: 1, simd: true },
        fetch: trackedFetch,
      });
    })
    .then((ocr) => {
      downloads.clear();
      notifyInit({ status: 'init', progress: 1 });
      return ocr;
    })
    .catch((err) => {
      ocrPromise = null;
      downloads.clear();
      throw new Error(friendlyOcrError(err));
    });

  return ocrPromise.finally(() => {
    if (onProgress) initSubscribers.delete(onProgress);
  });
}

function friendlyOcrError(err) {
  const raw = String(err?.message || err || '');
  if (/Failed to download|HTTP \d+|fetch/i.test(raw)) {
    return '辨識模型下載失敗，請確認網路連線後再試';
  }
  if (/WebGPU|GPU|adapter/i.test(raw)) {
    return '這台裝置的圖形加速無法使用，請改用其他瀏覽器或稍後再試';
  }
  return raw || 'OCR 無法使用';
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

function drawScaled(source, naturalW, naturalH, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** 只縮圖，不做灰階或對比處理。支援 Blob/File、HTMLCanvasElement 與 Data URL。 */
async function prepareImage(input, { maxSide = 2000 } = {}) {
  if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
    if (Math.max(input.width, input.height) <= maxSide) return input;
    return drawScaled(input, input.width, input.height, maxSide);
  }

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    if ('createImageBitmap' in window) {
      try {
        const bitmap = await createImageBitmap(input);
        const canvas = drawScaled(bitmap, Math.max(bitmap.width, 1), Math.max(bitmap.height, 1), maxSide);
        bitmap.close?.();
        return canvas;
      } catch {
        /* 退回 URL.createObjectURL */
      }
    }
    const url = URL.createObjectURL(input);
    try {
      const img = await loadImage(url);
      return drawScaled(
        img,
        Math.max(img.naturalWidth || img.width, 1),
        Math.max(img.naturalHeight || img.height, 1),
        maxSide
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const img = await loadImage(input);
  return drawScaled(
    img,
    Math.max(img.naturalWidth || img.width, 1),
    Math.max(img.naturalHeight || img.height, 1),
    maxSide
  );
}

/* ---------------------------------------------------------------- 排版整理 */

function pointOf(p) {
  if (Array.isArray(p)) return { x: Number(p[0]) || 0, y: Number(p[1]) || 0 };
  return { x: Number(p?.x) || 0, y: Number(p?.y) || 0 };
}

function bboxOf(poly) {
  const points = poly.map(pointOf);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
}

function verticalOverlap(a, b) {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const minH = Math.min(a.h, b.h);
  return minH > 0 ? overlap / minH : 0;
}

function cleanLineText(text) {
  return String(text || '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function groupLines(items) {
  const boxes = (items || [])
    .filter((item) => item && item.text && Array.isArray(item.poly) && item.poly.length)
    .map((item) => ({ text: cleanLineText(item.text), score: Number(item.score) || 0, box: bboxOf(item.poly) }))
    .filter((item) => item.text);

  boxes.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);

  const groups = [];
  for (const item of boxes) {
    let target = null;
    for (const group of groups) {
      if (verticalOverlap(group.box, item.box) > 0.55) {
        target = group;
        break;
      }
    }
    if (!target) {
      groups.push({ items: [item], box: { ...item.box } });
      continue;
    }
    target.items.push(item);
    target.box = {
      x0: Math.min(target.box.x0, item.box.x0),
      x1: Math.max(target.box.x1, item.box.x1),
      y0: Math.min(target.box.y0, item.box.y0),
      y1: Math.max(target.box.y1, item.box.y1),
      w: 0,
      h: 0,
    };
    target.box.w = target.box.x1 - target.box.x0;
    target.box.h = target.box.y1 - target.box.y0;
  }

  return groups
    .map((group) => {
      const sorted = group.items.slice().sort((a, b) => a.box.x0 - b.box.x0);
      const score = sorted.reduce((sum, item) => sum + item.score, 0) / sorted.length;
      return {
        text: cleanLineText(sorted.map((item) => item.text).join(' ')),
        score,
        x: group.box.x0,
        y: group.box.y0,
        w: group.box.w,
        h: group.box.h,
      };
    })
    .filter((line) => line.text)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

async function recognizeItems(canvas, onProgress) {
  const ocr = await getOcr(onProgress);
  onProgress?.({ status: 'recognizing', progress: 0 });
  const [result] = await ocr.predict(canvas);
  return result?.items || [];
}

/* ---------------------------------------------------------------- 方向 */

function rotateCanvas(source, degrees) {
  const swap = degrees % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? source.height : source.width;
  canvas.height = swap ? source.width : source.height;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function orientationStats(lines) {
  const lineCount = lines.length;
  let totalChars = 0;
  let quality = 0;
  let shortLines = 0;
  for (const line of lines) {
    const length = [...line.text].length;
    totalChars += length;
    quality += line.score * Math.min(length, 24);
    if (length <= 2) shortLines += 1;
  }
  return {
    lineCount,
    totalChars,
    quality,
    shortRatio: lineCount ? shortLines / lineCount : 0,
    avgLength: lineCount ? totalChars / lineCount : 0,
  };
}

async function analyzeOrientation(canvas, angle, onProgress) {
  const input = angle ? rotateCanvas(canvas, angle) : canvas;
  const items = await recognizeItems(input, onProgress);
  const lines = groupLines(items);
  const boxes = (items || [])
    .filter((item) => item && Array.isArray(item.poly) && item.poly.length)
    .map((item) => bboxOf(item.poly));
  const tallRatio = boxes.length
    ? boxes.filter((box) => box.h > box.w * 1.15).length / boxes.length
    : 0;
  return {
    angle,
    lines,
    text: lines.map((line) => line.text).join('\n'),
    tallRatio,
    ...orientationStats(lines),
  };
}

function looksRotated(result) {
  if (result.tallRatio >= 0.5) return true;
  if (result.lineCount < 8) return false;
  return result.shortRatio >= 0.4 || result.avgLength < 3.2;
}

async function pickOrientation(canvas, keyCheck, onProgress) {
  let best = await analyzeOrientation(canvas, 0, onProgress);
  best.hasKey = keyCheck(best);
  if (!looksRotated(best)) return best;

  for (const angle of [90, -90, 180]) {
    onProgress?.({ status: 'rotating', angle });
    const candidate = await analyzeOrientation(canvas, angle, onProgress);
    candidate.hasKey = keyCheck(candidate);

    if (candidate.hasKey && !best.hasKey) best = candidate;
    else if (candidate.hasKey === best.hasKey && candidate.quality > best.quality) best = candidate;

    if (best.hasKey && !looksRotated(best)) break;
  }
  return best;
}

/* ---------------------------------------------------------------- 有效期限 */

function mergeCandidates(text, trustedText) {
  const trustedIsos = new Set(findDates(trustedText).map((item) => item.iso));
  const byIso = new Map();

  for (const item of findDates(text)) {
    const cand = {
      iso: item.iso,
      raw: item.raw,
      kind: item.kind,
      score: item.score,
      trusted: trustedIsos.has(item.iso),
      ambiguous: !!item.ambiguous,
    };
    const prev = byIso.get(cand.iso);
    if (!prev) {
      byIso.set(cand.iso, cand);
      continue;
    }
    if (cand.trusted && !prev.trusted) byIso.set(cand.iso, cand);
    else if (cand.trusted === prev.trusted && prev.ambiguous && !cand.ambiguous) byIso.set(cand.iso, cand);
    else if (cand.trusted === prev.trusted && cand.score > prev.score) byIso.set(cand.iso, cand);
  }

  const list = [...byIso.values()].sort(
    (a, b) => Number(b.trusted) - Number(a.trusted) || b.score - a.score
  );
  const hasStrong = list.some((c) => c.score >= 50);
  return hasStrong ? list.filter((c) => c.score >= 40) : list;
}

function extractDateCandidates(result) {
  const trustedText = result.lines
    .filter((line) => line.score >= TRUST_SCORE)
    .map((line) => line.text)
    .join('\n');
  return mergeCandidates(result.text, trustedText);
}

/**
 * 讀取照片中的日期文字，回傳候選日期。
 * @returns {Promise<{text:string, candidates:Array, pass:number, rotation:number}>}
 */
export async function recognizeExpiry(input, { onProgress } = {}) {
  onProgress?.({ status: 'preparing', progress: 0 });
  const canvas = await prepareImage(input, { maxSide: 2000 });
  const result = await pickOrientation(canvas, (item) => findDates(item.text).length > 0, onProgress);
  return {
    text: result.text,
    candidates: extractDateCandidates(result),
    pass: 1,
    rotation: result.angle,
  };
}

/* ---------------------------------------------------------------- 品名 */

const NAME_LABEL_RE = /(品名|商品名|商品名稱|產品名稱|品稱|名稱|名(?=\s*[:：]))\s*[:：]?\s*(.*)$/i;
const NAME_NOISE_RE =
  /(有效日期|有效期限|有效期間|賞味期限|保存期限|製造日期|製造|生產|保存方法|使用方法|注意事項|注意|警告|成分|原料|材質|原產地|產地|地址|電話|客服|網址|批號|LOT|EXP|MFG|保存|請勿|請輕拉|避免|遠離|攝氏|℃)/i;
const FIELD_LABEL_RE = /^([^\s:：]{1,6})\s*[:：]\s*(.+)$/;
const NAME_FIELD_LABELS = /^(品名|商品名|商品名稱|產品名稱|品稱|名稱|品項|品牌)$/;

function cleanProductName(text) {
  return String(text || '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(品名|商品名|商品名稱|產品名稱|品稱|名稱|名)\s*[:：]\s*/i, '')
    .replace(/^(品名|商品名|商品名稱|產品名稱|品稱|名稱)\s*/i, '')
    .replace(/^[\s:：\-—・,，.。]+|[\s:：\-—・,，.。]+$/g, '')
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/\s+([，。、；：])/g, '$1')
    .trim();
}

function isPlausibleName(name) {
  const compact = name.replace(/\s+/g, '');
  if (compact.length < 2 || compact.length > 40) return false;
  if (/^[\d\s.\-/:：年月日()（）]+$/.test(compact)) return false;
  if (/^(exp|mfg|lot|bb|use\s*by|best\s*before)\b/i.test(compact)) return false;
  if (/^[a-z]{1,2}$/i.test(compact)) return false;
  return true;
}

function isNoiseLine(text) {
  return NAME_NOISE_RE.test(text) || /^(www\.|https?:)/i.test(text);
}

function extractProductNames(lines) {
  const found = [];
  const seen = new Set();
  const add = (raw, score) => {
    const name = cleanProductName(raw);
    if (!isPlausibleName(name)) return;
    const key = name.toLowerCase();
    const existing = seen.has(key) ? found.find((c) => c.name.toLowerCase() === key) : null;
    if (existing) {
      existing.score = Math.max(existing.score, score);
      return;
    }
    seen.add(key);
    found.push({ name, score });
  };

  const heights = lines.map((line) => line.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.text.match(NAME_LABEL_RE);

    if (match) {
      const value = match[2];
      if (isPlausibleName(cleanProductName(value))) {
        add(value, 120 + line.score * 20);
      } else if (lines[i + 1]) {
        add(lines[i + 1].text, 105 + lines[i + 1].score * 20);
      }
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (NAME_LABEL_RE.test(line.text)) continue;

    const field = line.text.match(FIELD_LABEL_RE);
    if (field && !NAME_FIELD_LABELS.test(field[1])) continue;

    const name = cleanProductName(line.text);
    if (!isPlausibleName(name)) continue;

    let score = line.score * 40;
    if (i === 0) score += 20;
    else if (i === 1) score += 14;
    else if (i === 2) score += 7;
    else if (i > 8) score -= 8;

    const relH = line.h / medianH;
    if (relH >= 1.25) score += 16;
    else if (relH <= 0.72) score -= 8;

    const len = [...name].length;
    if (len >= 3 && len <= 22) score += 10;
    else if (len > 30) score -= 18;

    if (/[\u3400-\u9fff]/.test(name)) score += 6;
    if (/[，。！？；]/.test(name)) score -= 20;
    if (/^(請|不可|無|避免|使用|存放|並|或|且|於|再)/.test(name)) score -= 12;
    if (isNoiseLine(name)) score -= 45;
    if (/(有限公司|股份有限公司|地址|電話|網址)/.test(name)) score -= 60;

    add(name, score);
  }

  const sorted = found.sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score ?? 0;
  return sorted.filter((c, i) => i === 0 || c.score >= top * 0.68).slice(0, 4);
}

/**
 * 從照片裡挑出最像「品名」的幾個候選。
 */
export async function recognizeProductName(input, { onProgress } = {}) {
  onProgress?.({ status: 'preparing', progress: 0 });
  const canvas = await prepareImage(input, { maxSide: 2000 });
  const result = await pickOrientation(
    canvas,
    (item) => item.lines.some((line) => NAME_LABEL_RE.test(line.text)),
    onProgress
  );
  return {
    text: result.text,
    rotation: result.angle,
    candidates: extractProductNames(result.lines),
  };
}

/**
 * 單拍同時辨識「品名」與「有效期限」：僅執行一次 PaddleOCR 推論。
 */
export async function recognizeLabel(input, { onProgress } = {}) {
  onProgress?.({ status: 'preparing', progress: 0 });
  const canvas = await prepareImage(input, { maxSide: 2000 });
  const result = await pickOrientation(
    canvas,
    (item) =>
      item.lines.some((line) => NAME_LABEL_RE.test(line.text)) || findDates(item.text).length > 0,
    onProgress
  );
  return {
    text: result.text,
    rotation: result.angle,
    nameCandidates: extractProductNames(result.lines),
    dateCandidates: extractDateCandidates(result),
  };
}

/* ---------------------------------------------------------------- 對外狀態 */

export async function terminateOCR() {
  if (!ocrPromise) return;
  try {
    const ocr = await ocrPromise;
    await ocr.dispose?.();
  } catch {
    /* noop */
  }
  ocrPromise = null;
  downloads.clear();
}

export function ocrStatusText(msg) {
  if (!msg) return '準備中…';
  switch (msg.status) {
    case 'sdk':
      return '載入 OCR 元件…';
    case 'models': {
      const pct = Math.round((msg.progress || 0) * 100);
      return pct > 0
        ? `下載辨識模型（第一次約 30 MB）… ${pct}%`
        : '下載辨識模型（第一次約 30 MB）…';
    }
    case 'init':
      return '初始化辨識引擎…';
    case 'preparing':
      return '準備照片…';
    case 'rotating':
      return '照片可能是橫的，嘗試旋轉後再辨識…';
    case 'recognizing':
      return '辨識中，請稍候…';
    default:
      return msg.status || '處理中…';
  }
}
