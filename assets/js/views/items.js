import { getState, sortedItems, stats } from '../core/store.js';
import { statusOf } from '../core/dates.js';
import { esc, popNumber, bindSpotlightCards } from '../core/ui.js';
import { itemCardHTML, bindItemCards, openItemEditor, warnSettings } from '../components/itemCard.js';
import { getCategoryMeta } from '../data/presets.js';
import { haptic } from '../core/haptics.js';
import { icon } from '../core/icons.js';

const STATUS_OPTIONS = [
  { key: 'all', label: '全部狀態', dot: '' },
  { key: 'expired', label: '已過期', dot: 'danger' },
  { key: 'soon', label: '快到期', dot: 'warn' },
  { key: 'watch', label: '待留意', dot: 'safe' },
  { key: 'none', label: '待補期限', dot: 'stone' },
];

const STATUS_LABEL = {
  expired: '已過期',
  soon: '快到期',
  watch: '待留意',
  none: '待補期限',
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

  const statusCounts = () => {
    const base = sortedItems({ category, query, sort: 'expiry' });
    const warn = warnSettings();
    const counts = { all: base.length, expired: 0, soon: 0, watch: 0, none: 0 };
    for (const item of base) {
      const k = statusOf(item.expiry, warn).key;
      if (k === 'expired') counts.expired += 1;
      else if (k === 'soon') counts.soon += 1;
      else if (k === 'none') {
        counts.watch += 1;
        counts.none += 1;
      } else if (k === 'watch') {
        counts.watch += 1;
      }
    }
    return counts;
  };

  const filterList = () => {
    let list = sortedItems({ category, query, sort });
    if (status !== 'all') {
      const allowed = STATUS_MATCH[status] || [status];
      const warn = warnSettings();
      list = list.filter((i) => allowed.includes(statusOf(i.expiry, warn).key));
    }
    return list;
  };

  const renderCategoryChips = () => {
    const box = view.querySelector('[data-cats]');
    if (!box) return;
    const s = stats();
    const cats = getState().categories;
    box.innerHTML = [
      `<button type="button" class="chip${category === 'all' ? ' is-active' : ''}" data-cat="all" aria-pressed="${
        category === 'all'
      }">${icon('bag')} 全部 <span class="chip-count">${s.total}</span></button>`,
      ...cats.map((c) => {
        const meta = getCategoryMeta(c);
        return `<button type="button" class="chip${category === c.id ? ' is-active' : ''}" data-cat="${esc(c.id)}" aria-pressed="${
          category === c.id
        }">${icon(meta.icon)} ${esc(c.name)} <span class="chip-count">${s.byCategory[c.id] || 0}</span></button>`;
      }),
    ].join('');
  };

  const renderStatusChips = () => {
    const box = view.querySelector('[data-statuses]');
    if (!box) return;
    const counts = statusCounts();
    box.innerHTML = STATUS_OPTIONS.map(
      (opt) => `
      <button type="button" class="chip chip--sm${status === opt.key ? ' is-active' : ''}" data-st="${opt.key}" aria-pressed="${
        status === opt.key
      }">
        ${opt.dot ? `<span class="chip-dot chip-dot--${opt.dot}" aria-hidden="true"></span>` : ''}
        ${opt.label} <span class="chip-count">${counts[opt.key] ?? 0}</span>
      </button>`
    ).join('');
  };

  const emptyHTML = () => {
    if (!getState().items.length) {
      return `
        <div class="group" style="grid-column:1/-1">
          <div class="empty">
            <div class="empty-mark" aria-hidden="true">${icon('bag')}</div>
            <h3>清單是空的</h3>
            <p>用掃描加入第一件物品，或直接手動新增。</p>
            <div class="btn-row">
              <a class="btn btn--primary" href="#/scan">${icon('scan')} 掃描加入</a>
              <button type="button" class="btn btn--ghost" data-add>${icon('plus')} 手動新增</button>
            </div>
          </div>
        </div>`;
    }
    return `
      <div class="group" style="grid-column:1/-1">
        <div class="empty">
          <div class="empty-mark" aria-hidden="true">${icon('search')}</div>
          <h3>沒有符合的項目</h3>
          <p>換個分類、狀態或關鍵字再試一次。</p>
          <button type="button" class="btn btn--ghost" data-reset>清除全部篩選</button>
        </div>
      </div>`;
  };

  const syncClearBtn = () => {
    const btn = view.querySelector('[data-search-clear]');
    if (btn) btn.hidden = !query;
  };

  const renderHealthStrip = () => {
    const strip = view.querySelector('[data-health-strip]');
    if (!strip) return;
    const s = stats();
    if (!s.total) {
      strip.hidden = true;
      strip.innerHTML = '';
      return;
    }
    const healthy = (s.watch || 0) + (s.ok || 0);
    strip.hidden = false;
    strip.innerHTML = `
      <div class="kit-health-head">
        <span class="kicker">INVENTORY HEALTH</span>
        <span class="hint">良好 ${healthy}・快到期 ${s.soon}・已過期 ${s.expired}${s.none ? `・未設期限 ${s.none}` : ''}</span>
      </div>
      <div class="kit-health-bar" role="img" aria-label="物資效期比例：良好 ${healthy}、快到期 ${s.soon}、已過期 ${s.expired}">
        ${s.expired ? `<span class="kh-seg kh-seg--expired" style="flex-grow:${s.expired}"></span>` : ''}
        ${s.soon ? `<span class="kh-seg kh-seg--soon" style="flex-grow:${s.soon}"></span>` : ''}
        ${healthy ? `<span class="kh-seg kh-seg--safe" style="flex-grow:${healthy}"></span>` : ''}
        ${s.none ? `<span class="kh-seg kh-seg--none" style="flex-grow:${s.none}"></span>` : ''}
      </div>`;
  };

  const updateGrid = ({ animate = false } = {}) => {
    const list = filterList();
    const grid = view.querySelector('#items-grid');
    if (!grid) return;

    grid.innerHTML = list.length
      ? list.map((item, idx) => itemCardHTML(item, { showStepper: true, index: idx, animate })).join('')
      : emptyHTML();

    const count = view.querySelector('[data-count]');
    if (count) count.textContent = `${list.length} 件`;

    const note = view.querySelector('[data-filter-note]');
    if (note) {
      if (status !== 'all') {
        note.hidden = false;
        note.innerHTML = `
          <span>正在篩選狀態：<strong>${STATUS_LABEL[status] || status}</strong></span>
          <button type="button" class="btn btn--quiet btn--sm" data-clear-status>清除</button>`;
      } else {
        note.hidden = true;
        note.innerHTML = '';
      }
    }

    renderCategoryChips();
    renderStatusChips();
    renderHealthStrip();
    syncClearBtn();
    bindSpotlightCards(grid, '.item-card');

    grid.querySelector('[data-add]')?.addEventListener('click', () => openItemEditor(null));
    grid.querySelector('[data-reset]')?.addEventListener('click', () => {
      query = '';
      category = 'all';
      status = 'all';
      const searchInput = view.querySelector('input[name="q"]');
      if (searchInput) searchInput.value = '';
      updateGrid({ animate: true });
    });
  };

  const updateInlineQty = (id) => {
    const item = getState().items.find((i) => i.id === id);
    const stepper = view.querySelector(`[data-stepper="${CSS.escape(id)}"]`);
    if (!item || !stepper) {
      updateGrid();
      return;
    }
    const valEl = stepper.querySelector('.qty-val');
    const minusBtn = stepper.querySelector('[data-qty-delta="-1"]');
    if (valEl) {
      valEl.textContent = String(item.qty);
      popNumber(valEl);
    }
    if (minusBtn) minusBtn.disabled = item.qty <= 1;
  };

  const drawShell = () => {
    const sortIndex = Math.max(0, SORTS.findIndex((s) => s.key === sort));

    view.innerHTML = `
      <section class="filters">
        <div class="filter-bar">
          <label class="search">
            <span class="search-ico" aria-hidden="true">${icon('search')}</span>
            <input class="input" type="search" name="q" placeholder="搜尋名稱、位置、備註或條碼" value="${esc(query)}" autocomplete="off">
            <button type="button" class="search-clear" data-search-clear aria-label="清除搜尋" hidden>${icon('x')}</button>
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
        </div>

        <div class="chip-row" data-cats></div>
        <div class="chip-row" data-statuses></div>
        <div class="kit-health-strip" data-health-strip hidden></div>

        <div class="filter-note" data-filter-note hidden></div>
      </section>

      <section>
        <div class="section-head">
          <h2>物品清單</h2>
          <div class="head-actions">
            <span class="hint" data-count></span>
            <button type="button" class="btn btn--quiet" data-add-new>${icon('plus')} 新增</button>
          </div>
        </div>
        <div class="items-grid" id="items-grid"></div>
      </section>
    `;

    bindItemCards(view.querySelector('#items-grid'));

    const search = view.querySelector('input[name="q"]');
    let timer = 0;
    search.addEventListener('input', () => {
      query = search.value;
      syncClearBtn();
      clearTimeout(timer);
      timer = setTimeout(() => {
        updateGrid();
      }, 110);
    });

    view.querySelector('[data-search-clear]').addEventListener('click', () => {
      query = '';
      search.value = '';
      search.focus();
      updateGrid({ animate: true });
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
      updateGrid({ animate: true });
    });

    view.querySelector('[data-cats]').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-cat]');
      if (!btn) return;
      category = btn.dataset.cat;
      haptic('select');
      updateGrid({ animate: true });
    });

    view.querySelector('[data-statuses]').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-st]');
      if (!btn) return;
      status = btn.dataset.st;
      haptic('select');
      updateGrid({ animate: true });
    });

    view.querySelector('[data-filter-note]').addEventListener('click', (event) => {
      if (event.target.closest('[data-clear-status]')) {
        status = 'all';
        updateGrid({ animate: true });
      }
    });

    view.querySelector('[data-add-new]').addEventListener('click', () => openItemEditor(null));

    updateGrid({ animate: true });
  };

  drawShell();

  return {
    refresh(_state, detail) {
      if (detail?.type === 'update' && detail?.reason === 'qty' && detail?.id) {
        updateInlineQty(detail.id);
        return;
      }
      updateGrid();
    },
  };
}
