import { getState, stats, attentionItems, loadTemplate } from '../core/store.js';
import { fmtDate, todayISO, weekdayZh } from '../core/dates.js';
import { esc, toast, confirmDialog } from '../core/ui.js';
import { templateItems, getCategoryMeta } from '../data/presets.js?v=2';
import { bindItemCards, itemRowHTML } from '../components/itemCard.js?v=2';
import { spring, countUp } from '../core/spring.js';
import { haptic } from '../core/haptics.js';

function summaryHTML(s) {
  const pct = Math.round((s.essentialOk / Math.max(1, s.essential.length)) * 100);
  let statusBadge = '';
  let title;
  let sub;

  if (!s.total) {
    statusBadge = '<span class="status-badge status-badge--empty">尚未建置</span>';
    title = '避難包還是空的';
    sub = '先從飲水與食物開始，一項一項補齊。';
  } else if (s.needsAttention) {
    statusBadge = `<span class="status-badge status-badge--warn">需處理 ${s.needsAttention} 項</span>`;
    title = `${s.needsAttention} 項物品需要留意`;
    sub = `已過期 ${s.expired} 項・快到期 ${s.soon} 項`;
  } else {
    statusBadge = '<span class="status-badge status-badge--ok">狀況良好</span>';
    title = '備品都在期限內';
    sub = `所有 ${s.total} 項物資皆在有效期限內`;
  }

  const chips = s.total
    ? `
    <div class="summary-chips">
      <span class="summary-chip"><strong>${s.total}</strong> 項物品</span>
      <span class="summary-chip"><strong>${s.qty}</strong> 件物資</span>
      <span class="summary-chip"><strong>${s.essentialOk}/${s.essential.length}</strong> 核心分類</span>
    </div>
  `
    : '';

  return `
    <section class="summary">
      <div class="ring" style="--pct:${pct}" data-ring data-pct="${pct}" role="img" aria-label="核心分類完整度 ${pct}%">
        <span class="ring-val" data-ring-val>${pct}%</span>
      </div>
      <div class="summary-main">
        <div class="summary-top">
          <p class="summary-kicker">整備進度</p>
          ${statusBadge}
        </div>
        <p class="summary-title">${esc(title)}</p>
        <p class="summary-sub">${esc(sub)}</p>
        ${chips}
      </div>
    </section>`;
}

function statsHTML(s) {
  const { warnSoon } = getState().settings;
  return `
    <section class="stat-grid" aria-label="到期狀態統計">
      <a class="stat stat--expired${s.expired ? '' : ' is-zero'}" href="#/items?st=expired">
        <div class="stat-top">
          <span class="stat-icon">⚠️</span>
          <span class="stat-label">已過期</span>
        </div>
        <span class="stat-num" data-count="${s.expired}">${s.expired}</span>
        <span class="stat-sub">需立即替換</span>
      </a>
      <a class="stat stat--soon${s.soon ? '' : ' is-zero'}" href="#/items?st=soon">
        <div class="stat-top">
          <span class="stat-icon">⏳</span>
          <span class="stat-label">快到期</span>
        </div>
        <span class="stat-num" data-count="${s.soon}">${s.soon}</span>
        <span class="stat-sub">${warnSoon} 天內到期</span>
      </a>
      <a class="stat stat--watch${s.watch + s.none ? '' : ' is-zero'}" href="#/items?st=watch">
        <div class="stat-top">
          <span class="stat-icon">🛡️</span>
          <span class="stat-label">待留意</span>
        </div>
        <span class="stat-num" data-count="${s.watch + s.none}">${s.watch + s.none}</span>
        <span class="stat-sub">含 ${s.none} 項無期限</span>
      </a>
    </section>`;
}

function alertsHTML(rows) {
  if (!rows.length) {
    return `
      <div class="empty empty--calm">
        <div class="empty-mark empty-mark--shield" aria-hidden="true">🛡️</div>
        <h3>目前物資狀態良好</h3>
        <p>定期檢查避難包，若有即將過期或需要更換的項目會自動顯示在此。</p>
      </div>`;
  }
  return rows.map(({ item }) => itemRowHTML(item, { showDate: true })).join('');
}

function completenessHTML(s) {
  return `
    <section class="essential-section">
      <div class="section-head">
        <h2>核心防災分類</h2>
        <span class="hint">${s.essentialOk} / ${s.essential.length} 已備妥</span>
      </div>
      <div class="essential-grid">
        ${s.essential
          .map((e) => {
            const meta = getCategoryMeta(e.id);
            return `
              <a class="essential-card${e.ok ? ' is-complete' : ''}" href="#/items?cat=${esc(e.id)}">
                <div class="essential-card-header">
                  <span class="essential-icon" style="background: ${meta.bg}" aria-hidden="true">${meta.icon}</span>
                  <span class="essential-status-tag ${e.ok ? 'tag--ok' : 'tag--wait'}">${e.ok ? '✓ 齊全' : '待補'}</span>
                </div>
                <div class="essential-card-body">
                  <span class="essential-name">${esc(e.name)}</span>
                  <span class="essential-count">${e.count ? `${e.count} 項物資` : '尚未準備'}</span>
                </div>
              </a>`;
          })
          .join('')}
      </div>
    </section>`;
}

function emptyHTML() {
  return `
    <div class="empty">
      <div class="empty-mark" aria-hidden="true">🎒</div>
      <h3>避難包尚未開始準備</h3>
      <p>掃描家裡的現成防災用品，或直接載入一份標準建議清單開始盤點。</p>
      <div class="btn-row">
        <a class="btn btn--primary" href="#/scan">相機掃描加入</a>
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
    ctx.setStamp('防災包');

    view.innerHTML = `
      ${summaryHTML(s)}
      ${statsHTML(s)}

      <section>
        <div class="section-head">
          <h2>即時提醒</h2>
          <span class="hint">${hasItems ? (rows.length ? '依急迫性排序' : '狀態正常') : '先加入物品'}</span>
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
