import {
  getState,
  getMeetingPoints,
  saveMeetingPoint,
  deleteMeetingPoint,
  replaceMeetingPoints,
  setSafeContacts,
} from '../core/store.js?v=3';
import { MAX_MEETING_POINTS } from '../data/presets.js?v=3';
import {
  SAFE_POSITION_TIMEOUT,
  locate,
  locateErrorMessage,
  coordsText,
  mapsUrl,
  buildSafeMessage,
  smsHref,
  formatPhone,
  fixTimeText,
  encodeMeetingPoints,
  decodeMeetingPoints,
  qrCodeSvg,
} from '../core/safety.js?v=3';
import { esc, toast, confirmDialog, openSheet, copyText } from '../core/ui.js?v=3';
import { haptic } from '../core/haptics.js?v=3';

const ICONS = {
  pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.4-5.4-6.4-10a6.4 6.4 0 0 1 12.8 0C18.4 15.6 12 21 12 21z"/><circle cx="12" cy="10.6" r="2.3"/></svg>`,
  locate: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.3"/><circle cx="12" cy="12" r="2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3"/></svg>`,
  message: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 5.8h14.8v9.4H9.4L5.2 18.6v-3.4H4.6z"/><path d="M8.3 9.2h7.4M8.3 12h5"/></svg>`,
  share: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.2V3.8M8.3 7.2 12 3.5l3.7 3.7"/><path d="M5.6 11.4v7.1a1.5 1.5 0 0 0 1.5 1.5h9.8a1.5 1.5 0 0 0 1.5-1.5v-7.1"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.3" y="8.3" width="11.2" height="11.2" rx="2"/><path d="M15.7 8.3V6.5a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v7.2a2 2 0 0 0 2 2h1.8"/></svg>`,
};

function contactsSummary(contacts) {
  if (!contacts.length) return '每次開啟簡訊後再挑選聯絡人';
  if (contacts.length === 1) return formatPhone(contacts[0]);
  return `${contacts.length} 位家人・${contacts.map(formatPhone).join('、')}`;
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

function heroHTML({ contacts, locating, elapsed, lastFix, locateError }) {
  let statusClass = 'is-idle';
  let statusText = '尚未取得位置';
  let statusSub = '需要時再按下方按鈕，網頁不會背景追蹤。';

  if (locating) {
    statusClass = 'is-locating';
    statusText = '正在搜尋衛星訊號，請盡量靠近窗邊或空曠處';
    statusSub = `已搜尋 ${elapsed} 秒・最多等 ${SAFE_POSITION_TIMEOUT / 1000} 秒`;
  } else if (locateError) {
    statusClass = 'is-error';
    statusText = locateError;
    statusSub = '確認瀏覽器已允許位置權限後再試一次。';
  } else if (lastFix) {
    statusClass = 'is-ok';
    statusText = `上次定位 ${fixTimeText(lastFix.at)}・${coordsText(lastFix.lat, lastFix.lng)}`;
    statusSub = Number.isFinite(lastFix.accuracy)
      ? `精確度約 ${Math.max(1, Math.round(lastFix.accuracy))} 公尺`
      : '已取得座標';
  }

  return `
    <section class="safety-hero">
      <div class="safety-hero-top">
        <div>
          <p class="safety-kicker">一鍵報平安</p>
          <h2 class="safety-title">讓家人知道你在哪</h2>
          <p class="safety-sub">抓取 GPS 座標，自動產生含 Google Maps 連結的簡訊草稿。不用網路也能定位。</p>
        </div>
        <span class="safety-emblem" aria-hidden="true">${ICONS.pin}</span>
      </div>

      <div class="safety-status ${statusClass}" data-locate-status>
        <span class="safety-status-dot" aria-hidden="true"></span>
        <span class="safety-status-main">
          <span class="safety-status-text" data-locate-text role="status" aria-live="polite">${esc(statusText)}</span>
          <span class="safety-status-sub" data-locate-sub>${esc(statusSub)}</span>
        </span>
      </div>

      <button type="button" class="btn btn--safe btn--block${locating ? ' is-busy' : ''}" data-locate aria-busy="${locating}">
        ${locating ? '<span class="spinner spinner--light"></span> 定位中…' : `${ICONS.locate} 取得位置並產生簡訊`}
      </button>

      <button type="button" class="safe-recipient" data-contacts>
        <span class="safe-recipient-icon" aria-hidden="true">${ICONS.message}</span>
        <span class="safe-recipient-main">
          <span class="safe-recipient-title">簡訊收件人</span>
          <span class="safe-recipient-sub">${esc(contactsSummary(contacts))}</span>
        </span>
        <span class="chev" aria-hidden="true"></span>
      </button>

      <p class="safety-note">位置只在你的手機上取得；按下開啟簡訊後，才會交給電信商傳送。</p>
    </section>`;
}

function pointCardHTML(point, index) {
  const href = mapHref(point);
  const hasCoords = Number.isFinite(point.lat) && Number.isFinite(point.lng);
  return `
    <article class="mp-card">
      <div class="mp-card-top">
        <span class="mp-index">集合點 ${index + 1}</span>
        <button type="button" class="btn btn--quiet" data-edit-point="${esc(point.id)}" aria-label="編輯 ${esc(point.name)}">編輯</button>
      </div>
      <h3 class="mp-name">${esc(point.name)}</h3>
      ${point.address ? `<p class="mp-address">${esc(point.address)}</p>` : ''}
      <div class="mp-meta">
        <span class="mp-coord${hasCoords ? '' : ' mp-coord--none'}">
          ${hasCoords ? esc(coordsText(point.lat, point.lng)) : '未設定座標'}
        </span>
        ${href ? `<a class="mp-map" href="${esc(href)}" target="_blank" rel="noopener" aria-label="${esc(point.name)} 地圖">${ICONS.pin} 地圖</a>` : ''}
      </div>
      ${point.note ? `<p class="mp-note">${esc(point.note)}</p>` : ''}
    </article>`;
}

function pointsHTML(points) {
  const full = points.length >= MAX_MEETING_POINTS;
  return `
    <section>
      <div class="section-head">
        <h2>預設集合點</h2>
        <span class="hint">${points.length} / ${MAX_MEETING_POINTS} 個</span>
      </div>
      <div class="mp-grid">
        ${points.map(pointCardHTML).join('')}
        ${
          full
            ? ''
            : `<button type="button" class="mp-card mp-card--add" data-add-point>
                 <span class="mp-add-icon" aria-hidden="true">${ICONS.plus}</span>
                 <span class="mp-add-title">新增集合點</span>
                 <span class="mp-add-sub">家附近的公園、學校操場或親友家</span>
               </button>`
        }
      </div>
      ${
        points.length
          ? `<div class="mp-share-row">
               <button type="button" class="btn btn--ghost btn--block" data-share-points>${ICONS.share} 分享給家人</button>
             </div>
             <p class="mp-hint">分享的連結與 QR Code 只包含集合點資料；家人打開後會看到匯入提示。</p>`
          : `<p class="mp-hint">先約好兩個地點：一個在家附近，一個在稍遠但安全的空曠處。</p>`
      }
    </section>`;
}

function openResultSheet(fix, contacts) {
  const message = buildSafeMessage(fix);
  const href = smsHref(message, contacts);
  const accuracy = Number.isFinite(fix.accuracy)
    ? `約 ${Math.max(1, Math.round(fix.accuracy))} 公尺`
    : '未知';
  const recipientNote = contacts.length
    ? `收件人：${contacts.map(formatPhone).join('、')}`
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
        <button type="button" class="btn btn--ghost" data-copy-message>${ICONS.copy} 複製內容</button>
        ${
          navigator.share
            ? `<button type="button" class="btn btn--ghost" data-share-message>${ICONS.share} 分享…</button>`
            : ''
        }
      </div>

      <p class="field-hint">${esc(recipientNote)}</p>
      <div class="notice">
        <span class="notice-mark">i</span>
        <span>簡訊會帶入座標與 Google Maps 連結。沒有電信訊號時，可先複製內容，等有訊號再傳。</span>
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
          /* 使用者取消分享 */
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

          <button type="button" class="btn btn--ghost btn--block" data-use-location>${ICONS.locate} 使用目前位置</button>
          <span class="field-hint" data-loc-hint>座標可以留空；只記地址也能從地圖開啟。</span>
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
      : `<button type="button" class="btn btn--danger" data-delete>刪除</button>
         <button type="button" class="btn btn--primary" data-save>儲存</button>`,
    onMount({ bodyEl, footEl, close }) {
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
          latInput.value = Number(fix.lat).toFixed(5);
          lngInput.value = Number(fix.lng).toFixed(5);
          locHint.textContent = Number.isFinite(fix.accuracy)
            ? `已填入目前位置，精確度約 ${Math.max(1, Math.round(fix.accuracy))} 公尺。`
            : '已填入目前位置。';
          haptic('success');
        } catch (err) {
          locHint.textContent = locateErrorMessage(err);
          haptic('warn');
        } finally {
          btn.disabled = false;
          btn.innerHTML = original;
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
  const contacts = getState().settings.safeContacts || [];

  openSheet({
    title: '簡訊收件人',
    body: `
      <p class="field-hint editor-lead">
        留空的話，開啟簡訊後再從聯絡人挑選。填一位會直接帶入號碼；填多位會使用群組簡訊。
      </p>
      <label class="field">
        <span class="field-label">緊急聯絡人號碼</span>
        <textarea class="textarea" name="contacts" rows="4" inputmode="tel" placeholder="0912 345 678&#10;0987 654 321">${esc(contacts.join('\n'))}</textarea>
        <span class="field-hint">一行一個號碼，也可以直接用逗號分隔。號碼只存在這台裝置。</span>
      </label>
      <div class="notice">
        <span class="notice-mark">i</span>
        <span>iPhone 會把多位收件人放進同一封群組簡訊；Android 的群組簡訊支援程度依簡訊 App 而定。</span>
      </div>
    `,
    foot: `
      <button type="button" class="btn btn--ghost" data-cancel>取消</button>
      <button type="button" class="btn btn--primary" data-save>儲存</button>
    `,
    onMount({ bodyEl, footEl, close }) {
      const area = bodyEl.querySelector('[name="contacts"]');

      footEl.querySelector('[data-cancel]')?.addEventListener('click', () => close());

      footEl.querySelector('[data-save]').addEventListener('click', () => {
        const lines = area.value
          .split(/[\n,;、]+/)
          .map((line) => line.trim())
          .filter(Boolean);

        const numbers = [];
        const invalid = [];
        for (const line of lines) {
          const digits = line.replace(/[^\d+]/g, '');
          if (digits.replace(/\D/g, '').length < 4) {
            invalid.push(line);
            continue;
          }
          if (!numbers.includes(digits)) numbers.push(digits);
        }

        if (invalid.length) {
          toast(`號碼格式不正確：${invalid[0]}`, { type: 'warn' });
          haptic('warn');
          return;
        }

        const saved = setSafeContacts(numbers);
        close('saved');
        haptic('success');
        toast(saved.length ? `已設定 ${saved.length} 位收件人` : '已改為開啟簡訊後選擇聯絡人');
      });
    },
  });
}

function openShareSheet(points) {
  const encoded = encodeMeetingPoints(points);
  const shareUrl = `${location.href.split('#')[0]}#/safe?mp=${encoded}`;

  openSheet({
    title: '分享集合點',
    body: `
      <p class="editor-lead">讓家人掃描 QR Code，或把連結傳給他們。打開後會看到匯入集合點的提示。</p>
      <div class="qr-box" data-qr>
        <span class="loading-row"><span class="spinner"></span> 產生 QR Code…</span>
      </div>
      <label class="field">
        <span class="field-label">分享連結</span>
        <textarea class="share-url" rows="3" readonly>${esc(shareUrl)}</textarea>
      </label>
      <p class="field-hint">連結只包含集合點的名稱、地址、座標與備註，不會上傳到任何伺服器。</p>
    `,
    foot: navigator.share
      ? `<button type="button" class="btn btn--ghost" data-copy-link>${ICONS.copy} 複製連結</button>
         <button type="button" class="btn btn--primary" data-share-link>${ICONS.share} 分享…</button>`
      : `<button type="button" class="btn btn--primary" data-copy-link>${ICONS.copy} 複製連結</button>`,
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

      bodyEl.querySelector('[data-copy-link]')?.addEventListener('click', copy);

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

  const params = ctx.params || new URLSearchParams();
  const incoming = params.get('mp') ? decodeMeetingPoints(params.get('mp')) : [];
  if (params.has('mp')) {
    history.replaceState(null, '', `${location.pathname}${location.search}#/safe`);
  }

  ctx.setSubtitle('集合點與報平安簡訊');
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
    const contacts = getState().settings.safeContacts || [];
    const elapsed = locating ? Math.floor((Date.now() - startedAt) / 1000) : 0;

    view.innerHTML = `
      ${heroHTML({ contacts, locating, elapsed, lastFix, locateError })}
      ${pointsHTML(points)}
      <div class="notice">
        <span class="notice-mark">i</span>
        <span>集合點與收件人只保存在這台裝置；換手機前請記得從設定匯出備份。</span>
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
      openResultSheet(fix, getState().settings.safeContacts || []);
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
