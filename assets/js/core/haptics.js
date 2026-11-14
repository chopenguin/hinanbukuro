/* 觸覺回饋：包成語意化的動作，並尊重設定與系統偏好 */
import { getState } from './store.js';

const PATTERNS = {
  light: 8,
  select: 6,
  medium: 16,
  success: [10, 42, 18],
  warn: [18, 60, 18],
};

export function hapticsEnabled() {
  const settings = getState()?.settings || {};
  return settings.haptics !== false;
}

export function haptic(kind = 'light') {
  if (!hapticsEnabled()) return;
  if (!('vibrate' in navigator)) return;
  try {
    navigator.vibrate(PATTERNS[kind] ?? PATTERNS.light);
  } catch {
    /* 不支援就算了 */
  }
}
