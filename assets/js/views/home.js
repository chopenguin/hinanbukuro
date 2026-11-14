import { getState, stats, attentionItems, loadTemplate, categoryName } from '../core/store.js';
import { fmtDate, todayISO, weekdayZh } from '../core/dates.js';
import { esc, toast, confirmDialog } from '../core/ui.js';
import { templateItems } from '../data/presets.js';
import { bindItemCards, statusPillHTML } from '../components/itemCard.js';

function heroHTML(s) {
  const today = todayISO();
  return `
    <section class="card hero">
      <span class="hero-mark" aria-hidden="true">備</span>
      <div class="hero-body">
        <p class="kicker">今日</p>
        <p class="hero-date">
          <span class="num">${fmtDate(today)}</span>
          <span class="hero-weekday">${weekdayZh(today)}</span>
        </p>
        <p class="hero-sub">${
          s.total
            ? `避難包共 ${s.total} 項・合計 ${s.qty} 件${s.needsAttention ? `，其中 ${s.needsAttention} 項需要處理` : '，目前都還在期限內'}`
            : '避難包還是空的。掃描一件現成的防災用品，先從水與食物開始。'
        }</p>
      </div>
      <a class="btn btn--primary hero-btn" href="#/scan">
        <svg viewBox="0 0 24 24"><path d="M4 8V5.6A1.6 1.6 0 0 1 5.6 4H8M16 4h2.4A1.6 1.6 0 0 1 20 5.6V8M20 16v2.4a1.6 1.6 0 0 1-1.6 1.6H16M8 20H5.6A1.6 1.6 0 0 1 4 18.4V16"/><path d="M7 12h10"/></svg>
        掃描加入
      </a>
    </section>`;
}

function statsHTML(s) {
  return `
    <section class="stat-grid" aria-label="到期狀態統計">
      <a class="stat stat--expired" href="#/items?st=expired">
        <span class="stat-num">${s.expired}</span>
        <span class="stat-label">已過期</span>
      </a>
      <a class="stat stat--soon" href="#/items?st=soon">
        <span class="stat-num">${s.soon}</span>
        <span class="stat-label">快到期</span>
        <span class="stat-sub">${getState().settings.warnSoon} 天內</span>
      </a>
      <a class="stat stat--watch" href="#/items?st=watch">
        <span class="stat-num">${s.watch + s.none}</span>
        <span class="stat-label">待留意</span>
        <span class="stat-sub">含 ${s.none} 項未設期限</span>
      </a>
    </section>`;
}

function alertsHTML(rows) {
  if (!rows.length) {
    return `
      <div class="card card--flat quiet-card">
        <p class="quiet-title">目前沒有快到期的物品</p>
        <p class="quiet-sub">下次打開時，這裡會列出需要優先檢查的項目。</p>
      </div>`;
  }

  return `
    <div class="alert-list">
      ${rows
        .map(({ item, st }) => `
        <button type="button" class="alert-row${st.key === 'expired' ? ' is-expired' : ''}" data-open-item="${esc(item.id)}">
          <span class="alert-main">
            <span class="alert-name">${esc(item.name)}</span>
            <span class="alert-meta">
              <span>${item.expiry ? fmtDate(item.expiry) : '未設期限'}</span>
              <span aria-hidden="true">·</span>
              <span>${esc(item.location || categoryName(item.category))}</span>
            </span>
          </span>
          ${statusPillHTML(item.expiry)}
        </button>`)
        .join('')}
    </div>`;
}

function completenessHTML(s) {
  const pct = Math.round((s.essentialOk / s.essential.length) * 100);
  return `
    <div class="card card--flat">
      <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <i style="width:${pct}%"></i>
      </div>
      <div class="check-grid" style="margin-top:14px">
        ${s.essential
          .map(
            (e) => `
          <span class="check-pill${e.ok ? ' is-on' : ''}">
            <span class="tick" aria-hidden="true">${e.ok ? '✓' : '·'}</span>${esc(e.name)}
          </span>`
          )
          .join('')}
      </div>
    </div>`;
}

function emptyHTML() {
  return `
    <div class="empty">
      <div class="empty-mark" aria-hidden="true">空</div>
      <h3>避難包還沒開始</h3>
      <p>掃描家裡現成的防災用品，或先載入一份建議清單，再逐項補上有效期限。</p>
      <div class="btn-row" style="justify-content:center">
        <a class="btn btn--primary" href="#/scan">掃描加入</a>
        <button type="button" class="btn btn--ghost" data-template>載入建議清單</button>
      </div>
    </div>`;
}

export function renderHome(view, ctx) {
  const draw = () => {
    const s = stats();
    const rows = attentionItems(5);
    const hasItems = s.total > 0;

    view.innerHTML = `
      ${heroHTML(s)}
      ${statsHTML(s)}

      <section>
        <div class="section-head">
          <h2>該補了</h2>
          <span class="hint">${hasItems ? '依到期日排序' : '先加入物品'}</span>
        </div>
        ${hasItems ? `<div data-cards>${alertsHTML(rows)}</div>` : emptyHTML()}
      </section>

      ${
        hasItems
          ? `<section>
              <div class="section-head">
                <h2>避難包完整度</h2>
                <span class="hint">${s.essentialOk} / ${s.essential.length} 個核心分類</span>
              </div>
              ${completenessHTML(s)}
            </section>`
          : ''
      }
    `;

    const cards = view.querySelector('[data-cards]');
    if (cards) bindItemCards(cards);

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
      toast('已加入 18 項常見防災用品');
    });
  };

  draw();
  return { refresh: draw };
}
