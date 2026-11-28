/**
 * 條碼查詢與台灣商品分類／單位自動推斷。
 * 查詢使用 Open Food Facts 公開 API（免金鑰、支援 CORS）。
 */

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS =
  'product_name,product_name_zh_tw,product_name_zh,product_name_ja,product_name_en,brands,quantity,categories_tags';

const CATEGORY_RULES = [
  {
    id: 'water',
    unit: '瓶',
    keys: [
      '礦泉水',
      '天然水',
      '純水',
      '竹炭水',
      '海洋水',
      '離子水',
      '氣泡水',
      '飲料水',
      '礦泉',
      '桶裝水',
      '舒跑',
      '寶礦力',
      '多喝水',
      'evian',
      'volvic',
      'mineral water',
      'drinking water',
      'spring water',
      'water',
    ],
  },
  {
    id: 'firstaid',
    unit: '盒',
    keys: [
      '棉花棒',
      'ok繃',
      '創可貼',
      '繃帶',
      '紗布',
      '優碘',
      '酒精',
      '急救包',
      '急救箱',
      '食鹽水',
      '藥膏',
      '止痛',
      '成藥',
      'bandage',
      'plaster',
      'medicine',
      'pharmaceutical',
      'first-aid',
      'medical',
    ],
  },
  {
    id: 'light',
    unit: '顆',
    keys: ['電池', '手電筒', '頭燈', '行動電源', '蠟燭', '照明', 'battery', 'batteries', 'flashlight', 'lamp', 'bulb'],
  },
  {
    id: 'hygiene',
    unit: '包',
    keys: [
      '口罩',
      '濕紙巾',
      '衛生紙',
      '面紙',
      '紙巾',
      '肥皂',
      '洗手',
      '沐浴',
      '牙刷',
      '衛生棉',
      '尿布',
      '乾洗手',
      'mask',
      'tissue',
      'wipe',
      'soap',
      'shampoo',
      'toothpaste',
      'sanitary',
      'diaper',
      'hygiene',
    ],
  },
  {
    id: 'tools',
    unit: '個',
    keys: ['哨子', '口哨', '求生哨', '雨衣', '暖暖包', '刀', '繩', '手套', '膠帶', '剪刀', '打火機', '開罐器', 'tape', 'rope', 'knife', 'tool', 'glove'],
  },
  {
    id: 'docs',
    unit: '份',
    keys: ['現金', '證件', '身分證', '健保卡', '護照', '保單', '存摺', '影本'],
  },
  {
    id: 'food',
    unit: '包',
    keys: [
      '泡麵',
      '杯麵',
      '拉麵',
      '拌麵',
      '炸醬麵',
      '牛肉麵',
      '乾麵',
      '炒麵',
      '麵條',
      '湯麵',
      '脆麵',
      '科學麵',
      '炒面',
      '汤面',
      '冬粉',
      '餅乾',
      '蛋白餅',
      '蘇打餅',
      '罐頭',
      '調理包',
      '花生醬',
      '能量棒',
      '口糧',
      '燕麥',
      '精鹽',
      '鹽',
      '巧克力',
      '糖果',
      '飲',
      '乳酸',
      '茶',
      '咖啡',
      '牛奶',
      'snack',
      'biscuit',
      'cereal',
      'canned',
      'noodle',
      'rice',
      'food',
      'bread',
      'chocolate',
      'candy',
      'jam',
      'coffee',
      'tea',
      'milk',
      'beverage',
    ],
  },
];

const UNIT_PATTERNS = [
  [/(\d+\s*(?:入|包))|袋裝|包/i, '包'],
  [/(杯麵|桶麵|碗麵|杯)/i, '碗'],
  [/(罐頭|罐裝|易開罐|罐)/i, '罐'],
  [/(盒裝|盒|棉花棒|口罩)/i, '盒'],
  [/(捲)/i, '捲'],
  [/(支|手電筒|牙刷)/i, '支'],
  [/(條|能量棒|繩)/i, '條'],
  [/(件|雨衣)/i, '件'],
  [/(顆|電池|行動電源)/i, '顆'],
  [/(瓶|水|離子水|氣泡水|ml|l\b)/i, '瓶'],
];

export function normalizeBarcode(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : '';
}

/**
 * 依商品名稱、分類標籤與包裝容量字串推斷分類與建議單位。
 * @returns {{ category: string, unit: string }}
 */
export function inferItemMeta(name = '', tags = [], quantity = '') {
  const text = String(name || '');
  const haystack = [text, ...(tags || []), String(quantity || '')].join(' ').toLowerCase();

  let category = 'other';
  let defaultUnit = '個';

  for (const rule of CATEGORY_RULES) {
    if (rule.keys.some((k) => haystack.includes(k))) {
      category = rule.id;
      defaultUnit = rule.unit;
      break;
    }
  }

  let unit = defaultUnit;
  const unitHaystack = `${text} ${quantity || ''}`;
  for (const [re, candidate] of UNIT_PATTERNS) {
    if (re.test(unitHaystack)) {
      /* 非液體食物出現 "ml" 還是保留食品預設或罐／瓶；水類優先瓶 */
      if (candidate === '瓶' && category === 'firstaid') continue;
      unit = candidate;
      break;
    }
  }

  return { category, unit };
}

function cleanName(product) {
  const candidates = [
    product.product_name_zh_tw,
    product.product_name_zh,
    product.product_name_ja,
    product.product_name,
    product.product_name_en,
  ];
  const name = candidates.find((n) => typeof n === 'string' && n.trim());
  return name ? name.trim() : '';
}

/** @returns {Promise<null|{name:string, brand:string, quantity:string, category:string, unit:string, source:string}>} */
export async function lookupBarcode(barcode, { timeout = 7000, signal } = {}) {
  const code = normalizeBarcode(barcode);
  if (!code) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const res = await fetch(`${ENDPOINT}/${code}.json?fields=${FIELDS}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.status === 0 || json.status === 'failure' || !json.product) return null;

    const product = json.product;
    const name = cleanName(product);
    if (!name) return null;

    const quantity = (product.quantity || '').trim();
    const inferred = inferItemMeta(name, product.categories_tags, quantity);

    return {
      name,
      brand: (product.brands || '').split(',')[0].trim(),
      quantity,
      category: inferred.category,
      unit: inferred.unit,
      source: 'off',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
