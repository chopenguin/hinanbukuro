import { cameraSupported, BarcodeScanner, decodeImageFile } from '../core/barcode.js?v=3';
import { lookupBarcode, normalizeBarcode } from '../core/off.js?v=3';
import { describeBarcode } from '../core/gtin.js?v=3';
import { recognizeExpiry, recognizeProductName, ocrStatusText } from '../core/ocr.js?v=3';
import {
  addItem,
  getProduct,
  rememberProduct,
  getState,
  findStockItem,
  incrementItemQty,
} from '../core/store.js?v=3';
import { addMonthsISO, todayISO, pickExpiry, fmtDate, relativeZh, daysLeft } from '../core/dates.js?v=3';
import { EXPIRY_KINDS } from '../data/presets.js?v=3';
import { esc, toast, openSheet, pickFile, fileToDataURL, beep } from '../core/ui.js?v=3';
import { haptic } from '../core/haptics.js?v=3';

const QUICK_MONTHS = { none: null, '6m': 6, '1y': 12, '3y': 36 };

/**
 * 條碼本身能給的線索：格式、檢查碼、GS1 前綴（註冊地）。
 * 只當提示用，檢查碼不符也不擋人 —— 有些店內碼本來就不照 GTIN 規則。
 */
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
        <span class="barcode-note">註冊地，非產地</span>
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
  let lastAuto = null;

  const $ = (sel) => view.querySelector(sel);

  /* ---------------------------------------------------------- 相機 */

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

  function stopCamera() {
    const current = scanner;
    scanner = null;
    clearTimeout(nudgeTimer);
    nudgeTimer = 0;
    if (current) {
      try {
        current.stop();
      } catch {
        /* noop */
      }
    }
    const torch = $('#stage-torch');
    if (torch) torch.hidden = true;
  }

  let nudgeTimer = 0;
  let torchOn = false;

  async function startCamera() {
    if (scanner || mode !== 'scan') return;
    const stage = $('#stage');
    const video = $('#cam');
    const hint = $('#stage-hint');
    const btn = $('[data-cam]');
    if (!video || !btn) return;

    if (!(await cameraSupported())) {
      showNote('這個環境無法啟動相機（需要 HTTPS、且瀏覽器支援）。請改用手動輸入或上傳照片。');
      return;
    }

    hideNote();
    torchOn = false;
    hint.textContent = '正在啟動相機…';

    const instance = new BarcodeScanner(video, {
      onDetect: (code) => handleDetected(code),
      onError: (message) => showNote(message),
      onStatus: ({ mode: decoder }) => {
        if (scanner !== instance) return;
        const node = $('#stage-hint');
        if (!node) return;
        node.textContent =
          decoder === 'zxing'
            ? '相容模式：把條碼放進框內，保持 15〜20 公分的距離'
            : '將條碼放進框內，會自動辨識';
      },
    });
    scanner = instance;

    const watchdog = setTimeout(() => {
      if (scanner === instance && stage.classList.contains('stage--idle')) {
        hint.textContent = '等待相機權限中…';
        showNote('若瀏覽器跳出相機權限詢問，請按「允許」。沒有看到詢問的話，可以改用手動輸入。');
      }
    }, 9000);

    try {
      await instance.start();
      clearTimeout(watchdog);
      if (scanner !== instance || mode !== 'scan') return;
      stage.classList.remove('stage--idle');
      hint.textContent = '將條碼放進框內，會自動辨識';
      btn.textContent = '關閉相機';

      const torch = $('#stage-torch');
      if (torch) torch.hidden = !instance.torchSupported();

      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(() => {
        if (scanner !== instance) return;
        showNote(
          '還是掃不到嗎？把手機拿遠一點（約 15〜20 公分），讓條碼填滿框線、避開反光；光線太暗可以開手電筒，或改用手動輸入。'
        );
      }, 14000);
    } catch (err) {
      clearTimeout(watchdog);
      if (scanner === instance) scanner = null;
      hint.textContent = '相機未啟動';
      showNote(err?.message || '相機啟動失敗，請改用手動輸入。');
    }
  }

  async function toggleTorch() {
    if (!scanner) return;
    torchOn = !torchOn;
    const ok = await scanner.setTorch(torchOn);
    if (!ok) {
      torchOn = false;
      toast('這台裝置不支援手電筒', { type: 'warn' });
      return;
    }
    const btn = $('#stage-torch');
    if (btn) btn.classList.toggle('is-on', torchOn);
    haptic('light');
  }

  function toggleCamera() {
    if (scanner) {
      stopCamera();
      const stage = $('#stage');
      const hint = $('#stage-hint');
      const btn = $('[data-cam]');
      stage?.classList.add('stage--idle');
      if (hint) hint.textContent = '相機已關閉';
      if (btn) btn.textContent = '開啟相機';
    } else {
      startCamera();
    }
  }

  function handleDetected(raw) {
    const code = normalizeBarcode(raw);
    if (!code) {
      showNote(`讀到「${String(raw).slice(0, 40)}」，但這不是商品條碼。請改掃條碼本身（EAN／UPC 那一排），或手動輸入。`);
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

  /** 條碼確定後：已建檔且未過期就自動 +1，否則開新增表單。 */
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

  /* ---------------------------------------------------------- 掃描畫面 */

  function drawScan() {
    mode = 'scan';
    draft = null;
    lastAuto = null;
    lookup = { status: 'idle', note: '' };
    ocr = { status: 'idle', preview: '', candidates: [], note: '', progress: '' };
    nameOcr = { status: 'idle', preview: '', candidates: [], text: '', note: '', picked: '', used: false };

    view.innerHTML = `
      <section>
        <div class="section-head">
          <h2>掃描條碼</h2>
          <span class="hint">對準包裝上的條碼</span>
        </div>

        <div class="stage stage--idle" id="stage">
          <video id="cam" playsinline muted autoplay></video>
          <div class="stage-overlay" aria-hidden="true">
            <div class="reticle"><span></span><span></span><span></span><span></span></div>
          </div>
          <p class="stage-hint" id="stage-hint">開啟相機後，把條碼放進框內</p>
          <button type="button" class="stage-torch" id="stage-torch" data-torch hidden aria-label="開關手電筒" aria-pressed="false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 3.4h4.8v4.3l2.3 3.4v9.5a1 1 0 0 1-1 1H8.3a1 1 0 0 1-1-1v-9.5l2.3-3.4z"/><path d="M8.3 13.8h7.4"/></svg>
          </button>
        </div>

        <div class="notice notice--warn" id="scan-note" hidden style="margin-top:12px"></div>

        <div class="btn-row" style="margin-top:14px">
          <button type="button" class="btn btn--primary" data-cam>開啟相機</button>
          <button type="button" class="btn btn--ghost" data-manual>手動輸入條碼</button>
        </div>
        <button type="button" class="btn btn--quiet btn--block" data-photo style="margin-top:8px">上傳條碼照片</button>
      </section>

      <div class="group">
        <div class="row">
          <span class="row-main">
            <span class="row-title">不想掃描？</span>
            <span class="row-sub">直接手動新增一件物品也可以，條碼之後再補。</span>
          </span>
          <button type="button" class="btn btn--quiet" data-blank>新增</button>
        </div>
      </div>
    `;

    $('[data-cam]').addEventListener('click', toggleCamera);
    $('[data-manual]').addEventListener('click', manualEntry);
    $('[data-photo]').addEventListener('click', photoScan);
    $('[data-torch]').addEventListener('click', toggleTorch);
    $('[data-blank]').addEventListener('click', () => enterForm({}));

    if (!autoStarted) {
      autoStarted = true;
      startCamera();
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
                <span class="notice-mark">!</span>
                <span>這件物品還沒有設定有效期限，記得找時間補上。</span>
              </div>`
        }
        <p class="auto-result-hint">為避免同一個條碼被重複計入，相機先暫停。確認數量正確後再繼續掃下一件。</p>
      </section>

      <div class="form-actions">
        <button type="button" class="btn btn--primary" data-continue>繼續掃描</button>
        <button type="button" class="btn btn--ghost" data-undo>復原</button>
      </div>
      <a class="btn btn--quiet btn--block" href="#/items" style="margin-top:10px">查看避難包</a>
    `;

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
  }

  /* ---------------------------------------------------------- 手動輸入 */

  function manualEntry() {
    openSheet({
      title: '手動輸入條碼',
      body: `
        <label class="field">
          <span class="field-label">條碼數字</span>
          <input class="input" id="m-code" inputmode="numeric" autocomplete="off" placeholder="例如 4901234567894">
        </label>
        <p class="field-hint" id="m-code-hint">包裝背面、8～14 位數字（EAN-13／UPC-A／EAN-8）。沒有條碼也可以直接跳過。</p>
      `,
      foot: `
        <button type="button" class="btn btn--ghost" data-act="cancel">取消</button>
        <button type="button" class="btn btn--primary" data-act="ok">下一步</button>
      `,
      onMount({ bodyEl, footEl, close }) {
        const input = bodyEl.querySelector('#m-code');
        const hint = bodyEl.querySelector('#m-code-hint');
        const baseHint = hint.textContent;
        setTimeout(() => input.focus(), 220);

        input.addEventListener('input', () => {
          const code = normalizeBarcode(input.value);
          const meta = code ? barcodeMeta(code) : null;
          hint.textContent = meta ? meta.text : baseHint;
          hint.classList.toggle('field-hint--warn', !!meta && meta.warn);
        });

        const submit = () => {
          const code = normalizeBarcode(input.value);
          if (!code) {
            toast('請輸入 8～14 位數字的條碼', { type: 'warn' });
            input.focus();
            return;
          }
          close('ok');
          handleCode(code);
        };

        footEl.querySelector('[data-act="ok"]').addEventListener('click', submit);
        footEl.querySelector('[data-act="cancel"]').addEventListener('click', () => close());
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        });
      },
    });
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
        handleCode(clean);
      } else {
        showNote('照片裡找不到清楚的一維條碼。換個角度再拍，或直接手動輸入。');
      }
    } catch {
      showNote('照片辨識失敗，請改用手動輸入。');
    }
  }

  /* ---------------------------------------------------------- 表單 */

  function enterForm(seed = {}) {
    stopCamera();
    nameTouched = false;
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
      applyLookup(cached, 'library');
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
      applyLookup(found, 'off');
    } else {
      lookup = {
        status: 'miss',
        note: '查不到這組條碼的商品資料，自己取個好認的名字就好。',
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
    if (data.category) {
      draft.category = data.category;
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

    view.innerHTML = `
      <section class="panel">
        <div class="form-head">
          <div>
            <p class="kicker">${draft.barcode ? `條碼 ${esc(draft.barcode)}` : '手動新增'}</p>
            <h2>${draft.barcode ? '這件物品是？' : '新增物品'}</h2>
          </div>
          <button type="button" class="btn btn--quiet" data-rescan>重新掃描</button>
        </div>

        ${draft.barcode ? barcodeMeta(draft.barcode).html : ''}

        <label class="field">
          <span class="field-label">名稱</span>
          <input class="input" id="f-name" maxlength="60" placeholder="例如：飲用水 600ml" value="${esc(draft.name)}" autocomplete="off">
          <span class="field-hint" id="lookup-note"></span>
        </label>

        <div class="field">
          <button type="button" class="btn btn--quiet btn--block" data-name-ocr>
            拍下品名標籤，自動辨識
          </button>
          <span class="field-hint">第一次辨識需下載約 30 MB 模型，之後瀏覽器會快取。</span>
          <div id="name-ocr-box"></div>
        </div>

        <div class="field">
          <span class="field-label">分類</span>
          <div class="chip-row" id="f-cats">
            ${cats
              .map(
                (c) =>
                  `<button type="button" class="chip${c.id === draft.category ? ' is-active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`
              )
              .join('')}
          </div>
        </div>

        <div class="field field-row">
          <label class="field">
            <span class="field-label">數量</span>
            <input class="input" id="f-qty" type="number" min="1" max="9999" inputmode="numeric" value="${esc(draft.qty)}">
          </label>
          <label class="field">
            <span class="field-label">單位</span>
            <input class="input" id="f-unit" maxlength="6" value="${esc(draft.unit)}">
          </label>
        </div>

        <label class="field">
          <span class="field-label">存放位置</span>
          <input class="input" id="f-location" maxlength="40" placeholder="例如：玄關櫃・下層" value="${esc(draft.location)}">
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
            <button type="button" class="chip" data-quick="none">無期限</button>
            <button type="button" class="chip" data-quick="6m">+6 個月</button>
            <button type="button" class="chip" data-quick="1y">+1 年</button>
            <button type="button" class="chip" data-quick="3y">+3 年</button>
          </div>
          <button type="button" class="btn btn--ghost btn--block" data-ocr style="margin-top:10px">
            拍下包裝上的日期，自動讀取
          </button>
          <div id="ocr-box"></div>
        </div>

        <label class="field">
          <span class="field-label">備註</span>
          <textarea class="textarea" id="f-note" maxlength="200" rows="2" placeholder="替換週期、使用方式⋯">${esc(draft.note)}</textarea>
        </label>
      </section>

      <div class="form-actions">
        <a class="btn btn--ghost" href="#/">取消</a>
        <button type="button" class="btn btn--primary" data-save>加入避難包</button>
      </div>
    `;

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
      paintCategoryChips();
    });

    $('#f-qty').addEventListener('input', (event) => {
      draft.qty = Math.max(1, Number(event.target.value) || 1);
    });
    $('#f-unit').addEventListener('input', (event) => {
      draft.unit = event.target.value || '個';
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
      });
    });

    $('[data-name-ocr]').addEventListener('click', runNameOcr);
    $('[data-ocr]').addEventListener('click', runOcr);
    $('[data-save]').addEventListener('click', save);
    $('[data-rescan]').addEventListener('click', () => {
      stopCamera();
      drawScan();
      startCamera();
    });
  }

  /* ---------------------------------------------------------- OCR */

  function updateOcrProgress(text) {
    const node = view.querySelector('[data-ocr-progress]');
    if (node) node.textContent = text;
  }

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
          ? '數字讀得清楚，但不敢斷定哪個是到期日，點一下填入'
          : '辨識信心偏低，請挑一個正確的日期（或直接用日曆選）';
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="ocr-text">
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
                ? `<p class="ocr-raw" title="${esc(ocr.text)}">照片上的文字：${esc(
                    String(ocr.text).replace(/\s+/g, ' ').trim().slice(0, 90)
                  )}</p>`
                : ''
            }
          </div>
        </div>`;
      box.querySelectorAll('[data-iso]').forEach((btn) => {
        btn.addEventListener('click', () => {
          setExpiry(btn.dataset.iso);
          renderOcrBox();
        });
      });
      return;
    }

    if (ocr.status === 'none') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="notice notice--warn">
            <span class="notice-mark">!</span>
            <span>照片裡沒辨識到可用的日期。試著靠近一點、避開反光，或直接選日期。</span>
          </div>
        </div>`;
      return;
    }

    if (ocr.status === 'error') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="notice notice--err">
            <span class="notice-mark">×</span>
            <span>${esc(ocr.note || 'OCR 無法使用')}。可以直接手動選擇日期。</span>
          </div>
        </div>`;
    }
  }

  /* ---------------------------------------------------------- 品名 OCR */

  function updateNameOcrProgress(text) {
    const node = view.querySelector('[data-name-ocr-progress]');
    if (node) node.textContent = text;
  }

  function applyName(name) {
    if (!draft || !name) return;
    draft.name = name;
    nameTouched = true;
    nameOcr.picked = name;
    nameOcr.used = true;
    const input = $('#f-name');
    if (input) input.value = name;
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
          <div class="loading-row"><span class="spinner"></span><span data-name-ocr-progress>${esc(
            nameOcr.progress || '準備讀取…'
          )}</span></div>
        </div>`;
      return;
    }

    if (nameOcr.status === 'found') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="ocr-text">
            <p class="ocr-title">點一下填入最正確的名稱：</p>
            <div class="name-candidates">
              ${nameOcr.candidates
                .map(
                  (c, i) => `
                <button type="button" class="name-cand${c.name === nameOcr.picked ? ' is-picked' : ''}" data-name="${esc(
                    c.name
                  )}">
                  <span>${esc(c.name)}</span>
                  <small>${c.name === nameOcr.picked ? '已填入' : i === 0 ? '最像' : ''}</small>
                </button>`
                )
                .join('')}
            </div>
            ${
              nameOcr.text
                ? `<p class="ocr-raw" title="${esc(nameOcr.text)}">照片上的文字：${esc(
                    String(nameOcr.text).replace(/\s+/g, ' ').trim().slice(0, 120)
                  )}</p>`
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
            <span class="notice-mark">!</span>
            <span>照片裡找不到清楚的品名。試著只拍名稱那一行、避開反光，或直接輸入名稱。</span>
          </div>
        </div>`;
      return;
    }

    if (nameOcr.status === 'error') {
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="notice notice--err">
            <span class="notice-mark">×</span>
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

    nameOcr = {
      status: 'loading',
      preview: '',
      candidates: [],
      text: '',
      note: '',
      picked: '',
      used: false,
      progress: '準備照片…',
    };

    try {
      nameOcr.preview = await fileToDataURL(file, 1400);
    } catch {
      nameOcr = {
        status: 'error',
        preview: '',
        candidates: [],
        text: '',
        note: '讀取照片失敗',
        picked: '',
        used: false,
        progress: '',
      };
      renderNameOcrBox();
      return;
    }

    renderNameOcrBox();

    try {
      const { candidates, text } = await recognizeProductName(nameOcr.preview, {
        onProgress: (msg) => updateNameOcrProgress(ocrStatusText(msg)),
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
        preview: nameOcr.preview,
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

    ocr = { status: 'loading', preview: '', candidates: [], note: '', progress: '準備照片…' };

    try {
      ocr.preview = await fileToDataURL(file, 1400);
    } catch {
      ocr = { status: 'error', preview: '', candidates: [], note: '讀取照片失敗', progress: '' };
      renderOcrBox();
      return;
    }

    renderOcrBox();

    try {
      const { candidates, text } = await recognizeExpiry(ocr.preview, {
        onProgress: (msg) => updateOcrProgress(ocrStatusText(msg)),
      });
      if (!view.isConnected || !draft) return;

      ocr.text = text || '';
      if (candidates.length) {
        ocr.status = 'found';
        ocr.candidates = candidates;

        /* 只有信心夠高的日期才自動填入；亂讀出來的就只列出來讓使用者自己挑。
           歧義的切法（例如 2028113 可能是 11/3 或 1/13）也不自動填。 */
        const trusted = candidates.filter((c) => c.trusted && !c.ambiguous);
        ocr.trusted = candidates.some((c) => c.trusted);
        const best = trusted.length ? pickExpiry(trusted) : null;
        ocr.autoFilled = !!best;
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
        preview: ocr.preview,
        candidates: [],
        note: err?.message || 'OCR 元件載入失敗',
        progress: '',
      };
      renderOcrBox();
    }
  }

  /* ---------------------------------------------------------- 儲存 */

  function save() {
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
        source: nameOcr.used ? 'ocr' : 'manual',
      });
    }

    haptic('success');
    toast('已加入避難包');
    ctx.navigate('#/items');
  }

  /* ---------------------------------------------------------- 啟動 */

  drawScan();

  return {
    refresh() {
      /* 掃描流程有自己的狀態，重新渲染會中斷相機，因此忽略全域更新 */
    },
    destroy() {
      stopCamera();
    },
  };
}
