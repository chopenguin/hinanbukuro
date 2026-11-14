import { getState, sortedItems, stats } from '../core/store.js';
import { statusOf } from '../core/dates.js';
import { esc } from '../core/ui.js';
import { itemCardHTML, bindItemCards, openItemEditor, warnSettings } from '../components/itemCard.js';

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
      `<button type="button" class="chip${category === 'all' ? ' is-active' : ''}" data-cat="all">全部 <span class="chip-count">${s.total}</span></button>`,
      ...cats.map(
        (c) =>
          `<button type="button" class="chip${category === c.id ? ' is-active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)} <span class="chip-count">${s.byCategory[c.id] || 0}</span></button>`
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
          <div class="btn-row" style="justify-content:center">
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
    grid.innerHTML = list.length ? list.map(itemCardHTML).join('') : emptyHTML();

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
    view.innerHTML = `
      <section>
        <div class="toolbar">
          <label class="search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4 4"/></svg>
            <input class="input" type="search" name="q" placeholder="搜尋名稱、位置或條碼" value="${esc(query)}" autocomplete="off">
          </label>
          <select class="select select--sort" name="sort" aria-label="排序方式">
            <option value="expiry"${sort === 'expiry' ? ' selected' : ''}>期限近→遠</option>
            <option value="added"${sort === 'added' ? ' selected' : ''}>最近加入</option>
            <option value="name"${sort === 'name' ? ' selected' : ''}>名稱</option>
          </select>
        </div>

        <div class="chip-row" data-cats style="margin-top:12px">${catChips()}</div>

        <div class="filter-note" data-filter-note hidden></div>

        <div class="section-head" style="margin-top:16px">
          <h2>清單 <span class="hint" data-count></span></h2>
          <button type="button" class="btn btn--quiet" data-add-new>＋ 手動新增</button>
        </div>

        <div class="items-grid" id="items-grid"></div>
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

    view.querySelector('select[name="sort"]').addEventListener('change', (event) => {
      sort = event.target.value;
      updateGrid();
    });

    view.querySelector('[data-cats]').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-cat]');
      if (!btn) return;
      category = btn.dataset.cat;
      view.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('is-active', b === btn));
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
