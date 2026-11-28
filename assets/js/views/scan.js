import { cameraSupported, BarcodeScanner, decodeImageFile } from '../core/barcode.js';
import { lookupBarcode, normalizeBarcode, inferItemMeta } from '../core/off.js';
import { describeBarcode } from '../core/gtin.js';
import { recognizeExpiry, recognizeProductName, ocrStatusText } from '../core/ocr.js';
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
import { esc, toast, pickFile, beep, fileToPreviewURL, sparkleBurst } from '../core/ui.js';
import { scannerIdleHUD } from '../components/illustrations.js';
import { haptic } from '../core/haptics.js';
import { icon } from '../core/icons.js';

const QUICK_MONTHS = { none: null, '6m': 6, '1y': 12, '3y': 36 };
const MODES = [
  { key: 'scan', label: '掃描條碼' },
  { key: 'form', label: '手動新增' },
];
const SUB_TOOLS = [
  { key: 'name', label: '掃描品名', icon: 'tag' },
  { key: 'expiry', label: '掃描有效期限', icon: 'calendar' },
  { key: 'barcode', label: '掃描條碼', icon: 'barcode' },
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
    text: `${info.kind} · ${place}（註冊地，不是產地）`,
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
  let mode = 'scan'; // 'scan' | 'scan-result' | 'form'
  let activeSubTool = null; // null | 'name' | 'expiry' | 'barcode'
  let nameTouched = false;
  let lookup = { status: 'idle', note: '', source: '' };
  let ocr = { status: 'idle', preview: '', candidates: [], note: '', progress: '' };
  let nameOcr = { status: 'idle', preview: '', candidates: [], text: '', note: '', picked: '', used: false };
  let existingStock = null;
  let nudgeTimer = 0;
  let torchOn = false;
  let decoderState = { mode: null, engine: null, nativeAvailable: false };
  let activeCameraDetect = null;

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
        <div class="segmented" data-scan-mode role="group" aria-label="新增方法" style="--n:${MODES.length};--i:${idx}">
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
        if (mode !== 'scan') {
          stopCamera();
          drawScan();
          startCamera(handleMainBarcode);
        }
      } else if (target === 'form') {
        if (mode !== 'form') enterForm({});
      }
    });
  }

  /* ---------------------------------------------------------- 相機控制 */

  function stageHTML({ compact = false, idleHint = '開啟相機後，把條碼放進框內' } = {}) {
    return `
      <div class="stage stage--idle${compact ? ' stage--compact' : ''}" id="stage">
        <video id="cam" playsinline muted autoplay></video>
        <div class="stage-idle-hud" aria-hidden="true">${scannerIdleHUD()}</div>
        <div class="stage-top">
          <span class="stage-badge" id="stage-badge">STANDBY // 相機待命</span>
          <div class="stage-controls">
            <button type="button" class="stage-pill-btn" data-switch-engine hidden>切至相容模式</button>
            <button type="button" class="stage-pill-btn" id="stage-torch" data-torch hidden aria-label="開關手電筒" aria-pressed="false">
              ${icon('torch')} 補光
            </button>
          </div>
        </div>
        <div class="stage-overlay" aria-hidden="true">
          <div class="reticle">
            <span></span><span></span><span></span><span></span>
            <div class="scan-beam"></div>
          </div>
        </div>
        <p class="stage-hint" id="stage-hint">${esc(idleHint)}</p>
      </div>`;
  }

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
      if (!scanner || !scanner.isRunning()) badge.textContent = 'STANDBY // 相機待命';
      else if (decoderState.mode === 'native') badge.textContent = 'NATIVE // 高速引擎';
      else if (decoderState.engine === 'worker') badge.textContent = 'WORKER // 背景引擎';
      else badge.textContent = 'COMPAT // 相容引擎';
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
    activeCameraDetect = null;
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

  async function startCamera(onDetectedCode) {
    if (scanner) return;
    const stage = $('#stage');
    const video = $('#cam');
    const hint = $('#stage-hint');
    const btn = $('[data-cam]');
    if (!video || !btn) return;

    if (!(await cameraSupported())) {
      showNote('這個環境無法啟動相機（需要 HTTPS 與瀏覽器權限），請改用「上傳照片」或直接輸入條碼數字。');
      return;
    }

    hideNote();
    torchOn = false;
    activeCameraDetect = onDetectedCode;
    if (hint) hint.textContent = '正在啟動相機…';

    const instance = new BarcodeScanner(video, {
      onDetect: (raw) => handleDetected(raw, onDetectedCode),
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
        if (hint) hint.textContent = '等待相機權限中…';
        showNote('若瀏覽器跳出相機權限詢問，請按「允許」；也可改用上傳條碼照片或輸入數字。');
      }
    }, 9000);

    try {
      await instance.start();
      clearTimeout(watchdog);
      if (scanner !== instance || !video.isConnected) return;
      stage?.classList.remove('stage--idle');
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
      if (!stillCurrent || !view.isConnected || !video.isConnected) return;
      if (hint) hint.textContent = '相機未啟動';
      showNote(err?.message || '相機啟動失敗，請改用上傳照片或直接輸入條碼數字。');
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

  function toggleCamera(onDetectedCode) {
    if (scanner) {
      stopCamera();
      const stage = $('#stage');
      const hint = $('#stage-hint');
      const btn = $('[data-cam]');
      stage?.classList.add('stage--idle');
      if (hint) hint.textContent = '相機已關閉';
      if (btn) btn.innerHTML = `${icon('camera')} 開啟相機`;
    } else {
      startCamera(onDetectedCode);
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

  function handleDetected(raw, onDetectedCode) {
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

    const cb = onDetectedCode || activeCameraDetect || handleMainBarcode;
    cb(code);
  }

  async function photoBarcodeScan({ capture = null, onDecoded } = {}) {
    const file = await pickFile({ accept: 'image/*', capture });
    if (!file) return;
    showNote('正在辨識照片中的條碼…');
    try {
      const code = await decodeImageFile(file);
      const clean = normalizeBarcode(code);
      if (clean) {
        hideNote();
        beep();
        haptic('success');
        stopCamera();
        onDecoded?.(clean);
      } else {
        showNote('照片裡找不到清楚的一維條碼。換個角度再拍，或直接輸入條碼數字。');
      }
    } catch {
      showNote('照片辨識失敗，請改用條碼輸入。');
    }
  }

  /* ---------------------------------------------------------- 模式一：掃描條碼 */

  function handleMainBarcode(code) {
    enterScanResult(code);
  }

  function drawScan() {
    mode = 'scan';
    draft = null;
    existingStock = null;
    activeSubTool = null;
    lookup = { status: 'idle', note: '', source: '' };
    ocr = { status: 'idle', preview: '', candidates: [], note: '', progress: '' };
    nameOcr = { status: 'idle', preview: '', candidates: [], text: '', note: '', picked: '', used: false };

    view.innerHTML = `
      ${modeBarHTML('scan')}

      <section class="scan-studio">
        ${stageHTML()}

        <div class="panel scan-deck">
          <div class="scan-deck-head">
            <span class="kicker">OPTICAL DECK</span>
            <h2>掃描條碼入包</h2>
            <p class="scan-deck-sub">對準條碼或上傳照片，掃完後可直接帶入品名並補上有效日期。</p>
          </div>

          <div class="scan-deck-actions">
            <button type="button" class="btn btn--primary" data-cam>${icon('camera')} 開啟相機</button>
            <button type="button" class="btn btn--ghost" data-photo>${icon('image')} 上傳條碼照片</button>
          </div>

          <form class="inline-barcode" data-inline-barcode>
            <input class="input" id="inline-code-input" inputmode="numeric" autocomplete="off" placeholder="輸入 8–14 位條碼數字">
            <button type="submit" class="btn btn--ghost">查詢</button>
          </form>
          <p class="field-hint" id="inline-code-hint">掃描失敗或沒有相機時，可直接貼上或輸入條碼數字。</p>

          <div class="notice notice--warn" id="scan-note" hidden></div>

          <div class="scan-specs" aria-hidden="true">
            <span class="scan-spec-pill">自動帶入綁定品名</span>
            <span class="scan-spec-pill">掃後設定效期</span>
            <span class="scan-spec-pill">支援上傳照片</span>
          </div>
        </div>
      </section>
    `;

    bindModeBar();
    $('[data-cam]').addEventListener('click', () => toggleCamera(handleMainBarcode));
    $('[data-photo]').addEventListener('click', () =>
      photoBarcodeScan({ capture: null, onDecoded: handleMainBarcode })
    );
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
      handleMainBarcode(code);
    });

    if (!autoStarted) {
      autoStarted = true;
      startCamera(handleMainBarcode);
    }
  }

  /* ---------------------------------------------------------- 條碼掃描結果（必可補加有效日期） */

  function enterScanResult(code) {
    stopCamera();
    mode = 'scan-result';
    activeSubTool = null;
    existingStock = findStockItem(code);
    const cached = getProduct(code);
    const seedName = cached?.name || existingStock?.name || '';

    nameTouched = Boolean(seedName);
    lookup = { status: 'idle', note: '', source: '' };
    ocr = { status: 'idle', preview: '', candidates: [], note: '', progress: '' };
    nameOcr = { status: 'idle', preview: '', candidates: [], text: '', note: '', picked: '', used: false };

    draft = {
      barcode: code,
      name: seedName,
      category: cached?.category || existingStock?.category || 'other',
      qty: 1,
      unit: cached?.unit || existingStock?.unit || '個',
      location: existingStock?.location || '',
      expiry: null,
      expiryKind: existingStock?.expiryKind || '賞味期限',
      note: existingStock?.note || '',
    };

    if (cached?.name) {
      lookup = { status: 'found', note: '已從「我的商品庫」帶入綁定品名與分類', source: cached.source || 'library' };
    } else if (existingStock?.name) {
      lookup = { status: 'found', note: '已帶入避難包既有物品名稱，可補上這次的有效期限', source: 'library' };
    }

    drawScanResult();
    if (!seedName) resolveProduct(code);
  }

  function drawScanResult() {
    mode = 'scan-result';
    const cats = getState().categories;
    const knownLocations = getKnownLocations();
    const sameExpiryQuick = existingStock?.expiry
      ? `<button type="button" class="chip chip--sm" data-quick-iso="${esc(existingStock.expiry)}">同現有效期 ${fmtDate(existingStock.expiry)}</button>`
      : '';

    view.innerHTML = `
      ${modeBarHTML('scan')}

      <section class="panel">
        <div class="form-head">
          <div>
            <p class="kicker">BARCODE SCANNED // 條碼 ${esc(draft.barcode)}</p>
            <h2>${draft.name ? '設定有效日期並加入' : '設定品名與有效日期'}</h2>
          </div>
          <button type="button" class="btn btn--quiet" data-rescan>${icon('scan')} 重新掃描</button>
        </div>

        ${barcodeMeta(draft.barcode).html}

        ${
          existingStock
            ? `<div class="notice scan-stock-notice">
                <span class="notice-mark">${icon('info')}</span>
                <span>避難包內已有「${esc(existingStock.name)}」共 ${esc(existingStock.qty)} ${esc(existingStock.unit)}（${
                  existingStock.expiry ? `效期 ${fmtDate(existingStock.expiry)}` : '未設定有效期限'
                }）。若這批效期相同會自動累加數量，不同效期則另記一筆。</span>
              </div>`
            : ''
        }

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
            ${sameExpiryQuick}
            <button type="button" class="chip chip--sm" data-quick="none">無期限</button>
            <button type="button" class="chip chip--sm" data-quick="6m">+6 個月</button>
            <button type="button" class="chip chip--sm" data-quick="1y">+1 年</button>
            <button type="button" class="chip chip--sm" data-quick="3y">+3 年</button>
          </div>
          <div class="subtool-actions" style="margin-top:10px">
            <button type="button" class="btn btn--ghost" data-ocr-cam>${icon('camera')} 拍照辨識效期</button>
            <button type="button" class="btn btn--ghost" data-ocr-upload>${icon('image')} 上傳效期照片</button>
          </div>
          <div id="ocr-box"></div>
        </div>

        <label class="field">
          <span class="field-label">名稱</span>
          <input class="input" id="f-name" maxlength="60" placeholder="例如：飲用水 600ml" value="${esc(draft.name)}" autocomplete="off">
          <span class="field-hint" id="lookup-note"></span>
        </label>

        <div class="field">
          <div class="subtool-actions">
            <button type="button" class="btn btn--ghost" data-name-ocr-cam>${icon('camera')} 拍照辨識品名</button>
            <button type="button" class="btn btn--ghost" data-name-ocr-upload>${icon('image')} 上傳品名照片</button>
          </div>
          <div id="name-ocr-box"></div>
        </div>

        ${commonDetailFieldsHTML(cats, knownLocations)}
      </section>

      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-save-next>儲存並繼續掃描</button>
        <button type="button" class="btn btn--primary" data-save>加入避難包</button>
      </div>
    `;

    bindModeBar();
    bindCommonFields();
    $('[data-ocr-cam]')?.addEventListener('click', () => runOcr({ capture: 'environment' }));
    $('[data-ocr-upload]')?.addEventListener('click', () => runOcr({ capture: null }));
    $('[data-name-ocr-cam]')?.addEventListener('click', () => runNameOcr({ capture: 'environment' }));
    $('[data-name-ocr-upload]')?.addEventListener('click', () => runNameOcr({ capture: null }));
    $('[data-rescan]')?.addEventListener('click', () => {
      stopCamera();
      drawScan();
      startCamera(handleMainBarcode);
    });
    view.querySelectorAll('[data-quick-iso]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setExpiry(btn.dataset.quickIso);
        haptic('select');
      });
    });

    updateLookupUI();
    renderOcrBox();
    renderNameOcrBox();
  }

  /* ---------------------------------------------------------- 模式二：手動新增 */

  function enterForm(seed = {}) {
    stopCamera();
    mode = 'form';
    activeSubTool = null;
    existingStock = null;
    nameTouched = Boolean(seed.name);
    lookup = { status: 'idle', note: '', source: '' };
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

  function syncSubToolBadges() {
    const doneMap = {
      name: Boolean(String(draft?.name || '').trim()),
      expiry: Boolean(draft?.expiry),
      barcode: Boolean(draft?.barcode),
    };
    view.querySelectorAll('[data-subtool]').forEach((btn) => {
      const key = btn.dataset.subtool;
      const isActive = key === activeSubTool;
      btn.classList.toggle('is-active', isActive);
      btn.classList.toggle('is-done', Boolean(doneMap[key]));
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  function renderSubToolPanel() {
    const panel = $('#subtool-panel');
    if (!panel) return;
    stopCamera();

    if (!activeSubTool) {
      panel.hidden = true;
      panel.innerHTML = '';
      syncSubToolBadges();
      return;
    }

    panel.hidden = false;
    if (activeSubTool === 'name') {
      panel.innerHTML = `
        <p class="subtool-desc">拍下或上傳包裝品名照片，自動辨識並填入「名稱」與建議分類。</p>
        <div class="subtool-actions">
          <button type="button" class="btn btn--primary" data-sub-name-cam>${icon('camera')} 拍照掃描品名</button>
          <button type="button" class="btn btn--ghost" data-sub-name-upload>${icon('image')} 上傳品名照片</button>
        </div>
        <div id="name-ocr-box"></div>
      `;
      $('[data-sub-name-cam]').addEventListener('click', () => runNameOcr({ capture: 'environment' }));
      $('[data-sub-name-upload]').addEventListener('click', () => runNameOcr({ capture: null }));
      renderNameOcrBox();
    } else if (activeSubTool === 'expiry') {
      panel.innerHTML = `
        <p class="subtool-desc">拍下或上傳包裝上的日期，自動辨識並填入「有效期限」。</p>
        <div class="subtool-actions">
          <button type="button" class="btn btn--primary" data-sub-expiry-cam>${icon('camera')} 拍照掃描效期</button>
          <button type="button" class="btn btn--ghost" data-sub-expiry-upload>${icon('image')} 上傳效期照片</button>
        </div>
        <div id="ocr-box"></div>
      `;
      $('[data-sub-expiry-cam]').addEventListener('click', () => runOcr({ capture: 'environment' }));
      $('[data-sub-expiry-upload]').addEventListener('click', () => runOcr({ capture: null }));
      renderOcrBox();
    } else if (activeSubTool === 'barcode') {
      panel.innerHTML = `
        <p class="subtool-desc">掃描或上傳商品條碼來綁定品名與條碼，儲存後下次直接掃描條碼即可帶入。</p>
        ${stageHTML({ compact: true, idleHint: '點擊「開啟相機」掃描條碼，或改用上傳照片' })}
        <div class="subtool-actions">
          <button type="button" class="btn btn--primary" data-cam>${icon('camera')} 開啟相機掃碼</button>
          <button type="button" class="btn btn--ghost" data-sub-barcode-upload>${icon('image')} 上傳條碼照片</button>
        </div>
        <div class="notice notice--warn" id="scan-note" hidden></div>
      `;
      $('[data-cam]').addEventListener('click', () => toggleCamera(applyFormBarcode));
      $('[data-sub-barcode-upload]').addEventListener('click', () =>
        photoBarcodeScan({ capture: null, onDecoded: applyFormBarcode })
      );
      $('[data-torch]').addEventListener('click', toggleTorch);
      $('[data-switch-engine]').addEventListener('click', switchEngine);
    }

    syncSubToolBadges();
  }

  function applyFormBarcode(code) {
    if (!draft) return;
    draft.barcode = code;
    const input = $('#f-barcode');
    if (input) input.value = code;
    updateFormBarcodeUI();
    syncSubToolBadges();

    // 若是在手動新增的子選項掃到條碼，停掉相機並收合提示使用者已填入
    const stage = $('#stage');
    const hint = $('#stage-hint');
    const camBtn = $('[data-cam]');
    stage?.classList.add('stage--idle');
    if (hint) hint.textContent = `已掃入條碼 ${code}`;
    if (camBtn) camBtn.innerHTML = `${icon('camera')} 重新開啟相機`;

    resolveProduct(code);
  }

  function updateFormBarcodeUI() {
    const metaBox = $('#form-barcode-meta');
    const bindBox = $('#form-barcode-bind');
    const clearBtn = $('[data-clear-barcode]');
    const raw = String($('#f-barcode')?.value ?? draft?.barcode ?? '').trim();
    const clean = normalizeBarcode(raw);

    if (clearBtn) clearBtn.hidden = !raw;

    if (metaBox) {
      if (clean) {
        metaBox.innerHTML = barcodeMeta(clean).html;
      } else if (raw) {
        metaBox.innerHTML = `<p class="field-hint field-hint--warn">請輸入 8～14 位數字的標準商品條碼。</p>`;
      } else {
        metaBox.innerHTML = '';
      }
    }

    if (bindBox) {
      const name = String(draft?.name || '').trim();
      if (clean && name) {
        bindBox.hidden = false;
        bindBox.textContent = `儲存後將綁定「${name}」↔ 條碼 ${clean}，下次可直接掃描條碼帶入。`;
      } else if (clean) {
        bindBox.hidden = false;
        bindBox.textContent = `已填入條碼 ${clean}，請輸入或掃描品名以完成綁定。`;
      } else {
        bindBox.hidden = true;
        bindBox.textContent = '';
      }
    }
  }

  function commonDetailFieldsHTML(cats, knownLocations) {
    return `
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

      <label class="field">
        <span class="field-label">備註</span>
        <textarea class="textarea" id="f-note" maxlength="200" rows="2" placeholder="替換週期、使用方式⋯">${esc(draft.note)}</textarea>
      </label>
    `;
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
            <p class="kicker">MANUAL ENTRY // 手動新增</p>
            <h2>新增物品與條碼綁定</h2>
          </div>
        </div>

        <div class="scan-subtools" aria-label="手動新增掃描選項">
          <div class="scan-subtools-head">
            <span class="field-label" style="margin-bottom:0">掃描或上傳照片帶入</span>
            <span class="hint">點選子項目展開</span>
          </div>
          <div class="subtool-tabs" role="group" aria-label="掃描子選項">
            ${SUB_TOOLS.map(
              (t) => `
              <button type="button" class="subtool-btn" data-subtool="${t.key}" aria-pressed="false">
                ${icon(t.icon)}
                <span>${t.label}</span>
              </button>`
            ).join('')}
          </div>
          <div class="subtool-panel" id="subtool-panel" hidden></div>
        </div>

        <label class="field">
          <span class="field-label">名稱</span>
          <input class="input" id="f-name" maxlength="60" placeholder="例如：飲用水 600ml" value="${esc(draft.name)}" autocomplete="off">
          <span class="field-hint" id="lookup-note"></span>
        </label>

        <div class="field">
          <span class="field-label">條碼（選填，用來綁定品名）</span>
          <div class="barcode-input-wrap">
            <input class="input" id="f-barcode" inputmode="numeric" maxlength="18" placeholder="點上方「掃描條碼」或輸入 8–14 位數字" value="${esc(draft.barcode)}" autocomplete="off">
            <button type="button" class="barcode-clear-btn" data-clear-barcode aria-label="清除條碼" ${draft.barcode ? '' : 'hidden'}>${icon('x')}</button>
          </div>
          <div id="form-barcode-meta"></div>
          <p class="barcode-bind-hint" id="form-barcode-bind" hidden></p>
        </div>

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
        </div>

        ${commonDetailFieldsHTML(cats, knownLocations)}
      </section>

      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-save-next>儲存並繼續新增</button>
        <button type="button" class="btn btn--primary" data-save>加入避難包</button>
      </div>
    `;

    bindModeBar();
    bindCommonFields();

    view.querySelectorAll('[data-subtool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.subtool;
        activeSubTool = activeSubTool === key ? null : key;
        haptic('select');
        renderSubToolPanel();
      });
    });

    const barcodeInput = $('#f-barcode');
    let lookupTimer = 0;
    barcodeInput?.addEventListener('input', () => {
      barcodeInput.classList.remove('is-invalid');
      const clean = normalizeBarcode(barcodeInput.value);
      draft.barcode = clean;
      updateFormBarcodeUI();
      syncSubToolBadges();
      clearTimeout(lookupTimer);
      if (clean) {
        lookupTimer = setTimeout(() => {
          if (draft?.barcode === clean) resolveProduct(clean);
        }, 320);
      } else {
        lookup = { status: 'idle', note: '', source: '' };
        updateLookupUI();
      }
    });

    $('[data-clear-barcode]')?.addEventListener('click', () => {
      if (!draft) return;
      draft.barcode = '';
      if (barcodeInput) barcodeInput.value = '';
      lookup = { status: 'idle', note: '', source: '' };
      updateLookupUI();
      updateFormBarcodeUI();
      syncSubToolBadges();
      haptic('select');
    });

    renderSubToolPanel();
    updateLookupUI();
    updateFormBarcodeUI();
    syncSubToolBadges();

    setTimeout(() => {
      if (!draft?.name && window.innerWidth > 700) $('#f-name')?.focus({ preventScroll: true });
    }, 120);
  }

  function bindCommonFields() {
    $('#f-name').addEventListener('input', (event) => {
      event.target.classList.remove('is-invalid');
      draft.name = event.target.value;
      nameTouched = Boolean(draft.name.trim());
      if (mode === 'form') {
        updateFormBarcodeUI();
        syncSubToolBadges();
      }
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
      if (mode === 'form') syncSubToolBadges();
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

    $('[data-save]').addEventListener('click', (event) => save({ nextScan: false, triggerEl: event.currentTarget }));
    $('[data-save-next]').addEventListener('click', (event) => save({ nextScan: true, triggerEl: event.currentTarget }));
  }

  /* ---------------------------------------------------------- 商品查詢 & 綁定 */

  async function resolveProduct(code) {
    const cached = getProduct(code);
    if (cached && cached.name) {
      lookup = { status: 'found', note: '已從「我的商品庫」帶入綁定品名', source: cached.source || 'library' };
      applyLookup(cached);
      return;
    }

    if (getState().settings.autoLookup === false) {
      lookup = {
        status: 'miss',
        note: '我的商品庫尚未綁定此條碼，填寫或掃描品名後儲存即可完成綁定。',
        source: '',
      };
      updateLookupUI();
      return;
    }

    lookup = { status: 'loading', note: '', source: '' };
    updateLookupUI();

    const found = await lookupBarcode(code);
    if (!draft || draft.barcode !== code || !view.isConnected) return;

    if (found) {
      lookup = { status: 'found', note: '已從 Open Food Facts 帶入名稱，可自行修改', source: 'off' };
      applyLookup(found);
    } else {
      lookup = {
        status: 'miss',
        note: '查不到這組條碼的商品資料，可掃描品名標籤或自行命名，儲存後即綁定此條碼。',
        source: '',
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
    } else if (nameTouched && data.name && draft.name.trim() !== data.name) {
      lookup = {
        status: 'found',
        note: `商品庫已有「${data.name}」，目前保留你輸入的品名，儲存時將更新綁定。`,
        source: lookup.source || 'manual',
      };
    }

    if (mode === 'form') {
      updateFormBarcodeUI();
      syncSubToolBadges();
    }
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
    if (mode === 'form') syncSubToolBadges();
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
    if (mode === 'form') {
      updateFormBarcodeUI();
      syncSubToolBadges();
    }
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

  async function runNameOcr({ capture = null } = {}) {
    if (!draft || nameOcr.status === 'loading') return;
    if (ocr.status === 'loading') {
      toast('目前正在讀取日期，請稍候再辨識品名', { type: 'warn' });
      return;
    }

    const file = await pickFile({ accept: 'image/*', capture });
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

  async function runOcr({ capture = null } = {}) {
    if (!draft || ocr.status === 'loading') return;
    if (nameOcr.status === 'loading') {
      toast('目前正在辨識品名，請稍候再讀取日期', { type: 'warn' });
      return;
    }

    const file = await pickFile({ accept: 'image/*', capture });
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

  function findSameBatchItem(code, expiryISO) {
    if (!code) return null;
    const today = todayISO();
    const targetExpiry = expiryISO || null;
    return (
      getState().items.find(
        (item) =>
          item.barcode === code &&
          (item.expiry || null) === targetExpiry &&
          (!item.expiry || item.expiry >= today)
      ) || null
    );
  }

  function save({ nextScan = false, triggerEl = null } = {}) {
    if (!draft) return;
    const nameInput = $('#f-name');
    const name = String(nameInput?.value || draft.name || '').trim();
    if (!name) {
      nameInput?.focus();
      nameInput?.classList.add('is-invalid');
      toast('請填寫物品名稱', { type: 'warn' });
      return;
    }

    if (mode === 'form') {
      const barcodeInput = $('#f-barcode');
      const rawBarcode = String(barcodeInput?.value || '').trim();
      if (rawBarcode) {
        const clean = normalizeBarcode(rawBarcode);
        if (!clean) {
          barcodeInput?.focus();
          barcodeInput?.classList.add('is-invalid');
          toast('條碼需為 8～14 位數字，或清空不綁定', { type: 'warn' });
          return;
        }
        draft.barcode = clean;
      } else {
        draft.barcode = '';
      }
    }

    sparkleBurst(triggerEl);
    draft.name = name;

    const expiry = draft.expiry || null;
    let savedMsg = `已加入「${name}」`;

    if (mode === 'scan-result' && draft.barcode && getState().settings.autoCount !== false) {
      const sameBatch = findSameBatchItem(draft.barcode, expiry);
      if (sameBatch) {
        const updated = incrementItemQty(sameBatch.id, draft.qty);
        if (updated) {
          savedMsg = `已為「${name}」數量 +${draft.qty}（目前共 ${updated.qty} ${updated.unit}）`;
        }
      } else {
        addItem({ ...draft, expiry });
      }
    } else {
      addItem({ ...draft, expiry });
    }

    if (draft.barcode) {
      rememberProduct(draft.barcode, {
        name,
        category: draft.category,
        unit: draft.unit,
        source: nameOcr.used ? 'ocr' : lookup.source || 'manual',
      });
      if (mode === 'form') {
        savedMsg = `已加入「${name}」並綁定條碼`;
      }
    }

    haptic('success');
    toast(savedMsg);

    if (nextScan) {
      if (mode === 'scan-result') {
        drawScan();
        startCamera(handleMainBarcode);
      } else {
        enterForm({});
      }
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
