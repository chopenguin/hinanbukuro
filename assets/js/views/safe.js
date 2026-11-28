import {
  getState,
  getMeetingPoints,
  saveMeetingPoint,
  deleteMeetingPoint,
  replaceMeetingPoints,
  setSafeContacts,
  canonicalContact,
} from '../core/store.js';
import { MAX_MEETING_POINTS, TAIWAN_EMERGENCY_NUMBERS } from '../data/presets.js';
import {
  SAFE_POSITION_TIMEOUT,
  SAFE_STATUS_PRESETS,
  locate,
  locateErrorMessage,
  coordsText,
  mapsUrl,
  distanceMeters,
  formatDistance,
  bearingZh,
  buildSafeMessage,
  smsHref,
  formatPhone,
  fixTimeText,
  encodeMeetingPoints,
  decodeMeetingPoints,
  qrCodeSvg,
} from '../core/safety.js';
import { esc, toast, confirmDialog, openSheet, copyText } from '../core/ui.js';
import { haptic } from '../core/haptics.js';
import { icon } from '../core/icons.js';

function contactDisplay(c) {
  if (!c) return '';
  if (typeof c === 'string') return formatPhone(c);
  return c.name ? `${c.name}（${formatPhone(c.phone)}）` : formatPhone(c.phone);
}

function contactsSummary(contacts) {
  if (!contacts.length) return '每次開啟簡訊後再挑選聯絡人';
  if (contacts.length === 1) return contactDisplay(contacts[0]);
  return `${contacts.length} 位家人・${contacts.map((c) => c.name || formatPhone(c.phone)).join('、')}`;
}

function mapHref(point) {
  if (Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
    return mapsUrl(point.lat, point.lng);
  }
  if (point.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point.address)}`;
  }
  return '';
}

function heroHTML({ contacts, points, selectedStatus, selectedPointId, locating, elapsed, lastFix, locateError }) {
  let statusClass = 'is-idle';
  let statusText = '尚未取得位置';
  let statusSub = '需要時再按下方按鈕，網頁不會背景追蹤。';

  if (locating) {
    statusClass = 'is-locating';
    statusText = '正在搜尋衛星訊號，請靠近窗邊或空曠處';
    statusSub = `已搜尋 ${elapsed} 秒・最多等 ${SAFE_POSITION_TIMEOUT / 1000} 秒`;
  } else if (locateError) {
    statusClass = 'is-error';
    statusText = locateError;
    statusSub = '確認瀏覽器已允許位置權限後再試一次。';
  } else if (lastFix) {
    statusClass = 'is-ok';
    statusText = `上次定位 ${fixTimeText(lastFix.at)}・${coordsText(lastFix.lat, lastFix.lng)}`;
    statusSub = Number.isFinite(lastFix.accuracy)
      ? `精確度約 ${Math.max(1, Math.round(lastFix.accuracy))} 公尺（集合點已顯示離線距離）`
      : '已取得座標（集合點已顯示離線距離）';
  }

  return `
    <section class="safety-hero">
      <div class="safety-hero-top">
        <div>
          <p class="safety-kicker">一鍵報平安</p>
          <h2 class="safety-title">讓家人知道你在哪</h2>
          <p class="safety-sub">抓取 GPS 座標並產生含 Google Maps 連結的簡訊草稿，免上網也能定位。</p>
        </div>
        <span class="safety-emblem" aria-hidden="true">${icon('pin')}</span>
      </div>

      <div class="safety-status-pills" role="group" aria-label="報平安狀態">
        ${SAFE_STATUS_PRESETS.map(
          (p) => `<button type="button" class="chip chip--sm${selectedStatus === p.id ? ' is-active' : ''}" data-safe-status="${p.id}">${esc(p.label)}</button>`
        ).join('')}
      </div>

      ${
        points.length
          ? `<select class="select safety-mp-select" data-mp-select aria-label="簡訊附帶集合點">
               <option value="">不特別附帶集合點</option>
               ${points
                 .map(
                   (pt) => `<option value="${esc(pt.id)}"${pt.id === selectedPointId ? ' selected' : ''}>附帶集合點：${esc(pt.name)}</option>`
                 )
                 .join('')}
             </select>`
          : ''
      }

      <div class="safety-status ${statusClass}" data-locate-status>
        <span class="safety-status-dot" aria-hidden="true"></span>
        <span class="safety-status-main">
          <span class="safety-status-text" data-locate-text role="status" aria-live="polite">${esc(statusText)}</span>
          <span class="safety-status-sub" data-locate-sub>${esc(statusSub)}</span>
        </span>
      </div>

      <button type="button" class="btn btn--safe btn--block${locating ? ' is-busy' : ''}" data-locate aria-busy="${locating}">
        ${locating ? '<span class="spinner spinner--light"></span> 定位中…' : `${icon('locate')} 取得位置並產生簡訊`}
      </button>

      <button type="button" class="safe-recipient" data-contacts>
        <span class="safe-recipient-icon" aria-hidden="true">${icon('message')}</span>
        <span class="safe-recipient-main">
          <span class="safe-recipient-title">簡訊收件人</span>
          <span class="safe-recipient-sub">${esc(contactsSummary(contacts))}</span>
        </span>
        <span class="chev" aria-hidden="true"></span>
      </button>

      ${
        contacts.length
          ? `<div class="contacts-pills">
               ${contacts
                 .map(
                   (c) => `<a class="contact-pill" href="tel:${esc(c.phone)}" aria-label="撥打給 ${esc(contactDisplay(c))}">${icon('phone')} ${esc(c.name || formatPhone(c.phone))}</a>`
                 )
                 .join('')}
             </div>`
          : ''
      }

      <p class="safety-note">位置只在手機本機運算；按下「開啟簡訊」後才由電信商傳送。</p>
    </section>`;
}

function pointCardHTML(point, index, lastFix) {
  const href = mapHref(point);
  const hasCoords = Number.isFinite(point.lat) && Number.isFinite(point.lng);
  let distanceHTML = '';

  if (lastFix && hasCoords) {
    const meters = distanceMeters(lastFix.lat, lastFix.lng, point.lat, point.lng);
    const dir = bearingZh(lastFix.lat, lastFix.lng, point.lat, point.lng);
    if (meters !== null) {
      distanceHTML = `<span class="mp-distance">${icon('compass')} ${esc(formatDistance(meters))}${dir ? `・${esc(dir)}` : ''}</span>`;
    }
  }

  return `
    <article class="mp-card">
      <div class="mp-card-top">
        <span class="mp-index">集合點 ${index + 1}</span>
        <button type="button" class="btn btn--quiet" data-edit-point="${esc(point.id)}" aria-label="編輯 ${esc(point.name)}">編輯</button>
      </div>
      <h3 class="mp-name">${esc(point.name)}</h3>
      ${point.address ? `<p class="mp-address">${esc(point.address)}</p>` : ''}
      <div class="mp-meta">
        ${distanceHTML}
        <span class="mp-coord${hasCoords ? '' : ' mp-coord--none'}">
          ${hasCoords ? esc(coordsText(point.lat, point.lng)) : '未設定座標'}
        </span>
        ${href ? `<a class="mp-map" href="${esc(href)}" target="_blank" rel="noopener" aria-label="${esc(point.name)} 地圖">${icon('pin')} 地圖</a>` : ''}
      </div>
      ${point.note ? `<p class="mp-note">${esc(point.note)}</p>` : ''}
    </article>`;
}

function pointsHTML(points, lastFix) {
  const full = points.length >= MAX_MEETING_POINTS;
  return `
    <section>
      <div class="section-head">
        <h2>預設集合點</h2>
        <span class="hint">${points.length} / ${MAX_MEETING_POINTS} 個</span>
      </div>
      <div class="mp-grid">
        ${points.map((pt, i) => pointCardHTML(pt, i, lastFix)).join('')}
        ${
          full
            ? ''
            : `<button type="button" class="mp-card mp-card--add" data-add-point>
                 <span class="mp-add-icon" aria-hidden="true">${icon('plus')}</span>
                 <span class="mp-add-title">新增集合點</span>
                 <span class="mp-add-sub">住家附近公園、學校操場或親友家</span>
               </button>`
        }
      </div>
      ${
        points.length
          ? `<div class="mp-share-row">
               <button type="button" class="btn btn--ghost btn--block" data-share-points>${icon('share')} 分享集合點給家人</button>
             </div>
             <p class="mp-hint">分享連結與 QR Code 僅含集合點資訊；取得 GPS 後會離線自動計算方位與距離。</p>`
          : `<p class="mp-hint">先約好兩個集合點：一個在住家附近，一個在稍遠的開闊公園或學校。</p>`
      }
    </section>`;
}

function emergencyHTML() {
  return `
    <section>
      <div class="section-head">
        <h2>緊急專線（一鍵撥號）</h2>
        <span class="hint">台灣常用電話</span>
      </div>
      <div class="emergency-grid">
        ${TAIWAN_EMERGENCY_NUMBERS.map(
          (item) => `
          <a class="emergency-card" href="tel:${esc(item.number)}">
            <span class="row-icon row-icon--${esc(item.tone)}" aria-hidden="true">${icon('phone')}</span>
            <span class="row-main">
              <span class="emergency-num">${esc(item.number)}</span>
              <span class="emergency-title">${esc(item.title)}</span>
              <span class="emergency-desc">${esc(item.desc)}</span>
            </span>
          </a>`
        ).join('')}
      </div>
    </section>`;
}

function openResultSheet(fix, contacts, { status = 'safe', meetingPoint = null } = {}) {
  const message = buildSafeMessage(fix, { status, meetingPoint });
  const href = smsHref(message, contacts);
  const accuracy = Number.isFinite(fix.accuracy)
    ? `約 ${Math.max(1, Math.round(fix.accuracy))} 公尺`
    : '未知';
  const recipientNote = contacts.length
    ? `收件人：${contacts.map(contactDisplay).join('、')}`
    : '開啟簡訊後，請從聯絡人挑選收件對象。';

  openSheet({
    title: '報平安簡訊',
    body: `
      <div class="sms-stats">
        <div class="sms-stat">
          <span class="sms-stat-label">定位時間</span>
          <strong>${esc(fixTimeText(fix.at))}</strong>
        </div>
        <div class="sms-stat">
          <span class="sms-stat-label">精確度</span>
          <strong>${esc(accuracy)}</strong>
        </div>
        <div class="sms-stat sms-stat--wide">
          <span class="sms-stat-label">座標</span>
          <strong class="num">${esc(coordsText(fix.lat, fix.lng))}</strong>
        </div>
      </div>

      <div class="sms-preview" data-sms-preview>${esc(message)}</div>

      <div class="sms-actions">
        <button type="button" class="btn btn--ghost" data-copy-message>${icon('copy')} 複製內容</button>
        ${
          navigator.share
            ? `<button type="button" class="btn btn--ghost" data-share-message>${icon('share')} 分享…</button>`
            : ''
        }
      </div>

      <p class="field-hint">${esc(recipientNote)}</p>
      <div class="notice">
        <span class="notice-mark">${icon('info')}</span>
        <span>簡訊會帶入座標與 Google Maps 連結。沒有電信訊號時可先複製內容，待恢復訊號再傳。</span>
      </div>
    `,
    foot: `
      <button type="button" class="btn btn--ghost" data-close>關閉</button>
      <a class="btn btn--primary" href="${esc(href)}">開啟簡訊</a>
    `,
    onMount({ bodyEl, footEl, close }) {
      bodyEl.querySelector('[data-copy-message]')?.addEventListener('click', async () => {
        const ok = await copyText(message);
        toast(ok ? '已複製簡訊內容' : '複製失敗，請長按訊息選取', { type: ok ? 'ok' : 'warn' });
        if (ok) haptic('success');
      });

      bodyEl.querySelector('[data-share-message]')?.addEventListener('click', async () => {
        try {
          await navigator.share({ title: '防災報平安', text: message });
        } catch {
          /* 使用者取消 */
        }
      });

      footEl.querySelector('[data-close]')?.addEventListener('click', () => close());
    },
  });
}

function openPointEditor(point) {
  const isNew = !point;
  const base = point || { name: '', address: '', lat: null, lng: null, note: '' };
  const latValue = Number.isFinite(base.lat) ? base.lat : '';
  const lngValue = Number.isFinite(base.lng) ? base.lng : '';

  openSheet({
    title: isNew ? '新增集合點' : '編輯集合點',
    body: `
      <form class="editor" novalidate>
        <label class="field">
          <span class="field-label">名稱</span>
          <input class="input" name="name" maxlength="40" placeholder="例如：住家旁的小公園" value="${esc(base.name)}">
        </label>

        <label class="field">
          <span class="field-label">地址或位置描述</span>
          <input class="input" name="address" maxlength="90" placeholder="例如：台北市大安區新生南路二段 1 號" value="${esc(base.address)}">
        </label>

        <div class="field">
          <div class="field-row">
            <label class="field">
              <span class="field-label">緯度</span>
              <input class="input num" name="lat" type="number" step="any" inputmode="decimal" placeholder="25.03300" value="${esc(latValue)}">
            </label>
            <label class="field">
              <span class="field-label">經度</span>
              <input class="input num" name="lng" type="number" step="any" inputmode="decimal" placeholder="121.56540" value="${esc(lngValue)}">
            </label>
          </div>

          <button type="button" class="btn btn--ghost btn--block" data-use-location>${icon('locate')} 使用目前位置</button>
          <span class="field-hint" data-loc-hint>設定座標後，取得定位時就能離線計算距離與方位。</span>
        </div>

        <label class="field">
          <span class="field-label">集合方式或備註</span>
          <textarea class="textarea" name="note" maxlength="140" rows="2" placeholder="例如：在涼亭等，不要站在馬路邊">${esc(base.note)}</textarea>
        </label>
      </form>
    `,
    foot: isNew
      ? `<button type="button" class="btn btn--ghost" data-cancel>取消</button>
         <button type="button" class="btn btn--primary" data-save>新增</button>`
      : `<button type="button" class="btn btn--danger" data-delete>${icon('trash')} 刪除</button>
         <button type="button" class="btn btn--primary" data-save>儲存</button>`,
    onMount({ dialog, bodyEl, footEl, close }) {
      const form = bodyEl.querySelector('form');
      const nameInput = form.querySelector('[name="name"]');
      const latInput = form.querySelector('[name="lat"]');
      const lngInput = form.querySelector('[name="lng"]');
      const locHint = bodyEl.querySelector('[data-loc-hint]');

      bodyEl.querySelector('[data-use-location]').addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        btn.disabled = true;
        const original = btn.innerHTML;
        btn.innerHTML = '<span class="spinner"></span> 定位中…';
        locHint.textContent = '正在搜尋衛星訊號，請盡量靠近窗邊或空曠處…';
        try {
          const fix = await locate();
          if (!dialog.isConnected) return;
          latInput.value = Number(fix.lat).toFixed(5);
          lngInput.value = Number(fix.lng).toFixed(5);
          locHint.textContent = Number.isFinite(fix.accuracy)
            ? `已填入目前位置，精確度約 ${Math.max(1, Math.round(fix.accuracy))} 公尺。`
            : '已填入目前位置。';
          haptic('success');
        } catch (err) {
          if (!dialog.isConnected) return;
          locHint.textContent = locateErrorMessage(err);
          haptic('warn');
        } finally {
          if (dialog.isConnected) {
            btn.disabled = false;
            btn.innerHTML = original;
          }
        }
      });

      footEl.querySelector('[data-cancel]')?.addEventListener('click', () => close());

      footEl.querySelector('[data-save]').addEventListener('click', () => {
        const data = new FormData(form);
        const name = String(data.get('name') || '').trim();
        if (!name) {
          nameInput.focus();
          nameInput.classList.add('is-invalid');
          haptic('warn');
          toast('請先填寫集合點名稱', { type: 'warn' });
          return;
        }

        const latRaw = String(data.get('lat') ?? '').trim();
        const lngRaw = String(data.get('lng') ?? '').trim();
        if (!latRaw !== !lngRaw) {
          toast('緯度和經度請一起填寫，或都留空', { type: 'warn' });
          (!latRaw ? latInput : lngInput).focus();
          return;
        }

        let lat = null;
        let lng = null;
        if (latRaw && lngRaw) {
          lat = Number(latRaw);
          lng = Number(lngRaw);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            toast('座標格式不正確，請確認緯度與經度', { type: 'warn' });
            return;
          }
        }

        const saved = saveMeetingPoint({
          id: base.id,
          name,
          address: String(data.get('address') || '').trim(),
          lat,
          lng,
          note: String(data.get('note') || '').trim(),
        });

        if (!saved) {
          toast(`最多只能設定 ${MAX_MEETING_POINTS} 個集合點`, { type: 'warn' });
          return;
        }

        close('saved');
        haptic('success');
        toast(isNew ? '已新增集合點' : '已更新集合點');
      });

      footEl.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '刪除集合點',
          message: `確定要刪除「${base.name}」嗎？`,
          confirmLabel: '刪除',
          tone: 'danger',
        });
        if (!ok) return;
        deleteMeetingPoint(base.id);
        close('deleted');
        haptic('warn');
        toast('已刪除集合點');
      });
    },
  });
}

function openContactsEditor() {
  const existing = getState().settings.safeContacts || [];
  const draft = existing.map((c) => ({ name: c.name || '', phone: c.phone || '' }));

  openSheet({
    title: '緊急聯絡人',
    body: `
      <p class="editor-lead">
        設定報平安簡訊的預設收件人與稱呼；儲存後也會出現在平安頁方便一鍵撥號。留空則每次從聯絡人挑選。
      </p>
      <div class="contact-editor-list" data-contact-list></div>
      <div class="field">
        <span class="field-label">新增聯絡人</span>
        <div class="contact-add-row">
          <input class="input" name="c-name" maxlength="24" placeholder="稱呼（如：媽媽）" autocomplete="off">
          <input class="input" name="c-phone" inputmode="tel" placeholder="電話（如：0912345678）" autocomplete="off">
          <button type="button" class="btn btn--ghost" data-add-contact>${icon('plus')} 加入</button>
        </div>
        <span class="field-hint">最多可設定 10 位聯絡人，號碼僅存在此裝置。</span>
      </div>
    `,
    foot: `
      <button type="button" class="btn btn--ghost" data-cancel>取消</button>
      <button type="button" class="btn btn--primary" data-save>儲存聯絡人</button>
    `,
    onMount({ bodyEl, footEl, close }) {
      const listEl = bodyEl.querySelector('[data-contact-list]');
      const nameInput = bodyEl.querySelector('[name="c-name"]');
      const phoneInput = bodyEl.querySelector('[name="c-phone"]');

      const paintList = () => {
        if (!draft.length) {
          listEl.innerHTML = '<p class="field-hint">目前尚未設定聯絡人。</p>';
          return;
        }
        listEl.innerHTML = draft
          .map(
            (c, idx) => `
            <div class="contact-item">
              <div>
                <strong style="display:block;font-size:14px">${esc(c.name || '未命名聯絡人')}</strong>
                <span class="hint">${esc(formatPhone(c.phone))}</span>
              </div>
              <button type="button" class="icon-btn icon-btn--danger" data-del-contact="${idx}" aria-label="移除 ${esc(c.name || c.phone)}">
                ${icon('x')}
              </button>
            </div>`
          )
          .join('');
      };

      const tryAddPending = () => {
        const phone = canonicalContact(phoneInput.value);
        const name = String(nameInput.value || '').trim().slice(0, 24);
        if (!phoneInput.value.trim()) return true;
        if (phone.replace(/\D/g, '').length < 4) {
          toast('請輸入至少 4 位數字的有效電話號碼', { type: 'warn' });
          phoneInput.focus();
          return false;
        }
        if (draft.some((c) => c.phone === phone)) {
          toast('這個電話號碼已在清單中', { type: 'warn' });
          return false;
        }
        if (draft.length >= 10) {
          toast('最多只能設定 10 位緊急聯絡人', { type: 'warn' });
          return false;
        }
        draft.push({ name, phone });
        nameInput.value = '';
        phoneInput.value = '';
        paintList();
        return true;
      };

      listEl.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-del-contact]');
        if (!btn) return;
        const idx = Number(btn.dataset.delContact);
        draft.splice(idx, 1);
        haptic('select');
        paintList();
      });

      bodyEl.querySelector('[data-add-contact]').addEventListener('click', () => {
        if (!phoneInput.value.trim()) {
          toast('請輸入電話號碼', { type: 'warn' });
          phoneInput.focus();
          return;
        }
        if (tryAddPending()) haptic('success');
      });

      phoneInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          bodyEl.querySelector('[data-add-contact]').click();
        }
      });

      footEl.querySelector('[data-cancel]').addEventListener('click', () => close());
      footEl.querySelector('[data-save]').addEventListener('click', () => {
        if (!tryAddPending()) return;
        const saved = setSafeContacts(draft);
        close('saved');
        haptic('success');
        toast(saved.length ? `已儲存 ${saved.length} 位聯絡人` : '已改為開啟簡訊後再選聯絡人');
      });

      paintList();
    },
  });
}

function openShareSheet(points) {
  const encoded = encodeMeetingPoints(points);
  const shareUrl = `${location.href.split('#')[0]}#/safe?mp=${encoded}`;

  openSheet({
    title: '分享集合點',
    body: `
      <p class="editor-lead">讓家人掃描 QR Code，或把連結傳給他們；對方打開後會看到匯入集合點的確認框。</p>
      <div class="qr-box" data-qr>
        <span class="loading-row"><span class="spinner"></span> 產生 QR Code…</span>
      </div>
      <label class="field">
        <span class="field-label">分享連結</span>
        <textarea class="share-url" rows="3" readonly>${esc(shareUrl)}</textarea>
      </label>
      <p class="field-hint">連結僅含集合點名稱、地址、座標與備註，不會上傳任何個人資料。</p>
    `,
    foot: navigator.share
      ? `<button type="button" class="btn btn--ghost" data-copy-link>${icon('copy')} 複製連結</button>
         <button type="button" class="btn btn--primary" data-share-link>${icon('share')} 分享…</button>`
      : `<button type="button" class="btn btn--primary" data-copy-link>${icon('copy')} 複製連結</button>`,
    onMount({ bodyEl, footEl, close }) {
      const qrBox = bodyEl.querySelector('[data-qr]');
      qrCodeSvg(shareUrl).then((svg) => {
        if (!qrBox.isConnected) return;
        qrBox.innerHTML = svg
          ? svg
          : '<span class="field-hint">QR Code 產生失敗，請改用下方的連結分享。</span>';
      });

      const copy = async () => {
        const ok = await copyText(shareUrl);
        toast(ok ? '已複製分享連結' : '複製失敗，請長按連結選取', { type: ok ? 'ok' : 'warn' });
        if (ok) haptic('success');
      };

      bodyEl.querySelector('.share-url')?.addEventListener('focus', (event) => {
        event.target.select();
      });

      /* 修正：按鈕在 footEl 內，由 footEl 綁定點擊事件 */
      footEl.querySelector('[data-copy-link]')?.addEventListener('click', copy);

      footEl.querySelector('[data-share-link]')?.addEventListener('click', async () => {
        try {
          await navigator.share({
            title: '避難包帖・集合點',
            text: `我們家的避難集合點（${points.length} 個）`,
            url: shareUrl,
          });
          haptic('success');
          close('shared');
        } catch {
          /* 使用者取消分享 */
        }
      });
    },
  });
}

export function renderSafe(view, ctx) {
  let lastFix = null;
  let locating = false;
  let locateError = '';
  let startedAt = 0;
  let tickTimer = 0;
  let alive = true;
  let selectedStatus = 'safe';
  let selectedPointId = '';

  const params = ctx.params || new URLSearchParams();
  const incoming = params.get('mp') ? decodeMeetingPoints(params.get('mp')) : [];
  if (params.has('mp')) {
    history.replaceState(null, '', `${location.pathname}${location.search}#/safe`);
  }

  ctx.setSubtitle('集合點、緊急專線與報平安');
  ctx.setStamp('報平安');

  const stopTick = () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = 0;
  };

  const startTick = () => {
    stopTick();
    tickTimer = setInterval(() => {
      const text = view.querySelector('[data-locate-sub]');
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      if (text) text.textContent = `已搜尋 ${seconds} 秒・最多等 ${SAFE_POSITION_TIMEOUT / 1000} 秒`;
    }, 1000);
  };

  const draw = () => {
    const points = getMeetingPoints();
    if (selectedPointId && !points.some((p) => p.id === selectedPointId)) {
      selectedPointId = '';
    }
    const contacts = getState().settings.safeContacts || [];
    const elapsed = locating ? Math.floor((Date.now() - startedAt) / 1000) : 0;

    view.innerHTML = `
      ${heroHTML({
        contacts,
        points,
        selectedStatus,
        selectedPointId,
        locating,
        elapsed,
        lastFix,
        locateError,
      })}
      ${pointsHTML(points, lastFix)}
      ${emergencyHTML()}
      <div class="notice">
        <span class="notice-mark">${icon('info')}</span>
        <span>集合點與緊急聯絡人僅保存在這台裝置；換手機前請記得從設定匯出備份。</span>
      </div>
    `;

    bind();
  };

  async function handleLocate() {
    if (locating) return;
    locating = true;
    locateError = '';
    startedAt = Date.now();
    haptic('light');
    draw();
    startTick();

    try {
      const fix = await locate();
      if (!alive) return;
      lastFix = fix;
      locating = false;
      stopTick();
      haptic('success');
      draw();
      const points = getMeetingPoints();
      const meetingPoint = points.find((p) => p.id === selectedPointId) || null;
      openResultSheet(fix, getState().settings.safeContacts || [], {
        status: selectedStatus,
        meetingPoint,
      });
    } catch (err) {
      if (!alive) return;
      locating = false;
      stopTick();
      locateError = locateErrorMessage(err);
      haptic('warn');
      draw();
      toast(locateError, { type: 'warn' });
    }
  }

  function bind() {
    view.querySelectorAll('[data-safe-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedStatus = btn.dataset.safeStatus;
        view.querySelectorAll('[data-safe-status]').forEach((node) => {
          node.classList.toggle('is-active', node === btn);
        });
        haptic('select');
      });
    });

    view.querySelector('[data-mp-select]')?.addEventListener('change', (event) => {
      selectedPointId = event.target.value;
    });

    view.querySelector('[data-locate]')?.addEventListener('click', handleLocate);
    view.querySelector('[data-contacts]')?.addEventListener('click', () => {
      haptic('light');
      openContactsEditor();
    });

    view.querySelector('[data-add-point]')?.addEventListener('click', () => {
      haptic('light');
      openPointEditor(null);
    });

    view.querySelectorAll('[data-edit-point]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const point = getMeetingPoints().find((p) => p.id === btn.dataset.editPoint);
        if (!point) return;
        haptic('light');
        openPointEditor(point);
      });
    });

    view.querySelector('[data-share-points]')?.addEventListener('click', () => {
      haptic('light');
      openShareSheet(getMeetingPoints());
    });
  }

  draw();

  if (incoming.length) {
    setTimeout(async () => {
      if (!alive) return;
      const ok = await confirmDialog({
        title: '匯入集合點',
        message: `家人分享了 ${incoming.length} 個集合點：${incoming
          .map((p) => p.name)
          .join('、')}。要匯入並覆蓋這台裝置目前的集合點嗎？`,
        confirmLabel: '匯入',
      });
      if (!ok || !alive) return;
      replaceMeetingPoints(incoming);
      haptic('success');
      toast(`已匯入 ${incoming.length} 個集合點`);
      draw();
    }, 420);
  }

  return {
    refresh: draw,
    destroy() {
      alive = false;
      stopTick();
    },
  };
}
