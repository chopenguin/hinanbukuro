import { statusOf, fmtDate, addMonthsISO, todayISO } from '../core/dates.js';
import { getState, categoryName, updateItem, addItem, deleteItem } from '../core/store.js';
import { EXPIRY_KINDS } from '../data/presets.js';
import { esc, openSheet, toast, confirmDialog } from '../core/ui.js';

export function warnSettings() {
  const { settings } = getState();
  return { warnSoon: settings.warnSoon, warnWatch: settings.warnWatch };
}

const PILL_CLASS = {
  expired: 'pill--expired',
  soon: 'pill--soon',
  watch: 'pill--watch',
  ok: 'pill--ok',
  none: 'pill--none',
};

export function statusPillHTML(iso, { showOk = false } = {}) {
  const st = statusOf(iso, warnSettings());
  if (st.key === 'ok' && !showOk) return '';
  const cls = PILL_CLASS[st.key];
  let text;
  if (st.key === 'none') text = '待補期限';
  else if (st.key === 'expired') text = `過期 ${Math.abs(st.days)} 天`;
  else text = `剩 ${st.days} 天`;
  return `<span class="pill ${cls}">${text}</span>`;
}

export function itemCardHTML(item) {
  const st = statusOf(item.expiry, warnSettings());
  const expired = st.key === 'expired' ? ' is-expired' : '';
  return `
    <button type="button" class="item-card${expired}" data-open-item="${esc(item.id)}">
      <span class="item-card-top">
        <span class="tag">${esc(categoryName(item.category))}</span>
        ${statusPillHTML(item.expiry)}
      </span>
      <span class="item-name">${esc(item.name)}</span>
      <span class="item-foot">
        <span class="item-qty">${esc(item.qty)} ${esc(item.unit)}</span>
        <span class="item-expiry">${item.expiry ? fmtDate(item.expiry) : '—'}</span>
      </span>
    </button>`;
}

/**
 * 編輯 / 新增物品的面板。
 */
export function openItemEditor(item, { onSaved, onDeleted } = {}) {
  const isNew = !item || !item.id;
  const base = isNew
    ? { name: '', category: 'other', qty: 1, unit: '個', location: '', expiry: null, expiryKind: '賞味期限', note: '', barcode: '' }
    : item;

  const categories = getState().categories;
  let catId = categories.some((c) => c.id === base.category) ? base.category : categories[0].id;

  const catChips = () =>
    categories
      .map(
        (c) =>
          `<button type="button" class="chip${c.id === catId ? ' is-active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`
      )
      .join('');

  const kindOptions = EXPIRY_KINDS.map(
    (k) => `<option value="${esc(k)}"${base.expiryKind === k ? ' selected' : ''}>${esc(k)}</option>`
  ).join('');

  openSheet({
    title: isNew ? '新增物品' : '編輯物品',
    body: `
      <form class="editor" novalidate>
        <label class="field">
          <span class="field-label">名稱</span>
          <input class="input" name="name" maxlength="60" placeholder="例如：飲用水 600ml" value="${esc(base.name)}">
        </label>

        <div class="field">
          <span class="field-label">分類</span>
          <div class="chip-row" data-cats>${catChips()}</div>
        </div>

        <div class="field field-row">
          <label class="field">
            <span class="field-label">數量</span>
            <input class="input" name="qty" type="number" min="1" max="9999" step="1" inputmode="numeric" value="${esc(base.qty)}">
          </label>
          <label class="field">
            <span class="field-label">單位</span>
            <input class="input" name="unit" maxlength="6" value="${esc(base.unit)}" placeholder="個">
          </label>
        </div>

        <label class="field">
          <span class="field-label">存放位置</span>
          <input class="input" name="location" maxlength="40" value="${esc(base.location)}" placeholder="例如：玄關櫃・下層">
        </label>

        <div class="field field-row">
          <label class="field">
            <span class="field-label">有效期限</span>
            <input class="input" name="expiry" type="date" value="${esc(base.expiry || '')}">
          </label>
          <label class="field">
            <span class="field-label">期限類型</span>
            <select class="select" name="expiryKind">${kindOptions}</select>
          </label>
        </div>

        <div class="field">
          <div class="chip-row" data-quick-row>
            <button type="button" class="chip" data-quick="none">無期限</button>
            <button type="button" class="chip" data-quick="6m">+6 個月</button>
            <button type="button" class="chip" data-quick="1y">+1 年</button>
            <button type="button" class="chip" data-quick="3y">+3 年</button>
          </div>
        </div>

        <label class="field">
          <span class="field-label">備註</span>
          <textarea class="textarea" name="note" maxlength="200" rows="2" placeholder="替換週期、使用方式⋯">${esc(base.note)}</textarea>
        </label>
      </form>
    `,
    foot: isNew
      ? `<button type="button" class="btn btn--ghost" data-act="cancel">取消</button>
         <button type="button" class="btn btn--primary" data-act="save">加入避難包</button>`
      : `<button type="button" class="btn btn--danger" data-act="delete">刪除</button>
         <button type="button" class="btn btn--primary" data-act="save">儲存</button>`,
    onMount({ dialog, bodyEl, footEl, close }) {
      const form = bodyEl.querySelector('form');
      const nameInput = form.querySelector('[name="name"]');
      const expiryInput = form.querySelector('[name="expiry"]');

      bodyEl.querySelector('[data-cats]').addEventListener('click', (event) => {
        const btn = event.target.closest('[data-cat]');
        if (!btn) return;
        catId = btn.dataset.cat;
        bodyEl.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('is-active', b === btn));
      });

      bodyEl.querySelector('[data-quick-row]').addEventListener('click', (event) => {
        const btn = event.target.closest('[data-quick]');
        if (!btn) return;
        const map = { none: null, '6m': 6, '1y': 12, '3y': 36 };
        if (!Object.prototype.hasOwnProperty.call(map, btn.dataset.quick)) return;
        const months = map[btn.dataset.quick];
        expiryInput.value = months === null ? '' : addMonthsISO(todayISO(), months);
      });

      footEl.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close());

      footEl.querySelector('[data-act="save"]').addEventListener('click', () => {
        const data = new FormData(form);
        const name = String(data.get('name') || '').trim();
        if (!name) {
          nameInput.focus();
          nameInput.classList.add('is-invalid');
          toast('請先填寫物品名稱', { type: 'warn' });
          return;
        }
        const payload = {
          name,
          category: catId,
          qty: Number(data.get('qty')) || 1,
          unit: String(data.get('unit') || '個').trim() || '個',
          location: String(data.get('location') || '').trim(),
          expiry: String(data.get('expiry') || '') || null,
          expiryKind: String(data.get('expiryKind') || '賞味期限'),
          note: String(data.get('note') || '').trim(),
          barcode: base.barcode || '',
        };

        if (isNew) {
          addItem(payload);
          toast('已加入避難包');
        } else {
          updateItem(base.id, payload);
          toast('已更新');
        }
        close('saved');
        onSaved?.();
      });

      footEl.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '刪除物品',
          message: `確定要刪除「${base.name}」嗎？此動作無法復原。`,
          confirmLabel: '刪除',
          tone: 'danger',
        });
        if (!ok) return;
        deleteItem(base.id);
        close('deleted');
        toast('已刪除');
        onDeleted?.();
      });

      setTimeout(() => {
        if (isNew && window.innerWidth > 700) nameInput.focus();
      }, 120);
    },
  });
}

/** 綁定「點卡片 → 開編輯」的行為 */
export function bindItemCards(container, { onChanged } = {}) {
  if (!container || container.dataset.cardsBound === '1') return;
  container.dataset.cardsBound = '1';
  container.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-open-item]');
    if (!btn) return;
    const item = getState().items.find((i) => i.id === btn.dataset.openItem);
    if (!item) return;
    openItemEditor(item, { onSaved: onChanged, onDeleted: onChanged });
  });
}
