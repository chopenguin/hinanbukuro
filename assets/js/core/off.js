/**
 * 條碼查詢：Open Food Facts 公開 API（免金鑰、支援 CORS）。
 * 查不到就回 null，讓使用者自己命名，並存進「我的商品庫」。
 */

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = 'product_name,product_name_zh,product_name_ja,product_name_en,brands,quantity,categories_tags';

const CATEGORY_HINTS = [
  ['water', ['water', 'mineral', '飲料水', '矿泉水', '礦泉水', '天然水']],
  ['food', ['snack', 'biscuit', 'cereal', 'canned', 'noodle', 'rice', 'food', 'bread', 'chocolate', 'candy', 'jelly', 'jam', 'coffee', 'tea', 'milk', 'drink', 'beverage']],
  ['firstaid', ['bandage', 'plaster', 'medicine', 'pharmaceutical', 'first-aid', 'medical']],
  ['light', ['battery', 'batteries', 'light', 'lamp', 'flashlight', 'bulb']],
  ['hygiene', ['mask', 'tissue', 'wipe', 'soap', 'shampoo', 'toothpaste', 'sanitary', 'diaper', 'hand-sanitizer', 'hygiene']],
  ['tools', ['tape', 'rope', 'knife', 'tool', 'glove', 'umbrella', 'bag']],
];

export function normalizeBarcode(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : '';
}

function guessCategory(tags, name) {
  const haystack = [...(tags || []), String(name || '').toLowerCase()].join(' ').toLowerCase();
  for (const [id, keys] of CATEGORY_HINTS) {
    if (keys.some((k) => haystack.includes(k))) return id;
  }
  return 'other';
}

function cleanName(product) {
  const candidates = [
    product.product_name_zh,
    product.product_name_ja,
    product.product_name,
    product.product_name_en,
  ];
  const name = candidates.find((n) => typeof n === 'string' && n.trim());
  if (!name) return '';
  return name.trim();
}

/** @returns {Promise<null|{name:string, brand:string, quantity:string, category:string, source:string}>} */
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

    return {
      name,
      brand: (product.brands || '').split(',')[0].trim(),
      quantity: (product.quantity || '').trim(),
      category: guessCategory(product.categories_tags, name),
      source: 'off',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
