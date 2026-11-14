import {
  getState,
  stats,
  updateSettings,
  addCategory,
  deleteCategory,
  countProducts,
  clearProducts,
  exportData,
  importData,
  clearAll,
  loadTemplate,
  isStorageOK,
} from '../core/store.js';
import { templateItems } from '../data/presets.js';
import { esc, toast, confirmDialog, openSheet, pickFile, downloadFile } from '../core/ui.js';
import { downloadICS } from '../core/ics.js';
import { haptic } from '../core/haptics.js';

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

function actionRow({ action, icon, tone, title, sub }) {
  return `
    <button type="button" class="row" data-${action}>
      <span class="row-icon row-icon--${tone}" aria-hidden="true">${esc(icon)}</span>
      <span class="row-main">
        <span class="row-title">${esc(title)}</span>
        <span class="row-sub">${esc(sub)}</span>
      </span>
      <span class="row-trail"><span class="chev" aria-hidden="true"></span></span>
    </button>`;
}

export function renderSettings(view, ctx) {
  const draw = () => {
    const state = getState();
    const s = stats();
    const { warnSoon, warnWatch, autoLookup, haptics } = state.settings;
    const products = countProducts();
    const dated = state.items.filter((i) => i.expiry).length;

    view.innerHTML = `
      ${
        isStorageOK()
          ? ''
          : `<div class="notice notice--err">
              <span class="notice-mark">×</span>
              <span>瀏覽器目前封鎖本機儲存（可能是無痕模式）。資料不會被保存，請關閉無痕或允許網站儲存資料。</span>
            </div>`
      }

      <section>
        <div class="section-head">
          <h2>提醒門檻</h2>
          <span class="hint">首頁分區依據</span>
        </div>
        <div class="group">
          <label class="row">
            <span class="row-main">
              <span class="row-title">快到期</span>
              <span class="row-sub">幾天內標示為金色</span>
            </span>
            <span class="row-value">
              <input class="input input--inline" id="warn-soon" type="number" min="0" max="90" step="1" inputmode="numeric" value="${esc(warnSoon)}" aria-label="快到期天數">
              <span class="unit-tag">天</span>
            </span>
          </label>
          <label class="row">
            <span class="row-main">
              <span class="row-title">留意</span>
              <span class="row-sub">幾天內標示為綠色</span>
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
          <span class="hint">可隨時關閉</span>
        </div>
        <div class="group">
          ${switchRow({
            key: 'autoLookup',
            title: '自動查詢商品名稱',
            sub: '用 Open Food Facts 帶入名稱；關閉後只查我的商品庫',
            on: autoLookup !== false,
          })}
          ${switchRow({
            key: 'haptics',
            title: '觸覺回饋',
            sub: '掃描、儲存與切換時輕震一下',
            on: haptics !== false,
          })}
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>分類</h2>
          <span class="hint">${state.categories.length} 個</span>
        </div>
        <div class="group">
          ${state.categories
            .map(
              (c) => `
            <div class="row">
              <span class="row-main">
                <span class="row-title">${esc(c.name)}</span>
                <span class="row-sub">${s.byCategory[c.id] || 0} 項</span>
              </span>
              <button type="button" class="icon-btn" data-del-cat="${esc(c.id)}" aria-label="刪除 ${esc(c.name)}">×</button>
            </div>`
            )
            .join('')}
          <div class="cat-add">
            <input class="input" id="new-cat" maxlength="8" placeholder="新增分類，例如：寵物" autocomplete="off">
            <button type="button" class="btn btn--ghost" data-add-cat>新增</button>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>資料</h2>
          <span class="hint">只存在這台裝置</span>
        </div>
        <div class="group">
          ${actionRow({
            action: 'export-json',
            icon: '出',
            tone: 'tint',
            title: '匯出備份',
            sub: 'JSON 檔，換手機或重裝瀏覽器時用',
          })}
          ${actionRow({
            action: 'import-json',
            icon: '入',
            tone: 'green',
            title: '匯入備份',
            sub: '可選擇覆蓋或合併現有清單',
          })}
          ${actionRow({
            action: 'export-ics',
            icon: '曆',
            tone: 'gold',
            title: '匯出到期提醒到日曆',
            sub: dated ? `${dated} 項有期限，含 3 段提醒` : '目前沒有設定期限的物品',
          })}
          ${actionRow({
            action: 'template',
            icon: '單',
            tone: 'green',
            title: '載入建議清單',
            sub: '18 項常見防災用品（三日份）',
          })}
          ${actionRow({
            action: 'clear',
            icon: '清',
            tone: 'red',
            title: '清除全部資料',
            sub: '物品、商品庫與設定都會移除',
          })}
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>我的商品庫</h2>
          <span class="hint">${products} 組條碼</span>
        </div>
        <div class="group">
          <div class="row">
            <span class="row-main">
              <span class="row-title">已記住 ${products} 組條碼</span>
              <span class="row-sub">掃過的條碼與你命名的名稱，下次同一個條碼會直接帶入</span>
            </span>
            <button type="button" class="btn btn--quiet" data-clear-products${products ? '' : ' disabled'}>清除</button>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>關於</h2>
          <span class="hint">v0.1</span>
        </div>
        <div class="group">
          <div class="about">
            <p>避難包帖是一個純靜態網頁：沒有帳號、沒有後端，所有資料都留在你的瀏覽器裡。</p>
            <p>條碼查詢使用 <strong>Open Food Facts</strong>（免費公開資料庫）；期限辨識使用 <strong>Tesseract.js</strong>，第一次使用需要下載約 10MB 的辨識模型，之後會由瀏覽器快取。</p>
            <p class="faint">照片只用於當次辨識，不會上傳、也不會儲存。</p>
          </div>
        </div>
      </section>
    `;

    bind();
  };

  function bind() {
    const setWarn = (patch) => {
      updateSettings(patch);
      const state = getState();
      if (state.settings.warnWatch < state.settings.warnSoon) {
        updateSettings({ warnWatch: state.settings.warnSoon });
        toast('「留意」天數需大於「快到期」', { type: 'warn' });
      }
    };

    view.querySelector('#warn-soon')?.addEventListener('change', (event) => {
      const v = Math.min(90, Math.max(0, Number(event.target.value) || 0));
      event.target.value = v;
      setWarn({ warnSoon: v });
    });

    view.querySelector('#warn-watch')?.addEventListener('change', (event) => {
      const v = Math.min(365, Math.max(1, Number(event.target.value) || 1));
      event.target.value = v;
      setWarn({ warnWatch: v });
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

    view.querySelector('[data-add-cat]')?.addEventListener('click', () => {
      const input = view.querySelector('#new-cat');
      const cat = addCategory(input.value);
      if (!cat) {
        haptic('warn');
        toast('請輸入分類名稱', { type: 'warn' });
        input.focus();
        return;
      }
      haptic('success');
      toast(`已新增「${cat.name}」`);
    });

    view.querySelector('#new-cat')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        view.querySelector('[data-add-cat]').click();
      }
    });

    view.querySelectorAll('[data-del-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const state = getState();
        if (state.categories.length <= 1) {
          toast('至少要保留一個分類', { type: 'warn' });
          return;
        }
        const cat = state.categories.find((c) => c.id === btn.dataset.delCat);
        const fallback = state.categories.find((c) => c.id !== btn.dataset.delCat) || state.categories[0];
        const count = stats().byCategory[btn.dataset.delCat] || 0;
        const ok = await confirmDialog({
          title: '刪除分類',
          message: count
            ? `「${cat.name}」還有 ${count} 項物品，刪除後會移到「${fallback.name}」。要繼續嗎？`
            : `確定刪除「${cat.name}」這個分類嗎？`,
          confirmLabel: '刪除',
          tone: 'danger',
        });
        if (!ok) return;
        deleteCategory(btn.dataset.delCat);
        haptic('warn');
        toast('已刪除分類');
      });
    });

    view.querySelector('[data-export-json]')?.addEventListener('click', () => {
      const data = exportData();
      const name = `避難包備份-${new Date().toISOString().slice(0, 10)}.json`;
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

    view.querySelector('[data-template]')?.addEventListener('click', async () => {
      if (getState().items.length) {
        const ok = await confirmDialog({
          title: '載入建議清單',
          message: '現有清單會保留，18 項建議用品會加在後面。要繼續嗎？',
          confirmLabel: '加入',
        });
        if (!ok) return;
      }
      loadTemplate(templateItems());
      haptic('success');
      toast('已加入 18 項常見防災用品');
    });

    view.querySelector('[data-clear]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '清除全部資料',
        message: '所有物品、商品庫與設定都會被移除，且無法復原。建議先匯出備份。',
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

    const count = Array.isArray(payload?.items) ? payload.items.length : 0;
    if (!count) {
      toast('檔案裡找不到物品清單', { type: 'warn' });
      return;
    }

    openSheet({
      title: '匯入備份',
      body: `
        <p class="muted" style="font-size:13.5px;line-height:1.8">
          檔案裡有 <strong>${count}</strong> 件物品。
          要保留目前資料並合併，或以備份檔完全覆蓋？
        </p>
        <div class="notice" style="margin-top:12px">
          <span class="notice-mark">i</span>
          <span>「合併」會保留現有物品，只加入備份裡沒有的項目；「覆蓋」會清空目前清單。</span>
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
  return { refresh: draw };
}
