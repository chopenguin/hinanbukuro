import { esc } from '../core/ui.js';

const PACK_CALLOUT_IDS = ['water', 'food', 'firstaid', 'light'];

/**
 * 互動式切面防災避難包 SVG（依核心物資備齊狀況即時切換照明、急救章、飲水瓶與狀態燈號）
 */
export function backpackKitSVG(essentialList = [], s = {}) {
  const map = new Map(essentialList.map((e) => [e.id, e]));
  const hasWater = Boolean(map.get('water')?.ok);
  const hasFood = Boolean(map.get('food')?.ok);
  const hasFirstAid = Boolean(map.get('firstaid')?.ok);
  const hasLight = Boolean(map.get('light')?.ok);
  const hasTools = Boolean(map.get('tools')?.ok);

  let ledTone = 'idle';
  if (s.total) {
    if (s.expired > 0) ledTone = 'danger';
    else if (s.soon > 0) ledTone = 'warn';
    else ledTone = 'ok';
  }

  return `
    <svg class="pack-svg" viewBox="0 0 280 260" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="v4PackShell" x1="60" y1="36" x2="220" y2="232" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#313742"/>
          <stop offset="55%" stop-color="#20242c"/>
          <stop offset="100%" stop-color="#14171d"/>
        </linearGradient>
        <linearGradient id="v4PackFlap" x1="80" y1="36" x2="200" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#3d4452"/>
          <stop offset="100%" stop-color="#252a33"/>
        </linearGradient>
        <linearGradient id="v4PackPouch" x1="90" y1="142" x2="190" y2="218" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#2b313b"/>
          <stop offset="100%" stop-color="#1a1e25"/>
        </linearGradient>
        <linearGradient id="v4LightCone" x1="230" y1="126" x2="274" y2="188" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ffd23f" stop-opacity="0.52"/>
          <stop offset="100%" stop-color="#ffd23f" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="v4SheenGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
          <stop offset="50%" stop-color="#ffffff" stop-opacity="0.62"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
        <clipPath id="v4YellowBandClip">
          <rect x="66" y="102" width="148" height="19" rx="5"/>
        </clipPath>
      </defs>

      <!-- 地面投影（呼吸微動畫） -->
      <ellipse class="pack-shadow" cx="140" cy="241" rx="84" ry="11" fill="rgba(0,0,0,0.28)"/>

      <!-- 整組懸浮背包本體 -->
      <g class="pack-float">
        <!-- 頂部提把 & 肩帶輪廓 -->
        <path d="M114 42 C114 23, 166 23, 166 42" stroke="#181b21" stroke-width="10" stroke-linecap="round"/>
        <path d="M114 42 C114 25, 166 25, 166 42" stroke="#474f5e" stroke-width="3" stroke-linecap="round" opacity="0.65"/>
        <path d="M72 74 C49 92, 47 180, 66 206" stroke="#1b1f27" stroke-width="14" stroke-linecap="round"/>
        <path d="M208 74 C231 92, 233 180, 214 206" stroke="#1b1f27" stroke-width="14" stroke-linecap="round"/>

        <!-- 左側外掛網袋：三日飲水壺 -->
        <g class="pack-module${hasWater ? ' is-stocked' : ''}">
          <path d="M40 132 H68 V204 C68 211 62 216 55 216 H48 C41 216 36 210 36 202 V140 C36 135 38 132 40 132 Z"
            fill="${hasWater ? '#168ae0' : '#2a2f38'}" fill-opacity="${hasWater ? '0.88' : '0.45'}"
            stroke="${hasWater ? '#7ad2ff' : 'rgba(255,255,255,0.18)'}" stroke-width="1.5"/>
          <rect x="44" y="119" width="16" height="13" rx="3.5" fill="${hasWater ? '#0f5c96' : '#232830'}"/>
          <rect x="47" y="113" width="10" height="6" rx="2" fill="${hasWater ? '#e6f5ff' : '#3a414d'}"/>
          ${
            hasWater
              ? `<path d="M43 144 V200" stroke="rgba(255,255,255,0.45)" stroke-width="2.5" stroke-linecap="round"/>
                 <path d="M37 166 Q45 161 52 166 T67 166 V202 C67 210 62 215 55 215 H48 C41 215 37 209 37 202 Z" fill="rgba(255,255,255,0.14)"/>`
              : ''
          }
          <!-- 網袋斜紋 -->
          <path d="M36 172 H68 V204 C68 211 62 217 55 217 H48 C40 217 36 211 36 203 Z"
            fill="rgba(16,19,24,0.45)" stroke="rgba(255,255,255,0.22)" stroke-width="1.2"/>
          <line x1="39" y1="184" x2="66" y2="184" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
          <line x1="39" y1="196" x2="66" y2="196" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
        </g>

        <!-- 右側外掛：手電筒 / 營燈模組 -->
        <g class="pack-module${hasLight ? ' is-stocked' : ''}">
          ${hasLight ? '<path class="pack-light-beam" d="M236 126 L276 146 L262 192 L222 140 Z" fill="url(#v4LightCone)"/>' : ''}
          <rect x="214" y="138" width="22" height="58" rx="6" fill="#252a34" stroke="rgba(255,255,255,0.18)" stroke-width="1.4"/>
          <rect x="212" y="122" width="26" height="19" rx="5" fill="${hasLight ? '#f6c316' : '#39404d'}" stroke="rgba(255,255,255,0.22)" stroke-width="1.3"/>
          <ellipse cx="225" cy="122" rx="10" ry="3.2" fill="${hasLight ? '#fff6bd' : '#555e6e'}"/>
          <rect x="208" y="156" width="8" height="18" rx="3" fill="#171a20"/>
        </g>

        <!-- 背包主體 -->
        <rect x="64" y="42" width="152" height="186" rx="34" fill="url(#v4PackShell)" stroke="rgba(255,255,255,0.16)" stroke-width="1.6"/>
        <!-- 縫線輪廓 -->
        <rect x="72" y="50" width="136" height="170" rx="28" stroke="rgba(255,255,255,0.08)" stroke-width="1.2" stroke-dasharray="4 4"/>

        <!-- 頂部防雨上蓋 -->
        <path d="M64 78 C64 52, 84 40, 112 40 H168 C196 40, 216 52, 216 78 V96 C216 105, 208 112, 198 112 H82 C72 112, 64 105, 64 96 Z"
          fill="url(#v4PackFlap)" stroke="rgba(255,255,255,0.14)" stroke-width="1.4"/>

        <!-- 東京防災 警示黃反光識別帶（含反光掃過動畫） -->
        <rect x="66" y="102" width="148" height="19" rx="5" fill="var(--bosai-yellow, #f6c316)"/>
        <g clip-path="url(#v4YellowBandClip)">
          <rect class="pack-stripe-sheen" x="0" y="96" width="44" height="32" fill="url(#v4SheenGrad)" transform="skewX(-22)"/>
        </g>
        <text x="140" y="115" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="9.5" font-weight="800" letter-spacing="1.6" fill="#171408">72H BOSAI</text>

        <!-- 雙戰術織帶與扣具 -->
        <rect x="92" y="42" width="11" height="82" rx="3" fill="#13161b"/>
        <rect x="177" y="42" width="11" height="82" rx="3" fill="#13161b"/>
        <rect x="89" y="88" width="17" height="13" rx="3" fill="#101216" stroke="rgba(255,255,255,0.28)" stroke-width="1.2"/>
        <rect x="174" y="88" width="17" height="13" rx="3" fill="#101216" stroke="rgba(255,255,255,0.28)" stroke-width="1.2"/>

        <!-- 整備狀態 LED 指示燈 -->
        <circle cx="195" cy="64" r="7" fill="rgba(0,0,0,0.45)"/>
        <circle class="pack-led pack-led--${ledTone}" cx="195" cy="64" r="3.8"/>

        <!-- 食料 / 備品拉鍊暗袋 -->
        <rect x="84" y="128" width="112" height="10" rx="5" fill="#13161c"/>
        <rect x="88" y="131" width="${hasFood ? '104' : '28'}" height="4" rx="2" fill="${hasFood ? '#e4431d' : '#4a5260'}" opacity="${hasFood ? '0.92' : '0.4'}"/>

        <!-- 下方急救工具前袋 -->
        <rect x="82" y="144" width="116" height="70" rx="18" fill="url(#v4PackPouch)" stroke="rgba(255,255,255,0.14)" stroke-width="1.4"/>
        <!-- 工具快掛環 -->
        <path d="M96 214 V224 M112 214 V224 M168 214 V224 M184 214 V224" stroke="${hasTools ? '#f6c316' : '#48505e'}" stroke-width="3" stroke-linecap="round"/>

        <!-- 中央急救十字識別徽章 -->
        <circle cx="140" cy="179" r="20" fill="${hasFirstAid ? '#107a57' : '#252a33'}" stroke="${hasFirstAid ? '#6ce3b6' : 'rgba(255,255,255,0.2)'}" stroke-width="1.6"/>
        <path d="M140 169 V189 M130 179 H150" stroke="${hasFirstAid ? '#ffffff' : 'rgba(255,255,255,0.35)'}" stroke-width="4.2" stroke-linecap="round"/>
      </g>
    </svg>`;
}

/**
 * 避難包視覺區下方可點擊的裝備模組膠囊（使用清晰 HTML 呈現繁中標籤）
 */
export function backpackCalloutsHTML(essentialList = []) {
  const map = new Map(essentialList.map((e) => [e.id, e]));
  return `
    <div class="pack-callouts" aria-label="核心裝備快速查看">
      ${PACK_CALLOUT_IDS.map((id) => {
        const item = map.get(id);
        if (!item) return '';
        return `
          <a class="pack-callout${item.ok ? ' is-ok' : ' is-wait'}" href="#/items?cat=${esc(item.id)}">
            <span class="callout-dot" aria-hidden="true"></span>
            <span class="callout-name">${esc(item.name)}</span>
            <span class="callout-count">${item.count ? `${item.count}` : '0'}</span>
          </a>`;
      }).join('')}
    </div>`;
}

/**
 * 動態三日飲水壺 SVG（雙正弦液面波紋 + 上升氣泡 + 刻度尺）
 */
export function waterBottleSVG({ pct = 0, waterQty = 0 } = {}) {
  const visualPct = waterQty <= 0 ? 6 : Math.max(16, Math.min(92, Number(pct) || 0));
  const surfaceY = Number((176 - (visualPct / 100) * 124).toFixed(1));

  return `
    <svg class="bottle-svg" viewBox="0 0 132 196" fill="none" aria-hidden="true">
      <defs>
        <clipPath id="v4BottleClip">
          <path d="M50 40 C50 47, 29 53, 29 68 V164 C29 174, 37 181, 47 181 H85 C95 181, 103 174, 103 164 V68 C103 53, 82 47, 82 40 Z"/>
        </clipPath>
        <linearGradient id="v4WaterFront" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="100%" stop-color="#0e68ad"/>
        </linearGradient>
        <linearGradient id="v4WaterBack" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7dd3fc" stop-opacity="0.72"/>
          <stop offset="100%" stop-color="#168ae0" stop-opacity="0.88"/>
        </linearGradient>
      </defs>

      <!-- 瓶身底框 -->
      <path d="M50 40 C50 47, 29 53, 29 68 V164 C29 174, 37 181, 47 181 H85 C95 181, 103 174, 103 164 V68 C103 53, 82 47, 82 40 Z"
        fill="var(--fill-1)" stroke="var(--hairline-strong)" stroke-width="2"/>

      <!-- 裁切區域內的晃動水位 -->
      <g clip-path="url(#v4BottleClip)">
        <g transform="translate(0 ${surfaceY})">
          <!-- 後層水波（112px 週期） -->
          <path class="liquid-wave liquid-wave--b"
            d="M-112 0 Q-84 -6 -56 0 T0 0 T56 0 T112 0 T168 0 T224 0 V180 H-112 Z"
            fill="url(#v4WaterBack)"/>
          <!-- 前層水波（140px 週期） -->
          <path class="liquid-wave liquid-wave--a"
            d="M-140 2 Q-105 -5 -70 2 T0 2 T70 2 T140 2 T210 2 T280 2 V180 H-140 Z"
            fill="url(#v4WaterFront)"/>
        </g>

        <!-- 氣泡粒子 -->
        ${
          waterQty > 0
            ? `<circle class="liquid-bubble b1" cx="48" cy="166" r="2.6" fill="rgba(255,255,255,0.6)"/>
               <circle class="liquid-bubble b2" cx="68" cy="172" r="3.2" fill="rgba(255,255,255,0.5)"/>
               <circle class="liquid-bubble b3" cx="84" cy="162" r="2.1" fill="rgba(255,255,255,0.65)"/>
               <circle class="liquid-bubble b4" cx="58" cy="154" r="1.8" fill="rgba(255,255,255,0.55)"/>`
            : ''
        }
      </g>

      <!-- 玻璃反光條 -->
      <path d="M38 72 V162" stroke="rgba(255,255,255,0.45)" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M44 76 V108" stroke="rgba(255,255,255,0.28)" stroke-width="2" stroke-linecap="round"/>

      <!-- 右側容量刻度線 -->
      <g stroke="var(--ink-3)" stroke-width="1.3" opacity="0.55" stroke-linecap="round">
        <line x1="87" y1="68" x2="99" y2="68"/>
        <line x1="91" y1="95" x2="99" y2="95"/>
        <line x1="85" y1="122" x2="99" y2="122"/>
        <line x1="91" y1="149" x2="99" y2="149"/>
      </g>

      <!-- 瓶頸環 & 旋蓋 + 掛環 -->
      <path d="M48 34 H84 V41 H48 Z" fill="var(--bg-sunk)" stroke="var(--hairline-strong)" stroke-width="1.4"/>
      <rect x="45" y="17" width="42" height="17" rx="4.5" fill="var(--bosai-yellow, #f6c316)" stroke="rgba(23,20,8,0.28)" stroke-width="1.4"/>
      <line x1="53" y1="20" x2="53" y2="31" stroke="rgba(23,20,8,0.22)" stroke-width="2" stroke-linecap="round"/>
      <line x1="66" y1="20" x2="66" y2="31" stroke="rgba(23,20,8,0.22)" stroke-width="2" stroke-linecap="round"/>
      <line x1="79" y1="20" x2="79" y2="31" stroke="rgba(23,20,8,0.22)" stroke-width="2" stroke-linecap="round"/>
      <path d="M56 17 C56 8, 76 8, 76 17" stroke="var(--ink-2)" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
}

function bearingDegrees(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lng2 - lng1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function approxMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 平安頁戰術掃描雷達與羅盤（依 GPS 與集合點座標定位或顯示預設標位）
 */
export function radarScopeSVG(points = [], lastFix = null, status = 'safe') {
  const cx = 120;
  const cy = 120;
  const scheme =
    status === 'help'
      ? { accent: '#ff7b76', wedge: 'rgba(255, 123, 118, 0.32)' }
      : status === 'arrived'
        ? { accent: '#5cb0ea', wedge: 'rgba(92, 176, 234, 0.32)' }
        : { accent: '#5ee6b3', wedge: 'rgba(94, 230, 179, 0.32)' };

  const ticks = Array.from({ length: 24 }, (_, i) => {
    const rad = ((i * 15 - 90) * Math.PI) / 180;
    const r1 = i % 6 === 0 ? 92 : 95;
    const r2 = 100;
    const x1 = (cx + r1 * Math.cos(rad)).toFixed(1);
    const y1 = (cy + r1 * Math.sin(rad)).toFixed(1);
    const x2 = (cx + r2 * Math.cos(rad)).toFixed(1);
    const y2 = (cy + r2 * Math.sin(rad)).toFixed(1);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }).join('');

  const fallbackDeg = [38, 138, 226, 310];
  const fallbackR = [54, 72, 58, 70];

  const blips = points.slice(0, 4).map((pt, i) => {
    const hasBoth =
      lastFix &&
      Number.isFinite(lastFix.lat) &&
      Number.isFinite(lastFix.lng) &&
      Number.isFinite(pt.lat) &&
      Number.isFinite(pt.lng);
    const deg = hasBoth ? bearingDegrees(lastFix.lat, lastFix.lng, pt.lat, pt.lng) : fallbackDeg[i % 4];
    const r = hasBoth
      ? Math.min(86, Math.max(28, 24 + Math.log10(Math.max(12, approxMeters(lastFix.lat, lastFix.lng, pt.lat, pt.lng))) * 14))
      : fallbackR[i % 4];
    const rad = ((deg - 90) * Math.PI) / 180;
    const bx = (cx + r * Math.cos(rad)).toFixed(1);
    const by = (cy + r * Math.sin(rad)).toFixed(1);
    const lx = (Number(bx) + (Math.cos(rad) >= 0 ? 9 : -21)).toFixed(1);
    const ly = (Number(by) + 3.5).toFixed(1);
    return `
      <g class="radar-blip" style="animation-delay:${i * 0.45}s">
        <circle class="radar-blip-halo" cx="${bx}" cy="${by}" r="11" fill="${scheme.accent}" opacity="0.24"/>
        <circle cx="${bx}" cy="${by}" r="4.2" fill="#f6c316" stroke="#0c1d16" stroke-width="1.3"/>
        <text x="${lx}" y="${ly}" font-family="ui-monospace, Menlo, monospace" font-size="9" font-weight="800" fill="rgba(255,255,255,0.9)">0${i + 1}</text>
      </g>`;
  }).join('');

  return `
    <svg class="radar-svg" viewBox="0 0 240 240" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="v4RadarSweep" x1="120" y1="120" x2="188" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${scheme.accent}" stop-opacity="0"/>
          <stop offset="100%" stop-color="${scheme.accent}" stop-opacity="0.34"/>
        </linearGradient>
      </defs>

      <!-- 外圈刻度與方位字 -->
      <circle cx="${cx}" cy="${cy}" r="100" fill="rgba(0,0,0,0.22)" stroke="rgba(255,255,255,0.16)" stroke-width="1.4"/>
      <g stroke="rgba(255,255,255,0.3)" stroke-width="1.4" stroke-linecap="round">${ticks}</g>
      <circle cx="${cx}" cy="${cy}" r="72" stroke="rgba(255,255,255,0.14)" stroke-dasharray="3 4"/>
      <circle cx="${cx}" cy="${cy}" r="42" stroke="rgba(255,255,255,0.16)" stroke-dasharray="3 4"/>
      <line x1="20" y1="${cy}" x2="220" y2="${cy}" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
      <line x1="${cx}" y1="20" x2="${cx}" y2="220" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>

      <text x="120" y="14" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="10.5" font-weight="800" fill="#f6c316">N</text>
      <text x="229" y="124" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="10" font-weight="700" fill="rgba(255,255,255,0.68)">E</text>
      <text x="120" y="234" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="10" font-weight="700" fill="rgba(255,255,255,0.68)">S</text>
      <text x="11" y="124" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="10" font-weight="700" fill="rgba(255,255,255,0.68)">W</text>

      <!-- 旋轉掃描扇區 -->
      <g class="radar-sweep">
        <path d="M120 120 L120 20 A100 100 0 0 1 190.7 49.3 Z" fill="url(#v4RadarSweep)"/>
        <line x1="120" y1="120" x2="120" y2="20" stroke="${scheme.accent}" stroke-width="1.8" opacity="0.88"/>
      </g>

      <!-- 集合點座標點位 -->
      ${blips}

      <!-- 中心自身信標 -->
      <circle class="radar-core-ring" cx="${cx}" cy="${cy}" r="12" stroke="${scheme.accent}" stroke-width="1.6"/>
      <circle cx="${cx}" cy="${cy}" r="5.5" fill="${scheme.accent}"/>
      <circle cx="${cx}" cy="${cy}" r="2.2" fill="#ffffff"/>
    </svg>`;
}

/**
 * 條碼取景窗待機 HUD（僅於相機尚未啟動時顯示）
 */
export function scannerIdleHUD() {
  return `
    <svg class="hud-svg" viewBox="0 0 320 180" fill="none" aria-hidden="true">
      <line x1="20" y1="90" x2="300" y2="90" stroke="rgba(255,255,255,0.08)" stroke-dasharray="4 4"/>
      <line x1="160" y1="18" x2="160" y2="162" stroke="rgba(255,255,255,0.08)" stroke-dasharray="4 4"/>
      <g opacity="0.42" fill="#ffffff">
        <rect x="92" y="64" width="4" height="44" rx="1"/>
        <rect x="99" y="64" width="2" height="44" rx="1"/>
        <rect x="105" y="64" width="7" height="44" rx="1"/>
        <rect x="115" y="64" width="3" height="44" rx="1"/>
        <rect x="122" y="64" width="5" height="44" rx="1"/>
        <rect x="131" y="64" width="2" height="44" rx="1"/>
        <rect x="137" y="64" width="8" height="44" rx="1"/>
        <rect x="148" y="64" width="3" height="44" rx="1"/>
        <rect x="155" y="64" width="6" height="44" rx="1"/>
        <rect x="165" y="64" width="2" height="44" rx="1"/>
        <rect x="171" y="64" width="7" height="44" rx="1"/>
        <rect x="181" y="64" width="3" height="44" rx="1"/>
        <rect x="188" y="64" width="5" height="44" rx="1"/>
        <rect x="197" y="64" width="2" height="44" rx="1"/>
        <rect x="203" y="64" width="4" height="44" rx="1"/>
        <rect x="211" y="64" width="7" height="44" rx="1"/>
        <rect x="222" y="64" width="3" height="44" rx="1"/>
      </g>
      <text x="160" y="126" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="9" font-weight="700" letter-spacing="2" fill="rgba(255,255,255,0.52)">OPTICAL // EAN-13 · UPC · CODE128</text>
      <line class="hud-laser" x1="76" y1="68" x2="244" y2="68" stroke="var(--tint)" stroke-width="2"/>
    </svg>`;
}

/**
 * 拍照辨識包裝標籤示範插畫
 */
export function labelOcrShowcaseSVG() {
  return `
    <svg viewBox="0 0 280 156" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="v4OcrBeam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--tint)" stop-opacity="0"/>
          <stop offset="100%" stop-color="var(--tint)" stop-opacity="0.38"/>
        </linearGradient>
      </defs>
      <!-- 底層卡片陰影厚度 -->
      <rect x="34" y="22" width="218" height="118" rx="14" fill="var(--fill-2)"/>
      <!-- 主標籤卡片 -->
      <rect x="28" y="14" width="220" height="118" rx="14" fill="var(--bg-elev)" stroke="var(--hairline-strong)" stroke-width="1.6"/>
      <!-- 辨識框：品名 -->
      <rect x="42" y="28" width="60" height="18" rx="5" fill="var(--tint-soft)" stroke="var(--tint)" stroke-width="1" stroke-dasharray="3 2"/>
      <text x="72" y="40.5" text-anchor="middle" font-size="9" font-weight="800" fill="var(--tint)">品名辨識</text>
      <rect x="110" y="31" width="122" height="12" rx="4" fill="var(--fill-3)"/>
      <rect x="42" y="54" width="164" height="8" rx="4" fill="var(--fill-2)"/>
      <!-- 辨識框：有效期限 -->
      <rect x="42" y="72" width="84" height="22" rx="6" fill="var(--safe-soft)" stroke="var(--safe)" stroke-width="1" stroke-dasharray="3 2"/>
      <text x="84" y="86.5" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="9.5" font-weight="800" fill="var(--safe)">2028.05.31</text>
      <!-- 推薦分類膠囊 -->
      <rect x="134" y="74" width="54" height="18" rx="9" fill="var(--bosai-yellow-soft, rgba(246,195,22,0.22))"/>
      <text x="161" y="86" text-anchor="middle" font-size="8.5" font-weight="800" fill="var(--ink)">推薦分類</text>
      <!-- 底部條碼與掃描光束 -->
      <g stroke="var(--ink-3)" stroke-width="2" opacity="0.5">
        <path d="M44 106v12M50 106v12M56 106v12M63 106v12M69 106v12M77 106v12M83 106v12M91 106v12M97 106v12M104 106v12"/>
      </g>
      <g class="ocr-art-beam">
        <rect x="30" y="22" width="216" height="20" fill="url(#v4OcrBeam)"/>
        <line x1="30" y1="42" x2="246" y2="42" stroke="var(--tint)" stroke-width="2.2"/>
      </g>
    </svg>`;
}
