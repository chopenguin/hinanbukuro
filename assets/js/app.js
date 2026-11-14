import { renderHome } from './views/home.js';
import { renderItems } from './views/items.js';
import { renderScan } from './views/scan.js';
import { renderSettings } from './views/settings.js';
import { subscribe } from './core/store.js';
import { haptic } from './core/haptics.js';
import { openItemEditor } from './components/itemCard.js';
import { esc } from './core/ui.js';

const ICONS = {
  scan: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.2V5.8A1.8 1.8 0 0 1 5.8 4h2.4M15.8 4h2.4A1.8 1.8 0 0 1 20 5.8v2.4M20 15.8v2.4a1.8 1.8 0 0 1-1.8 1.8h-2.4M8.2 20H5.8A1.8 1.8 0 0 1 4 18.2v-2.4"/><path d="M7.2 12h9.6"/></svg>`,
  add: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>`,
};

const ROUTES = [
  {
    path: '',
    render: renderHome,
    tab: 'home',
    title: '總覽',
    subtitle: '今天的避難包狀態',
    action: 'scan',
  },
  {
    path: 'items',
    render: renderItems,
    tab: 'items',
    title: '避難包',
    subtitle: '掃描、分類與有效期限',
    action: 'add',
  },
  {
    path: 'scan',
    render: renderScan,
    tab: 'scan',
    title: '掃描加入',
    subtitle: '對準條碼，或直接手動輸入',
    action: null,
  },
  {
    path: 'settings',
    render: renderSettings,
    tab: 'settings',
    title: '設定',
    subtitle: '提醒門檻與資料備份',
    action: null,
  },
];

const nav = document.getElementById('nav');
const navTitle = document.getElementById('navTitle');
const navActions = document.getElementById('navActions');
const tabbar = document.querySelector('.tabbar');
const viewEl = document.getElementById('view');

let current = null;
let token = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return {
    path: (path || '').replace(/\/+$/, ''),
    params: new URLSearchParams(qs || ''),
  };
}

function navigate(to) {
  if (location.hash === to) {
    renderRoute();
    return;
  }
  location.hash = to;
}

/* 大標題捲動收合：導覽列淡入材質、副標題淡出 */
let scrollQueued = false;

function updateScrollState() {
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  nav.classList.toggle('is-scrolled', y > 6);
  const progress = Math.min(1, Math.max(0, (y - 2) / 44));
  viewEl.style.setProperty('--head', progress.toFixed(3));
}

window.addEventListener(
  'scroll',
  () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      updateScrollState();
    });
  },
  { passive: true }
);

/* 導覽列右側動作 */
navActions.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-nav-action]');
  if (!btn) return;
  haptic('light');
  if (btn.dataset.navAction === 'scan') navigate('#/scan');
  else if (btn.dataset.navAction === 'add') openItemEditor(null);
});

/* 分頁切換：點目前頁籤時回到頂端，像 iOS 一樣 */
tabbar?.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  haptic('select');
  if (tab.classList.contains('is-active')) {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

async function renderRoute() {
  const { path, params } = parseHash();
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  const myToken = ++token;

  if (current && typeof current.destroy === 'function') {
    try {
      current.destroy();
    } catch (err) {
      console.error('[router] destroy failed', err);
    }
  }
  current = null;

  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === route.tab;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });

  document.title = `${route.title}｜避難包帖`;

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="page-head-main">
        <h1 class="large-title" id="pageTitle">${esc(route.title)}</h1>
        <p class="page-sub" id="pageSub">${esc(route.subtitle || '')}</p>
      </div>
      <div class="page-stamp" id="pageStamp" hidden></div>
    </div>
    <div class="page-body" id="pageBody"></div>
  `;

  const pageSub = viewEl.querySelector('#pageSub');
  const pageStamp = viewEl.querySelector('#pageStamp');
  const bodyEl = viewEl.querySelector('#pageBody');

  navTitle.textContent = route.title;
  navActions.innerHTML = route.action
    ? `<button type="button" class="nav-btn" data-nav-action="${route.action}" aria-label="${
        route.action === 'scan' ? '掃描加入' : '新增物品'
      }">${ICONS[route.action]}</button>`
    : '';

  window.scrollTo(0, 0);
  viewEl.style.setProperty('--head', '0');
  nav.classList.remove('is-scrolled');

  const ctx = {
    params,
    navigate,
    setSubtitle(text) {
      if (pageSub) pageSub.textContent = text || '';
    },
    setStamp(char) {
      if (!pageStamp) return;
      if (char) {
        pageStamp.innerHTML = `<span class="stamp">${esc(char)}</span>`;
        pageStamp.hidden = false;
      } else {
        pageStamp.innerHTML = '';
        pageStamp.hidden = true;
      }
    },
  };

  const result = route.render(bodyEl, ctx);
  const view = result && typeof result.then === 'function' ? await result : result;
  if (myToken !== token) return;

  current = view || {};

  viewEl.classList.remove('is-entering');
  void viewEl.offsetWidth;
  viewEl.classList.add('is-entering');
}

window.addEventListener('hashchange', renderRoute);

subscribe(() => {
  try {
    current?.refresh?.();
  } catch (err) {
    console.error('[router] refresh failed', err);
  }
});

renderRoute();

/* 讓 Safari 的網址列在加入主畫面後也能正常回到首頁 */
window.addEventListener('pageshow', (event) => {
  if (event.persisted) renderRoute();
});
