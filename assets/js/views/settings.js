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

export function renderSettings(view, ctx) {
  const draw = () => {
    const state = getState();
    const s = stats();
    const { warnSoon, warnWatch } = state.settings;
    const products = countProducts();

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
        <div class="card card--flat">
          <div class="field-row">
            <label class="field">
              <span class="field-label">快到期</span>
              <span class="input-group">
                <input class="input" id="warn-soon" type="number" min="0" max="90" step="1" inputmode="numeric" value="${esc(warnSoon)}">
                <span class="unit-suffix">天</span>
              </span>
            </label>
            <label class="field">
              <span class="field-label">留意</span>
              <span class="input-group">
                <input class="input" id="warn-watch" type="number" min="1" max="365" step="1" inputmode="numeric" value="${esc(warnWatch)}">
                <span class="unit-suffix">天</span>
              </span>
            </label>
          </div>
          <p class="field-hint">「快到期」會標金色、「留意」會標綠色。建議 7 與 30 天。</p>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>分類</h2>
          <span class="hint">${state.categories.length} 個</span>
        </div>
        <div class="card card--flat">
          <div class="list" data-cat-list>
            ${state.categories
              .map(
                (c) => `
              <div class="list-row">
                <span class="grow">${esc(c.name)}</span>
                <span class="sub">${s.byCategory[c.id] || 0} 項</span>
                <button type="button" class="icon-btn" data-del-cat="${esc(c.id)}" aria-label="刪除 ${esc(c.name)}">×</button>
              </div>`
              )
              .join('')}
          </div>
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
        <div class="card card--flat" style="padding-top:4px;padding-bottom:4px">
          <div class="list">
            <button type="button" class="list-row" data-export-json>
              <span class="grow">
                匯出備份
                <span class="sub">JSON 檔，換手機或重裝瀏覽器時用</span>
              </span>
              <span class="row-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" class="list-row" data-import-json>
              <span class="grow">
                匯入備份
                <span class="sub">可選擇覆蓋或合併現有清單</span>
              </span>
              <span class="row-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" class="list-row" data-export-ics>
              <span class="grow">
                匯出到期提醒到日曆
                <span class="sub">${s.total ? `共 ${state.items.filter((i) => i.expiry).length} 項有期限，含 3 段提醒` : '目前沒有物品'}</span>
              </span>
              <span class="row-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" class="list-row" data-template>
              <span class="grow">
                載入建議清單
                <span class="sub">18 項常見防災用品（三日份）</span>
              </span>
              <span class="row-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" class="list-row list-row--danger" data-clear>
              <span class="grow">
                清除全部資料
                <span class="sub">物品、商品庫與設定都會移除</span>
              </span>
              <span class="row-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>我的商品庫</h2>
          <span class="hint">${products} 組條碼</span>
        </div>
        <div class="card card--flat">
          <p class="quiet-sub">掃過的條碼與你命名的名稱會記在這裡，下次同一個條碼直接帶入。</p>
          <button type="button" class="btn btn--ghost" data-clear-products${products ? '' : ' disabled'} style="margin-top:12px">清除商品庫</button>
        </div>
      </section>

      <section>
        <div class="section-head"><h2>關於</h2><span class="hint">v0.1</span></div>
        <div class="card card--flat about">
          <p>避難包帖是一個純靜態網頁：沒有帳號、沒有後端，所有資料都留在你的瀏覽器裡。</p>
          <p>條碼查詢使用 <strong>Open Food Facts</strong>（免費公開資料庫）；期限辨識使用 <strong>Tesseract.js</strong>，第一次使用需要下載約 10MB 的辨識模型，之後會由瀏覽器快取。</p>
          <p class="faint">照片只用於當次辨識，不會上傳、也不會儲存。</p>
        </div>
      </section>
    `;

    bind();
  };

  function bind() {
    const setWarn = (patch) => {
      updateSettings(patch);
      const state = getState();
      const soon = state.settings.warnSoon;
      const watch = state.settings.warnWatch;
      if (watch < soon) {
        updateSettings({ warnWatch: soon });
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

    view.querySelector('[data-add-cat]')?.addEventListener('click', () => {
      const input = view.querySelector('#new-cat');
      const cat = addCategory(input.value);
      if (!cat) {
        toast('請輸入分類名稱', { type: 'warn' });
        input.focus();
        return;
      }
      toast(`已新增「${cat.name}」`);
    });

    view.querySelector('#new-cat')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        view.querySelector('[data-add-cat]').click();
      }
    });

    view.querySelector('[data-cat-list]')?.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-del-cat]');
      if (!btn) return;
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
      toast('已刪除分類');
    });

    view.querySelector('[data-export-json]').addEventListener('click', () => {
      const data = exportData();
      const name = `避難包備份-${new Date().toISOString().slice(0, 10)}.json`;
      downloadFile(name, JSON.stringify(data, null, 2));
      toast('已下載備份檔');
    });

    view.querySelector('[data-import-json]').addEventListener('click', importFlow);

    view.querySelector('[data-export-ics]').addEventListener('click', () => {
      const state = getState();
      const count = downloadICS(state.items, state.settings, state.categories);
      if (!count) {
        toast('還沒有設定期限的物品', { type: 'warn' });
        return;
      }
      toast(`已匯出 ${count} 筆到期提醒`);
    });

    view.querySelector('[data-template]').addEventListener('click', async () => {
      if (getState().items.length) {
        const ok = await confirmDialog({
          title: '載入建議清單',
          message: '現有清單會保留，18 項建議用品會加在後面。要繼續嗎？',
          confirmLabel: '加入',
        });
        if (!ok) return;
      }
      loadTemplate(templateItems());
      toast('已加入 18 項常見防災用品');
    });

    view.querySelector('[data-clear]').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '清除全部資料',
        message: '所有物品、商品庫與設定都會被移除，且無法復原。建議先匯出備份。',
        confirmLabel: '確定清除',
        tone: 'danger',
      });
      if (!ok) return;
      clearAll();
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
        <p class="muted" style="font-size:13.5px;line-height:1.85">
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
