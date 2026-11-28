import { getState, stats, attentionItems } from '../core/store.js';
import { fmtDate, todayISO, weekdayZh } from '../core/dates.js';
import { esc, bindSpotlightCards } from '../core/ui.js';
import { bindItemCards, itemRowHTML, openTemplatePicker } from '../components/itemCard.js';
import { backpackKitSVG, backpackCalloutsHTML, waterBottleSVG } from '../components/illustrations.js';
import { spring, countUp } from '../core/spring.js';
import { icon } from '../core/icons.js';

const DIAL_R = 35;
const DIAL_CIRC = 2 * Math.PI * DIAL_R;

const DIAL_TICKS_SVG = Array.from({ length: 36 }, (_, i) => {
  const angle = (i * 10 * Math.PI) / 180;
  const r1 = i % 3 === 0 ? 42.5 : 44.2;
  const r2 = 46.8;
  const x1 = (50 + r1 * Math.cos(angle)).toFixed(2);
  const y1 = (50 + r1 * Math.sin(angle)).toFixed(2);
  const x2 = (50 + r2 * Math.cos(angle)).toFixed(2);
  const y2 = (50 + r2 * Math.sin(angle)).toFixed(2);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
}).join('');

function dotPos(pct) {
  const rad = (((Math.max(0, Math.min(100, pct)) / 100) * 360 - 90) * Math.PI) / 180;
  return {
    cx: (50 + DIAL_R * Math.cos(rad)).toFixed(2),
    cy: (50 + DIAL_R * Math.sin(rad)).toFixed(2),
  };
}

function moodOf(s) {
  if (!s.total) return 'empty';
  if (s.expired > 0) return 'danger';
  if (s.soon > 0) return 'warn';
  return 'ok';
}

function packHeroHTML(s, animateZero) {
  const pct = s.readinessScore;
  const initialPct = animateZero ? 0 : pct;
  const dashOffset = DIAL_CIRC * (1 - initialPct / 100);
  const tip = dotPos(initialPct);
  const mood = moodOf(s);

  let statusBadge;
  let title;
  let sub;

  if (!s.total) {
    statusBadge = '<span class="status-badge status-badge--empty">尚未建置</span>';
    title = '避難包還是空的';
    sub = '從飲水、食料與急救包開始，補齊 72 小時黃金裝備。';
  } else if (s.needsAttention) {
    statusBadge = `<span class="status-badge status-badge--warn"><span class="pulse-dot"></span> 需處理 ${s.needsAttention} 項</span>`;
    title = `${s.needsAttention} 項物資需要更換或檢查`;
    sub = `已過期 ${s.expired} 項・快到期 ${s.soon} 項`;
  } else {
    statusBadge = '<span class="status-badge status-badge--ok">狀況良好</span>';
    title = '所有設定期限物資皆在效期內';
    sub = `已涵蓋 ${s.essentialOk} / ${s.essential.length} 項核心防災分類`;
  }

  const chips = s.total
    ? `
    <div class="console-metrics">
      <span class="console-chip"><strong>${s.total}</strong> 項物品</span>
      <span class="console-chip"><strong>${s.qty}</strong> 件物資</span>
      <span class="console-chip"><strong>${s.essentialOk}/${s.essential.length}</strong> 核心分類</span>
    </div>`
    : '';

  return `
    <section class="pack-hero" data-mood="${mood}">
      <div class="pack-stage">
        <div class="pack-stage-badge">FIELD BAG // 裝備實況</div>
        ${backpackKitSVG(s.essential, s)}
        ${backpackCalloutsHTML(s.essential)}
      </div>

      <div class="pack-telemetry">
        <div class="console-kicker-row">
          <span class="kicker">72H READINESS</span>
          ${statusBadge}
        </div>

        <div class="pack-dial-row">
          <div class="console-ring-wrap" role="img" aria-label="綜合整備度 ${pct}%">
            <svg class="console-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
              <g class="dial-ticks">${DIAL_TICKS_SVG}</g>
              <circle class="dial-track" cx="50" cy="50" r="${DIAL_R}" />
              <circle class="dial-progress${pct >= 100 ? ' is-complete' : ''}" data-ring-circle cx="50" cy="50" r="${DIAL_R}"
                transform="rotate(-90 50 50)"
                stroke-dasharray="${DIAL_CIRC.toFixed(2)}" stroke-dashoffset="${dashOffset.toFixed(2)}" />
              <circle data-ring-dot cx="${tip.cx}" cy="${tip.cy}" r="3.4" fill="#ffffff" ${initialPct <= 1 ? 'opacity="0"' : ''} />
            </svg>
            <div class="ring-center">
              <span class="ring-val" data-ring-val>${initialPct}%</span>
              <span class="ring-sub">整備度</span>
            </div>
          </div>

          <div class="pack-headline">
            <p class="console-title">${esc(title)}</p>
            <p class="console-sub">${esc(sub)}</p>
          </div>
        </div>

        ${chips}

        <div class="pack-actions">
          <a class="btn btn--primary btn--sm" href="#/scan">${icon('scan')} 掃描入包</a>
          <button type="button" class="btn btn--console-ghost btn--sm" data-template>${icon('listChecks')} 建議清單</button>
        </div>
      </div>
    </section>`;
}

function hydrationCardHTML(s) {
  const { householdSize = 1 } = getState().settings;
  const targetLiters = householdSize * 9;
  const targetBottles = householdSize * 15;
  const waterPct = Math.min(100, Math.round((s.waterQty / Math.max(1, targetBottles)) * 100));
  const badgeText = waterPct >= 100 ? '已達標' : waterPct >= 50 ? '持續補強' : '需補水';

  return `
    <section class="hydration-card bento-tilt" aria-label="三日飲水儲備">
      <div class="hydration-visual">
        ${waterBottleSVG({ pct: waterPct, waterQty: s.waterQty })}
      </div>
      <div class="hydration-info">
        <div class="hydration-head">
          <span class="kicker">HYDRATION</span>
          <span class="hydration-pill${waterPct >= 100 ? ' is-ok' : ''}">${badgeText} ${waterPct}%</span>
        </div>
        <h2 class="hydration-title">三日飲水儲備</h2>
        <div class="hydration-figure">
          <strong class="num">${s.waterQty}</strong>
          <span>單位（基準 ${targetBottles} 瓶）</span>
        </div>
        <p class="hydration-sub">${householdSize} 人安全飲水基準：<strong>${targetLiters} 公升</strong></p>
        <div class="hydration-bar" aria-hidden="true">
          <div class="hydration-bar-fill" style="width:${waterPct}%"></div>
        </div>
        <a class="hydration-link" href="#/items?cat=water">查看飲水清單 ${icon('arrowRight')}</a>
      </div>
    </section>`;
}

function statsHTML(s) {
  const { warnSoon } = getState().settings;
  return `
    <section class="stat-bento" aria-label="到期狀態統計">
      <a class="stat stat--expired bento-tilt stagger-in${s.expired ? '' : ' is-zero'}" style="--i:1" href="#/items?st=expired">
        <span class="stat-watermark" aria-hidden="true">${icon('alert')}</span>
        <div class="stat-top">
          <span class="stat-label">已過期・優先處理</span>
          <span class="stat-ico" aria-hidden="true">${icon('alert')}</span>
        </div>
        <div class="stat-bottom">
          <span class="stat-num" data-count="${s.expired}">${s.expired}</span>
          <span class="stat-sub">需立即替換新品</span>
        </div>
      </a>
      <a class="stat stat--soon bento-tilt stagger-in${s.soon ? '' : ' is-zero'}" style="--i:2" href="#/items?st=soon">
        <span class="stat-watermark" aria-hidden="true">${icon('clock')}</span>
        <div class="stat-top">
          <span class="stat-label">快到期</span>
          <span class="stat-ico" aria-hidden="true">${icon('clock')}</span>
        </div>
        <span class="stat-num" data-count="${s.soon}">${s.soon}</span>
        <span class="stat-sub">${warnSoon} 天內到期</span>
      </a>
      <a class="stat stat--watch bento-tilt stagger-in${s.watch + s.none ? '' : ' is-zero'}" style="--i:3" href="#/items?st=watch">
        <span class="stat-watermark" aria-hidden="true">${icon('shield')}</span>
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
        <h2>核心防災分類圖鑑</h2>
        <span class="hint">${s.essentialOk} / ${s.essential.length} 已備妥</span>
      </div>
      <div class="essential-grid">
        ${s.essential
          .map((e, i) => {
            const barPct = e.ok ? Math.min(100, 35 + e.count * 22) : 0;
            const code = String(i + 1).padStart(2, '0');
            return `
            <a class="essential-card bento-tilt stagger-in${e.ok ? ' is-complete' : ''}" style="--i:${i}" href="#/items?cat=${esc(e.id)}">
              <div class="essential-card-header">
                <span class="cat-badge cat-badge--sm tone--${esc(e.tone)}" aria-hidden="true">${icon(e.icon)}</span>
                <div class="essential-badges">
                  <span class="essential-code">${code}</span>
                  <span class="essential-status-tag ${e.ok ? 'tag--ok' : 'tag--wait'}">${e.ok ? '已備妥' : '待補'}</span>
                </div>
              </div>
              <div>
                <span class="essential-name">${esc(e.name)}</span>
                <span class="essential-count">${e.count ? `${e.count} 項物資` : '尚未準備'}</span>
                ${
                  e.ok
                    ? `<div class="essential-mini-bar" aria-hidden="true"><div class="essential-mini-fill" style="width:${barPct}%"></div></div>`
                    : ''
                }
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

    document.body.dataset.mood = moodOf(s);
    ctx.setSubtitle(`${fmtDate(today)}・週${weekdayZh(today)}`);
    ctx.setStamp('72H KIT');

    view.innerHTML = `
      <div class="home-bento-top">
        ${packHeroHTML(s, intro)}
        ${hydrationCardHTML(s)}
      </div>

      <div class="home-bento-mid">
        ${statsHTML(s)}
        <section class="alerts-desk">
          <div class="section-head">
            <h2>即時提醒看板</h2>
            <span class="hint">${hasItems ? (rows.length ? '依急迫性排序' : '狀態正常') : '開始盤點'}</span>
          </div>
          <div class="group" id="home-alerts">${hasItems ? alertsHTML(rows) : emptyHTML()}</div>
        </section>
      </div>

      ${hasItems ? completenessHTML(s) : ''}
    `;

    bindItemCards(view.querySelector('#home-alerts'));
    bindSpotlightCards(view);

    view.querySelectorAll('[data-template]').forEach((btn) => {
      btn.addEventListener('click', () => openTemplatePicker());
    });

    if (intro) {
      intro = false;
      const circle = view.querySelector('[data-ring-circle]');
      const dot = view.querySelector('[data-ring-dot]');
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
            circle.setAttribute('stroke-dashoffset', (DIAL_CIRC * (1 - safe / 100)).toFixed(2));
            if (dot) {
              const p = dotPos(safe);
              dot.setAttribute('cx', p.cx);
              dot.setAttribute('cy', p.cy);
              dot.setAttribute('opacity', safe > 1 ? '1' : '0');
            }
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
