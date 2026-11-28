/* 共用 UI：toast（支援復原按鈕）、底部/置中面板、確認框、媒體工具 */
import { spring, project, prefersReducedMotion } from './spring.js';
import { icon } from './icons.js';

let dialogSeq = 0;

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

export function el(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export function debounce(fn, wait = 180) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ------------------------------------------------------------- 背景鎖定 */

function lockScroll() {
  document.documentElement.classList.add('is-scroll-locked');
}

function unlockScroll() {
  if (!document.querySelector('dialog[open]')) {
    document.documentElement.classList.remove('is-scroll-locked');
  }
}

/* ------------------------------------------------------------- toast */

export function toast(
  message,
  { type = 'ok', duration = 2600, actionLabel = '', onAction = null } = {}
) {
  const root = document.getElementById('toast-root');
  if (!root) return;

  const hasAction = Boolean(actionLabel && typeof onAction === 'function');
  const timeoutMs = hasAction ? Math.max(duration, 4800) : duration;

  const node = el(`
    <div class="toast toast--${esc(type)}">
      <span class="toast-msg">${esc(message)}</span>
      ${hasAction ? `<button type="button" class="toast-action">${esc(actionLabel)}</button>` : ''}
    </div>
  `);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 320);
  };

  if (hasAction) {
    node.querySelector('.toast-action')?.addEventListener('click', () => {
      try {
        onAction();
      } finally {
        dismiss();
      }
    });
  }

  root.appendChild(node);
  const timer = setTimeout(dismiss, timeoutMs);
}

/* ------------------------------------------------------------- sheet */

const isDesktop = () => window.matchMedia?.('(min-width: 720px)').matches;

/**
 * 底部面板（行動裝置可 1:1 拖曳收起；桌面裝置置中淡入縮放）。
 * @returns {{dialog: HTMLDialogElement, close: Function, bodyEl: HTMLElement, footEl: HTMLElement}}
 */
export function openSheet({ title = '', body = '', foot = '', onMount, labelledBy } = {}) {
  const titleId = `sheet-title-${++dialogSeq}`;
  const dialog = el(`
    <dialog class="sheet" aria-modal="true"${title || labelledBy ? ` aria-labelledby="${esc(labelledBy || titleId)}"` : ''}>
      <div class="sheet-panel">
        <div class="sheet-grip" aria-hidden="true"></div>
        <div class="sheet-head">
          <h2 id="${titleId}">${esc(title)}</h2>
          <button type="button" class="sheet-close" aria-label="關閉">${icon('x')}</button>
        </div>
        <div class="sheet-body"></div>
        <div class="sheet-foot"></div>
      </div>
    </dialog>
  `);

  const panel = dialog.querySelector('.sheet-panel');
  const bodyEl = dialog.querySelector('.sheet-body');
  const footEl = dialog.querySelector('.sheet-foot');

  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  if (typeof foot === 'string') footEl.innerHTML = foot;
  else if (foot) footEl.appendChild(foot);
  else footEl.remove();

  if (!title) dialog.querySelector('.sheet-head').remove();

  document.body.appendChild(dialog);
  dialog.showModal();
  lockScroll();

  let drag = 0;
  let openAnim = null;
  let closing = false;
  let closed = false;
  let pendingValue = '';
  let tracking = null;
  const desktopMode = isDesktop();

  const panelHeight = () => panel.offsetHeight || Math.round(window.innerHeight * 0.5);

  const setDrag = (value) => {
    drag = value;
    panel.style.setProperty('--drag', `${Math.max(0, value)}px`);
  };

  const finishClose = () => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close(pendingValue || '');
  };

  const close = (value = '') => {
    if (closing || closed) return;
    closing = true;
    pendingValue = value;
    openAnim?.stop();
    dialog.classList.remove('is-open');
    dialog.classList.add('is-closing');
    panel.style.removeProperty('will-change');

    if (desktopMode || prefersReducedMotion()) {
      setTimeout(finishClose, prefersReducedMotion() ? 10 : 200);
      return;
    }

    spring({
      from: drag,
      to: panelHeight() + 40,
      response: 0.3,
      damping: 1,
      restDelta: 0.5,
      onUpdate: setDrag,
      onComplete: finishClose,
    });
  };

  if (desktopMode) {
    panel.style.setProperty('--drag', '0px');
    requestAnimationFrame(() => {
      if (!closed) dialog.classList.add('is-open');
    });
  } else {
    setDrag(panelHeight());
    requestAnimationFrame(() => {
      if (closed) return;
      dialog.classList.add('is-open');
      openAnim = spring({
        from: drag,
        to: 0,
        response: 0.42,
        damping: 0.88,
        restDelta: 0.35,
        restSpeed: 6,
        onUpdate: setDrag,
      });
    });
  }

  dialog.querySelector('.sheet-close')?.addEventListener('click', () => close('cancel'));

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close('cancel');
  });

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close('cancel');
  });

  dialog.addEventListener('close', () => {
    closed = true;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    unlockScroll();
    dialog.remove();
  });

  const startDrag = (event) => {
    if (desktopMode || closing || closed) return;
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest('button, a, input, textarea, select')) return;
    event.preventDefault();
    openAnim?.stop();
    panel.style.removeProperty('will-change');
    dialog.classList.add('is-dragging');
    tracking = {
      id: event.pointerId,
      startY: event.clientY,
      startDrag: drag,
      samples: [{ t: performance.now(), y: event.clientY }],
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  };

  function onDragMove(event) {
    if (!tracking || event.pointerId !== tracking.id) return;
    const dy = event.clientY - tracking.startY;
    setDrag(Math.max(0, tracking.startDrag + dy));
    tracking.samples.push({ t: performance.now(), y: event.clientY });
    if (tracking.samples.length > 8) tracking.samples.shift();
  }

  function endDrag(event) {
    if (!tracking || event.pointerId !== tracking.id) return;
    const now = performance.now();
    const samples = tracking.samples.filter((s) => now - s.t < 120);
    const first = samples[0];
    const last = samples[samples.length - 1];
    let velocity = 0;
    if (first && last && last.t > first.t) {
      velocity = ((last.y - first.y) / (last.t - first.t)) * 1000;
    }

    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    tracking = null;
    dialog.classList.remove('is-dragging');

    const height = panelHeight();
    const projected = drag + project(Math.max(0, velocity));
    const shouldDismiss =
      drag > height * 0.32 || velocity > 900 || (velocity > 260 && projected > height * 0.5);

    if (shouldDismiss) {
      close('drag');
      return;
    }

    spring({
      from: drag,
      to: 0,
      velocity: 0,
      response: 0.34,
      damping: 0.86,
      restDelta: 0.35,
      restSpeed: 6,
      onUpdate: setDrag,
    });
  }

  if (!desktopMode) {
    const grip = dialog.querySelector('.sheet-grip');
    const head = dialog.querySelector('.sheet-head');
    grip?.addEventListener('pointerdown', startDrag);
    head?.addEventListener('pointerdown', startDrag);
  }

  if (onMount) onMount({ dialog, bodyEl, footEl, close });

  return { dialog, bodyEl, footEl, close };
}

/* ------------------------------------------------------------- alert */

export function confirmDialog({
  title = '確認',
  message = '',
  confirmLabel = '確定',
  cancelLabel = '取消',
  tone = 'default',
} = {}) {
  return new Promise((resolve) => {
    const titleId = `alert-title-${++dialogSeq}`;
    const dialog = el(`
      <dialog class="alert" role="alertdialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="alert-panel">
          <div class="alert-text">
            <h2 id="${titleId}">${esc(title)}</h2>
            ${message ? `<p>${esc(message)}</p>` : ''}
          </div>
          <div class="alert-actions">
            <button type="button" class="alert-btn" data-act="cancel">${esc(cancelLabel)}</button>
            <button type="button" class="alert-btn alert-btn--primary${
              tone === 'danger' ? ' alert-btn--danger' : ''
            }" data-act="ok">${esc(confirmLabel)}</button>
          </div>
        </div>
      </dialog>
    `);

    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (dialog.open) dialog.close();
    };

    dialog.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false));
    dialog.querySelector('[data-act="ok"]').addEventListener('click', () => finish(true));

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });

    dialog.addEventListener('close', () => {
      dialog.remove();
      unlockScroll();
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    lockScroll();
  });
}

/* ------------------------------------------------------------- download */

export function downloadFile(filename, content, mime = 'application/json;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------- misc */

/** 複製文字；Clipboard API 不可用時退回 textarea + execCommand */
export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* 繼續嘗試備援 */
  }

  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    const host = document.querySelector('dialog[open]') || document.body;
    host.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 把 <input type=file> 包成 Promise */
export function pickFile({ accept = 'image/*', capture = null } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      resolve(file || null);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

/** 產生即時零重編碼預覽 URL */
export function fileToPreviewURL(file) {
  return URL.createObjectURL(file);
}

/** 縮圖 + 轉 dataURL（優先用 createImageBitmap 加速並自動套用 EXIF 方向） */
export async function fileToDataURL(file, maxSize = 1400) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      return canvas.toDataURL('image/jpeg', 0.88);
    } catch {
      /* 退回 Image 解碼 */
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('無法解析圖片'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** 極簡嗶聲，掃到條碼時回饋 */
export function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1180;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
    osc.addEventListener('ended', () => ctx.close());
  } catch {
    /* 靜音失敗不影響流程 */
  }
}

/** 輕量微慶祝粒子爆發（尊重減少動態偏好） */
export function sparkleBurst(targetEl, { color = 'var(--tint)', count = 10 } = {}) {
  if (!targetEl || prefersReducedMotion()) return;
  const rect = targetEl.getBoundingClientRect?.();
  if (!rect || (!rect.width && !rect.height)) return;

  const box = document.createElement('div');
  box.className = 'sparkle-burst';
  box.style.left = `${rect.left + rect.width / 2}px`;
  box.style.top = `${rect.top + rect.height / 2}px`;

  const palette = [color, 'var(--safe)', 'var(--warn)'];
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
    const dist = 24 + Math.random() * 28;
    const dot = document.createElement('span');
    dot.className = 'sparkle-dot';
    dot.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
    dot.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist)}px`);
    dot.style.setProperty('--sp-color', palette[i % palette.length]);
    box.appendChild(dot);
  }

  document.body.appendChild(box);
  setTimeout(() => box.remove(), 680);
}

/** 重觸發數字彈跳動畫 */
export function popNumber(node) {
  if (!node || prefersReducedMotion()) return;
  node.classList.remove('is-popping');
  void node.offsetWidth;
  node.classList.add('is-popping');
}

/** 桌面版滑鼠微傾 3D 與光澤跟隨效果（觸控裝置與減少動態時自動停用） */
export function bindSpotlightCards(root, selector = '.bento-tilt') {
  if (!root || prefersReducedMotion() || !window.matchMedia?.('(hover: hover)').matches) return;
  root.querySelectorAll(selector).forEach((card) => {
    if (card.dataset.tiltBound === '1') return;
    card.dataset.tiltBound = '1';
    card.addEventListener('pointermove', (event) => {
      const r = card.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width));
      const py = Math.max(0, Math.min(1, (event.clientY - r.top) / r.height));
      card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
      card.style.setProperty('--rx', `${((0.5 - py) * 4.4).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${((px - 0.5) * 4.4).toFixed(2)}deg`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
      card.style.removeProperty('--rx');
      card.style.removeProperty('--ry');
    });
  });
}
