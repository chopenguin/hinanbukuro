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

/** 2027 年 3 月 1 日（土） */
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
 * 支援：2027.03.01 / 2027-03-01 / 2027/3/1 / 2027年3月1日 / 20270301
 *       27.03.01（兩位年份）/ 2027.03（年月，取月底）
 *       民國 116.03.01 / 116年3月1日
 * ---------------------------------------------------------------------- */

const DATE_PATTERNS = [
  {
    kind: 'ymd',
    score: 100,
    re: /(?<!\d)((?:19|20)\d{2})\s*[.\-/_年]\s*(\d{1,2})\s*[.\-/_月]\s*(\d{1,2})\s*日?(?!\d)/g,
    build: (y, m, d) => ({ y: +y, m: +m, d: +d }),
  },
  {
    kind: 'ymd8',
    score: 96,
    re: /(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g,
    build: (y, m, d) => ({ y: +y, m: +m, d: +d }),
  },
  {
    kind: 'roc',
    score: 92,
    re: /(?:民國|民)\s*(\d{2,3})\s*[.\-/_年]\s*(\d{1,2})\s*[.\-/_月]\s*(\d{1,2})\s*日?/g,
    build: (y, m, d) => ({ y: +y + 1911, m: +m, d: +d }),
  },
  {
    kind: 'ymd2',
    score: 74,
    re: /(?<!\d)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/g,
    build: (y, m, d) => ({ y: 2000 + +y, m: +m, d: +d }),
  },
  {
    kind: 'ym',
    score: 55,
    re: /(?<!\d)((?:19|20)\d{2})\s*[.\-/_年]\s*(\d{1,2})\s*月?(?!\d)/g,
    build: (y, m) => ({ y: +y, m: +m, d: 0 }),
  },
  {
    kind: 'my',
    score: 48,
    re: /(?<!\d)(\d{1,2})\s*[.\-/]\s*((?:19|20)\d{2})(?!\d)/g,
    build: (m, y) => ({ y: +y, m: +m, d: 0 }),
  },
];

function overlaps(spans, start, end) {
  return spans.some(([s, e]) => start < e && end > s);
}

/**
 * 從任意文字中抓出可能的有效期限。
 * @returns {Array<{iso:string, raw:string, kind:string, score:number}>}
 */
export function findDates(text, { minYear = 1995, maxYear = 2100 } = {}) {
  if (!text) return [];
  const flat = String(text).replace(/[，,、]/g, ' ').replace(/\s+/g, ' ');
  const found = [];
  const taken = [];

  for (const p of DATE_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(flat))) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(taken, start, end)) continue;

      const parts = p.build(...m.slice(1));
      if (!parts || !parts.y || !parts.m) continue;
      if (parts.y < minYear || parts.y > maxYear) continue;
      if (parts.m < 1 || parts.m > 12) continue;

      const dim = daysInMonth(parts.y, parts.m);
      const day = parts.d === 0 ? dim : parts.d;
      if (day < 1 || day > dim) continue;

      const iso = `${parts.y}-${pad2(parts.m)}-${pad2(day)}`;
      taken.push([start, end]);
      found.push({ iso, raw: m[0].trim(), kind: p.kind, score: p.score });
    }
  }

  return found
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Math.abs(daysLeft(a.iso) ?? 0) - Math.abs(daysLeft(b.iso) ?? 0);
    })
    .filter((item, i, arr) => arr.findIndex((x) => x.iso === item.iso) === i);
}

/**
 * 給定一批日期，選出最像「有效期限」的那一個：
 * 優先未過期（今天之後）且最近的日期；若全部過期則取最晚的。
 */
export function pickExpiry(candidates) {
  if (!candidates.length) return null;
  const flat = candidates.map((c) => (typeof c === 'string' ? c : c.iso));
  const future = flat.filter((iso) => (daysLeft(iso) ?? 0) >= 0);
  if (future.length) {
    return future.sort((a, b) => (daysLeft(a) ?? 0) - (daysLeft(b) ?? 0))[0];
  }
  return flat.sort((a, b) => (daysLeft(b) ?? 0) - (daysLeft(a) ?? 0))[0];
}
