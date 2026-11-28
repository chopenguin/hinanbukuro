/* 統一的 24×24 細線 SVG 圖示庫（stroke 1.8px） */

const PATHS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H14v-5.5h-4v5.5H5.5A1.5 1.5 0 0 1 4 19z"/>',
  bag: '<path d="M6 8.5h12l1 10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  shield: '<path d="M12 3 4.5 6.2v5.4c0 4.6 3.2 8.7 7.5 9.9 4.3-1.2 7.5-5.3 7.5-9.9V6.2z"/><path d="m9.2 12.2 2 2 3.8-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',

  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M5 12.5 9.5 17 19 7"/>',
  alert: '<path d="M12 3.5 2.8 19.5a1 1 0 0 0 .87 1.5h16.66a1 1 0 0 0 .87-1.5z"/><path d="M12 10v4.2M12 17.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v4.8l3.2 1.8"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3.2v3.6M16 3.2v3.6"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M4.5 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>',
  upload: '<path d="M12 15V4m0 0-4 4m4-4 4 4"/><path d="M4.5 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/><path d="M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/>',
  edit: '<path d="M12 20h7.5"/><path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4z"/>',
  share: '<path d="M12 15V4m0 0-3.8 3.8M12 4l3.8 3.8"/><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6.5A1.5 1.5 0 0 0 13.5 5h-7A1.5 1.5 0 0 0 5 6.5v7A1.5 1.5 0 0 0 6.5 15H9"/>',
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  pin: '<path d="M12 21s-6.5-5.3-6.5-10.2a6.5 6.5 0 1 1 13 0C18.5 15.7 12 21 12 21z"/><circle cx="12" cy="10.8" r="2.3"/>',
  phone: '<path d="M6.6 4.2h3l1.4 3.6-1.8 1.4a12.5 12.5 0 0 0 5.6 5.6l1.4-1.8 3.6 1.4v3a1.8 1.8 0 0 1-1.9 1.8C10.1 18.8 5.2 13.9 4.8 6.1A1.8 1.8 0 0 1 6.6 4.2z"/>',
  message: '<path d="M4.5 6h15v9.5H9.2L5 19v-3.5h-.5z"/><path d="M8.5 9.5h7M8.5 12.5h4.8"/>',
  torch: '<path d="M9.5 3.5h5v4.2l2.3 3.4V20a1 1 0 0 1-1 1H8.2a1 1 0 0 1-1-1v-8.9l2.3-3.4z"/><path d="M8 13.5h8"/>',
  camera: '<path d="M4 8.5A2 2 0 0 1 6 6.5h2.2l1.3-2h5l1.3 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.8" r="3.2"/>',
  cameraOff: '<path d="m3 3 18 18"/><path d="M9.5 4.5h5l1.3 2H18a2 2 0 0 1 2 2v7.2M4 9v8.5a2 2 0 0 0 2 2h11.5"/><path d="M10.4 10.4a3.2 3.2 0 0 0 4.2 4.2"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m20.5 15.5-4.5-4.5-6.5 6.5-2.5-2.5-3.5 3.5"/>',
  sparkles: '<path d="M12 3.5 13.8 8.2 18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z"/><path d="M18.5 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  wifiOff: '<path d="m2 2 20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.8a9.8 9.8 0 0 1 4.8-2.4M14.8 10.6a9.8 9.8 0 0 1 4.2 2.2M2.5 9.2a14 14 0 0 1 4-2.4M11 6.1a14 14 0 0 1 10.5 3.1"/><circle cx="12" cy="19.5" r="1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="9.5" r="2.2"/><path d="M16 14.2a4.5 4.5 0 0 1 4.5 4.8"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><polygon points="15.5,8.5 13.5,13.5 8.5,15.5 10.5,10.5"/>',
  listChecks: '<path d="m4 7 1.5 1.5L8 6M4 13l1.5 1.5L8 12M4 19l1.5 1.5L8 18"/><path d="M11 7h9M11 13h9M11 19h9"/>',
  barcode: '<path d="M4 6v12M7.5 6v12M11 6v12M14 6v12M17 6v12M20 6v12"/>',
  tag: '<path d="M20.5 13.4 13.4 20.5a2 2 0 0 1-2.8 0L3.5 13.4V3.5h9.9z"/><circle cx="8" cy="8" r="1.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  external: '<path d="M14 5h5v5M19 5l-8.5 8.5"/><path d="M18 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8A1.5 1.5 0 0 1 6.5 6.5H11"/>',

  /* 分類專用圖示 */
  water: '<path d="M12 3.5s5.8 6.4 5.8 10.7a5.8 5.8 0 0 1-11.6 0C6.2 9.9 12 3.5 12 3.5z"/><path d="M9.5 15.2a2.8 2.8 0 0 0 2.5 2"/>',
  food: '<rect x="5.5" y="4.5" width="13" height="15" rx="2"/><path d="M5.5 8.5h13M5.5 15.5h13M9.5 12h5"/>',
  firstaid: '<rect x="3.5" y="6.5" width="17" height="13" rx="2"/><path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5"/><path d="M12 10v6M9 13h6"/>',
  light: '<path d="M9 18h6M10 20.5h4"/><path d="M8.5 14.5c-1.5-1.2-2.3-2.8-2.3-4.7a5.8 5.8 0 1 1 11.6 0c0 1.9-.8 3.5-2.3 4.7-.4.4-.5.9-.5 1.5H9c0-.6-.1-1.1-.5-1.5z"/>',
  hygiene: '<path d="M12 3.5 4.5 6.2v5.3c0 4.5 3.1 8.5 7.5 9.7 4.4-1.2 7.5-5.2 7.5-9.7V6.2z"/><path d="M9.5 12.2h5M12 9.7v5"/>',
  docs: '<path d="M7 3.5h7l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.5V8h4.5M9 12h6M9 15.5h4"/>',
  tools: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l2.8-2.8a5.2 5.2 0 0 1-6.8 6.8l-6.6 6.6a1.6 1.6 0 0 1-2.3-2.3l6.6-6.6a5.2 5.2 0 0 1 6.8-6.8z"/>',
  other: '<path d="M4.5 8.5 12 4.5l7.5 4v7L12 19.5l-7.5-4z"/><path d="M4.5 8.5 12 12.5l7.5-4M12 12.5v7"/>',
  pet: '<circle cx="7" cy="8.5" r="1.7"/><circle cx="12" cy="6.8" r="1.7"/><circle cx="17" cy="8.5" r="1.7"/><path d="M8 16.5c0-2.2 1.8-4 4-4s4 1.8 4 4a2.2 2.2 0 0 1-2.2 2.2h-3.6A2.2 2.2 0 0 1 8 16.5z"/>',
  baby: '<circle cx="12" cy="12.5" r="7"/><path d="M12 5.5c0-1.4 1.2-2.2 2.2-1.7M9.5 11.5h.01M14.5 11.5h.01M9.8 15c1.3 1 3.1 1 4.4 0"/>',
  clothing: '<path d="M8 4.5 4 7l2 4 2-1v9.5h8V10l2 1 2-4-4-2.5a4 4 0 0 1-8 0z"/>',
  power: '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M10 2.5h4M12.5 9l-3 4h3l-1 4"/>',
  package: '<path d="M4.5 8.5 12 4.5l7.5 4v7L12 19.5l-7.5-4z"/><path d="M4.5 8.5 12 12.5l7.5-4M12 12.5v7"/>',
};

export const CATEGORY_ICON_OPTIONS = [
  { id: 'water', label: '飲水' },
  { id: 'food', label: '食料' },
  { id: 'firstaid', label: '急救' },
  { id: 'light', label: '照明' },
  { id: 'hygiene', label: '衛生' },
  { id: 'docs', label: '文件' },
  { id: 'tools', label: '工具' },
  { id: 'power', label: '電源' },
  { id: 'clothing', label: '衣物' },
  { id: 'pet', label: '寵物' },
  { id: 'baby', label: '嬰幼' },
  { id: 'other', label: '箱包' },
];

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}

export function icon(name, className = '') {
  const path = PATHS[name] || PATHS.package;
  const cls = className ? `ico ${className}` : 'ico';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
