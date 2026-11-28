import { renderHome } from './views/home.js';
import { renderItems } from './views/items.js';
import { renderScan } from './views/scan.js';
import { renderSettings } from './views/settings.js';
import { renderSafe } from './views/safe.js';
import { getState, subscribe } from './core/store.js';
import { haptic } from './core/haptics.js';
import { openItemEditor } from './components/itemCard.js';
import { esc } from './core/ui.js';
import { icon } from './core/icons.js';

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
    subtitle: '盤點、分類與有效期限',
    action: 'add',
  },
  {
    path: 'scan',
    render: renderScan,
    tab: 'scan',
    title: '掃描入包',
    subtitle: '條碼掃描、拍照辨識或手動新增',
    action: null,
  },
  {
    path: 'safe',
    render: renderSafe,
    tab: 'safe',
    title: '平安',
    subtitle: '集合點、緊急專線與報平安',
    action: null,
  },
  {
    path: 'settings',
    render: renderSettings,
    tab: 'settings',
    title: '設定',
    subtitle: '主題、家庭人數與離線備份',
    action: null,
  },
];

const nav = document.getElementById('nav');
const navTitle = document.getElementById('navTitle');
const navActions = document.getElementById('navActions');
const tabbar = document.querySelector('.tabbar');
const sideNav = document.querySelector('.side-nav');
const viewEl = document.getElementById('view');
const offlineBanner = document.getElementById('offlineBanner');
const sideNetDot = document.getElementById('sideNetDot');
const sideNetText = document.getElementById('sideNetText');
const metaThemeColor = document.getElementById('metaThemeColor');

let current = null;
let token = 0;
let headObserver = null;
let swRegistration = null;

/* ------------------------------------------------------------------ 主題 */

const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

export function applyTheme(theme = getState().settings.theme) {
  const mode = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  if (mode === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }
  const isDark = mode === 'dark' || (mode === 'system' && Boolean(darkQuery?.matches));
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', isDark ? '#121110' : '#f6f4ef');
  }
}

darkQuery?.addEventListener?.('change', () => {
  if ((getState().settings.theme || 'system') === 'system') {
    applyTheme('system');
  }
});

/* -------------------------------------------------------------- 離線 / SW */

function syncNetworkState() {
  const online = navigator.onLine !== false;
  if (offlineBanner) offlineBanner.hidden = online;
  if (sideNetDot) sideNetDot.classList.toggle('is-offline', !online);
  if (sideNetText) sideNetText.textContent = online ? '連線正常（支援離線）' : '離線運作中';
}

window.addEventListener('online', syncNetworkState);
window.addEventListener('offline', syncNetworkState);

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch {
    /* 部分受限預覽環境可能停用 SW */
  }
}

export function getSwStatus() {
  if (!('serviceWorker' in navigator)) {
    return { supported: false, ready: false, label: '此瀏覽器不支援離線快取' };
  }
  if (!window.isSecureContext) {
    return { supported: false, ready: false, label: '需在 HTTPS 或 localhost 下才可啟用離線快取' };
  }
  if (swRegistration?.active || navigator.serviceWorker.controller) {
    return { supported: true, ready: true, label: '離線引擎已就緒（斷網仍可開啟）' };
  }
  if (swRegistration?.installing || swRegistration?.waiting) {
    return { supported: true, ready: false, label: '正在安裝離線快取…' };
  }
  return { supported: true, ready: false, label: '離線快取尚未啟用' };
}

export async function checkSwUpdate() {
  if (!swRegistration) return false;
  try {
    await swRegistration.update();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ 路由 */

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

function observePageHead(headEl) {
  headObserver?.disconnect();
  headObserver = null;
  if (!headEl || typeof IntersectionObserver === 'undefined') {
    nav.classList.remove('is-scrolled');
    return;
  }
  headObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;
      nav.classList.toggle('is-scrolled', !entry.isIntersecting);
    },
    { rootMargin: '-48px 0px 0px 0px', threshold: 0 }
  );
  headObserver.observe(headEl);
}

navActions?.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-nav-action]');
  if (!btn) return;
  haptic('light');
  if (btn.dataset.navAction === 'scan') navigate('#/scan');
  else if (btn.dataset.navAction === 'add') openItemEditor(null);
});

function handleNavClick(event) {
  const link = event.target.closest('[data-tab]');
  if (!link) return;
  haptic('select');
  if (link.classList.contains('is-active')) {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

tabbar?.addEventListener('click', handleNavClick);
sideNav?.addEventListener('click', handleNavClick);

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
  headObserver?.disconnect();
  headObserver = null;

  document.querySelectorAll('[data-tab]').forEach((item) => {
    const active = item.dataset.tab === route.tab;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  document.title = `${route.title}｜避難包帖`;

  viewEl.innerHTML = `
    <div class="page-head" id="pageHead">
      <div class="page-head-main">
        <h1 class="large-title" id="pageTitle">${esc(route.title)}</h1>
        <p class="page-sub" id="pageSub">${esc(route.subtitle || '')}</p>
      </div>
      <div class="page-stamp" id="pageStamp" hidden></div>
    </div>
    <div class="page-body" id="pageBody"></div>
  `;

  const pageHead = viewEl.querySelector('#pageHead');
  const pageSub = viewEl.querySelector('#pageSub');
  const pageStamp = viewEl.querySelector('#pageStamp');
  const bodyEl = viewEl.querySelector('#pageBody');

  navTitle.textContent = route.title;
  navActions.innerHTML = route.action
    ? `<button type="button" class="nav-btn" data-nav-action="${route.action}" aria-label="${
        route.action === 'scan' ? '掃描加入' : '新增物品'
      }">${icon(route.action === 'scan' ? 'scan' : 'plus')}</button>`
    : '';

  window.scrollTo(0, 0);
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
  observePageHead(pageHead);

  viewEl.classList.remove('is-entering');
  void viewEl.offsetWidth;
  viewEl.classList.add('is-entering');
}

window.addEventListener('hashchange', renderRoute);

subscribe((state, detail) => {
  if (detail?.type === 'settings' || detail?.type === 'import') {
    applyTheme(state.settings.theme);
  }
  try {
    current?.refresh?.(state, detail);
  } catch (err) {
    console.error('[router] refresh failed', err);
  }
});

applyTheme();
syncNetworkState();
registerServiceWorker();
renderRoute();

window.addEventListener('pageshow', (event) => {
  if (event.persisted) renderRoute();
});
