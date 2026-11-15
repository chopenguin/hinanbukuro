/**
 * 條碼「本身」能告訴我們的事。
 *
 * 一串零售條碼（GTIN）只有四段：GS1 前綴、廠商代碼、商品代碼、檢查碼。
 * 它不含品名、容量、產地，也不含製造日或有效期限。能免費且離線得到的只有：
 *
 * 1. 格式：EAN-8 / UPC-A / EAN-13 / GTIN-14
 * 2. 檢查碼對不對 → 抓「掃錯、打錯」的號碼
 * 3. GS1 前綴 → 號碼是在哪個國家／地區登記的
 *    （注意：是「註冊地」，不是製造地。台灣公司委外代工一樣是 471）
 */

const KINDS = {
  8: 'EAN-8',
  12: 'UPC-A',
  13: 'EAN-13',
  14: 'GTIN-14',
};

/**
 * GS1 前綴對照表（3 碼範圍）。只列消費者實際會遇到的地區，
 * 資料來源：GS1 前綴表 / GS1 Taiwan 前置碼國家代碼一覽表。
 */
const PREFIX_RANGES = [
  [0, 19, '美國／加拿大', 'GS1 US'],
  [20, 29, '店內／區域碼', '不對外流通'],
  [30, 39, '美國／加拿大', 'GS1 US'],
  [40, 49, '公司內部碼', '不對外流通'],
  [50, 59, '美國／加拿大', 'GS1 US'],
  [60, 139, '美國／加拿大', 'GS1 US'],
  [200, 299, '店內／區域碼', '不對外流通'],
  [300, 379, '法國', 'GS1 France'],
  [380, 380, '保加利亞', 'GS1 Bulgaria'],
  [383, 383, '斯洛維尼亞', 'GS1 Slovenija'],
  [385, 385, '克羅埃西亞', 'GS1 Croatia'],
  [387, 387, '波士尼亞', 'GS1 BIH'],
  [389, 389, '蒙特內哥羅', 'GS1 Montenegro'],
  [400, 440, '德國', 'GS1 Germany'],
  [450, 459, '日本', 'GS1 Japan'],
  [460, 469, '俄羅斯', 'GS1 Russia'],
  [470, 470, '吉爾吉斯', 'GS1 Kyrgyzstan'],
  [471, 471, '台灣', 'GS1 Taiwan'],
  [474, 474, '愛沙尼亞', 'GS1 Estonia'],
  [475, 475, '拉脫維亞', 'GS1 Latvia'],
  [476, 476, '亞塞拜然', 'GS1 Azerbaijan'],
  [477, 477, '立陶宛', 'GS1 Lithuania'],
  [478, 478, '烏茲別克', 'GS1 Uzbekistan'],
  [479, 479, '斯里蘭卡', 'GS1 Sri Lanka'],
  [480, 480, '菲律賓', 'GS1 Philippines'],
  [481, 481, '白俄羅斯', 'GS1 Belarus'],
  [482, 482, '烏克蘭', 'GS1 Ukraine'],
  [489, 489, '香港', 'GS1 Hong Kong'],
  [490, 499, '日本', 'GS1 Japan'],
  [500, 509, '英國', 'GS1 UK'],
  [520, 521, '希臘', 'GS1 Greece'],
  [528, 528, '黎巴嫩', 'GS1 Lebanon'],
  [529, 529, '賽普勒斯', 'GS1 Cyprus'],
  [530, 530, '阿爾巴尼亞', 'GS1 Albania'],
  [539, 539, '愛爾蘭', 'GS1 Ireland'],
  [540, 549, '比利時／盧森堡', 'GS1 Belgium & Luxembourg'],
  [560, 560, '葡萄牙', 'GS1 Portugal'],
  [569, 569, '冰島', 'GS1 Iceland'],
  [570, 579, '丹麥', 'GS1 Denmark'],
  [590, 590, '波蘭', 'GS1 Poland'],
  [594, 594, '羅馬尼亞', 'GS1 Romania'],
  [599, 599, '匈牙利', 'GS1 Hungary'],
  [600, 601, '南非', 'GS1 South Africa'],
  [616, 616, '肯亞', 'GS1 Kenya'],
  [619, 619, '突尼西亞', 'GS1 Tunisia'],
  [622, 622, '埃及', 'GS1 Egypt'],
  [628, 628, '沙烏地阿拉伯', 'GS1 Saudi Arabia'],
  [629, 629, '阿聯', 'GS1 UAE'],
  [640, 649, '芬蘭', 'GS1 Finland'],
  [690, 699, '中國', 'GS1 China'],
  [700, 709, '挪威', 'GS1 Norway'],
  [729, 729, '以色列', 'GS1 Israel'],
  [730, 739, '瑞典', 'GS1 Sweden'],
  [750, 750, '墨西哥', 'GS1 Mexico'],
  [754, 755, '加拿大', 'GS1 Canada'],
  [759, 759, '委內瑞拉', 'GS1 Venezuela'],
  [760, 769, '瑞士', 'GS1 Switzerland'],
  [770, 770, '哥倫比亞', 'GS1 Colombia'],
  [775, 775, '秘魯', 'GS1 Peru'],
  [779, 779, '阿根廷', 'GS1 Argentina'],
  [780, 780, '智利', 'GS1 Chile'],
  [789, 790, '巴西', 'GS1 Brazil'],
  [800, 839, '義大利', 'GS1 Italy'],
  [840, 849, '西班牙', 'GS1 Spain'],
  [858, 858, '斯洛伐克', 'GS1 Slovakia'],
  [859, 859, '捷克', 'GS1 Czech Republic'],
  [868, 869, '土耳其', 'GS1 Turkey'],
  [870, 879, '荷蘭', 'GS1 Netherlands'],
  [880, 880, '韓國', 'GS1 South Korea'],
  [885, 885, '泰國', 'GS1 Thailand'],
  [888, 888, '新加坡', 'GS1 Singapore'],
  [890, 890, '印度', 'GS1 India'],
  [893, 893, '越南', 'GS1 Vietnam'],
  [899, 899, '印尼', 'GS1 Indonesia'],
  [900, 919, '奧地利', 'GS1 Austria'],
  [930, 939, '澳洲', 'GS1 Australia'],
  [940, 949, '紐西蘭', 'GS1 New Zealand'],
  [950, 950, 'GS1 總會', 'GS1 Global Office'],
  [955, 955, '馬來西亞', 'GS1 Malaysia'],
  [958, 958, '澳門', 'GS1 Macao'],
  [977, 977, '期刊（ISSN）', '書報雜誌條碼'],
  [978, 979, '書籍（ISBN）', '書報雜誌條碼'],
  [980, 980, '退款單', 'GS1 內部用途'],
  [981, 984, '折價券', 'GS1 折價券'],
  [990, 999, '折價券', 'GS1 折價券'],
];

function digitsOf(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function weightedSum(body) {
  /* 從最右邊的資料位開始，權重 3、1、3、1…（所有 GTIN 長度都一樣） */
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * weight;
    weight = 4 - weight;
  }
  return sum;
}

/**
 * 算出「正確的檢查碼」。
 * @returns {string|null} 單一數字；長度不是 8/12/13/14 就無法計算
 */
export function expectedCheckDigit(raw) {
  const digits = digitsOf(raw);
  if (!KINDS[digits.length]) return null;
  const body = digits.slice(0, -1);
  if (!/^\d+$/.test(body)) return null;
  return String((10 - (weightedSum(body) % 10)) % 10);
}

function regionOf(prefix) {
  const value = Number(prefix);
  if (!prefix || !Number.isFinite(value)) return null;
  const hit = PREFIX_RANGES.find(([lo, hi]) => value >= lo && value <= hi);
  return hit ? { name: hit[2], org: hit[3] } : null;
}

/**
 * 描述一組條碼：格式、檢查碼是否正確、前綴屬於哪個註冊地。
 *
 * @returns {{
 *   code: string,
 *   kind: string,            // 'EAN-13'…；長度不是零售條碼時為 ''
 *   valid: boolean|null,     // null = 無法判斷
 *   expected: string|null,   // 正確的檢查碼
 *   prefix: string,          // 前 3 碼
 *   region: {name:string, org:string}|null
 * }}
 */
export function describeBarcode(raw) {
  const code = digitsOf(raw);
  const kind = KINDS[code.length] || '';
  if (!kind) {
    return { code, kind: '', valid: null, expected: null, prefix: '', region: null };
  }
  const expected = expectedCheckDigit(code);
  const prefix = code.slice(0, 3);
  return {
    code,
    kind,
    expected,
    valid: expected === code.slice(-1),
    prefix,
    region: regionOf(prefix),
  };
}
