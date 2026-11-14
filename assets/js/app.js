import { renderHome } from './views/home.js';
import { renderItems } from './views/items.js';
import { renderScan } from './views/scan.js';
import { renderSettings } from './views/settings.js';
import { subscribe } from './core/store.js';

const ROUTES = [
  { path: '', render: renderHome, tab: 'home', title: '總覽' },
  { path: 'items', render: renderItems, tab: 'items', title: '避難包' },
  { path: 'scan', render: renderScan, tab: 'scan', title: '掃描加入' },
  { path: 'settings', render: renderSettings, tab: 'settings', title: '設定' },
];

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
    tab.classList.toggle('is-active', tab.dataset.tab === route.tab);
    if (tab.dataset.tab === route.tab) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });

  document.title = `${route.title}｜避難包帖`;

  viewEl.className = 'view';
  viewEl.innerHTML = '';
  void viewEl.offsetWidth;
  viewEl.classList.add('view-enter');

  const result = route.render(viewEl, { params, navigate });
  const view = result && typeof result.then === 'function' ? await result : result;
  if (myToken !== token) return;

  current = view || {};
  window.scrollTo(0, 0);
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
