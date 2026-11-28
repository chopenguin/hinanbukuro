import {
  getState,
  stats,
  updateSettings,
  addCategory,
  updateCategory,
  deleteCategory,
  countProducts,
  clearProducts,
  exportData,
  importData,
  clearAll,
  isStorageOK,
} from '../core/store.js';
import { getCategoryMeta, CATEGORY_TONES } from '../data/presets.js';
import { esc, toast, confirmDialog, openSheet, pickFile, downloadFile } from '../core/ui.js';
import { openTemplatePicker } from '../components/itemCard.js';
import { downloadICS } from '../core/ics.js';
import { todayISO } from '../core/dates.js';
import { haptic } from '../core/haptics.js';
import { icon, CATEGORY_ICON_OPTIONS } from '../core/icons.js';
import { getSwStatus, checkSwUpdate } from '../app.js';

const THEMES = [
  { key: 'system', label: '跟隨系統' },
  { key: 'light', label: '淺色石紙' },
  { key: 'dark', label: '深色曜石' },
];

const PERSON_SVG = `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>`;

function householdAvatarsHTML(count) {
  return Array.from({ length: count }, (_, i) =>
    `<span class="hh-person" style="animation-delay:${i * 25}ms" aria-hidden="true">${PERSON_SVG}</span>`
  ).join('');
}

function switchRow({ key, title, sub, on }) {
  return `
    <div class="row">
      <span class="row-main">
        <span class="row-title">${esc(title)}</span>
        <span class="row-sub">${esc(sub)}</span>
      </span>
      <button type="button" class="switch" role="switch" aria-checked="${on ? 'true' : 'false'}"
        data-switch="${key}" aria-label="${esc(title)}"></button>
    </div>`;
}

function actionRow({ action, iconName, tone, title, sub }) {
  return `
    <button type="button" class="row" data-${action}>
      <span class="row-icon row-icon--${tone}" aria-hidden="true">${icon(iconName)}</span>
      <span class="row-main">
        <span class="row-title">${esc(title)}</span>
        <span class="row-sub">${esc(sub)}</span>
      </span>
      <span class="row-trail"><span class="chev" aria-hidden="true"></span></span>
    </button>`;
}

function openCategoryEditor(cat) {
  let pickedIcon = cat.icon || getCategoryMeta(cat).icon;
  let pickedTone = cat.tone || getCategoryMeta(cat).tone;

  openSheet({
    title: '編輯分類',
    body: `
      <form class="editor" novalidate>
        <label class="field">
          <span class="field-label">分類名稱</span>
          <input class="input" name="cat-name" maxlength="12" value="${esc(cat.name)}">
        </label>

        <div class="field">
          <span class="field-label">選擇圖示</span>
          <div class="icon-picker-grid" data-icon-grid>
            ${CATEGORY_ICON_OPTIONS.map(
              (opt) => `
              <button type="button" class="icon-pick-btn${opt.id === pickedIcon ? ' is-active' : ''}" data-pick-icon="${esc(opt.id)}" title="${esc(opt.label)}" aria-label="${esc(opt.label)}">
                ${icon(opt.id)}
              </button>`
            ).join('')}
          </div>
        </div>

        <div class="field">
          <span class="field-label">標籤色系</span>
          <div class="tone-picker-row" data-tone-row>
            ${CATEGORY_TONES.map(
              (t) => `
              <button type="button" class="tone-pick-btn tone--${esc(t.id)}${t.id === pickedTone ? ' is-active' : ''}" data-pick-tone="${esc(t.id)}">
                ${esc(t.label)}
              </button>`
            ).join('')}
          </div>
        </div>
      </form>
    `,
    foot: `
      <button type="button" class="btn btn--ghost" data-cancel>取消</button>
      <button type="button" class="btn btn--primary" data-save>儲存</button>
    `,
    onMount({ bodyEl, footEl, close }) {
      const nameInput = bodyEl.querySelector('[name="cat-name"]');

      bodyEl.querySelector('[data-icon-grid]').addEventListener('click', (event) => {
        const btn = event.target.closest('[data-pick-icon]');
        if (!btn) return;
        pickedIcon = btn.dataset.pickIcon;
        bodyEl.querySelectorAll('[data-pick-icon]').forEach((b) => b.classList.toggle('is-active', b === btn));
        haptic('select');
      });

      bodyEl.querySelector('[data-tone-row]').addEventListener('click', (event) => {
        const btn = event.target.closest('[data-pick-tone]');
        if (!btn) return;
        pickedTone = btn.dataset.pickTone;
        bodyEl.querySelectorAll('[data-pick-tone]').forEach((b) => b.classList.toggle('is-active', b === btn));
        haptic('select');
      });

      footEl.querySelector('[data-cancel]').addEventListener('click', () => close());
      footEl.querySelector('[data-save]').addEventListener('click', () => {
        const name = String(nameInput.value || '').trim();
        if (!name) {
          nameInput.focus();
          nameInput.classList.add('is-invalid');
          toast('請輸入分類名稱', { type: 'warn' });
          return;
        }
        updateCategory(cat.id, { name, icon: pickedIcon, tone: pickedTone });
        haptic('success');
        toast(`已更新「${name}」`);
        close('saved');
      });
    },
  });
}

export function renderSettings(view) {
  const renderCategoriesList = () => {
    const state = getState();
    const s = stats();
    const group = view.querySelector('#settings-cats-group');
    const count = view.querySelector('#settings-cats-count');
    if (count) count.textContent = `${state.categories.length} 個`;
    if (!group) return;

    group.innerHTML = `
      ${state.categories
        .map((c) => {
          const meta = getCategoryMeta(c);
          return `
          <div class="row">
            <span class="cat-badge cat-badge--sm tone--${esc(meta.tone)}" aria-hidden="true">${icon(meta.icon)}</span>
            <span class="row-main">
              <span class="row-title">${esc(c.name)}</span>
              <span class="row-sub">${s.byCategory[c.id] || 0} 項</span>
            </span>
            <span class="cat-row-actions">
              <button type="button" class="icon-btn" data-edit-cat="${esc(c.id)}" aria-label="編輯 ${esc(c.name)}">${icon('edit')}</button>
              <button type="button" class="icon-btn icon-btn--danger" data-del-cat="${esc(c.id)}" aria-label="刪除 ${esc(c.name)}">${icon('trash')}</button>
            </span>
          </div>`;
        })
        .join('')}
      <div class="cat-add">
        <input class="input" id="new-cat" maxlength="12" placeholder="新增分類，例如：寵物" autocomplete="off">
        <button type="button" class="btn btn--ghost" data-add-cat>${icon('plus')} 新增</button>
      </div>
    `;
  };

  const renderProductsRow = () => {
    const products = countProducts();
    const count = view.querySelector('#settings-products-count');
    const title = view.querySelector('#settings-products-title');
    const btn = view.querySelector('[data-clear-products]');
    if (count) count.textContent = `${products} 組條碼`;
    if (title) title.textContent = `已記住 ${products} 組條碼`;
    if (btn) btn.disabled = !products;
  };

  const syncSettingsControls = () => {
    const { warnSoon, warnWatch, autoLookup, autoCount, haptics, theme = 'system', householdSize = 1 } =
      getState().settings;

    const soonEl = view.querySelector('#warn-soon');
    const watchEl = view.querySelector('#warn-watch');
    if (soonEl && document.activeElement !== soonEl) soonEl.value = String(warnSoon);
    if (watchEl && document.activeElement !== watchEl) watchEl.value = String(warnWatch);

    const hhVal = view.querySelector('#household-val');
    const hhTip = view.querySelector('#household-tip');
    const hhAvatars = view.querySelector('#household-avatars');
    const hhMinus = view.querySelector('[data-hh-delta="-1"]');
    const hhPlus = view.querySelector('[data-hh-delta="1"]');
    if (hhVal) hhVal.textContent = `${householdSize} 人`;
    if (hhTip) hhTip.textContent = `三日飲水基準 ${householdSize * 9} 公升・糧食 ${householdSize * 9} 餐份`;
    if (hhAvatars) hhAvatars.innerHTML = householdAvatarsHTML(householdSize);
    if (hhMinus) hhMinus.disabled = householdSize <= 1;
    if (hhPlus) hhPlus.disabled = householdSize >= 12;

    view.querySelectorAll('[data-theme-val]').forEach((btn) => {
      const active = btn.dataset.themeVal === theme;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const switches = { autoLookup: autoLookup !== false, autoCount: autoCount !== false, haptics: haptics !== false };
    Object.entries(switches).forEach(([key, on]) => {
      const sw = view.querySelector(`[data-switch="${key}"]`);
      if (sw) sw.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  };

  const draw = () => {
    const state = getState();
    const {
      warnSoon,
      warnWatch,
      autoLookup,
      autoCount,
      haptics,
      theme = 'system',
      householdSize = 1,
    } = state.settings;
    const products = countProducts();
    const dated = state.items.filter((i) => i.expiry).length;
    const sw = getSwStatus();

    view.innerHTML = `
      ${
        isStorageOK()
          ? ''
          : `<div class="notice notice--err">
              <span class="notice-mark">${icon('alert')}</span>
              <span>瀏覽器目前封鎖本機儲存（可能是無痕模式）。資料不會被保存，請改用一般視窗。</span>
            </div>`
      }

      <div class="settings-bento">
        <section>
          <div class="section-head">
            <h2>外觀與家庭設定</h2>
            <span class="hint">立即套用</span>
          </div>
          <div class="group">
            <div class="theme-row">
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span class="row-title">外觀主題</span>
                <span class="hint">可手動切換顯示風格</span>
              </div>
              <div class="theme-cards" data-theme-seg role="group" aria-label="外觀主題">
                ${THEMES.map(
                  (t) => `
                  <button type="button" class="theme-card${t.key === theme ? ' is-active' : ''}" data-theme-val="${t.key}" aria-pressed="${t.key === theme}">
                    <span class="theme-preview-mock theme-preview-mock--${t.key}" aria-hidden="true">
                      <span class="mock-hero">
                        <span class="mock-dot"></span>
                        <span class="mock-bar"></span>
                      </span>
                      <span class="mock-card-lines">
                        <span class="mock-line"></span>
                        <span class="mock-line mock-line--short"></span>
                      </span>
                    </span>
                    <span class="theme-card-label">${t.label}</span>
                  </button>`
                ).join('')}
              </div>
            </div>

            <div class="row">
              <span class="row-icon row-icon--info" aria-hidden="true">${icon('users')}</span>
              <span class="row-main">
                <span class="row-title">家庭人數</span>
                <span class="row-sub" id="household-tip">三日飲水基準 ${householdSize * 9} 公升・糧食 ${householdSize * 9} 餐份</span>
                <div class="household-avatars" id="household-avatars">${householdAvatarsHTML(householdSize)}</div>
              </span>
              <div class="qty-stepper" role="group" aria-label="家庭人數調整">
                <button type="button" class="qty-btn" data-hh-delta="-1" aria-label="減少人數"${householdSize <= 1 ? ' disabled' : ''}>${icon('minus')}</button>
                <span class="qty-val" id="household-val">${householdSize} 人</span>
                <button type="button" class="qty-btn" data-hh-delta="1" aria-label="增加人數"${householdSize >= 12 ? ' disabled' : ''}>${icon('plus')}</button>
              </div>
            </div>
          </div>
        </section>

        <div class="settings-bento-stack">
          <section>
            <div class="section-head">
              <h2>提醒門檻</h2>
              <span class="hint">首頁分區依據</span>
            </div>
            <div class="group">
              <label class="row">
                <span class="row-main">
                  <span class="row-title">快到期</span>
                  <span class="row-sub">幾天內標示為琥珀提醒</span>
                </span>
                <span class="row-value">
                  <input class="input input--inline" id="warn-soon" type="number" min="0" max="90" step="1" inputmode="numeric" value="${esc(warnSoon)}" aria-label="快到期天數">
                  <span class="unit-tag">天</span>
                </span>
              </label>
              <label class="row">
                <span class="row-main">
                  <span class="row-title">留意</span>
                  <span class="row-sub">幾天內納入待留意範圍</span>
                </span>
                <span class="row-value">
                  <input class="input input--inline" id="warn-watch" type="number" min="1" max="365" step="1" inputmode="numeric" value="${esc(warnWatch)}" aria-label="留意天數">
                  <span class="unit-tag">天</span>
                </span>
              </label>
            </div>
          </section>

          <section>
            <div class="section-head">
              <h2>掃描與回饋</h2>
              <span class="hint">細粒度即時儲存</span>
            </div>
            <div class="group">
              ${switchRow({
                key: 'autoLookup',
                title: '自動查詢商品名稱',
                sub: '用 Open Food Facts 帶入名稱；關閉後僅查我的商品庫',
                on: autoLookup !== false,
              })}
              ${switchRow({
                key: 'autoCount',
                title: '掃到已建檔商品自動 +1',
                sub: '同條碼未過期時直接增加數量；關閉則每次開建檔表單',
                on: autoCount !== false,
              })}
              ${switchRow({
                key: 'haptics',
                title: '觸覺回饋',
                sub: '掃描、儲存與切換時輕微震動',
                on: haptics !== false,
              })}
            </div>
          </section>
        </div>
      </div>

      <section>
        <div class="section-head">
          <h2>分類管理</h2>
          <span class="hint" id="settings-cats-count">${state.categories.length} 個</span>
        </div>
        <div class="group" id="settings-cats-group"></div>
      </section>

      <section>
        <div class="section-head">
          <h2>資料與行事曆</h2>
          <span class="hint">僅存在此裝置</span>
        </div>
        <div class="group">
          ${actionRow({
            action: 'export-json',
            iconName: 'download',
            tone: 'tint',
            title: '匯出備份',
            sub: 'JSON 檔，換手機或重裝瀏覽器時可還原',
          })}
          ${actionRow({
            action: 'import-json',
            iconName: 'upload',
            tone: 'green',
            title: '匯入備份',
            sub: '可選擇合併或覆蓋物品與集合點',
          })}
          ${actionRow({
            action: 'export-ics',
            iconName: 'calendar',
            tone: 'gold',
            title: '匯出到期提醒到日曆',
            sub: dated ? `${dated} 項有期限，含 3 段提醒` : '目前沒有設定期限的物品',
          })}
          ${actionRow({
            action: 'template',
            iconName: 'listChecks',
            tone: 'green',
            title: '挑選建議防災清單',
            sub: '18 項常見用品，自動標記已備齊項目',
          })}
          ${actionRow({
            action: 'clear',
            iconName: 'trash',
            tone: 'red',
            title: '清除全部資料',
            sub: '物品與集合點會移除，分類與設定保留',
          })}
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>我的商品庫</h2>
          <span class="hint" id="settings-products-count">${products} 組條碼</span>
        </div>
        <div class="group" id="settings-products-group">
          <div class="row">
            <span class="row-main">
              <span class="row-title" id="settings-products-title">已記住 ${products} 組條碼</span>
              <span class="row-sub">掃過的條碼與命名會快取在本機，下次直接帶入</span>
            </span>
            <button type="button" class="btn btn--quiet" data-clear-products${products ? '' : ' disabled'}>清除</button>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>離線快取與關於</h2>
          <span class="hint">v3.0</span>
        </div>
        <div class="group">
          <div class="row">
            <span class="row-icon row-icon--${sw.ready ? 'safe' : 'warn'}" aria-hidden="true">${icon('shield')}</span>
            <span class="row-main">
              <span class="row-title">離線可用狀態（PWA）</span>
              <span class="row-sub" id="pwa-status-text">${esc(sw.label)}</span>
            </span>
            ${
              sw.supported
                ? '<button type="button" class="btn btn--quiet" data-sw-update>檢查更新</button>'
                : ''
            }
          </div>
          <div class="about">
            <p><strong>避難包帖</strong>是一個零後端、資料完全留在裝置上的防災管理工具。可透過條碼 Web Worker 或繁體中文離線 OCR 快速建檔，並在緊急時離線計算集合點距離與方位。</p>
            <p class="faint">照片僅用於當次瀏覽器端辨識，絕不上傳伺服器。</p>
          </div>
        </div>
      </section>
    `;

    renderCategoriesList();
    bind();
  };

  function bind() {
    const setWarn = (patch) => {
      updateSettings(patch);
      const next = getState().settings;
      if (patch.warnWatch !== undefined && next.warnWatch === next.warnSoon && Number(patch.warnWatch) < next.warnSoon) {
        toast('「留意」天數已自動調整為不小於「快到期」', { type: 'warn' });
      }
    };

    view.querySelector('#warn-soon')?.addEventListener('change', (event) => {
      const v = Math.min(90, Math.max(0, Number(event.target.value) || 0));
      event.target.value = String(v);
      setWarn({ warnSoon: v });
    });

    view.querySelector('#warn-watch')?.addEventListener('change', (event) => {
      const v = Math.min(365, Math.max(1, Number(event.target.value) || 1));
      event.target.value = String(v);
      setWarn({ warnWatch: v });
    });

    view.querySelector('[data-theme-seg]')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-theme-val]');
      if (!btn) return;
      updateSettings({ theme: btn.dataset.themeVal });
      haptic('select');
    });

    view.querySelectorAll('[data-hh-delta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = Number(btn.dataset.hhDelta) || 0;
        const curr = getState().settings.householdSize || 1;
        const next = Math.min(12, Math.max(1, curr + delta));
        if (next === curr) return;
        updateSettings({ householdSize: next });
        haptic('select');
      });
    });

    view.querySelectorAll('[data-switch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.switch;
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(next));
        updateSettings({ [key]: next });
        haptic('select');
      });
    });

    const catsGroup = view.querySelector('#settings-cats-group');
    catsGroup?.addEventListener('click', async (event) => {
      const addBtn = event.target.closest('[data-add-cat]');
      if (addBtn) {
        const input = catsGroup.querySelector('#new-cat');
        const cat = addCategory(input.value);
        if (!cat) {
          haptic('warn');
          toast('請輸入分類名稱', { type: 'warn' });
          input.focus();
          return;
        }
        haptic('success');
        toast(`已新增「${cat.name}」`);
        return;
      }

      const editBtn = event.target.closest('[data-edit-cat]');
      if (editBtn) {
        const cat = getState().categories.find((c) => c.id === editBtn.dataset.editCat);
        if (cat) {
          haptic('light');
          openCategoryEditor(cat);
        }
        return;
      }

      const delBtn = event.target.closest('[data-del-cat]');
      if (delBtn) {
        const state = getState();
        if (state.categories.length <= 1) {
          toast('至少要保留一個分類', { type: 'warn' });
          return;
        }
        const cat = state.categories.find((c) => c.id === delBtn.dataset.delCat);
        const fallback = state.categories.find((c) => c.id !== delBtn.dataset.delCat) || state.categories[0];
        const count = stats().byCategory[delBtn.dataset.delCat] || 0;
        const ok = await confirmDialog({
          title: '刪除分類',
          message: count
            ? `「${cat.name}」還有 ${count} 項物品，刪除後會移到「${fallback.name}」。要繼續嗎？`
            : `確定刪除「${cat.name}」這個分類嗎？`,
          confirmLabel: '刪除',
          tone: 'danger',
        });
        if (!ok) return;
        deleteCategory(delBtn.dataset.delCat);
        haptic('warn');
        toast('已刪除分類');
      }
    });

    catsGroup?.addEventListener('keydown', (event) => {
      if (event.target.id === 'new-cat' && event.key === 'Enter') {
        event.preventDefault();
        catsGroup.querySelector('[data-add-cat]')?.click();
      }
    });

    view.querySelector('[data-export-json]')?.addEventListener('click', () => {
      const data = exportData();
      const name = `避難包備份-${todayISO()}.json`;
      downloadFile(name, JSON.stringify(data, null, 2));
      haptic('success');
      toast('已下載備份檔');
    });

    view.querySelector('[data-import-json]')?.addEventListener('click', importFlow);

    view.querySelector('[data-export-ics]')?.addEventListener('click', () => {
      const state = getState();
      const count = downloadICS(state.items, state.settings, state.categories);
      if (!count) {
        haptic('warn');
        toast('還沒有設定期限的物品', { type: 'warn' });
        return;
      }
      haptic('success');
      toast(`已匯出 ${count} 筆到期提醒`);
    });

    view.querySelector('[data-template]')?.addEventListener('click', () => {
      openTemplatePicker();
    });

    view.querySelector('[data-clear]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '清除全部資料',
        message: '所有物品與集合點都會被移除，分類與設定會保留。此動作無法復原，建議先匯出備份。',
        confirmLabel: '確定清除',
        tone: 'danger',
      });
      if (!ok) return;
      clearAll();
      haptic('warn');
      toast('已清除全部資料');
    });

    view.querySelector('[data-clear-products]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '清除商品庫',
        message: '已記住的條碼與名稱會全部移除，下次掃到時會重新查詢。',
        confirmLabel: '清除',
        tone: 'danger',
      });
      if (!ok) return;
      clearProducts();
      haptic('warn');
      toast('已清除商品庫');
    });

    view.querySelector('[data-sw-update]')?.addEventListener('click', async () => {
      const ok = await checkSwUpdate();
      const statusText = view.querySelector('#pwa-status-text');
      if (statusText) statusText.textContent = getSwStatus().label;
      toast(ok ? '已檢查離線快取更新' : '目前尚未註冊離線快取', { type: ok ? 'ok' : 'warn' });
    });
  }

  async function importFlow() {
    const file = await pickFile({ accept: 'application/json,.json' });
    if (!file) return;

    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      toast('這個檔案不是有效的 JSON', { type: 'warn' });
      return;
    }

    const raw = payload?.data && payload?.app ? payload.data : payload;
    const itemCount = Array.isArray(raw?.items) ? raw.items.length : 0;
    const mpCount = Array.isArray(raw?.meetingPoints) ? raw.meetingPoints.length : 0;
    if (!raw || (!Array.isArray(raw.items) && !Array.isArray(raw.meetingPoints))) {
      toast('檔案裡找不到避難包物品或集合點資料', { type: 'warn' });
      return;
    }

    openSheet({
      title: '匯入備份',
      body: `
        <p class="editor-lead">
          檔案裡有 <strong>${itemCount}</strong> 件物品、<strong>${mpCount}</strong> 個集合點。
          要保留目前資料並合併，或以備份檔完全覆蓋？
        </p>
        <div class="notice">
          <span class="notice-mark">${icon('info')}</span>
          <span>「合併」會保留現有物品與集合點並補入新項目；「覆蓋」會清空目前清單與集合點。</span>
        </div>
      `,
      foot: `
        <button type="button" class="btn btn--ghost" data-act="merge">合併</button>
        <button type="button" class="btn btn--primary" data-act="replace">覆蓋</button>
      `,
      onMount({ footEl, close }) {
        const run = (mode) => {
          try {
            const total = importData(payload, { mode });
            close(mode);
            haptic('success');
            toast(`已匯入，目前共 ${total} 件`);
          } catch (err) {
            toast(err?.message || '匯入失敗', { type: 'warn' });
          }
        };
        footEl.querySelector('[data-act="merge"]').addEventListener('click', () => run('merge'));
        footEl.querySelector('[data-act="replace"]').addEventListener('click', () => run('replace'));
      },
    });
  }

  draw();

  return {
    refresh(_state, detail) {
      if (detail?.type === 'settings') {
        syncSettingsControls();
        return;
      }
      if (detail?.type?.startsWith('category-')) {
        renderCategoriesList();
        return;
      }
      if (detail?.type?.startsWith('product-')) {
        renderProductsRow();
        return;
      }
      draw();
    },
  };
}
