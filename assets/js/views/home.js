import { getState, stats, attentionItems, loadTemplate } from '../core/store.js';
import { fmtDate, todayISO, weekdayZh } from '../core/dates.js';
import { esc, toast, confirmDialog } from '../core/ui.js';
import { templateItems } from '../data/presets.js';
import { bindItemCards, itemRowHTML } from '../components/itemCard.js';
import { spring, countUp } from '../core/spring.js';
import { haptic } from '../core/haptics.js';

function summaryHTML(s) {
  const pct = Math.round((s.essentialOk / Math.max(1, s.essential.length)) * 100);
  let title;
  let sub;

  if (!s.total) {
    title = '避難包還是空的';
    sub = '先從飲水與食物開始，一項一項補齊。';
  } else if (s.needsAttention) {
    title = `${s.needsAttention} 項需要處理`;
    sub = `已過期 ${s.expired}・快到期 ${s.soon}・共 ${s.total} 項`;
  } else {
    title = '目前都在期限內';
    sub = `${s.total} 項・合計 ${s.qty} 件・${s.essentialOk}/${s.essential.length} 個核心分類`;
  }

  return `
    <section class="summary">
      <div class="ring" style="--pct:${pct}" data-ring data-pct="${pct}" role="img" aria-label="核心分類完整度 ${pct}%">
        <span class="ring-val" data-ring-val>${pct}%</span>
      </div>
      <div class="summary-main">
        <p class="summary-kicker">避難包狀態</p>
        <p class="summary-title">${esc(title)}</p>
        <p class="summary-sub">${esc(sub)}</p>
      </div>
    </section>`;
}

function statsHTML(s) {
  const { warnSoon } = getState().settings;
  return `
    <section class="stat-grid" aria-label="到期狀態統計">
      <a class="stat stat--expired${s.expired ? '' : ' is-zero'}" href="#/items?st=expired">
        <span class="stat-num" data-count="${s.expired}">${s.expired}</span>
        <span class="stat-label">已過期</span>
      </a>
      <a class="stat stat--soon${s.soon ? '' : ' is-zero'}" href="#/items?st=soon">
        <span class="stat-num" data-count="${s.soon}">${s.soon}</span>
        <span class="stat-label">快到期</span>
        <span class="stat-sub">${warnSoon} 天內</span>
      </a>
      <a class="stat stat--watch${s.watch + s.none ? '' : ' is-zero'}" href="#/items?st=watch">
        <span class="stat-num" data-count="${s.watch + s.none}">${s.watch + s.none}</span>
        <span class="stat-label">待留意</span>
        <span class="stat-sub">含 ${s.none} 項未設期限</span>
      </a>
    </section>`;
}

function alertsHTML(rows) {
  if (!rows.length) {
    return `
      <div class="empty" style="padding:28px 20px">
        <div class="empty-mark" aria-hidden="true">良</div>
        <h3>目前沒有快到期的物品</h3>
        <p>下次打開時，這裡會列出需要優先檢查的項目。</p>
      </div>`;
  }
  return rows.map(({ item }) => itemRowHTML(item, { showDate: true })).join('');
}

function completenessHTML(s) {
  return `
    <section>
      <div class="section-head">
        <h2>核心分類</h2>
        <span class="hint">${s.essentialOk} / ${s.essential.length}</span>
      </div>
      <div class="group">
        <div class="check-grid">
          ${s.essential
            .map(
              (e) => `
            <span class="check-pill${e.ok ? ' is-on' : ''}">
              <span class="tick" aria-hidden="true">${e.ok ? '✓' : '·'}</span>${esc(e.name)}
            </span>`
            )
            .join('')}
        </div>
      </div>
    </section>`;
}

function emptyHTML() {
  return `
    <div class="empty">
      <div class="empty-mark" aria-hidden="true">包</div>
      <h3>避難包還沒開始</h3>
      <p>掃描家裡現成的防災用品，或先載入一份建議清單，再逐項補上有效期限。</p>
      <div class="btn-row">
        <a class="btn btn--primary" href="#/scan">掃描加入</a>
        <button type="button" class="btn btn--ghost" data-template>載入建議清單</button>
      </div>
    </div>`;
}

export function renderHome(view, ctx) {
  let intro = true;

  const draw = () => {
    const s = stats();
    const rows = attentionItems(5);
    const hasItems = s.total > 0;
    const today = todayISO();
    const pct = Math.round((s.essentialOk / Math.max(1, s.essential.length)) * 100);

    ctx.setSubtitle(`${fmtDate(today)}・${weekdayZh(today)}`);
    ctx.setStamp('備');

    view.innerHTML = `
      ${summaryHTML(s)}
      ${statsHTML(s)}

      <section>
        <div class="section-head">
          <h2>該補了</h2>
          <span class="hint">${hasItems ? '依到期日排序' : '先加入物品'}</span>
        </div>
        <div class="group">${hasItems ? alertsHTML(rows) : emptyHTML()}</div>
      </section>

      ${hasItems ? completenessHTML(s) : ''}
    `;

    /* 提醒列所在的群組：點任一列開啟編輯 */
    bindItemCards(view.querySelector('.group'));

    const ring = view.querySelector('[data-ring]');
    const ringVal = view.querySelector('[data-ring-val]');

    if (intro) {
      intro = false;
      if (ring) {
        ring.style.setProperty('--pct', '0');
        if (ringVal) ringVal.textContent = '0%';
        spring({
          from: 0,
          to: pct,
          response: 0.7,
          damping: 1,
          restDelta: 0.2,
          restSpeed: 3,
          onUpdate: (value) => {
            const safe = Math.max(0, value);
            ring.style.setProperty('--pct', String(safe));
            if (ringVal) ringVal.textContent = `${Math.round(safe)}%`;
          },
        });
      }
      view.querySelectorAll('[data-count]').forEach((node) => {
        countUp(node, Number(node.dataset.count) || 0);
      });
    }

    view.querySelector('[data-template]')?.addEventListener('click', async () => {
      if (getState().items.length) {
        const ok = await confirmDialog({
          title: '載入建議清單',
          message: '目前的清單會保留，建議項目會加在後面。要繼續嗎？',
          confirmLabel: '加入建議項目',
        });
        if (!ok) return;
      }
      loadTemplate(templateItems());
      haptic('success');
      toast('已加入 18 項常見防災用品');
    });
  };

  draw();
  return { refresh: draw };
}
