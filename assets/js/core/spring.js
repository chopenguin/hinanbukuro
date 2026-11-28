/* 彈簧動畫：參數概念取自 WWDC「Designing Fluid Interfaces」
 * response = 一次來回的時間（秒），damping = 1 無回彈、< 1 有回彈
 */

const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');

export function prefersReducedMotion() {
  return Boolean(motionQuery?.matches);
}

/**
 * 物理彈簧。可中途 stop()，回傳的 promise 會以最後的值結束。
 * @returns {{stop: () => void, promise: Promise<number>, readonly value: number}}
 */
export function spring({
  from = 0,
  to = 1,
  velocity = 0,
  response = 0.35,
  damping = 1,
  mass = 1,
  restDelta = 0.4,
  restSpeed = 0.4,
  onUpdate,
  onComplete,
} = {}) {
  let value = from;
  let v = velocity;
  let frame = 0;
  let finished = false;
  let resolveDone;

  const promise = new Promise((resolve) => {
    resolveDone = resolve;
  });

  if (prefersReducedMotion()) {
    value = to;
    onUpdate?.(to, 0);
    onComplete?.(to);
    resolveDone?.(to);
    return {
      stop() {},
      promise,
      get value() {
        return value;
      },
    };
  }

  const w0 = (2 * Math.PI) / Math.max(0.08, response);
  const k = w0 * w0 * mass;
  const c = 2 * Math.max(0.04, damping) * w0 * mass;

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    value = to;
    v = 0;
    onUpdate?.(to, 0);
    onComplete?.(to);
    resolveDone?.(to);
  };

  let last = performance.now();

  const step = (now) => {
    if (finished) return;
    const dt = Math.min(0.064, Math.max(0, (now - last) / 1000));
    last = now;

    /* 固定小步積分，避免高刷新率或掉幀時發散 */
    let remaining = dt;
    while (remaining > 0.0001) {
      const h = Math.min(1 / 240, remaining);
      const a = (-k * (value - to) - c * v) / mass;
      v += a * h;
      value += v * h;
      remaining -= h;
    }

    onUpdate?.(value, v);

    if (Math.abs(v) < restSpeed && Math.abs(value - to) < restDelta) {
      finish();
      return;
    }
    frame = requestAnimationFrame(step);
  };

  frame = requestAnimationFrame(step);

  return {
    stop() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      onComplete?.(value);
      resolveDone?.(value);
    },
    promise,
    get value() {
      return value;
    },
  };
}

/** 甩出後的慣性距離（px），velocity 單位 px/s */
export function project(velocity, deceleration = 0.998) {
  const d = Math.min(0.9999, Math.max(0.001, deceleration));
  return ((velocity / 1000) * d) / (1 - d);
}

/** 數字滾動（統計卡片用），尊重減少動態偏好 */
export function countUp(node, to, { duration = 640, suffix = '', from = 0 } = {}) {
  if (!node) return () => {};
  const target = Number(to) || 0;

  if (prefersReducedMotion()) {
    node.textContent = `${target}${suffix}`;
    return () => {};
  }

  const start = performance.now();
  let raf = 0;
  let stopped = false;

  const tick = (now) => {
    if (stopped) return;
    const p = Math.min(1, Math.max(0, (now - start) / duration));
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = `${Math.round(from + (target - from) * eased)}${suffix}`;
    if (p < 1) raf = requestAnimationFrame(tick);
    else node.textContent = `${target}${suffix}`;
  };

  raf = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
