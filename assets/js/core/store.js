import {
  STORAGE_KEY,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  ESSENTIAL_IDS,
  MAX_MEETING_POINTS,
  newItem,
  newMeetingPoint,
  defaultState,
} from '../data/presets.js?v=3';
import { statusOf, todayISO } from './dates.js?v=3';

let storageOK = true;
let state = load();
const listeners = new Set();

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeItem(raw) {
  const base = newItem();
  const item = { ...base, ...raw };
  item.id = typeof raw?.id === 'string' && raw.id ? raw.id : base.id;
  item.name = String(item.name || '').trim();
  item.qty = Number.isFinite(Number(item.qty)) && Number(item.qty) > 0 ? Number(item.qty) : 1;
  item.expiry = /^\d{4}-\d{2}-\d{2}$/.test(item.expiry || '') ? item.expiry : null;
  item.category = String(item.category || 'other');
  item.unit = String(item.unit || '個');
  item.location = String(item.location || '');
  item.note = String(item.note || '');
  item.barcode = String(item.barcode || '');
  return item;
}

function normalizeMeetingPoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name ?? raw.n ?? '').trim().slice(0, 40);
  if (!name) return null;

  const latRaw = raw.lat ?? raw.y;
  const lngRaw = raw.lng ?? raw.x;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  const hasCoords =
    latRaw !== null &&
    latRaw !== undefined &&
    lngRaw !== null &&
    lngRaw !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  const base = newMeetingPoint();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : base.id,
    name,
    address: String(raw.address ?? raw.a ?? '').trim().slice(0, 90),
    lat: hasCoords ? Math.round(lat * 1e5) / 1e5 : null,
    lng: hasCoords ? Math.round(lng * 1e5) / 1e5 : null,
    note: String(raw.note ?? raw.m ?? '').trim().slice(0, 140),
  };
}

function canonicalContact(value) {
  let digits = String(value ?? '').replace(/[^\d+]/g, '');
  /* +886 912 345 678 → 0912 345 678，避免同一支手機重複出現 */
  const twMobile = /^\+?886(9\d{8})$/.exec(digits);
  if (twMobile) digits = `0${twMobile[1]}`;
  return digits;
}

function normalizeContacts(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const value of list) {
    const digits = canonicalContact(value);
    if (digits.replace(/\D/g, '').length < 4) continue;
    if (!out.includes(digits)) out.push(digits);
  }
  return out.slice(0, 10);
}

function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const categories = Array.isArray(raw.categories) && raw.categories.length
    ? raw.categories
        .filter((c) => c && typeof c.name === 'string' && c.name.trim())
        .map((c) => ({ id: String(c.id || c.name).trim() || c.name, name: c.name.trim() }))
    : DEFAULT_CATEGORIES.map((c) => ({ ...c }));

  const items = Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter((i) => i.name) : [];
  const meetingPoints = Array.isArray(raw.meetingPoints)
    ? raw.meetingPoints.map(normalizeMeetingPoint).filter(Boolean).slice(0, MAX_MEETING_POINTS)
    : [];

  const settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  settings.safeContacts = normalizeContacts(settings.safeContacts);

  return {
    version: 1,
    items,
    categories,
    settings,
    products: raw.products && typeof raw.products === 'object' ? raw.products : {},
    meetingPoints,
    meta: { ...base.meta, ...(raw.meta || {}) },
  };
}

function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = safeParse(raw);
    if (!parsed) return defaultState();
    return normalizeState(parsed);
  } catch {
    storageOK = false;
    return defaultState();
  }
}

function persist() {
  if (!storageOK) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    storageOK = false;
    notify({ type: 'storage-error', error: err });
  }
}

function notify(detail) {
  listeners.forEach((fn) => {
    try {
      fn(state, detail);
    } catch (err) {
      console.error('[store] listener failed', err);
    }
  });
}

function commit(detail) {
  persist();
  notify(detail);
}

/* ------------------------------------------------------------------ API */

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isStorageOK() {
  return storageOK;
}

export function getItem(id) {
  return state.items.find((i) => i.id === id) || null;
}

export function addItem(partial) {
  const item = normalizeItem({ ...partial, id: undefined });
  item.createdAt = new Date().toISOString();
  item.updatedAt = item.createdAt;
  state.items.unshift(item);
  commit({ type: 'add', id: item.id });
  return item;
}

export function addItems(list) {
  const created = list.map((partial) => {
    const item = normalizeItem({ ...partial, id: undefined });
    item.createdAt = item.createdAt || new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    return item;
  });
  state.items = [...created, ...state.items];
  commit({ type: 'add-many' });
  return created;
}

export function updateItem(id, patch) {
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const next = normalizeItem({ ...state.items[idx], ...patch, id });
  next.updatedAt = new Date().toISOString();
  state.items[idx] = next;
  commit({ type: 'update', id });
  return next;
}

export function deleteItem(id) {
  const before = state.items.length;
  state.items = state.items.filter((i) => i.id !== id);
  if (state.items.length !== before) commit({ type: 'delete', id });
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  if ('safeContacts' in patch) {
    state.settings.safeContacts = normalizeContacts(state.settings.safeContacts);
  }
  commit({ type: 'settings' });
}

/* 集合點（家庭避難約定地點） */
export function getMeetingPoints() {
  return state.meetingPoints;
}

export function saveMeetingPoint(partial) {
  const point = normalizeMeetingPoint(partial);
  if (!point) return null;

  const idx = state.meetingPoints.findIndex((p) => p.id === point.id);
  if (idx >= 0) {
    state.meetingPoints[idx] = point;
    commit({ type: 'meeting-point-update', id: point.id });
    return point;
  }

  if (state.meetingPoints.length >= MAX_MEETING_POINTS) return null;
  state.meetingPoints = [...state.meetingPoints, point];
  commit({ type: 'meeting-point-add', id: point.id });
  return point;
}

export function deleteMeetingPoint(id) {
  const before = state.meetingPoints.length;
  state.meetingPoints = state.meetingPoints.filter((p) => p.id !== id);
  if (state.meetingPoints.length !== before) {
    commit({ type: 'meeting-point-delete', id });
  }
}

/** 覆蓋整組集合點（從家人分享的連結匯入） */
export function replaceMeetingPoints(list) {
  const next = (Array.isArray(list) ? list : [])
    .map(normalizeMeetingPoint)
    .filter(Boolean)
    .slice(0, MAX_MEETING_POINTS);
  state.meetingPoints = next;
  commit({ type: 'meeting-point-import' });
  return next;
}

export function setSafeContacts(list) {
  updateSettings({ safeContacts: normalizeContacts(list) });
  return state.settings.safeContacts;
}

export function addCategory(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const exists = state.categories.find((c) => c.name === clean);
  if (exists) return exists;
  const cat = { id: `cat_${Date.now().toString(36)}`, name: clean };
  state.categories = [...state.categories, cat];
  commit({ type: 'category-add' });
  return cat;
}

export function renameCategory(id, name) {
  const clean = String(name || '').trim();
  const cat = state.categories.find((c) => c.id === id);
  if (!cat || !clean) return;
  cat.name = clean;
  commit({ type: 'category-rename' });
}

export function deleteCategory(id) {
  if (state.categories.length <= 1) return;
  state.categories = state.categories.filter((c) => c.id !== id);
  const fallback = state.categories[0].id;
  state.items = state.items.map((i) => (i.category === id ? { ...i, category: fallback } : i));
  commit({ type: 'category-delete' });
}

export function categoryName(id) {
  return state.categories.find((c) => c.id === id)?.name || '其他';
}

/* 商品條碼快取（我的商品庫） */
export function rememberProduct(barcode, data) {
  if (!barcode) return;
  state.products[barcode] = {
    name: data.name || '',
    category: data.category || 'other',
    source: data.source || 'manual',
    savedAt: new Date().toISOString(),
  };
  commit({ type: 'product-remember' });
}

export function getProduct(barcode) {
  return state.products[barcode] || null;
}

/**
 * 找出可以「自動計入」的既有物品：
 * 同一個條碼、沒有過期（沒有期限視為可用），優先選最早到期的，
 * 這樣新掃的那一件會補在舊庫存後面，而不是堆到期限較晚的那批。
 */
export function findStockItem(barcode) {
  const code = String(barcode || '');
  if (!code) return null;
  const today = todayISO();
  const candidates = state.items.filter(
    (item) => item.barcode === code && (!item.expiry || item.expiry >= today)
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const ea = a.expiry || '9999-12-31';
    const eb = b.expiry || '9999-12-31';
    return ea.localeCompare(eb);
  });
  return candidates[0];
}

/** 調整既有物品的數量（自動計入 +1、復原 -1），最低保留 1。 */
export function incrementItemQty(id, delta = 1) {
  const idx = state.items.findIndex((item) => item.id === id);
  if (idx < 0) return null;
  const current = state.items[idx];
  const change = Math.round(Number(delta) || 0);
  const qty = Math.max(1, Math.min(9999, current.qty + change));
  if (qty === current.qty) return current;
  const next = normalizeItem({ ...current, qty, id });
  next.updatedAt = new Date().toISOString();
  state.items[idx] = next;
  commit({ type: 'update', id, reason: 'auto-count' });
  return next;
}

export function countProducts() {
  return Object.keys(state.products).length;
}

export function clearProducts() {
  state.products = {};
  commit({ type: 'product-clear' });
}

/* 建議清單 */
export function loadTemplate(items) {
  const created = addItems(items);
  state.settings = { ...state.settings, lastTemplateAt: new Date().toISOString() };
  commit({ type: 'template' });
  return created;
}

/* 備份 / 還原 */
export function exportData() {
  return {
    app: '避難包帖',
    schema: 1,
    exportedAt: new Date().toISOString(),
    ...JSON.parse(JSON.stringify(state)),
  };
}

export function importData(payload, { mode = 'replace' } = {}) {
  const raw = payload?.data && payload?.app ? payload.data : payload;
  if (!raw || !Array.isArray(raw.items)) {
    throw new Error('檔案格式不正確：找不到物品清單');
  }
  const incoming = normalizeState(raw);

  if (mode === 'merge') {
    const existing = new Set(state.items.map((i) => i.id));
    const merged = [...state.items, ...incoming.items.filter((i) => !existing.has(i.id))];
    const catIds = new Set(state.categories.map((c) => c.id));
    const cats = [...state.categories, ...incoming.categories.filter((c) => !catIds.has(c.id))];
    state = {
      ...state,
      items: merged,
      categories: cats,
      products: { ...incoming.products, ...state.products },
      settings: { ...state.settings, ...incoming.settings },
    };
  } else {
    state = incoming;
  }

  persist();
  notify({ type: 'import', mode });
  return state.items.length;
}

export function clearAll({ keepSettings = true } = {}) {
  const settings = state.settings;
  const categories = state.categories;
  const products = state.products;
  state = defaultState();
  if (keepSettings) {
    state.settings = settings;
    state.categories = categories;
    state.products = products;
  }
  commit({ type: 'clear' });
}

/* 統計 */
export function stats() {
  const { warnSoon, warnWatch } = state.settings;
  const out = { total: 0, expired: 0, soon: 0, watch: 0, ok: 0, none: 0, qty: 0 };
  const byCategory = {};

  for (const item of state.items) {
    const st = statusOf(item.expiry, { warnSoon, warnWatch });
    out.total += 1;
    out.qty += item.qty;
    out[st.key] = (out[st.key] || 0) + 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  }

  const essential = ESSENTIAL_IDS.map((id) => ({
    id,
    name: categoryName(id),
    ok: (byCategory[id] || 0) > 0,
    count: byCategory[id] || 0,
  }));

  out.essential = essential;
  out.essentialOk = essential.filter((e) => e.ok).length;
  out.byCategory = byCategory;
  out.needsAttention = out.expired + out.soon;
  return out;
}

/** 需要注意的物品（已過期 + 快到期），依急迫度排序 */
export function attentionItems(limit = 4) {
  const { warnSoon, warnWatch } = state.settings;
  return state.items
    .map((item) => ({ item, st: statusOf(item.expiry, { warnSoon, warnWatch }) }))
    .filter(({ st }) => st.key === 'expired' || st.key === 'soon')
    .sort((a, b) => (a.st.days ?? 0) - (b.st.days ?? 0))
    .slice(0, limit);
}

export function sortedItems({ category = 'all', query = '', sort = 'expiry' } = {}) {
  const q = query.trim().toLowerCase();
  let list = state.items.slice();

  if (category !== 'all') list = list.filter((i) => i.category === category);
  if (q) {
    list = list.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.location.toLowerCase().includes(q) ||
        i.barcode.includes(q) ||
        i.note.toLowerCase().includes(q)
    );
  }

  const far = Number.MAX_SAFE_INTEGER;
  if (sort === 'expiry') {
    list.sort((a, b) => {
      const da = a.expiry ? Date.parse(a.expiry) : far;
      const db = b.expiry ? Date.parse(b.expiry) : far;
      return da - db;
    });
  } else if (sort === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  } else {
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  return list;
}
