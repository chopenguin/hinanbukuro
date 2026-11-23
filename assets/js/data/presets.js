import { todayISO } from '../core/dates.js';

export const CATEGORY_ICONS = {
  water: { icon: '💧', color: '#0284c7', bg: 'rgba(2, 132, 199, 0.12)' },
  food: { icon: '🥫', color: '#ea580c', bg: 'rgba(234, 88, 12, 0.12)' },
  firstaid: { icon: '🩹', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.12)' },
  light: { icon: '🔦', color: '#d97706', bg: 'rgba(217, 119, 6, 0.14)' },
  hygiene: { icon: '🧼', color: '#059669', bg: 'rgba(5, 150, 105, 0.12)' },
  docs: { icon: '📄', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.12)' },
  tools: { icon: '🔧', color: '#475569', bg: 'rgba(71, 85, 105, 0.12)' },
  other: { icon: '🎒', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.12)' },
};

export function getCategoryMeta(id) {
  return CATEGORY_ICONS[id] || { icon: '📦', color: '#64748b', bg: 'rgba(100, 116, 139, 0.12)' };
}

/** 建議的防災分類（可在設定中增刪） */
export const DEFAULT_CATEGORIES = [
  { id: 'water', name: '飲水' },
  { id: 'food', name: '食料' },
  { id: 'firstaid', name: '急救' },
  { id: 'light', name: '照明' },
  { id: 'hygiene', name: '衛生' },
  { id: 'docs', name: '文件' },
  { id: 'tools', name: '工具' },
  { id: 'other', name: '其他' },
];

export const EXPIRY_KINDS = ['賞味期限', '使用期限', '電池期限', '定期檢查', '其他'];

/** 避難包完整度檢查的核心分類 */
export const ESSENTIAL_IDS = ['water', 'food', 'firstaid', 'light', 'hygiene', 'docs', 'tools'];

export const DEFAULT_SETTINGS = {
  warnSoon: 7,
  warnWatch: 30,
  autoLookup: true,
  autoCount: true,
  haptics: true,
  lastTemplateAt: null,
};

export const STORAGE_KEY = 'hinanbukuro.v1';

export function uid(prefix = 'itm') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function newItem(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: '',
    barcode: '',
    category: 'other',
    qty: 1,
    unit: '個',
    location: '',
    expiry: null,
    expiryKind: '賞味期限',
    note: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function defaultState() {
  return {
    version: 1,
    items: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: { ...DEFAULT_SETTINGS },
    products: {},
    meta: { createdAt: new Date().toISOString() },
  };
}

/** 內建建議清單：以「三日份、一人份」為基礎的常見防災用品 */
export function templateItems() {
  const today = todayISO();
  const rows = [
    ['飲用水（600ml）', 'water', 6, '瓶', '至少 3 日份，每人約 9 公升'],
    ['行動糧／能量棒', 'food', 6, '條', '免加熱、好保存'],
    ['罐頭或調理包', 'food', 3, '份', '附開罐器更安心'],
    ['急救包', 'firstaid', 1, '組', '繃帶、優碘、紗布'],
    ['個人常用藥', 'firstaid', 1, '份', '依醫囑準備'],
    ['手電筒', 'light', 1, '支', '放床邊與玄關'],
    ['備用電池', 'light', 4, '顆', '與手電筒同規格'],
    ['行動電源', 'light', 1, '顆', '每半年充放一次'],
    ['哨子', 'tools', 1, '個', '呼救用，比喊叫省力'],
    ['口罩', 'hygiene', 5, '片', ''],
    ['濕紙巾', 'hygiene', 1, '包', ''],
    ['衛生紙', 'hygiene', 2, '捲', ''],
    ['雨衣', 'tools', 2, '件', '輕便型即可'],
    ['暖暖包', 'tools', 2, '個', '冬季必備'],
    ['現金（小鈔）', 'docs', 1, '份', '停電時電子支付不可用'],
    ['證件影本', 'docs', 1, '份', '身分證、健保卡、保單'],
    ['多功能刀具', 'tools', 1, '把', ''],
    ['繩索（10m）', 'tools', 1, '條', ''],
  ];

  return rows.map(([name, category, qty, unit, note]) =>
    newItem({
      name,
      category,
      qty,
      unit,
      note,
      expiryKind: category === 'food' || category === 'water' ? '賞味期限' : '使用期限',
      createdAt: today,
    })
  );
}
