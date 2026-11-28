import {
  STORAGE_KEY,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  ESSENTIAL_IDS,
  MAX_MEETING_POINTS,
  getCategoryMeta,
  newItem,
  newMeetingPoint,
  defaultState,
} from '../data/presets.js';
import { statusOf, todayISO } from './dates.js';

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
  item.qty = Number.isFinite(Number(item.qty)) && Number(item.qty) > 0 ? Math.min(9999, Math.round(Number(item.qty))) : 1;
  item.expiry = /^\d{4}-\d{2}-\d{2}$/.test(item.expiry || '') ? item.expiry : null;
  item.category = String(item.category || 'other');
  item.unit = String(item.unit || '個').trim() || '個';
  item.location = String(item.location || '').trim();
  item.note = String(item.note || '').trim();
  item.barcode = String(item.barcode || '').trim();
  delete item.scalable;
  return item;
}

function normalizeCategory(raw) {
  if (!raw || typeof raw.name !== 'string') return null;
  const name = raw.name.trim().slice(0, 12);
  if (!name) return null;
  const id = String(raw.id || name).trim() || name;
  const meta = getCategoryMeta(id);
  return {
    id,
    name,
    icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : meta.icon,
    tone: typeof raw.tone === 'string' && raw.tone ? raw.tone : meta.tone,
  };
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
    latRaw !== '' &&
    lngRaw !== null &&
    lngRaw !== undefined &&
    lngRaw !== '' &&
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

export function canonicalContact(value) {
  let digits = String(value ?? '').replace(/[^\d+]/g, '');
  /* +886 912 345 678 → 0912 345 678，避免同一支手機重複出現 */
  const twMobile = /^\+?886(9\d{8})$/.exec(digits);
  if (twMobile) digits = `0${twMobile[1]}`;
  return digits;
}

function normalizeContacts(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const byPhone = new Map();

  for (const entry of list) {
    const rawPhone = typeof entry === 'string' ? entry : entry?.phone ?? entry?.tel ?? '';
    const rawName = typeof entry === 'object' && entry ? entry.name ?? entry.label ?? '' : '';
    const phone = canonicalContact(rawPhone);
    if (phone.replace(/\D/g, '').length < 4) continue;
    const name = String(rawName || '').trim().slice(0, 24);

    if (byPhone.has(phone)) {
      const existing = byPhone.get(phone);
      if (!existing.name && name) existing.name = name;
      continue;
    }
    const contact = { name, phone };
    byPhone.set(phone, contact);
    out.push(contact);
  }
  return out.slice(0, 10);
}

function normalizeSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  const warnSoon = Math.min(90, Math.max(0, Math.round(Number(merged.warnSoon ?? 7) || 0)));
  const warnWatchRaw = Math.min(365, Math.max(1, Math.round(Number(merged.warnWatch ?? 30) || 30)));
  const warnWatch = Math.max(warnSoon, warnWatchRaw);
  const theme = ['system', 'light', 'dark'].includes(merged.theme) ? merged.theme : 'system';
  const householdSize = Math.min(12, Math.max(1, Math.round(Number(merged.householdSize) || 1)));

  return {
    ...merged,
    warnSoon,
    warnWatch,
    autoLookup: merged.autoLookup !== false,
    autoCount: merged.autoCount !== false,
    haptics: merged.haptics !== false,
    theme,
    householdSize,
    safeContacts: normalizeContacts(merged.safeContacts),
  };
}

function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const categories =
    Array.isArray(raw.categories) && raw.categories.length
      ? raw.categories.map(normalizeCategory).filter(Boolean)
      : DEFAULT_CATEGORIES.map((c) => ({ ...c }));

  const items = Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter((i) => i.name) : [];
  const meetingPoints = Array.isArray(raw.meetingPoints)
    ? raw.meetingPoints.map(normalizeMeetingPoint).filter(Boolean).slice(0, MAX_MEETING_POINTS)
    : [];

  return {
    version: 1,
    items,
    categories: categories.length ? categories : DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: normalizeSettings(raw.settings),
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
  const now = new Date().toISOString();
  const created = list.map((partial) => {
    const item = normalizeItem({ ...partial, id: undefined });
    item.createdAt = item.createdAt || now;
    item.updatedAt = now;
    return item;
  });
  state.items = [...created, ...state.items];
  commit({ type: 'add-many', count: created.length });
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
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const removed = state.items[idx];
  state.items = state.items.filter((i) => i.id !== id);
  commit({ type: 'delete', id });
  return { item: removed, index: idx };
}

export function restoreItem(snapshot, index = 0) {
  if (!snapshot || !snapshot.name) return null;
  const existing = state.items.some((i) => i.id === snapshot.id);
  const item = normalizeItem(existing ? { ...snapshot, id: undefined } : snapshot);
  const pos = Math.max(0, Math.min(state.items.length, Number(index) || 0));
  const next = state.items.slice();
  next.splice(pos, 0, item);
  state.items = next;
  commit({ type: 'restore', id: item.id });
  return item;
}

export function getKnownLocations() {
  const seen = new Set();
  for (const item of state.items) {
    const loc = String(item.location || '').trim();
    if (loc) seen.add(loc);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

export function updateSettings(patch) {
  state.settings = normalizeSettings({ ...state.settings, ...patch });
  commit({ type: 'settings', keys: Object.keys(patch || {}) });
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

/* 分類 */
export function addCategory(name, { icon, tone } = {}) {
  const clean = String(name || '').trim().slice(0, 12);
  if (!clean) return null;
  const exists = state.categories.find((c) => c.name === clean);
  if (exists) return exists;
  const cat = normalizeCategory({
    id: `cat_${Date.now().toString(36)}`,
    name: clean,
    icon: icon || 'package',
    tone: tone || 'stone',
  });
  state.categories = [...state.categories, cat];
  commit({ type: 'category-add', id: cat.id });
  return cat;
}

export function updateCategory(id, { name, icon, tone } = {}) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return null;
  const nextName = name !== undefined ? String(name || '').trim().slice(0, 12) : cat.name;
  if (!nextName) return null;
  cat.name = nextName;
  if (icon) cat.icon = icon;
  if (tone) cat.tone = tone;
  commit({ type: 'category-update', id });
  return cat;
}

export function renameCategory(id, name) {
  return updateCategory(id, { name });
}

export function deleteCategory(id) {
  if (state.categories.length <= 1) return;
  state.categories = state.categories.filter((c) => c.id !== id);
  const fallback = state.categories[0].id;
  state.items = state.items.map((i) => (i.category === id ? { ...i, category: fallback } : i));
  commit({ type: 'category-delete', id });
}

export function getCategory(id) {
  return state.categories.find((c) => c.id === id) || null;
}

export function categoryName(id) {
  return getCategory(id)?.name || '其他';
}

/* 商品條碼快取（我的商品庫） */
export function rememberProduct(barcode, data) {
  if (!barcode) return;
  state.products[barcode] = {
    name: data.name || '',
    category: data.category || 'other',
    unit: data.unit || '',
    source: data.source || 'manual',
    savedAt: new Date().toISOString(),
  };
  commit({ type: 'product-remember', barcode });
}

export function getProduct(barcode) {
  return state.products[barcode] || null;
}

/**
 * 找出可以「自動計入」的既有物品：
 * 同一個條碼、沒有過期（沒有期限視為可用），優先選最早到期的。
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

/** 調整既有物品的數量（自動計入 +1、清單步進、復原 -1），最低保留 1。 */
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
  commit({ type: 'update', id, reason: 'qty' });
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

function pointKey(p) {
  return `${p.name}|${p.lat ?? ''}|${p.lng ?? ''}`;
}

export function importData(payload, { mode = 'replace' } = {}) {
  const raw = payload?.data && payload?.app ? payload.data : payload;
  if (!raw || (!Array.isArray(raw.items) && !Array.isArray(raw.meetingPoints))) {
    throw new Error('檔案格式不正確：找不到避難包物品或集合點資料');
  }
  const incoming = normalizeState(raw);

  if (mode === 'merge') {
    const existing = new Set(state.items.map((i) => i.id));
    const mergedItems = [...state.items, ...incoming.items.filter((i) => !existing.has(i.id))];

    const catIds = new Set(state.categories.map((c) => c.id));
    const cats = [...state.categories, ...incoming.categories.filter((c) => !catIds.has(c.id))];

    const existingPoints = new Set(state.meetingPoints.map(pointKey));
    const mergedPoints = [
      ...state.meetingPoints,
      ...incoming.meetingPoints.filter((p) => !existingPoints.has(pointKey(p))),
    ].slice(0, MAX_MEETING_POINTS);

    const mergedContacts = normalizeContacts([
      ...(state.settings.safeContacts || []),
      ...(incoming.settings.safeContacts || []),
    ]);

    state = {
      ...state,
      items: mergedItems,
      categories: cats,
      meetingPoints: mergedPoints,
      products: { ...incoming.products, ...state.products },
      settings: normalizeSettings({
        ...state.settings,
        ...incoming.settings,
        safeContacts: mergedContacts,
      }),
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
  const out = {
    total: 0,
    expired: 0,
    soon: 0,
    watch: 0,
    ok: 0,
    none: 0,
    qty: 0,
    waterQty: 0,
    foodQty: 0,
  };
  const byCategory = {};

  for (const item of state.items) {
    const st = statusOf(item.expiry, { warnSoon, warnWatch });
    out.total += 1;
    out.qty += item.qty;
    if (item.category === 'water') out.waterQty += item.qty;
    if (item.category === 'food') out.foodQty += item.qty;
    out[st.key] = (out[st.key] || 0) + 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  }

  const essential = ESSENTIAL_IDS.map((id) => {
    const cat = getCategory(id);
    return {
      id,
      name: cat?.name || categoryName(id),
      icon: cat?.icon || getCategoryMeta(id).icon,
      tone: cat?.tone || getCategoryMeta(id).tone,
      ok: (byCategory[id] || 0) > 0,
      count: byCategory[id] || 0,
    };
  });

  out.essential = essential;
  out.essentialOk = essential.filter((e) => e.ok).length;
  out.byCategory = byCategory;
  out.needsAttention = out.expired + out.soon;

  const essentialRatio = out.essentialOk / Math.max(1, essential.length);
  const freshRatio = out.total ? (out.total - out.expired) / out.total : 0;
  out.readinessScore = out.total ? Math.round((essentialRatio * 0.7 + freshRatio * 0.3) * 100) : 0;
  return out;
}

/** 需要注意的物品（已過期 + 快到期），依急迫度排序 */
export function attentionItems(limit = 6) {
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
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });
  } else if (sort === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  } else {
    list.sort((a, b) => {
      const cmp = String(b.createdAt).localeCompare(String(a.createdAt));
      if (cmp !== 0) return cmp;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });
  }

  return list;
}
