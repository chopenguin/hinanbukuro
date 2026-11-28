import { statusOf, fmtDate, addMonthsISO, todayISO } from '../core/dates.js';
import {
  getState,
  getCategory,
  categoryName,
  updateItem,
  addItem,
  addItems,
  deleteItem,
  restoreItem,
  incrementItemQty,
  getKnownLocations,
} from '../core/store.js';
import { EXPIRY_KINDS, UNIT_SUGGESTIONS, getCategoryMeta, templateItems } from '../data/presets.js';
import { esc, openSheet, toast, confirmDialog, pickFile, sparkleBurst } from '../core/ui.js';
import { haptic } from '../core/haptics.js';
import { icon } from '../core/icons.js';
import { recognizeExpiry, ocrStatusText } from '../core/ocr.js';

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
  const dot = st.key === 'expired' ? '<span class="pulse-dot" aria-hidden="true"></span>' : '';
  return `<span class="pill ${cls}">${dot}${text}</span>`;
}

function shelfMeta(st) {
  if (st.key === 'none') return { key: 'none', pct: 0 };
  if (st.key === 'expired') return { key: 'expired', pct: 100 };
  const pct = Math.max(6, Math.min(100, Math.round(((st.days ?? 0) / 365) * 100)));
  return { key: st.key, pct };
}

/** 單行物品列（用於首頁即時提醒群組） */
export function itemRowHTML(item, { showDate = false, showRestock = false } = {}) {
  const st = statusOf(item.expiry, warnSettings());
  const cat = getCategory(item.category);
  const catMeta = getCategoryMeta(cat || item.category);
  const sub = [];
  sub.push(showDate ? (item.expiry ? fmtDate(item.expiry) : '未設期限') : categoryName(item.category));
  sub.push(`${item.qty} ${item.unit}`);
  if (item.location) sub.push(item.location);

  const pill = statusPillHTML(item.expiry);
  const trail = pill || `<span class="row-date">${item.expiry ? fmtDate(item.expiry) : '—'}</span>`;
  const urgencyClass = st.key === 'expired' ? ' is-expired' : st.key === 'soon' ? ' is-soon' : '';

  return `
    <div class="row item-row item-row-line${urgencyClass}" data-item-id="${esc(item.id)}">
      <button type="button" class="item-open-area" data-open-item="${esc(item.id)}">
        <span class="cat-badge tone--${esc(catMeta.tone)}" aria-hidden="true">${icon(catMeta.icon)}</span>
        <span class="row-main">
          <span class="row-title">${esc(item.name)}</span>
          <span class="row-sub">${sub.map((part) => `<span>${esc(part)}</span>`).join('<span class="sep">·</span>')}</span>
        </span>
      </button>
      <span class="row-trail">
        <button type="button" class="row-trail" data-open-item="${esc(item.id)}" aria-label="編輯 ${esc(item.name)}">
          ${trail}
          ${showRestock ? '' : '<span class="chev" aria-hidden="true"></span>'}
        </button>
        ${
          showRestock
            ? `<button type="button" class="btn btn--quiet btn--sm" data-restock="${esc(item.id)}">已更換</button>`
            : ''
        }
      </span>
    </div>`;
}

/** 質感物品卡片（用於避難包雙欄網格，含效期殘量進度條與彈跳數量微調器） */
export function itemCardHTML(item, { showStepper = false, index = 0, animate = false } = {}) {
  const st = statusOf(item.expiry, warnSettings());
  const shelf = shelfMeta(st);
  const cat = getCategory(item.category);
  const catMeta = getCategoryMeta(cat || item.category);
  const pill = statusPillHTML(item.expiry);
  const dateOrPill = pill || `<span class="row-date">${item.expiry ? fmtDate(item.expiry) : '—'}</span>`;
  const urgencyClass = st.key === 'expired' ? ' is-expired' : st.key === 'soon' ? ' is-soon' : '';

  return `
    <article class="item-row item-card bento-tilt${urgencyClass}${animate ? ' stagger-in' : ''}" data-item-id="${esc(item.id)}" style="--i:${index}">
      <div class="item-card-top">
        <button type="button" class="item-open-area" data-open-item="${esc(item.id)}">
          <span class="cat-badge tone--${esc(catMeta.tone)}" aria-hidden="true">${icon(catMeta.icon)}</span>
          <span class="row-main">
            <span class="row-title">${esc(item.name)}</span>
            <span class="row-sub">
              <span>${esc(categoryName(item.category))}</span>
              <span class="sep">·</span>
              <span>${esc(item.unit || '個')}</span>
            </span>
          </span>
        </button>
        <button type="button" class="row-trail" data-open-item="${esc(item.id)}" aria-label="編輯 ${esc(item.name)}">
          ${dateOrPill}
          <span class="chev" aria-hidden="true"></span>
        </button>
      </div>

      <div class="item-card-foot">
        <div class="item-card-meta">
          ${
            item.location
              ? `<span class="item-loc-tag">${icon('pin')} ${esc(item.location)}</span>`
              : `<span class="hint">${item.expiry ? fmtDate(item.expiry) : '尚未指定存放位置'}</span>`
          }
        </div>
        ${
          showStepper
            ? `<div class="qty-stepper" data-stepper="${esc(item.id)}" role="group" aria-label="${esc(item.name)} 數量調整">
                 <button type="button" class="qty-btn" data-qty-delta="-1" aria-label="減少數量"${item.qty <= 1 ? ' disabled' : ''}>${icon('minus')}</button>
                 <span class="qty-val">${esc(item.qty)}</span>
                 <button type="button" class="qty-btn" data-qty-delta="1" aria-label="增加數量">${icon('plus')}</button>
               </div>`
            : `<span class="hint">${esc(item.qty)} ${esc(item.unit)}</span>`
        }
      </div>

      <div class="shelf-bar is-${shelf.key}" style="--shelf:${shelf.pct}%" aria-hidden="true">
        <div class="shelf-fill"></div>
      </div>
    </article>`;
}

/** 一鍵更新有效期限面板 */
export function openRestockSheet(item, { onSaved } = {}) {
  if (!item) return;
  openSheet({
    title: '更新有效期限',
    body: `
      <p class="editor-lead">
        為「<strong>${esc(item.name)}</strong>」設定補換後的新期限。
        ${item.expiry ? `（原本：${fmtDate(item.expiry)}）` : ''}
      </p>
      <div class="field">
        <span class="field-label">快速延長（從今天算起）</span>
        <div class="chip-row" data-restock-quick>
          <button type="button" class="chip" data-months="6">+6 個月</button>
          <button type="button" class="chip" data-months="12">+1 年</button>
          <button type="button" class="chip" data-months="24">+2 年</button>
          <button type="button" class="chip" data-months="36">+3 年</button>
          <button type="button" class="chip" data-months="none">無期限</button>
        </div>
      </div>
      <label class="field">
        <span class="field-label">新有效期限</span>
        <input class="input" id="restock-date" type="date" value="${esc(addMonthsISO(todayISO(), 12))}">
      </label>
      <div class="field">
        <button type="button" class="btn btn--ghost btn--block" data-restock-ocr>
          ${icon('camera')} 拍新包裝日期自動讀取
        </button>
        <p class="field-hint" data-restock-ocr-hint></p>
      </div>
    `,
    foot: `
      <button type="button" class="btn btn--ghost" data-act="cancel">取消</button>
      <button type="button" class="btn btn--primary" data-act="save">儲存新期限</button>
    `,
    onMount({ bodyEl, footEl, close }) {
      const dateInput = bodyEl.querySelector('#restock-date');
      const hint = bodyEl.querySelector('[data-restock-ocr-hint]');

      bodyEl.querySelector('[data-restock-quick]').addEventListener('click', (event) => {
        const btn = event.target.closest('[data-months]');
        if (!btn) return;
        const val = btn.dataset.months;
        dateInput.value = val === 'none' ? '' : addMonthsISO(todayISO(), Number(val));
        haptic('select');
      });

      bodyEl.querySelector('[data-restock-ocr]').addEventListener('click', async () => {
        const file = await pickFile({ accept: 'image/*', capture: 'environment' });
        if (!file || !bodyEl.isConnected) return;
        hint.textContent = '正在讀取日期…';
        try {
          const { candidates } = await recognizeExpiry(file, {
            onProgress: (msg) => {
              if (hint.isConnected) hint.textContent = ocrStatusText(msg);
            },
          });
          if (!bodyEl.isConnected) return;
          const best = candidates.find((c) => c.trusted && !c.ambiguous) || candidates[0];
          if (best) {
            dateInput.value = best.iso;
            hint.textContent = `已帶入辨識日期：${fmtDate(best.iso)}`;
            haptic('success');
          } else {
            hint.textContent = '未能辨識出明確日期，請手動選擇。';
          }
        } catch (err) {
          if (hint.isConnected) hint.textContent = err?.message || '辨識失敗';
        }
      });

      footEl.querySelector('[data-act="cancel"]').addEventListener('click', () => close());
      footEl.querySelector('[data-act="save"]').addEventListener('click', (event) => {
        sparkleBurst(event.currentTarget, { color: 'var(--safe)' });
        updateItem(item.id, { expiry: dateInput.value || null });
        haptic('success');
        toast('已更新有效期限');
        close('saved');
        onSaved?.();
      });
    },
  });
}

/** 編輯 / 新增物品面板（含效期 OCR、位置建議、刪除可復原） */
export function openItemEditor(item, { onSaved, onDeleted } = {}) {
  const isNew = !item || !item.id;
  const base = isNew
    ? { name: '', category: 'other', qty: 1, unit: '個', location: '', expiry: null, expiryKind: '賞味期限', note: '', barcode: '' }
    : item;

  const categories = getState().categories;
  const knownLocations = getKnownLocations();
  let catId = categories.some((c) => c.id === base.category) ? base.category : categories[0].id;

  const catChips = () =>
    categories
      .map((c) => {
        const meta = getCategoryMeta(c);
        return `<button type="button" class="chip${c.id === catId ? ' is-active' : ''}" data-cat="${esc(c.id)}">${icon(meta.icon)} ${esc(c.name)}</button>`;
      })
      .join('');

  const kindOptions = EXPIRY_KINDS.map(
    (k) => `<option value="${esc(k)}"${base.expiryKind === k ? ' selected' : ''}>${esc(k)}</option>`
  ).join('');

  openSheet({
    title: isNew ? '新增物品' : '編輯物品',
    body: `
      <form class="editor" novalidate>
        ${
          base.barcode
            ? `<div class="barcode-meta"><span class="barcode-tag">${icon('barcode')} ${esc(base.barcode)}</span></div>`
            : ''
        }

        <label class="field">
          <span class="field-label">名稱</span>
          <input class="input" name="name" maxlength="60" placeholder="例如：飲用水 600ml" value="${esc(base.name)}">
        </label>

        <div class="field">
          <span class="field-label">分類</span>
          <div class="chip-row" data-cats>${catChips()}</div>
        </div>

        <div class="field field-row">
          <div class="field">
            <span class="field-label">數量</span>
            <div class="qty-stepper qty-stepper--lg">
              <button type="button" class="qty-btn" data-ed-qty="-1" aria-label="減少數量">${icon('minus')}</button>
              <input class="qty-input" name="qty" type="number" min="1" max="9999" step="1" inputmode="numeric" value="${esc(base.qty)}">
              <button type="button" class="qty-btn" data-ed-qty="1" aria-label="增加數量">${icon('plus')}</button>
            </div>
          </div>
          <label class="field">
            <span class="field-label">單位</span>
            <input class="input" name="unit" maxlength="6" value="${esc(base.unit)}" placeholder="個" list="unit-suggestions">
            <datalist id="unit-suggestions">
              ${UNIT_SUGGESTIONS.map((u) => `<option value="${esc(u)}">`).join('')}
            </datalist>
          </label>
        </div>

        <div class="field">
          <div class="chip-row" data-unit-chips>
            ${UNIT_SUGGESTIONS.slice(0, 8)
              .map((u) => `<button type="button" class="chip chip--sm" data-unit-pick="${esc(u)}">${esc(u)}</button>`)
              .join('')}
          </div>
        </div>

        <label class="field">
          <span class="field-label">存放位置</span>
          <input class="input" name="location" maxlength="40" value="${esc(base.location)}" placeholder="例如：玄關櫃・下層" list="known-locations-list">
          <datalist id="known-locations-list">
            ${knownLocations.map((loc) => `<option value="${esc(loc)}">`).join('')}
          </datalist>
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
            <button type="button" class="chip chip--sm" data-quick="none">無期限</button>
            <button type="button" class="chip chip--sm" data-quick="6m">+6 個月</button>
            <button type="button" class="chip chip--sm" data-quick="1y">+1 年</button>
            <button type="button" class="chip chip--sm" data-quick="3y">+3 年</button>
          </div>
          <button type="button" class="btn btn--ghost btn--block" data-editor-ocr style="margin-top:10px">
            ${icon('camera')} 拍包裝日期，自動讀取效期
          </button>
          <span class="field-hint" data-editor-ocr-hint></span>
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
      : `<button type="button" class="btn btn--danger" data-act="delete">${icon('trash')} 刪除</button>
         <button type="button" class="btn btn--primary" data-act="save">儲存</button>`,
    onMount({ bodyEl, footEl, close }) {
      const form = bodyEl.querySelector('form');
      const nameInput = form.querySelector('[name="name"]');
      const qtyInput = form.querySelector('[name="qty"]');
      const unitInput = form.querySelector('[name="unit"]');
      const expiryInput = form.querySelector('[name="expiry"]');
      const ocrHint = bodyEl.querySelector('[data-editor-ocr-hint]');

      bodyEl.querySelector('[data-cats]').addEventListener('click', (event) => {
        const btn = event.target.closest('[data-cat]');
        if (!btn) return;
        catId = btn.dataset.cat;
        haptic('select');
        bodyEl.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('is-active', b === btn));
      });

      bodyEl.querySelectorAll('[data-ed-qty]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const delta = Number(btn.dataset.edQty) || 0;
          const next = Math.max(1, Math.min(9999, (Number(qtyInput.value) || 1) + delta));
          qtyInput.value = String(next);
          haptic('select');
        });
      });

      bodyEl.querySelector('[data-unit-chips]').addEventListener('click', (event) => {
        const btn = event.target.closest('[data-unit-pick]');
        if (!btn) return;
        unitInput.value = btn.dataset.unitPick;
        haptic('select');
      });

      bodyEl.querySelector('[data-quick-row]').addEventListener('click', (event) => {
        const btn = event.target.closest('[data-quick]');
        if (!btn) return;
        const map = { none: null, '6m': 6, '1y': 12, '3y': 36 };
        if (!Object.prototype.hasOwnProperty.call(map, btn.dataset.quick)) return;
        const months = map[btn.dataset.quick];
        expiryInput.value = months === null ? '' : addMonthsISO(todayISO(), months);
        haptic('select');
      });

      bodyEl.querySelector('[data-editor-ocr]').addEventListener('click', async () => {
        const file = await pickFile({ accept: 'image/*', capture: 'environment' });
        if (!file || !bodyEl.isConnected) return;
        ocrHint.textContent = '準備讀取照片日期…';
        try {
          const { candidates } = await recognizeExpiry(file, {
            onProgress: (msg) => {
              if (ocrHint.isConnected) ocrHint.textContent = ocrStatusText(msg);
            },
          });
          if (!bodyEl.isConnected) return;
          const best = candidates.find((c) => c.trusted && !c.ambiguous) || candidates[0];
          if (best) {
            expiryInput.value = best.iso;
            ocrHint.textContent = `已帶入辨識日期：${fmtDate(best.iso)}（可依需求修改）`;
            haptic('success');
          } else {
            ocrHint.textContent = '找不到可用日期，請試著避開反光或直接點日曆選擇。';
          }
        } catch (err) {
          if (ocrHint.isConnected) ocrHint.textContent = err?.message || '日期辨識失敗';
        }
      });

      footEl.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close());

      footEl.querySelector('[data-act="save"]').addEventListener('click', (event) => {
        const data = new FormData(form);
        const name = String(data.get('name') || '').trim();
        if (!name) {
          nameInput.focus();
          nameInput.classList.add('is-invalid');
          haptic('warn');
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

        sparkleBurst(event.currentTarget);
        if (isNew) {
          addItem(payload);
          haptic('success');
          toast('已加入避難包');
        } else {
          updateItem(base.id, payload);
          haptic('success');
          toast('已更新');
        }
        close('saved');
        onSaved?.();
      });

      footEl.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '刪除物品',
          message: `確定要刪除「${base.name}」嗎？`,
          confirmLabel: '刪除',
          tone: 'danger',
        });
        if (!ok) return;
        const removed = deleteItem(base.id);
        haptic('warn');
        close('deleted');
        onDeleted?.();
        if (removed) {
          toast(`已刪除「${base.name}」`, {
            type: 'warn',
            actionLabel: '復原',
            onAction: () => {
              restoreItem(removed.item, removed.index);
              haptic('success');
              toast(`已還原「${removed.item.name}」`);
            },
          });
        }
      });

      setTimeout(() => {
        if (isNew && window.innerWidth > 700) nameInput.focus({ preventScroll: true });
      }, 240);
    },
  });
}

/** 可勾選、去重的建議防災用品選擇器 */
export function openTemplatePicker({ onDone } = {}) {
  const { settings, items: existingItems } = getState();
  const householdSize = settings.householdSize || 1;
  const templates = templateItems(householdSize);
  const ownedNames = new Set(existingItems.map((i) => i.name.trim().toLowerCase()));

  const rows = templates.map((t, idx) => ({
    ...t,
    idx,
    owned: ownedNames.has(t.name.trim().toLowerCase()),
  }));

  openSheet({
    title: '載入建議防災清單',
    body: `
      <p class="editor-lead">
        已依目前設定的 <strong>${householdSize} 人</strong>家庭份量換算飲水與食料建議數；已備妥的項目預設不會重複勾選。
      </p>
      <div class="btn-row" style="margin-bottom:12px">
        <button type="button" class="btn btn--ghost btn--sm" data-pick-missing>只選未備齊</button>
        <button type="button" class="btn btn--ghost btn--sm" data-pick-all>全選 18 項</button>
      </div>
      <div class="template-list">
        ${rows
          .map((row) => {
            const meta = getCategoryMeta(row.category);
            return `
              <label class="template-item${row.owned ? ' is-owned' : ''}">
                <input class="template-check" type="checkbox" data-tpl-idx="${row.idx}"${row.owned ? '' : ' checked'}>
                <span class="cat-badge cat-badge--sm tone--${esc(meta.tone)}" aria-hidden="true">${icon(meta.icon)}</span>
                <span class="template-meta">
                  <span class="template-name">
                    <span>${esc(row.name)}</span>
                    ${row.owned ? '<span class="pill pill--ok">已在包中</span>' : ''}
                  </span>
                  ${row.note ? `<span class="template-note">${esc(row.note)}</span>` : ''}
                </span>
                <span class="template-qty">${row.qty} ${esc(row.unit)}</span>
              </label>`;
          })
          .join('')}
      </div>
    `,
    foot: `
      <button type="button" class="btn btn--ghost" data-act="cancel">取消</button>
      <button type="button" class="btn btn--primary" data-act="confirm">加入勾選項目</button>
    `,
    onMount({ bodyEl, footEl, close }) {
      const checks = [...bodyEl.querySelectorAll('.template-check')];
      const confirmBtn = footEl.querySelector('[data-act="confirm"]');

      const updateCount = () => {
        const count = checks.filter((c) => c.checked).length;
        confirmBtn.disabled = count === 0;
        confirmBtn.textContent = count ? `加入 ${count} 項用品` : '請先勾選項目';
      };

      checks.forEach((c) => c.addEventListener('change', updateCount));

      bodyEl.querySelector('[data-pick-missing]').addEventListener('click', () => {
        checks.forEach((c) => {
          const idx = Number(c.dataset.tplIdx);
          c.checked = !rows[idx].owned;
        });
        updateCount();
        haptic('select');
      });

      bodyEl.querySelector('[data-pick-all]').addEventListener('click', () => {
        checks.forEach((c) => {
          c.checked = true;
        });
        updateCount();
        haptic('select');
      });

      footEl.querySelector('[data-act="cancel"]').addEventListener('click', () => close());
      footEl.querySelector('[data-act="confirm"]').addEventListener('click', (event) => {
        const picked = checks
          .filter((c) => c.checked)
          .map((c) => {
            const { idx, owned, scalable, ...clean } = rows[Number(c.dataset.tplIdx)];
            return clean;
          });
        if (!picked.length) return;
        sparkleBurst(event.currentTarget);
        addItems(picked);
        haptic('success');
        toast(`已加入 ${picked.length} 項防災用品`);
        close('added');
        onDone?.(picked.length);
      });

      updateCount();
    },
  });
}

/** 綁定清單容器內的點擊、步進器加減與快速更換效期 */
export function bindItemCards(container, { onChanged } = {}) {
  if (!container || container.dataset.cardsBound === '1') return;
  container.dataset.cardsBound = '1';

  container.addEventListener('click', (event) => {
    const qtyBtn = event.target.closest('[data-qty-delta]');
    if (qtyBtn) {
      event.stopPropagation();
      const stepper = qtyBtn.closest('[data-stepper]');
      const id = stepper?.dataset.stepper;
      const delta = Number(qtyBtn.dataset.qtyDelta) || 0;
      if (!id || !delta) return;
      incrementItemQty(id, delta);
      haptic('select');
      onChanged?.();
      return;
    }

    const restockBtn = event.target.closest('[data-restock]');
    if (restockBtn) {
      event.stopPropagation();
      const item = getState().items.find((i) => i.id === restockBtn.dataset.restock);
      if (!item) return;
      haptic('light');
      openRestockSheet(item, { onSaved: onChanged });
      return;
    }

    const openBtn = event.target.closest('[data-open-item]');
    if (!openBtn) return;
    const item = getState().items.find((i) => i.id === openBtn.dataset.openItem);
    if (!item) return;
    haptic('light');
    openItemEditor(item, { onSaved: onChanged, onDeleted: onChanged });
  });
}
