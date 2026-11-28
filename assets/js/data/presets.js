export const CATEGORY_META = {
  water: { icon: 'water', tone: 'info' },
  food: { icon: 'food', tone: 'accent' },
  firstaid: { icon: 'firstaid', tone: 'danger' },
  light: { icon: 'light', tone: 'warn' },
  hygiene: { icon: 'hygiene', tone: 'safe' },
  docs: { icon: 'docs', tone: 'violet' },
  tools: { icon: 'tools', tone: 'slate' },
  other: { icon: 'other', tone: 'stone' },
};

export const CATEGORY_TONES = [
  { id: 'info', label: '水藍' },
  { id: 'accent', label: '朱紅' },
  { id: 'danger', label: '警紅' },
  { id: 'warn', label: '琥珀' },
  { id: 'safe', label: '松綠' },
  { id: 'violet', label: '靛紫' },
  { id: 'slate', label: '鐵灰' },
  { id: 'stone', label: '暖灰' },
];

export function getCategoryMeta(catOrId) {
  if (catOrId && typeof catOrId === 'object') {
    const base = CATEGORY_META[catOrId.id] || { icon: 'package', tone: 'stone' };
    return {
      icon: catOrId.icon || base.icon,
      tone: catOrId.tone || base.tone,
    };
  }
  return CATEGORY_META[catOrId] || { icon: 'package', tone: 'stone' };
}

/** 建議的防災分類（可在設定中增刪改） */
export const DEFAULT_CATEGORIES = [
  { id: 'water', name: '飲水', icon: 'water', tone: 'info' },
  { id: 'food', name: '食料', icon: 'food', tone: 'accent' },
  { id: 'firstaid', name: '急救', icon: 'firstaid', tone: 'danger' },
  { id: 'light', name: '照明', icon: 'light', tone: 'warn' },
  { id: 'hygiene', name: '衛生', icon: 'hygiene', tone: 'safe' },
  { id: 'docs', name: '文件', icon: 'docs', tone: 'violet' },
  { id: 'tools', name: '工具', icon: 'tools', tone: 'slate' },
  { id: 'other', name: '其他', icon: 'other', tone: 'stone' },
];

export const EXPIRY_KINDS = ['賞味期限', '使用期限', '電池期限', '定期檢查', '其他'];

export const UNIT_SUGGESTIONS = ['瓶', '包', '罐', '盒', '個', '組', '份', '顆', '支', '片', '捲', '件', '條'];

/** 避難包完整度檢查的核心分類 */
export const ESSENTIAL_IDS = ['water', 'food', 'firstaid', 'light', 'hygiene', 'docs', 'tools'];

export const DEFAULT_SETTINGS = {
  warnSoon: 7,
  warnWatch: 30,
  autoLookup: true,
  autoCount: true,
  haptics: true,
  theme: 'system',
  householdSize: 1,
  lastTemplateAt: null,
  /** 報平安簡訊的預設收件人（空陣列＝開啟簡訊後再選） */
  safeContacts: [],
};

/** 台灣常用防災緊急電話 */
export const TAIWAN_EMERGENCY_NUMBERS = [
  { number: '119', title: '消防・救護', desc: '火警、緊急救護與災難救援', tone: 'danger' },
  { number: '110', title: '警察報案', desc: '治安事件、交通阻塞或急難協助', tone: 'info' },
  { number: '1991', title: '報平安留言', desc: '內政部災區親友報平安專線', tone: 'safe' },
  { number: '112', title: '行動緊急救難', desc: '無網路或無 SIM 卡時優先接通', tone: 'warn' },
];

/** 集合點上限：分享網址才不會太長，QR Code 也還掃得到 */
export const MAX_MEETING_POINTS = 4;

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

export function newMeetingPoint(partial = {}) {
  return {
    id: uid('mp'),
    name: '',
    address: '',
    lat: null,
    lng: null,
    note: '',
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
    meetingPoints: [],
    meta: { createdAt: new Date().toISOString() },
  };
}

/** 內建建議清單：可依家庭人數自動換算飲水與食料數量 */
export function templateItems(householdSize = 1) {
  const size = Math.max(1, Math.min(12, Math.round(Number(householdSize) || 1)));
  const now = new Date().toISOString();
  const rows = [
    ['飲用水（600ml）', 'water', 6, '瓶', '每人三日至少約 9 公升（可分批存放）', true],
    ['行動糧／能量棒', 'food', 6, '條', '免加熱、好保存', true],
    ['罐頭或調理包', 'food', 3, '份', '附開罐器更安心', true],
    ['急救包', 'firstaid', 1, '組', '繃帶、優碘、紗布', false],
    ['個人常用藥', 'firstaid', 1, '份', '依醫囑準備，含慢性病用藥', false],
    ['手電筒', 'light', 1, '支', '放床邊與玄關', false],
    ['備用電池', 'light', 4, '顆', '與手電筒同規格', false],
    ['行動電源', 'light', 1, '顆', '每半年充放一次並附充電線', false],
    ['哨子', 'tools', 1, '個', '呼救用，比喊叫省力', false],
    ['口罩', 'hygiene', 5, '片', '防塵與防護用', false],
    ['濕紙巾', 'hygiene', 1, '包', '停水時清潔用', false],
    ['衛生紙', 'hygiene', 2, '捲', '壓扁去紙捲軸省空間', false],
    ['雨衣', 'tools', 2, '件', '防雨兼保暖', false],
    ['暖暖包', 'tools', 2, '個', '低溫或淋濕時保暖', false],
    ['現金（小鈔）', 'docs', 1, '份', '停電時電子支付不可用', false],
    ['證件影本', 'docs', 1, '份', '身分證、健保卡、存摺與保單', false],
    ['多功能刀具', 'tools', 1, '把', '開罐與剪裁用', false],
    ['繩索（10m）', 'tools', 1, '條', '固定或緊急捆綁', false],
  ];

  return rows.map(([name, category, baseQty, unit, note, scalable]) => ({
    ...newItem({
      name,
      category,
      qty: scalable ? baseQty * size : baseQty,
      unit,
      note,
      expiryKind: category === 'food' || category === 'water' ? '賞味期限' : '使用期限',
      createdAt: now,
    }),
    scalable,
  }));
}
