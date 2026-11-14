import { cameraSupported, BarcodeScanner, decodeImageFile } from '../core/barcode.js';
import { lookupBarcode, normalizeBarcode } from '../core/off.js';
import { recognizeExpiry, ocrStatusText } from '../core/ocr.js';
import { addItem, getProduct, rememberProduct, getState } from '../core/store.js';
import { addMonthsISO, todayISO, pickExpiry, fmtDate, relativeZh, daysLeft } from '../core/dates.js';
import { EXPIRY_KINDS } from '../data/presets.js';
import { esc, toast, openSheet, pickFile, fileToDataURL, beep, vibrate } from '../core/ui.js';

const QUICK_MONTHS = { none: null, '6m': 6, '1y': 12, '3y': 36 };

let autoStarted = false;

export function renderScan(view, ctx) {
  let scanner = null;
  let draft = null;
  let mode = 'scan';
  let nameTouched = false;
  let lookup = { status: 'idle', note: '' };
  let ocr = { status: 'idle', preview: '', candidates: [], note: '', progress: '' };

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
    if (current) {
      try {
        current.stop();
      } catch {
        /* noop */
      }
    }
  }

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
    hint.textContent = '正在啟動相機…';

    const instance = new BarcodeScanner(video, {
      onDetect: (code) => handleDetected(code),
      onError: (message) => showNote(message),
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
    } catch (err) {
      clearTimeout(watchdog);
      if (scanner === instance) scanner = null;
      hint.textContent = '相機未啟動';
      showNote(err?.message || '相機啟動失敗，請改用手動輸入。');
    }
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
    if (!code) return;

    beep();
    vibrate(30);

    const current = scanner;
    scanner = null;
    if (current) setTimeout(() => current.stop(), 40);

    enterForm({ barcode: code });
  }

  /* ---------------------------------------------------------- 掃描畫面 */

  function drawScan() {
    mode = 'scan';
    draft = null;
    lookup = { status: 'idle', note: '' };
    ocr = { status: 'idle', preview: '', candidates: [], note: '', progress: '' };

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
        </div>

        <div class="notice notice--warn" id="scan-note" hidden></div>

        <div class="btn-row" style="margin-top:14px">
          <button type="button" class="btn btn--primary" data-cam>開啟相機</button>
          <button type="button" class="btn btn--ghost" data-manual>手動輸入條碼</button>
        </div>
        <button type="button" class="btn btn--quiet btn--block" data-photo>上傳條碼照片</button>
      </section>

      <section class="card card--flat">
        <p class="kicker">不想掃描？</p>
        <p class="quiet-sub">直接手動新增一件物品也可以，條碼之後再補。</p>
        <button type="button" class="btn btn--ghost" data-blank style="margin-top:12px">手動新增物品</button>
      </section>
    `;

    $('[data-cam]').addEventListener('click', toggleCamera);
    $('[data-manual]').addEventListener('click', manualEntry);
    $('[data-photo]').addEventListener('click', photoScan);
    $('[data-blank]').addEventListener('click', () => enterForm({}));

    if (!autoStarted) {
      autoStarted = true;
      startCamera();
    }
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
        <p class="field-hint">包裝背面、8～14 位數字。沒有條碼也可以直接跳過。</p>
      `,
      foot: `
        <button type="button" class="btn btn--ghost" data-act="cancel">取消</button>
        <button type="button" class="btn btn--primary" data-act="ok">下一步</button>
      `,
      onMount({ bodyEl, footEl, close }) {
        const input = bodyEl.querySelector('#m-code');
        setTimeout(() => input.focus(), 220);

        const submit = () => {
          const code = normalizeBarcode(input.value);
          if (!code) {
            toast('請輸入 8～14 位數字的條碼', { type: 'warn' });
            input.focus();
            return;
          }
          close('ok');
          enterForm({ barcode: code });
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
        enterForm({ barcode: clean });
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
    lookup = { status: 'idle', note: '' };
    ocr = { status: 'idle', preview: '', candidates: [], note: '', progress: '' };
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
      <section class="card">
        <div class="form-head">
          <div>
            <p class="kicker">${draft.barcode ? `條碼 ${esc(draft.barcode)}` : '手動新增'}</p>
            <h2>${draft.barcode ? '這件物品是？' : '新增物品'}</h2>
          </div>
          <button type="button" class="btn btn--quiet" data-rescan>重新掃描</button>
        </div>

        <label class="field">
          <span class="field-label">名稱</span>
          <input class="input" id="f-name" maxlength="60" placeholder="例如：飲用水 600ml" value="${esc(draft.name)}" autocomplete="off">
          <span class="field-hint" id="lookup-note"></span>
        </label>

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
    setTimeout(() => {
      if (!draft?.name && window.innerWidth > 700) $('#f-name')?.focus();
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
      box.innerHTML = `
        <div class="ocr-panel">
          ${thumb}
          <div class="ocr-text">
            <p class="ocr-title">讀到這些日期，點一下填入</p>
            <div class="date-candidates">
              ${ocr.candidates
                .map(
                  (c) => `
                <button type="button" class="date-cand${c.iso === draft.expiry ? ' is-picked' : ''}" data-iso="${c.iso}">
                  ${fmtDate(c.iso)}
                  <small>${relativeZh(daysLeft(c.iso))}</small>
                </button>`
                )
                .join('')}
            </div>
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

  async function runOcr() {
    if (!draft || ocr.status === 'loading') return;

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
      const { candidates } = await recognizeExpiry(ocr.preview, {
        onProgress: (msg) => updateOcrProgress(ocrStatusText(msg)),
      });
      if (!view.isConnected || !draft) return;

      if (candidates.length) {
        ocr.status = 'found';
        ocr.candidates = candidates;
        const best = pickExpiry(candidates);
        if (best) setExpiry(best);
      } else {
        ocr.status = 'none';
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
      rememberProduct(draft.barcode, { name, category: draft.category, source: 'manual' });
    }

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
