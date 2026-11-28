import { cameraSupported, BarcodeScanner, decodeImageFile } from '../core/barcode.js';
import { lookupBarcode, normalizeBarcode, inferItemMeta } from '../core/off.js';
import { describeBarcode } from '../core/gtin.js';
import { recognizeExpiry, recognizeProductName, recognizeLabel, ocrStatusText } from '../core/ocr.js';
import {
  addItem,
  getProduct,
  rememberProduct,
  getState,
  findStockItem,
  incrementItemQty,
  getKnownLocations,
} from '../core/store.js';
import { addMonthsISO, todayISO, pickExpiry, fmtDate, relativeZh, daysLeft } from '../core/dates.js';
import { EXPIRY_KINDS, UNIT_SUGGESTIONS, getCategoryMeta } from '../data/presets.js';
import { esc, toast, pickFile, beep, fileToPreviewURL } from '../core/ui.js';
import { openItemEditor } from '../components/itemCard.js';
import { haptic } from '../core/haptics.js';
import { icon } from '../core/icons.js';

const QUICK_MONTHS = { none: null, '6m': 6, '1y': 12, '3y': 36 };
const MODES = [
  { key: 'scan', label: '條碼掃描' },
  { key: 'label', label: '拍照辨識' },
  { key: 'form', label: '手動建檔' },
];

function barcodeMeta(barcode) {
  const info = describeBarcode(barcode);
  if (!info.kind) return { html: '', text: '', warn: false };

  const place = info.region ? `${info.prefix} ${info.region.name}` : `${info.prefix} 未知前綴`;

  if (info.valid === false) {
    return {
      warn: true,
      text: `${info.kind} 檢查碼不符，可能是掃錯或打錯（正確的最後一碼是 ${info.expected}）`,
      html: `<p class="barcode-meta barcode-meta--warn">
          <span class="barcode-tag">${esc(info.kind)}</span>
          <span class="barcode-tag barcode-tag--warn">檢查碼不符</span>
          <span>可能掃錯或打錯，正確的最後一碼是 ${esc(info.expected)}</span>
        </p>`,
    };
  }

  return {
    warn: false,
    text: `${info.kind} · ${place}（註冊地，非產地）`,
    html: `<p class="barcode-meta">
        <span class="barcode-tag">${esc(info.kind)}</span>
        <span class="barcode-tag" title="${esc(info.region?.org || '')}">${esc(place)}</span>
        <span>註冊地，非產地</span>
      </p>`,
  };
}

let autoStarted = false;

export function renderScan(view, ctx) {
  let scanner = null;
  let draft = null;
  let mode = 'scan';
  let nameTouched = false;
  let lookup = { status: 'idle', note: '' };
  let ocr = { status: 'idle', preview: '', candidates: [], note: '', progress: '' };
  let nameOcr = { status: 'idle', preview: '', candidates: [], text: '', note: '', picked: '', used: false };
  let labelOcr = { status: 'idle', preview: '', progress: '', note: '' };
  let lastAuto = null;
  let nudgeTimer = 0;
  let torchOn = false;
  let decoderState = { mode: null, engine: null, nativeAvailable: false };

  const previewUrls = new Set();
  const trackPreview = (file) => {
    const url = fileToPreviewURL(file);
    previewUrls.add(url);
    return url;
  };
  const revokePreviews = () => {
    previewUrls.forEach((u) => URL.revokeObjectURL(u));
    previewUrls.clear();
  };

  const $ = (sel) => view.querySelector(sel);

  function modeBarHTML(activeKey) {
    const idx = Math.max(0, MODES.findIndex((m) => m.key === activeKey));
    return `
      <div class="scan-mode-wrap">
        <div class="segmented" data-scan-mode role="group" aria-label="加入方式" style="--n:${MODES.length};--i:${idx}">
          <span class="segmented-thumb" aria-hidden="true"></span>
          ${MODES.map(
            (m) => `<button type="button" data-mode-val="${m.key}" class="${m.key === activeKey ? 'is-active' : ''}" aria-pressed="${m.key === activeKey}">${m.label}</button>`
          ).join('')}
        </div>
      </div>`;
  }

  function bindModeBar() {
    $('[data-scan-mode]')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-mode-val]');
      if (!btn) return;
      const target = btn.dataset.modeVal;
      haptic('select');
      if (target === 'scan') {
        drawScan();
        startCamera();
      } else if (target === 'label') {
        stopCamera();
        drawLabelMode();
      } else if (target === 'form') {
        if (mode !== 'form') enterForm({});
      }
    });
  }

  /* ---------------------------------------------------------- 相機控制 */

  function showNote(message) {
    const note = $('#scan-note');
    if (!note) {
      toast(message, { type: 'warn', duration: 3600 });
      return;
    }
    note.hidden = false;
    note.textContent = message;
  }

  function hideNote() {
    const note = $('#scan-note');
    if (note) note.hidden = true;
  }

  function updateStageControls() {
    const badge = $('#stage-badge');
    const engineBtn = $('[data-switch-engine]');
    const torchBtn = $('#stage-torch');
    const hint = $('#stage-hint');

    if (badge) {
      if (!scanner || !scanner.isRunning()) badge.textContent = '相機待命';
      else if (decoderState.mode === 'native') badge.textContent = '原生高速引擎';
      else if (decoderState.engine === 'worker') badge.textContent = 'Worker 相容引擎';
      else badge.textContent = '相容掃碼引擎';
    }

    if (engineBtn) {
      engineBtn.hidden = !scanner || !scanner.isRunning();
      engineBtn.textContent = decoderState.mode === 'native' ? '切至相容模式' : '切至原生高速';
      if (decoderState.mode === 'zxing' && !decoderState.nativeAvailable) {
        engineBtn.hidden = true;
      }
    }

    if (torchBtn) {
      torchBtn.hidden = !scanner || !scanner.torchSupported();
      torchBtn.classList.toggle('is-on', torchOn);
      torchBtn.setAttribute('aria-pressed', String(torchOn));
    }

    if (hint && scanner?.isRunning()) {
      hint.textContent =
        decoderState.mode === 'zxing'
          ? '相容模式：把條碼放進框內，保持 15〜20 公分（支援直式條碼）'
          : '將條碼放進框內，會自動高速辨識';
    }
  }

  function stopCamera() {
    const current = scanner;
    scanner = null;
    clearTimeout(nudgeTimer);
    nudgeTimer = 0;
    torchOn = false;
    decoderState = { mode: null, engine: null, nativeAvailable: false };
    if (current) {
      try {
        current.stop();
      } catch {
        /* noop */
      }
    }
    updateStageControls();
  }

  async function startCamera() {
    if (scanner || mode !== 'scan') return;
    const stage = $('#stage');
    const video = $('#cam');
    const hint = $('#stage-hint');
    const btn = $('[data-cam]');
    if (!video || !btn) return;

    if (!(await cameraSupported())) {
      showNote('這個環境無法啟動相機（需要 HTTPS 與瀏覽器權限），請改用下方條碼輸入或拍照辨識。');
      return;
    }

    hideNote();
    torchOn = false;
    hint.textContent = '正在啟動相機…';

    const instance = new BarcodeScanner(video, {
      onDetect: (code) => handleDetected(code),
      onError: (message) => showNote(message),
      onStatus: (status) => {
        if (scanner !== instance) return;
        decoderState = status;
        updateStageControls();
      },
    });
    scanner = instance;

    const watchdog = setTimeout(() => {
      if (scanner === instance && stage?.classList.contains('stage--idle')) {
        hint.textContent = '等待相機權限中…';
        showNote('若瀏覽器跳出相機權限詢問，請按「允許」；也可改用下方輸入條碼。');
      }
    }, 9000);

    try {
      await instance.start();
      clearTimeout(watchdog);
      if (scanner !== instance || mode !== 'scan') return;
      stage.classList.remove('stage--idle');
      btn.innerHTML = `${icon('cameraOff')} 關閉相機`;
      updateStageControls();

      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(() => {
        if (scanner !== instance) return;
        showNote('還是掃不到嗎？讓條碼保持 15〜20 公分避開反光，或切至「相容模式」掃描直式條碼。');
      }, 14000);
    } catch (err) {
      clearTimeout(watchdog);
      const stillCurrent = scanner === instance;
      if (stillCurrent) scanner = null;
      if (!stillCurrent || mode !== 'scan' || !view.isConnected) return;
      hint.textContent = '相機未啟動';
      showNote(err?.message || '相機啟動失敗，請改用下方條碼輸入或拍照辨識。');
      updateStageControls();
    }
  }

  async function toggleTorch() {
    if (!scanner) return;
    torchOn = !torchOn;
    const ok = await scanner.setTorch(torchOn);
    if (!ok) {
      torchOn = false;
      toast('這台裝置不支援手電筒', { type: 'warn' });
    } else {
      haptic('light');
    }
    updateStageControls();
  }

  async function switchEngine() {
    if (!scanner) return;
    const target = decoderState.mode === 'native' ? 'zxing' : 'native';
    await scanner.switchMode(target);
    haptic('select');
    updateStageControls();
  }

  function toggleCamera() {
    if (scanner) {
      stopCamera();
      const stage = $('#stage');
      const hint = $('#stage-hint');
      const btn = $('[data-cam]');
      stage?.classList.add('stage--idle');
      if (hint) hint.textContent = '相機已關閉';
      if (btn) btn.innerHTML = `${icon('camera')} 開啟相機`;
    } else {
      startCamera();
    }
  }

  function onVisibilityChange() {
    if (document.hidden && scanner) {
      stopCamera();
      const stage = $('#stage');
      const hint = $('#stage-hint');
      const btn = $('[data-cam]');
      stage?.classList.add('stage--idle');
      if (hint) hint.textContent = '切至背景時已暫停相機';
      if (btn) btn.innerHTML = `${icon('camera')} 重新開啟相機`;
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange);

  function handleDetected(raw) {
    const code = normalizeBarcode(raw);
    if (!code) {
      showNote(`讀到「${String(raw).slice(0, 40)}」，這不是商品條碼，請改掃 EAN／UPC 條碼。`);
      return;
    }

    beep();
    haptic('success');
    clearTimeout(nudgeTimer);

    const current = scanner;
    scanner = null;
    if (current) setTimeout(() => current.stop(), 40);

    handleCode(code);
  }

  /** 條碼確定後：已建檔且未過期就自動 +1，否則進入建檔表單 */
  function handleCode(code) {
    if (getState().settings.autoCount !== false) {
      const existing = findStockItem(code);
      if (existing) {
        const beforeQty = existing.qty;
        const updated = incrementItemQty(existing.id, 1);
        if (updated && updated.qty > beforeQty) {
          if (!getProduct(code)) {
            rememberProduct(code, {
              name: updated.name,
              category: updated.category,
              unit: updated.unit,
              source: 'library',
            });
          }
          lastAuto = { id: updated.id, beforeQty };
          drawAutoResult(updated, beforeQty);
          return;
        }
        if (updated) {
          toast('這件物品數量已達上限，請直接編輯', { type: 'warn' });
        }
      }
    }

    enterForm({ barcode: code });
  }

  /* ---------------------------------------------------------- 模式一：條碼掃描 */

  function drawScan() {
    mode = 'scan';
    draft = null;
    lastAuto = null;
    lookup = { status: 'idle', note: '' };
    ocr = { status: 'idle', preview: '', candidates: [], note: '', progress: '' };
    nameOcr = { status: 'idle', preview: '', candidates: [], text: '', note: '', picked: '', used: false };

    view.innerHTML = `
      ${modeBarHTML('scan')}

      <section>
        <div class="stage stage--idle" id="stage">
          <video id="cam" playsinline muted autoplay></video>
          <div class="stage-top">
            <span class="stage-badge" id="stage-badge">相機待命</span>
            <div class="stage-controls">
              <button type="button" class="stage-pill-btn" data-switch-engine hidden>切至相容模式</button>
              <button type="button" class="stage-pill-btn" id="stage-torch" data-torch hidden aria-label="開關手電筒" aria-pressed="false">
                ${icon('torch')} 補光
              </button>
            </div>
          </div>
          <div class="stage-overlay" aria-hidden="true">
            <div class="reticle"><span></span><span></span><span></span><span></span></div>
          </div>
          <p class="stage-hint" id="stage-hint">開啟相機後，把條碼放進框內</p>
        </div>

        <div class="notice notice--warn" id="scan-note" hidden style="margin-top:12px"></div>

        <div class="btn-row" style="margin-top:14px">
          <button type="button" class="btn btn--primary" data-cam>${icon('camera')} 開啟相機</button>
          <button type="button" class="btn btn--ghost" data-photo>${icon('image')} 上傳條碼照片</button>
        </div>

        <form class="inline-barcode" data-inline-barcode>
          <input class="input" id="inline-code-input" inputmode="numeric" autocomplete="off" placeholder="或直接輸入 8–14 位條碼數字">
          <button type="submit" class="btn btn--ghost">查詢</button>
        </form>
        <p class="field-hint" id="inline-code-hint">掃描失敗或沒有相機時，可直接貼上或輸入條碼數字。</p>
      </section>
    `;

    bindModeBar();
    $('[data-cam]').addEventListener('click', toggleCamera);
    $('[data-photo]').addEventListener('click', photoScan);
    $('[data-torch]').addEventListener('click', toggleTorch);
    $('[data-switch-engine]').addEventListener('click', switchEngine);

    const inlineInput = $('#inline-code-input');
    const inlineHint = $('#inline-code-hint');
    const baseHint = inlineHint.textContent;

    inlineInput.addEventListener('input', () => {
      const code = normalizeBarcode(inlineInput.value);
      const meta = code ? barcodeMeta(code) : null;
      inlineHint.textContent = meta ? meta.text : baseHint;
      inlineHint.classList.toggle('field-hint--warn', Boolean(meta?.warn));
    });

    $('[data-inline-barcode]').addEventListener('submit', (event) => {
      event.preventDefault();
      const code = normalizeBarcode(inlineInput.value);
      if (!code) {
        toast('請輸入 8～14 位數字的條碼', { type: 'warn' });
        inlineInput.focus();
        return;
      }
      stopCamera();
      handleCode(code);
    });

    if (!autoStarted) {
      autoStarted = true;
      startCamera();
    }
  }

  async function photoScan() {
    const file = await pickFile({ accept: 'image/*' });
    if (!file) return;
    showNote('正在辨識照片中的條碼…');
    try {
      const code = await decodeImageFile(file);
      const clean = normalizeBarcode(code);
      if (clean) {
        hideNote();
        stopCamera();
        handleCode(clean);
      } else {
        showNote('照片裡找不到清楚的一維條碼。換個角度再拍，或直接輸入數字。');
      }
    } catch {
      showNote('照片辨識失敗，請改用條碼輸入。');
    }
  }

  /* ---------------------------------------------------------- 自動計入結果 */

  function drawAutoResult(item, beforeQty) {
    mode = 'result';
    draft = null;
    const expiry = item.expiry
      ? `${fmtDate(item.expiry)}（${relativeZh(daysLeft(item.expiry))}）`
      : '未設定有效期限';
    const place = item.location ? ` · ${item.location}` : '';

    view.innerHTML = `
      ${modeBarHTML('scan')}

      <section class="panel auto-result">
        <p class="kicker">已自動計入</p>
        <h2 class="auto-result-name">${esc(item.name)}</h2>
        <div class="auto-result-qty">
          <span class="auto-qty">${esc(item.qty)}</span>
          <span class="auto-unit">${esc(item.unit)}</span>
          <span class="auto-delta">+1</span>
        </div>
        <p class="auto-result-sub">原本 ${esc(beforeQty)} ${esc(item.unit)}${esc(place)}</p>
        <p class="auto-result-expiry">有效期限 ${esc(expiry)}</p>
        ${
          item.expiry
            ? ''
            : `<div class="notice notice--warn" style="margin-top:12px">
                <span class="notice-mark">${icon('alert')}</span>
                <span>這件物品還沒有設定有效期限，建議順便補上。</span>
              </div>`
        }
        <p class="auto-result-hint">為避免同一個條碼被重複計入，相機已暫停。確認數量後可繼續掃下一件。</p>
      </section>

      <div class="form-actions">
        <button type="button" class="btn btn--primary" data-continue>${icon('scan')} 繼續掃描</button>
        <button type="button" class="btn btn--ghost" data-undo>${icon('undo')} 復原</button>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn btn--quiet" data-edit-current>${icon('edit')} 編輯這件物品</button>
        <a class="btn btn--quiet" href="#/items">查看避難包</a>
      </div>
    `;

    bindModeBar();

    $('[data-continue]').addEventListener('click', () => {
      drawScan();
      startCamera();
    });

    $('[data-undo]').addEventListener('click', () => {
      if (!lastAuto) return;
      incrementItemQty(lastAuto.id, -1);
      haptic('warn');
      toast('已復原數量');
      drawScan();
      startCamera();
    });

    $('[data-edit-current]').addEventListener('click', () => {
      const latest = getState().items.find((i) => i.id === item.id);
      if (latest) openItemEditor(latest);
    });
  }

  /* ---------------------------------------------------------- 模式二：單拍雙辨識 */

  function drawLabelMode() {
    mode = 'label';
    view.innerHTML = `
      ${modeBarHTML('label')}

      <section class="panel label-ocr-hero">
        <span class="empty-mark" aria-hidden="true">${icon('sparkles')}</span>
        <h3>拍下包裝標籤，一次讀出品名與效期</h3>
        <p>使用離線繁體中文 OCR（PP-OCRv6），只需拍一張照即可同時抓出商品名稱、建議分類與有效期限。</p>
        <button type="button" class="btn btn--primary btn--block" data-label-ocr>
          ${icon('camera')} 拍照或選擇標籤照片
        </button>
        <span class="field-hint">首次使用需下載約 30 MB 辨識模型，之後由瀏覽器快取加速。</span>
        <div id="label-ocr-box" style="width:100%;text-align:left"></div>
      </section>
    `;

    bindModeBar();
    renderLabelOcrBox();
    $('[data-label-ocr]').addEventListener('click', runLabelOcr);
  }

  function renderLabelOcrBox() {
    const box = $('#label-ocr-box');
    if (!box) return;
    if (labelOcr.status === 'idle') {
      box.innerHTML = '';
      return;
    }
    const thumb = labelOcr.preview
      ? `<img class="ocr-thumb" src="${labelOcr.preview}" alt="標籤照片預覽">`
      : '';
    if (labelOcr.status === 'loading') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="loading-row"><span class="spinner"></span><span data-label-progress>${esc(labelOcr.progress || '準備讀取…')}</span></div>
        </div>`;
      return;
    }
    if (labelOcr.status === 'error') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="notice notice--err">
            <span class="notice-mark">${icon('alert')}</span>
            <span>${esc(labelOcr.note || '辨識失敗')}，請改用手動建檔。</span>
          </div>
        </div>`;
    }
  }

  async function runLabelOcr() {
    if (labelOcr.status === 'loading') return;
    const file = await pickFile({ accept: 'image/*', capture: 'environment' });
    if (!file) return;

    const preview = trackPreview(file);
    labelOcr = { status: 'loading', preview, progress: '準備照片…', note: '' };
    renderLabelOcrBox();

    try {
      const { text, nameCandidates, dateCandidates } = await recognizeLabel(file, {
        onProgress: (msg) => {
          const node = view.querySelector('[data-label-progress]');
          if (node) node.textContent = ocrStatusText(msg);
        },
      });
      if (!view.isConnected) return;

      labelOcr = { status: 'idle', preview: '', progress: '', note: '' };

      const bestName = nameCandidates[0]?.name || '';
      const inferred = bestName ? inferItemMeta(bestName) : { category: 'other', unit: '個' };
      const trustedDates = dateCandidates.filter((c) => c.trusted && !c.ambiguous);
      const bestDate = trustedDates.length ? pickExpiry(trustedDates) : null;

      enterForm({
        name: bestName,
        category: inferred.category,
        unit: inferred.unit,
        expiry: bestDate,
      });

      nameTouched = Boolean(bestName);
      nameOcr = {
        status: nameCandidates.length ? 'found' : 'none',
        preview,
        candidates: nameCandidates,
        text: text || '',
        note: '',
        picked: bestName,
        used: Boolean(bestName),
      };
      ocr = {
        status: dateCandidates.length ? 'found' : 'none',
        preview,
        candidates: dateCandidates,
        text: text || '',
        note: '',
        progress: '',
        trusted: dateCandidates.some((c) => c.trusted),
        autoFilled: Boolean(bestDate),
      };
      if (bestName) {
        lookup = { status: 'found', note: '已從標籤照片同時帶入品名與分類，可自行微調', source: 'ocr' };
      }
      renderNameOcrBox();
      renderOcrBox();
      updateLookupUI();
      haptic('success');
    } catch (err) {
      labelOcr = {
        status: 'error',
        preview,
        progress: '',
        note: err?.message || 'OCR 元件載入失敗',
      };
      renderLabelOcrBox();
    }
  }

  /* ---------------------------------------------------------- 模式三：建檔表單 */

  function enterForm(seed = {}) {
    stopCamera();
    nameTouched = Boolean(seed.name);
    lastAuto = null;
    lookup = { status: 'idle', note: '' };
    ocr = { status: 'idle', preview: '', candidates: [], note: '', progress: '' };
    nameOcr = { status: 'idle', preview: '', candidates: [], text: '', note: '', picked: '', used: false };
    draft = {
      barcode: '',
      name: '',
      category: 'other',
      qty: 1,
      unit: '個',
      location: '',
      expiry: null,
      expiryKind: '賞味期限',
      note: '',
      ...seed,
    };
    drawForm();
    if (draft.barcode) resolveProduct(draft.barcode);
  }

  async function resolveProduct(code) {
    const cached = getProduct(code);
    if (cached && cached.name) {
      lookup = { status: 'found', note: '已從「我的商品庫」帶入名稱', source: 'library' };
      applyLookup(cached);
      return;
    }

    if (getState().settings.autoLookup === false) {
      lookup = { status: 'miss', note: '自動查詢已關閉，自己取個好認的名字就好。' };
      updateLookupUI();
      return;
    }

    lookup = { status: 'loading', note: '' };
    updateLookupUI();

    const found = await lookupBarcode(code);
    if (!draft || draft.barcode !== code || !view.isConnected) return;

    if (found) {
      lookup = { status: 'found', note: '已從 Open Food Facts 帶入名稱，可自行修改', source: 'off' };
      applyLookup(found);
    } else {
      lookup = {
        status: 'miss',
        note: '查不到這組條碼的商品資料，可拍品名標籤辨識或自行命名。',
      };
      updateLookupUI();
    }
  }

  function applyLookup(data) {
    if (!draft) return;
    if (!nameTouched && data.name) {
      draft.name = data.name;
      const input = $('#f-name');
      if (input) input.value = data.name;
    }
    if (data.category) draft.category = data.category;
    if (data.unit) {
      draft.unit = data.unit;
      const unitInput = $('#f-unit');
      if (unitInput) unitInput.value = data.unit;
    }
    const brand = data.brand ? `${data.brand}${data.quantity ? `・${data.quantity}` : ''}` : '';
    if (brand && lookup.status === 'found') {
      lookup.note = `已帶入 ${brand}，可自行修改`;
    }
    paintCategoryChips();
    updateLookupUI();
  }

  function paintCategoryChips() {
    view.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.cat === draft?.category);
    });
  }

  function updateLookupUI() {
    const note = $('#lookup-note');
    if (!note) return;
    if (lookup.status === 'loading') {
      note.innerHTML = '<span class="loading-row"><span class="spinner"></span>正在查詢商品資料…</span>';
    } else if (lookup.status === 'found' || lookup.status === 'miss') {
      note.textContent = lookup.note;
    } else {
      note.textContent = '';
    }
  }

  function setExpiry(iso) {
    if (!draft) return;
    draft.expiry = iso || null;
    const input = $('#f-expiry');
    if (input) input.value = iso || '';
  }

  function drawForm() {
    mode = 'form';
    const cats = getState().categories;
    const knownLocations = getKnownLocations();

    view.innerHTML = `
      ${modeBarHTML('form')}

      <section class="panel">
        <div class="form-head">
          <div>
            <p class="kicker">${draft.barcode ? `條碼 ${esc(draft.barcode)}` : '建檔確認'}</p>
            <h2>${draft.barcode ? '這件物品是？' : '新增物品'}</h2>
          </div>
          <button type="button" class="btn btn--quiet" data-rescan>${icon('scan')} 重新掃描</button>
        </div>

        ${draft.barcode ? barcodeMeta(draft.barcode).html : ''}

        <label class="field">
          <span class="field-label">名稱</span>
          <input class="input" id="f-name" maxlength="60" placeholder="例如：飲用水 600ml" value="${esc(draft.name)}" autocomplete="off">
          <span class="field-hint" id="lookup-note"></span>
        </label>

        <div class="field">
          <button type="button" class="btn btn--ghost btn--block" data-name-ocr>
            ${icon('camera')} 拍下品名標籤，自動辨識
          </button>
          <div id="name-ocr-box"></div>
        </div>

        <div class="field">
          <span class="field-label">分類</span>
          <div class="chip-row" id="f-cats">
            ${cats
              .map((c) => {
                const meta = getCategoryMeta(c);
                return `<button type="button" class="chip${c.id === draft.category ? ' is-active' : ''}" data-cat="${esc(c.id)}">${icon(meta.icon)} ${esc(c.name)}</button>`;
              })
              .join('')}
          </div>
        </div>

        <div class="field field-row">
          <div class="field">
            <span class="field-label">數量</span>
            <div class="qty-stepper qty-stepper--lg">
              <button type="button" class="qty-btn" data-f-qty="-1" aria-label="減少數量">${icon('minus')}</button>
              <input class="qty-input" id="f-qty" type="number" min="1" max="9999" inputmode="numeric" value="${esc(draft.qty)}">
              <button type="button" class="qty-btn" data-f-qty="1" aria-label="增加數量">${icon('plus')}</button>
            </div>
          </div>
          <label class="field">
            <span class="field-label">單位</span>
            <input class="input" id="f-unit" maxlength="6" value="${esc(draft.unit)}" list="scan-unit-list">
            <datalist id="scan-unit-list">
              ${UNIT_SUGGESTIONS.map((u) => `<option value="${esc(u)}">`).join('')}
            </datalist>
          </label>
        </div>

        <div class="field">
          <div class="chip-row" data-unit-chips>
            ${UNIT_SUGGESTIONS.slice(0, 7)
              .map((u) => `<button type="button" class="chip chip--sm" data-unit-pick="${esc(u)}">${esc(u)}</button>`)
              .join('')}
          </div>
        </div>

        <label class="field">
          <span class="field-label">存放位置</span>
          <input class="input" id="f-location" maxlength="40" placeholder="例如：玄關櫃・下層" value="${esc(draft.location)}" list="scan-locations-list">
          <datalist id="scan-locations-list">
            ${knownLocations.map((loc) => `<option value="${esc(loc)}">`).join('')}
          </datalist>
        </label>

        <div class="field">
          <span class="field-label">有效期限</span>
          <div class="field-row">
            <input class="input" id="f-expiry" type="date" value="${draft.expiry || ''}">
            <select class="select" id="f-kind">
              ${EXPIRY_KINDS.map(
                (k) => `<option value="${esc(k)}"${k === draft.expiryKind ? ' selected' : ''}>${esc(k)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="chip-row" style="margin-top:10px">
            <button type="button" class="chip chip--sm" data-quick="none">無期限</button>
            <button type="button" class="chip chip--sm" data-quick="6m">+6 個月</button>
            <button type="button" class="chip chip--sm" data-quick="1y">+1 年</button>
            <button type="button" class="chip chip--sm" data-quick="3y">+3 年</button>
          </div>
          <button type="button" class="btn btn--ghost btn--block" data-ocr style="margin-top:10px">
            ${icon('camera')} 拍下包裝上的日期，自動讀取
          </button>
          <div id="ocr-box"></div>
        </div>

        <label class="field">
          <span class="field-label">備註</span>
          <textarea class="textarea" id="f-note" maxlength="200" rows="2" placeholder="替換週期、使用方式⋯">${esc(draft.note)}</textarea>
        </label>
      </section>

      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-save-next>儲存並繼續掃描</button>
        <button type="button" class="btn btn--primary" data-save>加入避難包</button>
      </div>
    `;

    bindModeBar();
    bindForm();
    updateLookupUI();
    renderOcrBox();
    renderNameOcrBox();
    setTimeout(() => {
      if (!draft?.name && window.innerWidth > 700) $('#f-name')?.focus({ preventScroll: true });
    }, 120);
  }

  function bindForm() {
    $('#f-name').addEventListener('input', (event) => {
      draft.name = event.target.value;
      nameTouched = true;
    });

    $('#f-cats').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-cat]');
      if (!btn) return;
      draft.category = btn.dataset.cat;
      haptic('select');
      paintCategoryChips();
    });

    const qtyInput = $('#f-qty');
    qtyInput.addEventListener('input', (event) => {
      draft.qty = Math.max(1, Number(event.target.value) || 1);
    });
    view.querySelectorAll('[data-f-qty]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = Number(btn.dataset.fQty) || 0;
        const next = Math.max(1, Math.min(9999, (Number(qtyInput.value) || 1) + delta));
        qtyInput.value = String(next);
        draft.qty = next;
        haptic('select');
      });
    });

    const unitInput = $('#f-unit');
    unitInput.addEventListener('input', (event) => {
      draft.unit = event.target.value || '個';
    });
    $('[data-unit-chips]').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-unit-pick]');
      if (!btn) return;
      draft.unit = btn.dataset.unitPick;
      unitInput.value = draft.unit;
      haptic('select');
    });

    $('#f-location').addEventListener('input', (event) => {
      draft.location = event.target.value;
    });
    $('#f-note').addEventListener('input', (event) => {
      draft.note = event.target.value;
    });
    $('#f-expiry').addEventListener('change', (event) => {
      draft.expiry = event.target.value || null;
    });
    $('#f-kind').addEventListener('change', (event) => {
      draft.expiryKind = event.target.value;
    });

    view.querySelectorAll('[data-quick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const months = QUICK_MONTHS[btn.dataset.quick];
        setExpiry(months === null ? null : addMonthsISO(todayISO(), months));
        haptic('select');
      });
    });

    $('[data-name-ocr]').addEventListener('click', runNameOcr);
    $('[data-ocr]').addEventListener('click', runOcr);
    $('[data-save]').addEventListener('click', () => save({ nextScan: false }));
    $('[data-save-next]').addEventListener('click', () => save({ nextScan: true }));
    $('[data-rescan]').addEventListener('click', () => {
      stopCamera();
      drawScan();
      startCamera();
    });
  }

  /* ---------------------------------------------------------- OCR 區塊 */

  function renderOcrBox() {
    const box = $('#ocr-box');
    if (!box) return;
    if (ocr.status === 'idle') {
      box.innerHTML = '';
      return;
    }

    const thumb = ocr.preview
      ? `<img class="ocr-thumb" src="${ocr.preview}" alt="期限照片預覽">`
      : '';

    if (ocr.status === 'loading') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="loading-row"><span class="spinner"></span><span data-ocr-progress>${esc(ocr.progress || '準備讀取…')}</span></div>
        </div>`;
      return;
    }

    if (ocr.status === 'found') {
      const title = ocr.autoFilled
        ? '讀到這些日期，點一下填入'
        : ocr.trusted
          ? '數字讀得清楚，但不敢斷定哪個是到期日，請點選填入'
          : '辨識信心偏低，請挑一個正確的日期（或直接用日曆選）';
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div>
            <p class="ocr-title">${title}</p>
            <div class="date-candidates">
              ${ocr.candidates
                .slice(0, 4)
                .map(
                  (c) => `
                <button type="button" class="date-cand${c.iso === draft.expiry ? ' is-picked' : ''}" data-iso="${c.iso}">
                  ${fmtDate(c.iso)}
                  <small>${relativeZh(daysLeft(c.iso))}</small>
                </button>`
                )
                .join('')}
            </div>
            ${
              ocr.text
                ? `<p class="ocr-raw">照片文字：${esc(String(ocr.text).replace(/\s+/g, ' ').trim().slice(0, 90))}</p>`
                : ''
            }
          </div>
        </div>`;
      box.querySelectorAll('[data-iso]').forEach((btn) => {
        btn.addEventListener('click', () => {
          setExpiry(btn.dataset.iso);
          renderOcrBox();
          haptic('select');
        });
      });
      return;
    }

    if (ocr.status === 'none') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="notice notice--warn">
            <span class="notice-mark">${icon('alert')}</span>
            <span>照片裡沒辨識到可用的日期，試著避開反光或直接手動選日期。</span>
          </div>
        </div>`;
      return;
    }

    if (ocr.status === 'error') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="notice notice--err">
            <span class="notice-mark">${icon('alert')}</span>
            <span>${esc(ocr.note || 'OCR 無法使用')}。可以直接手動選擇日期。</span>
          </div>
        </div>`;
    }
  }

  function applyName(name) {
    if (!draft || !name) return;
    draft.name = name;
    nameTouched = true;
    nameOcr.picked = name;
    nameOcr.used = true;
    const input = $('#f-name');
    if (input) input.value = name;
    const inferred = inferItemMeta(name);
    if (draft.category === 'other' && inferred.category !== 'other') {
      draft.category = inferred.category;
      paintCategoryChips();
    }
    if (draft.unit === '個' && inferred.unit !== '個') {
      draft.unit = inferred.unit;
      const unitInput = $('#f-unit');
      if (unitInput) unitInput.value = inferred.unit;
    }
    lookup = { status: 'found', note: '已用照片辨識帶入名稱，可自行修改', source: 'ocr' };
    updateLookupUI();
  }

  function renderNameOcrBox() {
    const box = $('#name-ocr-box');
    if (!box) return;
    if (nameOcr.status === 'idle') {
      box.innerHTML = '';
      return;
    }

    const thumb = nameOcr.preview
      ? `<img class="ocr-thumb" src="${nameOcr.preview}" alt="品名照片預覽">`
      : '';

    if (nameOcr.status === 'loading') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="loading-row"><span class="spinner"></span><span data-name-ocr-progress>${esc(nameOcr.progress || '準備讀取…')}</span></div>
        </div>`;
      return;
    }

    if (nameOcr.status === 'found') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div>
            <p class="ocr-title">點一下填入最正確的名稱：</p>
            <div class="name-candidates">
              ${nameOcr.candidates
                .map(
                  (c, i) => `
                <button type="button" class="name-cand${c.name === nameOcr.picked ? ' is-picked' : ''}" data-name="${esc(c.name)}">
                  <span>${esc(c.name)}</span>
                  <small>${c.name === nameOcr.picked ? '已填入' : i === 0 ? '最像' : ''}</small>
                </button>`
                )
                .join('')}
            </div>
            ${
              nameOcr.text
                ? `<p class="ocr-raw">照片文字：${esc(String(nameOcr.text).replace(/\s+/g, ' ').trim().slice(0, 120))}</p>`
                : ''
            }
          </div>
        </div>`;
      box.querySelectorAll('[data-name]').forEach((btn) => {
        btn.addEventListener('click', () => {
          applyName(btn.dataset.name);
          renderNameOcrBox();
          haptic('select');
        });
      });
      return;
    }

    if (nameOcr.status === 'none') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="notice notice--warn">
            <span class="notice-mark">${icon('alert')}</span>
            <span>照片裡找不到清楚的品名，試著只拍名稱那一行或直接輸入。</span>
          </div>
        </div>`;
      return;
    }

    if (nameOcr.status === 'error') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="notice notice--err">
            <span class="notice-mark">${icon('alert')}</span>
            <span>${esc(nameOcr.note || 'OCR 無法使用')}。可以直接輸入名稱。</span>
          </div>
        </div>`;
    }
  }

  async function runNameOcr() {
    if (!draft || nameOcr.status === 'loading') return;
    if (ocr.status === 'loading') {
      toast('目前正在讀取日期，請稍候再辨識品名', { type: 'warn' });
      return;
    }

    const file = await pickFile({ accept: 'image/*', capture: 'environment' });
    if (!file || !draft) return;

    const preview = trackPreview(file);
    nameOcr = { status: 'loading', preview, candidates: [], text: '', note: '', picked: '', used: false, progress: '準備照片…' };
    renderNameOcrBox();

    try {
      const { candidates, text } = await recognizeProductName(file, {
        onProgress: (msg) => {
          const node = view.querySelector('[data-name-ocr-progress]');
          if (node) node.textContent = ocrStatusText(msg);
        },
      });
      if (!view.isConnected || !draft) return;

      nameOcr.text = text || '';
      nameOcr.candidates = candidates || [];
      nameOcr.status = nameOcr.candidates.length ? 'found' : 'none';
      nameOcr.progress = '';

      const best = nameOcr.candidates[0];
      if (best && !nameTouched) applyName(best.name);
      renderNameOcrBox();
    } catch (err) {
      nameOcr = {
        status: 'error',
        preview,
        candidates: [],
        text: '',
        note: err?.message || 'OCR 元件載入失敗',
        picked: '',
        used: false,
        progress: '',
      };
      renderNameOcrBox();
    }
  }

  async function runOcr() {
    if (!draft || ocr.status === 'loading') return;
    if (nameOcr.status === 'loading') {
      toast('目前正在辨識品名，請稍候再讀取日期', { type: 'warn' });
      return;
    }

    const file = await pickFile({ accept: 'image/*', capture: 'environment' });
    if (!file || !draft) return;

    const preview = trackPreview(file);
    ocr = { status: 'loading', preview, candidates: [], note: '', progress: '準備照片…' };
    renderOcrBox();

    try {
      const { candidates, text } = await recognizeExpiry(file, {
        onProgress: (msg) => {
          const node = view.querySelector('[data-ocr-progress]');
          if (node) node.textContent = ocrStatusText(msg);
        },
      });
      if (!view.isConnected || !draft) return;

      ocr.text = text || '';
      if (candidates.length) {
        ocr.status = 'found';
        ocr.candidates = candidates;
        const trusted = candidates.filter((c) => c.trusted && !c.ambiguous);
        ocr.trusted = candidates.some((c) => c.trusted);
        const best = trusted.length ? pickExpiry(trusted) : null;
        ocr.autoFilled = Boolean(best);
        if (best) setExpiry(best);
      } else {
        ocr.status = 'none';
        ocr.trusted = false;
        ocr.autoFilled = false;
      }
      renderOcrBox();
    } catch (err) {
      ocr = {
        status: 'error',
        preview,
        candidates: [],
        note: err?.message || 'OCR 元件載入失敗',
        progress: '',
      };
      renderOcrBox();
    }
  }

  /* ---------------------------------------------------------- 儲存 */

  function save({ nextScan = false } = {}) {
    if (!draft) return;
    const nameInput = $('#f-name');
    const name = String(nameInput?.value || draft.name || '').trim();
    if (!name) {
      nameInput?.focus();
      nameInput?.classList.add('is-invalid');
      toast('請填寫物品名稱', { type: 'warn' });
      return;
    }

    draft.name = name;
    addItem({ ...draft, expiry: draft.expiry || null });

    if (draft.barcode) {
      rememberProduct(draft.barcode, {
        name,
        category: draft.category,
        unit: draft.unit,
        source: nameOcr.used ? 'ocr' : 'manual',
      });
    }

    haptic('success');
    toast(`已加入「${name}」`);

    if (nextScan) {
      drawScan();
      startCamera();
      return;
    }
    ctx.navigate('#/items');
  }

  /* ---------------------------------------------------------- 啟動 */

  drawScan();

  return {
    refresh() {},
    destroy() {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopCamera();
      revokePreviews();
    },
  };
}
