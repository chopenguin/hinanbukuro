/**
 * 日期工具：全部以「當地時區的 YYYY-MM-DD」字串為準，
 * 避免 new Date('2027-03-01') 被當成 UTC 而位移一天。
 */

const MS_DAY = 86400000;

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function toISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function parseISO(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isValidISO(iso) {
  const d = parseISO(iso);
  return !!d && toISO(d) === iso;
}

function utcDay(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 距離今天還有幾天（負數代表已過期） */
export function daysLeft(iso, fromISO = todayISO()) {
  const a = parseISO(fromISO);
  const b = parseISO(iso);
  if (!a || !b) return null;
  return Math.round((utcDay(b) - utcDay(a)) / MS_DAY);
}

export function daysInMonth(year, month /* 1-12 */) {
  return new Date(year, month, 0).getDate();
}

export function addMonthsISO(iso, months) {
  const d = parseISO(iso);
  if (!d) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const target = new Date(y, m, 1);
  const day = Math.min(d.getDate(), daysInMonth(target.getFullYear(), target.getMonth() + 1));
  return toISO(new Date(target.getFullYear(), target.getMonth(), day));
}

export function addDaysISO(iso, days) {
  const d = parseISO(iso);
  if (!d) return null;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  return toISO(next);
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function weekdayZh(iso = todayISO()) {
  const d = parseISO(iso);
  return d ? WEEKDAYS[d.getDay()] : '';
}

/** 2027.03.01 */
export function fmtDate(iso) {
  const d = parseISO(iso);
  if (!d) return '—';
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

/** 3/1 */
export function fmtDateShort(iso) {
  const d = parseISO(iso);
  if (!d) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 2027 年 3 月 1 日（六） */
export function fmtDateLong(iso) {
  const d = parseISO(iso);
  if (!d) return '—';
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（${WEEKDAYS[d.getDay()]}）`;
}

export function relativeZh(days) {
  if (days === null) return '未設定';
  if (days === 0) return '今天到期';
  if (days === 1) return '明天到期';
  if (days === -1) return '昨天過期';
  if (days < 0) return `已過期 ${Math.abs(days)} 天`;
  return `還有 ${days} 天`;
}

/**
 * 依期限回傳狀態。
 * expired → 已過期 / soon → 快到期（warnSoon 天內）/ watch → 留意 / ok → 正常 / none → 未設定
 */
export function statusOf(iso, { warnSoon = 7, warnWatch = 30 } = {}) {
  const days = daysLeft(iso);
  if (days === null) return { key: 'none', days: null, text: '未設期限' };
  if (days < 0) return { key: 'expired', days, text: relativeZh(days) };
  if (days <= warnSoon) return { key: 'soon', days, text: relativeZh(days) };
  if (days <= warnWatch) return { key: 'watch', days, text: relativeZh(days) };
  return { key: 'ok', days, text: relativeZh(days) };
}

export const STATUS_ORDER = { expired: 0, soon: 1, watch: 2, none: 3, ok: 4 };

/* -------------------------------------------------------------------------
 * 有效期限文字解析（OCR 輔助）
 *
 * 包裝上的日期長相很雜，除了標準的 2027.03.01，還會遇到：
 *   - OCR 斷行：`2026.11` + 換行 + `13`（舊版會誤判成「年月」→ 取月底）
 *   - 日／月／年：`13/11/2026`
 *   - 沒有年份：`11/13`、`11月13日`
 *   - 數字之間被塞空白：`2 0 2 6 . 1 1 . 1 3`
 * 解析完會依「像不像有效期限」給分（賞味期限 > 製造日期）。
 * ---------------------------------------------------------------------- */

const FULLWIDTH = {
  '．': '.',
  '。': '.',
  '／': '/',
  '⁄': '/',
  '－': '-',
  '—': '-',
  '–': '-',
  '−': '-',
  '　': ' ',
};

function normalizeDateText(text) {
  return String(text ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。／⁄－—–−　]/g, (c) => FULLWIDTH[c] || c)
    .replace(/[，,、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** OCR 有時會在每個字元之間插空白，這裡把「數字 空白 數字」黏回去 */
function tightenDates(text) {
  let out = text;
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(/(\d) (?=\d)/g, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}

const EXPIRY_WORDS = /(賞味|期限|到期|有效|EXP|BB|BEST\s*BEFORE|USE\s*BY)/i;
const MADE_WORDS = /(製造|生產|加工|MFG|MANUFACTURED?|PACKED|PRD)/i;
const UNIT_WORDS = /^\s*(個|入|枚|包|袋|本|支|片|粒|組|箱|杯|匙|大匙|小匙|人份|份|倍|kg|g|mg|ml|l|%|cm|mm|度)/i;

function contextScore(flat, start) {
  const before = flat.slice(Math.max(0, start - 24), start);
  let score = 0;
  if (EXPIRY_WORDS.test(before)) score += 26;
  if (MADE_WORDS.test(before)) score -= 34;
  return score;
}

function thisYear() {
  return new Date().getFullYear();
}

const DATE_PATTERNS = [
  {
    kind: 'ymd',
    /* 2026.11.13 / 2026年11月13日 / 2026 11 13（OCR 斷行、斷字都吃） */
    re: /(?<!\d)((?:19|20)\d{2})\s*(?:[.\-/_年]\s*|\s+)(\d{1,2})\s*(?:[.\-/_月]\s*|\s+)(\d{1,2})\s*日?(?!\d)/g,
    build: (y, m, d) => [{ y: +y, m: +m, d: +d, score: 100 }],
  },
  {
    kind: 'ymd8',
    re: /(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g,
    build: (y, m, d) => [{ y: +y, m: +m, d: +d, score: 96 }],
  },
  {
    kind: 'roc',
    re: /(?:民國|民)\s*(\d{2,3})\s*[.\-/_年]?\s*(\d{1,2})\s*[.\-/_月]?\s*(\d{1,2})\s*日?/g,
    build: (y, m, d) => [{ y: +y + 1911, m: +m, d: +d, score: 94 }],
  },
  {
    kind: 'roc3',
    /* 台灣包裝常見的民國年：115.11.13 / 115年11月13日（100–199 → 2011–2110） */
    re: /(?<!\d)(1\d{2})\s*[.\-/_年]\s*(\d{1,2})\s*[.\-/_月]\s*(\d{1,2})\s*日?(?!\d)/g,
    build: (y, m, d) => [{ y: +y + 1911, m: +m, d: +d, score: 92 }],
  },
  {
    kind: 'compact',
    /* 台灣很常印「2028年5月31日」，OCR 把國字吃掉後只剩 2028531 / 20280531 */
    re: /(?<!\d)((?:19|20)\d{2})(\d{3,4})(?!\d)/g,
    build: (y, rest) => {
      const Y = +y;
      const out = [];
      /* 3 位數殘留（113）要同時試 11/3 和 1/13，所以月份最多取 2 位 */
      for (let mlen = Math.min(2, rest.length - 1); mlen >= 1; mlen -= 1) {
        const m = +rest.slice(0, mlen);
        const d = +rest.slice(mlen);
        if (m < 1 || m > 12) continue;
        if (d < 1 || d > daysInMonth(Y, m)) continue;
        /* 兩位數月份（11月3日）比一位數月份（1月13日）常見一點點 */
        out.push({ y: Y, m, d, score: mlen === 2 ? 72 : 66 });
      }
      /* 兩種切法都說得通（2028113 → 11/3 或 1/13）→ 標記為歧義，只能讓使用者自己挑 */
      if (out.length > 1) for (const o of out) o.ambiguous = true;
      return out;
    },
  },
  {
    kind: 'dmy',
    /* 13/11/2026 或 11/13/2026：依數字大小判斷是日先還是月先 */
    re: /(?<!\d)(\d{1,2})\s*[.\-/_]\s*(\d{1,2})\s*[.\-/_]\s*((?:19|20)\d{2})(?!\d)/g,
    build: (a, b, y) => {
      const A = +a;
      const B = +b;
      const Y = +y;
      if (A > 12) return [{ y: Y, m: B, d: A, score: 80 }];
      if (B > 12) return [{ y: Y, m: A, d: B, score: 78 }];
      return [
        { y: Y, m: A, d: B, score: 74 },
        { y: Y, m: B, d: A, score: 64 },
      ];
    },
  },
  {
    kind: 'dmy2',
    /* 26.11.13（兩位年份）或 13.11.26（日.月.年） */
    re: /(?<!\d)(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{2})(?!\d)/g,
    build: (a, b, yy) => {
      const A = +a;
      const B = +b;
      const C = +yy;
      if (A > 12 && C <= 12) return [{ y: 2000 + C, m: B, d: A, score: 72 }];
      if (B > 12 && A <= 12) return [{ y: 2000 + C, m: A, d: B, score: 72 }];
      if (A >= 20 && A <= 49) return [{ y: 2000 + A, m: B, d: C, score: 74 }];
      return [{ y: 2000 + C, m: A, d: B, score: 68 }];
    },
  },
  {
    kind: 'jp',
    /* 11月13日（沒有年份時用今年） */
    re: /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日/g,
    build: (m, d) => [{ y: thisYear(), m: +m, d: +d, score: 70 }],
  },
  {
    kind: 'ym',
    /* 2026.11：只有年月，取月底（分數刻意壓低，免得蓋掉真正的日期） */
    re: /(?<!\d)((?:19|20)\d{2})\s*[.\-/_年]\s*(\d{1,2})\s*月?(?!\d)/g,
    build: (y, m) => [{ y: +y, m: +m, d: 0, score: 45 }],
  },
  {
    kind: 'my',
    re: /(?<!\d)(\d{1,2})\s*[.\-/]\s*((?:19|20)\d{2})(?!\d)/g,
    build: (m, y) => [{ y: +y, m: +m, d: 0, score: 42 }],
  },
  {
    kind: 'md',
    /* 11/13、13/11：沒有年份，用今年 */
    re: /(?<!\d)(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/g,
    build: (a, b, offset, whole) => {
      const A = +a;
      const B = +b;
      const tail = String(whole || '').slice(offset + String(a).length + String(b).length + 1);
      /* `1/2 個`、`3/4 杯` 這類比例／份量不要當日期 */
      if (UNIT_WORDS.test(tail) && A < 10 && B < 10) return [];
      const Y = thisYear();
      if (A > 12 && B <= 12) return [{ y: Y, m: B, d: A, score: 38 }];
      if (B > 12 && A <= 12) return [{ y: Y, m: A, d: B, score: 38 }];
      return [{ y: Y, m: A, d: B, score: 32 }];
    },
  },
];

function overlaps(spans, start, end) {
  return spans.some(([s, e]) => start < e && end > s);
}

function collect(text, { minYear, maxYear }) {
  const flat = normalizeDateText(text);
  const found = [];

  const sources = [flat];
  const tight = tightenDates(flat);
  if (tight !== flat) sources.push(tight);

  for (const source of sources) {
    const taken = [];
    for (const p of DATE_PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(source))) {
        const start = m.index;
        const end = start + m[0].length;
        if (overlaps(taken, start, end)) continue;

        const partsList = p.build(...m.slice(1), m.index, source);
        if (!partsList?.length) continue;
        taken.push([start, end]);

        const bonus = contextScore(source, start);
        for (const parts of partsList) {
          if (!parts?.y || !parts?.m) continue;
          if (parts.y < minYear || parts.y > maxYear) continue;
          if (parts.m < 1 || parts.m > 12) continue;

          const dim = daysInMonth(parts.y, parts.m);
          const day = parts.d === 0 ? dim : parts.d;
          if (day < 1 || day > dim) continue;

          found.push({
            iso: `${parts.y}-${pad2(parts.m)}-${pad2(day)}`,
            raw: m[0].trim(),
            kind: p.kind,
            score: (parts.score ?? 40) + bonus,
            ambiguous: !!parts.ambiguous,
          });
        }
      }
    }
  }
  return found;
}

/**
 * 從任意文字中抓出可能的有效期限。
 * @returns {Array<{iso:string, raw:string, kind:string, score:number}>}
 */
export function findDates(text, { minYear = 1995, maxYear = 2100 } = {}) {
  if (!text) return [];

  const merged = new Map();
  for (const item of collect(text, { minYear, maxYear })) {
    const prev = merged.get(item.iso);
    if (!prev || item.score > prev.score) merged.set(item.iso, item);
  }

  return [...merged.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return Math.abs(daysLeft(a.iso) ?? 0) - Math.abs(daysLeft(b.iso) ?? 0);
  });
}

/**
 * 給定一批日期，選出最像「有效期限」的那一個：
 * 1. 有「賞味期限」等字樣的分數最高（findDates 已排序）
 * 2. 優先未過期（今天之後）且最近的日期；全部過期則取最晚的
 */
export function pickExpiry(candidates) {
  if (!candidates.length) return null;
  const list = candidates.map((c) => (typeof c === 'string' ? { iso: c, score: 0 } : c));

  const top = Math.max(...list.map((c) => c.score ?? 0));
  const strong = list.filter((c) => (c.score ?? 0) >= top - 12);
  const future = strong.filter((c) => (daysLeft(c.iso) ?? 0) >= 0);
  if (future.length) {
    return future.sort((a, b) => (daysLeft(a.iso) ?? 0) - (daysLeft(b.iso) ?? 0))[0].iso;
  }
  /* 全部都過期了：取最晚的那一個（通常才是最末效期，而不是製造日） */
  return strong.sort((a, b) => (daysLeft(b.iso) ?? 0) - (daysLeft(a.iso) ?? 0))[0].iso;
}
