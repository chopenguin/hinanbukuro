import { getState, stats, attentionItems } from '../core/store.js';
import { fmtDate, todayISO, weekdayZh } from '../core/dates.js';
import { esc } from '../core/ui.js';
import { bindItemCards, itemRowHTML, openTemplatePicker } from '../components/itemCard.js';
import { spring, countUp } from '../core/spring.js';
import { icon } from '../core/icons.js';

const RING_R = 32;
const RING_CIRC = 2 * Math.PI * RING_R;

function summaryHTML(s, animateZero) {
  const { householdSize = 1 } = getState().settings;
  const pct = s.readinessScore;
  const initialPct = animateZero ? 0 : pct;
  const dashOffset = RING_CIRC * (1 - initialPct / 100);

  let statusBadge;
  let title;
  let sub;

  if (!s.total) {
    statusBadge = '<span class="status-badge status-badge--empty">尚未建置</span>';
    title = '避難包還是空的';
    sub = '從飲水、食料與急救包開始，依序補齊核心備品。';
  } else if (s.needsAttention) {
    statusBadge = `<span class="status-badge status-badge--warn">需處理 ${s.needsAttention} 項</span>`;
    title = `${s.needsAttention} 項物資需要更換或檢查`;
    sub = `已過期 ${s.expired} 項・快到期 ${s.soon} 項`;
  } else {
    statusBadge = '<span class="status-badge status-badge--ok">狀況良好</span>';
    title = '所有設定期限物資皆在效期內';
    sub = `已涵蓋 ${s.essentialOk} / ${s.essential.length} 項核心防災分類`;
  }

  const targetLiters = householdSize * 9;
  const chips = s.total
    ? `
    <div class="hero-metrics">
      <span class="metric-chip"><strong>${s.total}</strong> 項物品</span>
      <span class="metric-chip"><strong>${s.qty}</strong> 件物資</span>
      <span class="metric-chip"><strong>${s.essentialOk}/${s.essential.length}</strong> 核心分類</span>
    </div>`
    : '';

  return `
    <section class="hero-card">
      <div class="hero-top">
        <div class="ring-wrap" role="img" aria-label="綜合整備度 ${pct}%">
          <svg class="ring-svg" viewBox="0 0 78 78" aria-hidden="true">
            <circle class="ring-track" cx="39" cy="39" r="${RING_R}" />
            <circle class="ring-progress${pct >= 100 ? ' is-complete' : ''}" data-ring-circle cx="39" cy="39" r="${RING_R}"
              stroke-dasharray="${RING_CIRC.toFixed(2)}" stroke-dashoffset="${dashOffset.toFixed(2)}" />
          </svg>
          <div class="ring-center">
            <span class="ring-val" data-ring-val>${initialPct}%</span>
            <span class="ring-sub">整備度</span>
          </div>
        </div>
        <div class="hero-main">
          <div class="hero-kicker-row">
            <span class="kicker">整備進度</span>
            ${statusBadge}
          </div>
          <p class="hero-title">${esc(title)}</p>
          <p class="hero-sub">${esc(sub)}</p>
          ${chips}
        </div>
      </div>

      <div class="hero-foot">
        <span class="water-tip">
          ${icon('water')}
          <span>${householdSize} 人三日建議飲水約 <strong>${targetLiters} 公升</strong>（目前飲水登錄 ${s.waterQty} 單位）</span>
        </span>
        <div class="hero-actions">
          <a class="btn btn--primary btn--sm" href="#/scan">${icon('scan')} 掃描入包</a>
          <button type="button" class="btn btn--ghost btn--sm" data-template>${icon('listChecks')} 建議清單</button>
        </div>
      </div>
    </section>`;
}

function statsHTML(s) {
  const { warnSoon } = getState().settings;
  return `
    <section class="stat-grid" aria-label="到期狀態統計">
      <a class="stat stat--expired${s.expired ? '' : ' is-zero'}" href="#/items?st=expired">
        <div class="stat-top">
          <span class="stat-label">已過期</span>
          <span class="stat-ico" aria-hidden="true">${icon('alert')}</span>
        </div>
        <span class="stat-num" data-count="${s.expired}">${s.expired}</span>
        <span class="stat-sub">需立即替換</span>
      </a>
      <a class="stat stat--soon${s.soon ? '' : ' is-zero'}" href="#/items?st=soon">
        <div class="stat-top">
          <span class="stat-label">快到期</span>
          <span class="stat-ico" aria-hidden="true">${icon('clock')}</span>
        </div>
        <span class="stat-num" data-count="${s.soon}">${s.soon}</span>
        <span class="stat-sub">${warnSoon} 天內到期</span>
      </a>
      <a class="stat stat--watch${s.watch + s.none ? '' : ' is-zero'}" href="#/items?st=watch">
        <div class="stat-top">
          <span class="stat-label">待留意</span>
          <span class="stat-ico" aria-hidden="true">${icon('shield')}</span>
        </div>
        <span class="stat-num" data-count="${s.watch + s.none}">${s.watch + s.none}</span>
        <span class="stat-sub">含 ${s.none} 項待補期限</span>
      </a>
    </section>`;
}

function alertsHTML(rows) {
  if (!rows.length) {
    return `
      <div class="empty empty--calm">
        <div class="empty-mark empty-mark--shield" aria-hidden="true">${icon('shield')}</div>
        <h3>目前物資狀態良好</h3>
        <p>定期檢查避難包，若有即將過期或需要更換的項目會自動顯示在此。</p>
      </div>`;
  }
  return rows.map(({ item }) => itemRowHTML(item, { showDate: true, showRestock: true })).join('');
}

function completenessHTML(s) {
  return `
    <section>
      <div class="section-head">
        <h2>核心防災分類</h2>
        <span class="hint">${s.essentialOk} / ${s.essential.length} 已備妥</span>
      </div>
      <div class="essential-grid">
        ${s.essential
          .map(
            (e) => `
            <a class="essential-card${e.ok ? ' is-complete' : ''}" href="#/items?cat=${esc(e.id)}">
              <div class="essential-card-header">
                <span class="cat-badge cat-badge--sm tone--${esc(e.tone)}" aria-hidden="true">${icon(e.icon)}</span>
                <span class="essential-status-tag ${e.ok ? 'tag--ok' : 'tag--wait'}">${e.ok ? '已備妥' : '待補'}</span>
              </div>
              <div>
                <span class="essential-name">${esc(e.name)}</span>
                <span class="essential-count">${e.count ? `${e.count} 項物資` : '尚未準備'}</span>
              </div>
            </a>`
          )
          .join('')}
      </div>
    </section>`;
}

function emptyHTML() {
  return `
    <div class="empty">
      <div class="empty-mark" aria-hidden="true">${icon('bag')}</div>
      <h3>避難包尚未開始準備</h3>
      <p>掃描包裝條碼或拍照辨識品名與期限，或從標準防災建議清單挑選需要的用品。</p>
      <div class="btn-row">
        <a class="btn btn--primary" href="#/scan">${icon('scan')} 掃描加入</a>
        <button type="button" class="btn btn--ghost" data-template>${icon('listChecks')} 挑選建議清單</button>
      </div>
    </div>`;
}

export function renderHome(view, ctx) {
  let intro = true;

  const draw = () => {
    const s = stats();
    const rows = attentionItems(6);
    const hasItems = s.total > 0;
    const today = todayISO();
    const pct = s.readinessScore;

    ctx.setSubtitle(`${fmtDate(today)}・週${weekdayZh(today)}`);
    ctx.setStamp('防災手帳');

    view.innerHTML = `
      ${summaryHTML(s, intro)}
      ${statsHTML(s)}

      <section>
        <div class="section-head">
          <h2>即時提醒</h2>
          <span class="hint">${hasItems ? (rows.length ? '依急迫性排序' : '狀態正常') : '開始盤點'}</span>
        </div>
        <div class="group" id="home-alerts">${hasItems ? alertsHTML(rows) : emptyHTML()}</div>
      </section>

      ${hasItems ? completenessHTML(s) : ''}
    `;

    bindItemCards(view.querySelector('#home-alerts'));

    view.querySelectorAll('[data-template]').forEach((btn) => {
      btn.addEventListener('click', () => openTemplatePicker());
    });

    if (intro) {
      intro = false;
      const circle = view.querySelector('[data-ring-circle]');
      const ringVal = view.querySelector('[data-ring-val]');
      if (circle) {
        spring({
          from: 0,
          to: pct,
          response: 0.48,
          damping: 1,
          restDelta: 0.2,
          restSpeed: 3,
          onUpdate: (value) => {
            const safe = Math.max(0, Math.min(100, value));
            circle.setAttribute('stroke-dashoffset', (RING_CIRC * (1 - safe / 100)).toFixed(2));
            if (ringVal) ringVal.textContent = `${Math.round(safe)}%`;
          },
        });
      }
      view.querySelectorAll('[data-count]').forEach((node) => {
        countUp(node, Number(node.dataset.count) || 0);
      });
    }
  };

  draw();
  return { refresh: draw };
}
