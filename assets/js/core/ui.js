/* 共用 UI：toast、底部面板、確認框、小工具 */

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

/* ------------------------------------------------------------- toast */

export function toast(message, { type = 'ok', duration = 2400 } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const node = el(`<div class="toast toast--${type}">${esc(message)}</div>`);
  root.appendChild(node);
  setTimeout(() => {
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  }, duration);
}

/* ------------------------------------------------------------- sheet */

/**
 * 底部面板。body / foot 可傳 HTML 字串或 DOM 節點。
 * @returns {{dialog: HTMLDialogElement, close: Function, bodyEl: HTMLElement, footEl: HTMLElement}}
 */
export function openSheet({ title = '', body = '', foot = '', onMount, labelledBy } = {}) {
  const dialog = el(`
    <dialog class="sheet" aria-modal="true">
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 id="sheet-title">${esc(title)}</h2>
        <button type="button" class="sheet-close" aria-label="關閉">×</button>
      </div>
      <div class="sheet-body"></div>
      <div class="sheet-foot"></div>
    </dialog>
  `);

  const bodyEl = dialog.querySelector('.sheet-body');
  const footEl = dialog.querySelector('.sheet-foot');

  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  if (typeof foot === 'string') footEl.innerHTML = foot;
  else if (foot) footEl.appendChild(foot);
  else footEl.remove();

  if (!title) dialog.querySelector('.sheet-head').remove();
  if (labelledBy) dialog.setAttribute('aria-labelledby', labelledBy);

  const close = (value) => {
    if (dialog.open) dialog.close(value || '');
  };

  dialog.querySelector('.sheet-close')?.addEventListener('click', () => close('cancel'));

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close('cancel');
  });

  dialog.addEventListener('close', () => {
    dialog.remove();
  });

  document.body.appendChild(dialog);
  dialog.showModal();

  if (onMount) onMount({ dialog, bodyEl, footEl, close });

  return { dialog, bodyEl, footEl, close };
}

export function confirmDialog({
  title = '確認',
  message = '',
  confirmLabel = '確定',
  cancelLabel = '取消',
  tone = 'default',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const { dialog } = openSheet({
      title,
      body: `<p class="muted" style="font-size:13.5px;line-height:1.85">${esc(message)}</p>`,
      foot: `
        <button type="button" class="btn btn--ghost" data-act="cancel">${esc(cancelLabel)}</button>
        <button type="button" class="btn ${tone === 'danger' ? 'btn--primary' : 'btn--primary'}" data-act="ok">${esc(confirmLabel)}</button>
      `,
      onMount({ footEl, close }) {
        footEl.querySelector('[data-act="cancel"]').addEventListener('click', () => {
          settled = true;
          close('cancel');
          resolve(false);
        });
        footEl.querySelector('[data-act="ok"]').addEventListener('click', () => {
          settled = true;
          close('ok');
          resolve(true);
        });
      },
    });
    dialog.addEventListener('close', () => {
      if (!settled) resolve(false);
    });
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

/** 縮圖 + 轉 dataURL，降低 OCR 負擔 */
export function fileToDataURL(file, maxSize = 1400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('無法解析圖片'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
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

export function vibrate(pattern = 24) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* noop */
    }
  }
}
