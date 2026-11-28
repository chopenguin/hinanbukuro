/* 平安頁的共用工具：定位、離線距離計算、報平安簡訊、集合點分享連結 */
import { pad2 } from './dates.js';

export const SAFE_POSITION_TIMEOUT = 30000;
export const MAX_SHARE_CODE_LENGTH = 6000;

export const SAFE_STATUS_PRESETS = [
  { id: 'safe', label: '我目前安全', prefix: '【防災報平安】我目前安全' },
  { id: 'arrived', label: '已抵達集合點', prefix: '【防災報平安】我已抵達集合點' },
  { id: 'help', label: '需要協助', prefix: '【防災緊急求助】我目前需要協助' },
];

/**
 * 取得目前位置。室內或斷網時 GNSS 冷啟動可能很慢，
 * 所以預設給到 30 秒，讓手機有機會抓到衛星。
 * @returns {Promise<{lat:number, lng:number, accuracy:number|null, at:number}>}
 */
export function locate({ timeout = SAFE_POSITION_TIMEOUT, maximumAge = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(Object.assign(new Error('這個瀏覽器不支援定位'), { code: -1 }));
      return;
    }
    if (!window.isSecureContext) {
      reject(Object.assign(new Error('定位需要 HTTPS 或 localhost 環境'), { code: -2 }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          at: pos.timestamp || Date.now(),
        });
      },
      reject,
      { enableHighAccuracy: true, timeout, maximumAge }
    );
  });
}

export function locateErrorMessage(err) {
  switch (err?.code) {
    case 1:
      return '沒有取得定位權限。請到瀏覽器設定允許這個網站使用位置。';
    case 2:
      return '目前抓不到位置。請移到窗邊或空曠處，再試一次。';
    case 3:
      return '30 秒內沒有收到衛星訊號。請靠近窗邊或空曠處再試一次。';
    case -2:
      return '定位需要 HTTPS 或 localhost 環境。';
    default:
      return err?.message || '取得位置失敗，請再試一次。';
  }
}

export function coordsText(lat, lng, digits = 5) {
  return `${Number(lat).toFixed(digits)}, ${Number(lng).toFixed(digits)}`;
}

export function mapsUrl(lat, lng) {
  return `https://www.google.com/maps?q=${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

/** Haversine 直線距離（公尺），完全離線可算 */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return null;
  }
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) return `約 ${Math.round(meters)} 公尺`;
  return `約 ${(meters / 1000).toFixed(1)} 公里`;
}

const COMPASS_ZH = ['北方', '東北方', '東方', '東南方', '南方', '西南方', '西方', '西北方'];

/** 從起點到終點的 8 方位中文方向 */
export function bearingZh(lat1, lng1, lat2, lng2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return '';
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lng2 - lng1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return COMPASS_ZH[Math.round(deg / 45) % 8];
}

function fmtTime(at) {
  const d = new Date(at || Date.now());
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fixTimeText(at) {
  return fmtTime(at);
}

/** 產生「報平安」簡訊內容（座標 + Google Maps 連結，支援狀態與集合點） */
export function buildSafeMessage(fix, { status = 'safe', meetingPoint = null, note = '' } = {}) {
  const preset = SAFE_STATUS_PRESETS.find((p) => p.id === status) || SAFE_STATUS_PRESETS[0];
  const coord = coordsText(fix.lat, fix.lng);
  const accuracy = Number.isFinite(fix.accuracy)
    ? `（精確度約 ${Math.max(1, Math.round(fix.accuracy))} 公尺）`
    : '';

  const lines = [`${preset.prefix}，位置在 ${coord}${accuracy}`];

  if (meetingPoint && meetingPoint.name) {
    const addr = meetingPoint.address ? `（${meetingPoint.address}）` : '';
    lines.push(`約定集合點：${meetingPoint.name}${addr}`);
  }

  const cleanNote = String(note || '').trim();
  if (cleanNote) {
    lines.push(`備註：${cleanNote}`);
  }

  lines.push(`${fmtTime(fix.at)}・Google Maps：${mapsUrl(fix.lat, fix.lng)}`);
  return lines.join('\n');
}

export function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * 依收件人數量組成簡訊 URL。
 * 同時接受字串陣列與 `{ name, phone }` 物件陣列。
 */
export function smsHref(body, contacts = []) {
  const text = encodeURIComponent(body);
  const numbers = contacts
    .map((c) => (typeof c === 'string' ? c : c?.phone))
    .map((n) => String(n || '').replace(/[^\d+]/g, ''))
    .filter(Boolean);
  const ios = isIOS();

  if (!numbers.length) return ios ? `sms:&body=${text}` : `sms:?body=${text}`;
  if (numbers.length === 1) return `sms:${numbers[0]}${ios ? '&' : '?'}body=${text}`;
  if (ios) return `sms://open?addresses=${numbers.join(',')}&body=${text}`;
  return `sms:${numbers.join(',')}?body=${text}`;
}

export function formatPhone(contactOrNumber) {
  const raw = typeof contactOrNumber === 'string' ? contactOrNumber : contactOrNumber?.phone;
  const value = String(raw || '');
  if (/^09\d{8}$/.test(value)) return `${value.slice(0, 4)} ${value.slice(4, 7)} ${value.slice(7)}`;
  return value;
}

/* --------------------------------------------------------- 集合點分享連結 */

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  const normalized = code.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function packPoint(point) {
  const out = { n: point.name };
  if (point.address) out.a = point.address;
  if (Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
    out.y = Math.round(point.lat * 1e5) / 1e5;
    out.x = Math.round(point.lng * 1e5) / 1e5;
  }
  if (point.note) out.m = point.note;
  return out;
}

export function encodeMeetingPoints(points = []) {
  const payload = {
    v: 1,
    p: points
      .filter((point) => point && String(point.name || '').trim())
      .slice(0, 4)
      .map(packPoint),
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeMeetingPoints(code) {
  if (!code || code.length > MAX_SHARE_CODE_LENGTH) return [];
  try {
    const data = JSON.parse(fromBase64Url(code));
    if (!data || data.v !== 1 || !Array.isArray(data.p)) return [];
    return data.p
      .slice(0, 4)
      .map((raw) => {
        const name = String(raw?.n || '').trim().slice(0, 40);
        if (!name) return null;
        const lat = Number(raw?.y);
        const lng = Number(raw?.x);
        const hasCoords =
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lng) <= 180;
        return {
          name,
          address: String(raw?.a || '').trim().slice(0, 90),
          lat: hasCoords ? lat : null,
          lng: hasCoords ? lng : null,
          note: String(raw?.m || '').trim().slice(0, 140),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------- QR Code */

let qrLibPromise = null;

function loadQrLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrLibPromise) {
    qrLibPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../../vendor/qrcode.min.js', import.meta.url).href;
      script.async = true;
      script.onload = () => {
        if (window.qrcode) resolve(window.qrcode);
        else reject(new Error('QR Code 模組載入失敗'));
      };
      script.onerror = () => reject(new Error('QR Code 模組載入失敗'));
      document.head.appendChild(script);
    }).catch((err) => {
      qrLibPromise = null;
      throw err;
    });
  }
  return qrLibPromise;
}

/** 產生可直接插入頁面的 QR Code SVG；載入失敗時回傳空字串 */
export async function qrCodeSvg(text) {
  try {
    const qrcode = await loadQrLib();
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({
      cellSize: 5,
      margin: 2,
      scalable: true,
      alt: { text: '集合點分享 QR Code' },
    });
  } catch {
    return '';
  }
}
