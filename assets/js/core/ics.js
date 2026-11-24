import { downloadFile } from './ui.js?v=3';

function escICS(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function fold(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 74) return line;
  const out = [];
  let buf = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 74) {
      out.push(buf);
      buf = ' ';
      bytes = 1;
    }
    buf += ch;
    bytes += size;
  }
  out.push(buf);
  return out.join('\r\n');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/**
 * 把有期限的物品轉成 .ics 行事曆。
 * 每件物品會在「到期日前 warnSoon 天」與「到期當天」各觸發一次提醒。
 */
export function buildICS(items, { warnSoon = 7, warnWatch = 30, categories = [] } = {}) {
  const catName = (id) => categories.find((c) => c.id === id)?.name || id || '其他';
  const now = stamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hinanbukuro-cho//Hinanbukuro Techo//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:避難包 有效期限',
    'X-WR-TIMEZONE:Asia/Taipei',
  ];

  for (const item of items) {
    if (!item.expiry) continue;
    const day = item.expiry.replace(/-/g, '');
    const kind = item.expiryKind || '有效期限';
    const desc = [
      `分類：${catName(item.category)}`,
      `數量：${item.qty} ${item.unit || ''}`,
      item.location ? `存放位置：${item.location}` : '',
      item.note ? `備註：${item.note}` : '',
      `期限類型：${kind}`,
      '',
      '由「避難包帖」匯出：請檢查並更換這項物品。',
    ]
      .filter(Boolean)
      .join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.id}@hinanbukuro-cho`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${day}`,
      `SUMMARY:${escICS(`${item.name} 到期（${kind}）`)}`,
      `DESCRIPTION:${escICS(desc)}`,
      'TRANSP:TRANSPARENT',
      'CATEGORIES:避難包'
    );

    const alarms = new Set(
      [warnSoon, Math.round(warnSoon / 2), 0].filter((d) => Number.isFinite(d) && d >= 0)
    );
    for (const days of alarms) {
      lines.push(
        'BEGIN:VALARM',
        `TRIGGER:-P${days}D`,
        'ACTION:DISPLAY',
        `DESCRIPTION:${escICS(days === 0 ? `${item.name} 今天到期` : `${item.name} 還有 ${days} 天到期`)}`,
        'END:VALARM'
      );
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadICS(items, settings, categories = []) {
  const dated = items.filter((i) => i.expiry);
  if (!dated.length) return 0;
  const ics = buildICS(dated, { ...settings, categories });
  const name = `避難包期限-${new Date().toISOString().slice(0, 10)}.ics`;
  downloadFile(name, ics, 'text/calendar;charset=utf-8');
  return dated.length;
}
