import { getState, sortedItems, stats } from '../core/store.js';
import { statusOf } from '../core/dates.js';
import { esc } from '../core/ui.js';
import { itemRowHTML, bindItemCards, openItemEditor, warnSettings } from '../components/itemCard.js?v=2';
import { getCategoryMeta } from '../data/presets.js?v=2';
import { haptic } from '../core/haptics.js';

const STATUS_LABEL = {
  expired: '已過期',
  soon: '快到期',
  watch: '待留意',
  none: '未設期限',
};

const STATUS_MATCH = {
  expired: ['expired'],
  soon: ['soon'],
  watch: ['watch', 'none'],
  none: ['none'],
};

const SORTS = [
  { key: 'expiry', label: '期限' },
  { key: 'added', label: '加入' },
  { key: 'name', label: '名稱' },
];

export function renderItems(view, ctx) {
  const params = ctx.params || new URLSearchParams();
  let category = params.get('cat') || 'all';
  let status = params.get('st') || 'all';
  let query = '';
  let sort = 'expiry';

  const filterList = () => {
    let list = sortedItems({ category, query, sort });
    if (status !== 'all') {
      const allowed = STATUS_MATCH[status] || [status];
      const warn = warnSettings();
      list = list.filter((i) => allowed.includes(statusOf(i.expiry, warn).key));
    }
    return list;
  };

  const catChips = () => {
    const s = stats();
    const cats = getState().categories;
    const rows = [
      `<button type="button" class="chip${category === 'all' ? ' is-active' : ''}" data-cat="all" aria-pressed="${
        category === 'all'
      }"><span>🎒</span> 全部 <span class="chip-count">${s.total}</span></button>`,
      ...cats.map(
        (c) =>
          `<button type="button" class="chip${category === c.id ? ' is-active' : ''}" data-cat="${esc(c.id)}" aria-pressed="${
            category === c.id
          }"><span>${getCategoryMeta(c.id).icon}</span> ${esc(c.name)} <span class="chip-count">${s.byCategory[c.id] || 0}</span></button>`
      ),
    ];
    return rows.join('');
  };

  const emptyHTML = () => {
    if (!getState().items.length) {
      return `
        <div class="empty">
          <div class="empty-mark" aria-hidden="true">空</div>
          <h3>清單是空的</h3>
          <p>用掃描加入第一件物品，或直接手動新增。</p>
          <div class="btn-row">
            <a class="btn btn--primary" href="#/scan">掃描加入</a>
            <button type="button" class="btn btn--ghost" data-add>手動新增</button>
          </div>
        </div>`;
    }
    return `
      <div class="empty">
        <div class="empty-mark" aria-hidden="true">無</div>
        <h3>沒有符合的項目</h3>
        <p>換個分類或關鍵字再試一次。</p>
        <button type="button" class="btn btn--ghost" data-reset>清除篩選</button>
      </div>`;
  };

  const updateGrid = () => {
    const list = filterList();
    const grid = view.querySelector('#items-grid');
    if (!grid) return;
    grid.innerHTML = list.length ? list.map((item) => itemRowHTML(item)).join('') : emptyHTML();

    const count = view.querySelector('[data-count]');
    if (count) count.textContent = `${list.length} 件`;

    const note = view.querySelector('[data-filter-note]');
    if (note) {
      if (status !== 'all') {
        note.hidden = false;
        note.innerHTML = `
          <span>正在顯示：<strong>${STATUS_LABEL[status] || status}</strong></span>
          <button type="button" class="btn btn--quiet" data-clear-status>清除</button>`;
      } else {
        note.hidden = true;
        note.innerHTML = '';
      }
    }

    grid.querySelector('[data-add]')?.addEventListener('click', () => openItemEditor(null));
    grid.querySelector('[data-reset]')?.addEventListener('click', () => {
      query = '';
      category = 'all';
      status = 'all';
      sort = 'expiry';
      draw();
    });
  };

  const draw = () => {
    const sortIndex = Math.max(0, SORTS.findIndex((s) => s.key === sort));

    view.innerHTML = `
      <section class="filters">
        <label class="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4 4"/></svg>
          <input class="input" type="search" name="q" placeholder="搜尋名稱、位置或條碼" value="${esc(query)}" autocomplete="off">
        </label>

        <div class="segmented" data-sort role="group" aria-label="排序方式" style="--n:${SORTS.length};--i:${sortIndex}">
          <span class="segmented-thumb" aria-hidden="true"></span>
          ${SORTS.map(
            (s) =>
              `<button type="button" data-sort-value="${s.key}" class="${
                s.key === sort ? 'is-active' : ''
              }" aria-pressed="${s.key === sort}">${s.label}</button>`
          ).join('')}
        </div>

        <div class="chip-row" data-cats>${catChips()}</div>

        <div class="filter-note" data-filter-note hidden></div>
      </section>

      <section>
        <div class="section-head">
          <h2>清單</h2>
          <div class="head-actions">
            <span class="hint" data-count></span>
            <button type="button" class="btn btn--quiet" data-add-new>新增</button>
          </div>
        </div>
        <div class="group" id="items-grid"></div>
      </section>
    `;

    bindItemCards(view.querySelector('#items-grid'));

    const search = view.querySelector('input[name="q"]');
    let timer = 0;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        query = search.value;
        updateGrid();
      }, 120);
    });

    const segmented = view.querySelector('[data-sort]');
    segmented.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-sort-value]');
      if (!btn) return;
      sort = btn.dataset.sortValue;
      const index = SORTS.findIndex((s) => s.key === sort);
      segmented.style.setProperty('--i', String(index));
      segmented.querySelectorAll('[data-sort-value]').forEach((node) => {
        const on = node === btn;
        node.classList.toggle('is-active', on);
        node.setAttribute('aria-pressed', String(on));
      });
      haptic('select');
      updateGrid();
    });

    view.querySelector('[data-cats]').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-cat]');
      if (!btn) return;
      category = btn.dataset.cat;
      view.querySelectorAll('[data-cat]').forEach((node) => {
        const on = node === btn;
        node.classList.toggle('is-active', on);
        node.setAttribute('aria-pressed', String(on));
      });
      haptic('select');
      updateGrid();
    });

    view.querySelector('[data-filter-note]').addEventListener('click', (event) => {
      if (event.target.closest('[data-clear-status]')) {
        status = 'all';
        updateGrid();
      }
    });

    view.querySelector('[data-add-new]').addEventListener('click', () => openItemEditor(null));

    updateGrid();
  };

  draw();

  return { refresh: draw };
}
