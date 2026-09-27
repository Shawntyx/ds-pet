// 渲染进程主逻辑：状态机、像素级点击穿透、拖拽抛出、行走、摸头摸尾巴互动。
// 注意：这个文件故意不用 import/export（不当 ES module 用），
// 因为窗口没开 nodeIntegration，浏览器端没有 require，写成普通 <script> 直接跑最省事。

// 这个文件不含 import/export，TS 把它当成普通全局脚本处理，
// 所以直接给 Window 接口做声明合并就行，不需要（也不能用）declare global 包一层。
interface Window {
  petAPI: {
    resolveAsset(filename: string): string;
    setIgnoreMouseEvents(ignore: boolean, forward?: boolean): void;
    setWindowPosition(x: number, y: number): void;
    getWindowPosition(): Promise<{ x: number; y: number }>;
    getWorkArea(): Promise<{ x: number; y: number; width: number; height: number }>;
    getSpriteSize(): Promise<number>;
  };
}

type PetState =
  | 'idle'
  | 'blink'
  | 'tailSwing'
  | 'walking'
  | 'dragging'
  | 'falling'
  | 'petHead'
  | 'petTail'
  | 'pokeBelly';

interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 和 src/shared/types.ts 里的 DEFAULT_ZONES 保持一致（渲染进程不能直接 import 主进程模块，改配置时两边都要改）。
const ZONES: Record<'head' | 'tail' | 'belly', ZoneRect> = {
  head: { x: 0.28, y: 0.0, w: 0.44, h: 0.28 },
  tail: { x: 0.62, y: 0.35, w: 0.36, h: 0.35 },
  belly: { x: 0.3, y: 0.42, w: 0.4, h: 0.3 },
};

const SPRITE_FILES: Record<PetState, string> = {
  idle: 'dsh-whale-state-idle-cute.webp',
  blink: 'dsh-whale-state-wink.webp',
  tailSwing: 'dsh-whale-state-tail-swing.webp',
  walking: 'dsh-whale-state-running.webp',
  dragging: 'dsh-whale-state-pick-up.webp',
  falling: 'dsh-whale-state-pick-up.webp',
  petHead: 'dsh-whale-state-react-head.webp',
  petTail: 'dsh-whale-state-react-tail.webp',
  pokeBelly: 'dsh-whale-state-react-belly.webp',
};

const REACTION_BUBBLES: Record<'petHead' | 'petTail' | 'pokeBelly', string[]> = {
  petHead: ['诶、诶？！', '别、别乱摸啦…', '哼，心情变好了一点点'],
  petTail: ['尾巴不可以随便碰！', '呜哇！', '…其实还挺舒服的'],
  pokeBelly: ['肚、肚子不可以戳！', '嗯啊！？', '别戳啦，会笑出来的'],
};

const spriteEl = document.getElementById('sprite') as HTMLImageElement;
const bubbleEl = document.getElementById('bubble') as HTMLDivElement;
spriteEl.addEventListener('error', () => console.error('[whale-pet] 立绘加载失败:', spriteEl.src));

let spriteSize = 220;
let workArea = { x: 0, y: 0, width: 1920, height: 1080 };
let posX = 0;
let posY = 0;
let ignoring = true;
let state: PetState = 'idle';
let bubbleTimer: number | null = null;
let actionTimer: number | null = null;

// 每张图只解码一次，缓存像素数据用于透明度检测。
const imageDataCache = new Map<string, { data: ImageData; width: number; height: number }>();
const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true })!;

function groundY(): number {
  return workArea.y + workArea.height - spriteSize;
}

function clampX(x: number): number {
  return Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - spriteSize);
}

async function setState(next: PetState): Promise<void> {
  state = next;
  const filename = SPRITE_FILES[next];
  spriteEl.src = window.petAPI.resolveAsset(filename);

  spriteEl.classList.toggle('anim-breathe', next === 'idle');
  spriteEl.classList.toggle('anim-walk-bob', next === 'walking');

  if (!imageDataCache.has(filename)) {
    await new Promise<void>((resolve) => {
      if (spriteEl.complete && spriteEl.naturalWidth > 0) return resolve();
      spriteEl.addEventListener('load', () => resolve(), { once: true });
    });
    const w = spriteEl.naturalWidth;
    const h = spriteEl.naturalHeight;
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
    offscreenCtx.clearRect(0, 0, w, h);
    offscreenCtx.drawImage(spriteEl, 0, 0, w, h);
    imageDataCache.set(filename, { data: offscreenCtx.getImageData(0, 0, w, h), width: w, height: h });
  }
}

function showBubble(text: string): void {
  if (bubbleTimer !== null) window.clearTimeout(bubbleTimer);
  bubbleEl.textContent = text;
  bubbleEl.classList.remove('hidden');
  // 强制 reflow 让 opacity 过渡生效
  void bubbleEl.offsetWidth;
  bubbleEl.classList.add('show');
  bubbleTimer = window.setTimeout(() => {
    bubbleEl.classList.remove('show');
    window.setTimeout(() => bubbleEl.classList.add('hidden'), 200);
  }, 2200);
}

/** object-fit: contain 下，图片实际渲染的矩形（相对窗口左上角）。 */
function containRect(natW: number, natH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / natW, boxH / natH);
  const width = natW * scale;
  const height = natH * scale;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height, scale };
}

function alphaAt(clientX: number, clientY: number): number {
  const cached = imageDataCache.get(SPRITE_FILES[state]);
  if (!cached) return 0;
  const rect = containRect(cached.width, cached.height, spriteSize, spriteSize);
  if (
    clientX < rect.left ||
    clientX > rect.left + rect.width ||
    clientY < rect.top ||
    clientY > rect.top + rect.height
  ) {
    return 0;
  }
  const px = Math.floor((clientX - rect.left) / rect.scale);
  const py = Math.floor((clientY - rect.top) / rect.scale);
  if (px < 0 || py < 0 || px >= cached.width || py >= cached.height) return 0;
  const idx = (py * cached.width + px) * 4 + 3;
  return cached.data.data[idx];
}

function zoneAt(clientX: number, clientY: number): 'head' | 'tail' | 'belly' | null {
  const fx = clientX / spriteSize;
  const fy = clientY / spriteSize;
  for (const key of ['head', 'tail', 'belly'] as const) {
    const z = ZONES[key];
    if (fx >= z.x && fx <= z.x + z.w && fy >= z.y && fy <= z.y + z.h) return key;
  }
  return null;
}

/* ---------------- 鼠标事件 / 点击穿透 ---------------- */

let pointerDown = false;
let dragging = false;
let dragStart = { x: 0, y: 0, screenX: 0, screenY: 0 };
let posX0 = 0;
let posY0 = 0;
const velocitySamples: { x: number; y: number; t: number }[] = [];
const DRAG_THRESHOLD_PX = 6;

// 鼠标不在角色不透明像素上时，让窗口整体穿透点击；移回来时恢复响应。
window.addEventListener('mousemove', (e) => {
  if (pointerDown) return; // 拖拽/判定期间不做透明度检测，避免和下面的处理打架
  const alpha = alphaAt(e.clientX, e.clientY);
  const shouldIgnore = alpha < 10;
  if (shouldIgnore !== ignoring) {
    ignoring = shouldIgnore;
    window.petAPI.setIgnoreMouseEvents(ignoring, true);
  }
});

window.addEventListener('mousedown', (e) => {
  if (ignoring) return; // 理论上穿透状态下不会收到 mousedown，双重保险
  pointerDown = true;
  dragging = false;
  dragStart = { x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY };
  posX0 = posX;
  posY0 = posY;
  velocitySamples.length = 0;
  velocitySamples.push({ x: e.screenX, y: e.screenY, t: performance.now() });
});

window.addEventListener('mousemove', (e) => {
  if (!pointerDown) return;
  const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
  if (!dragging && moved > DRAG_THRESHOLD_PX) {
    dragging = true;
    cancelScheduledAction();
    setState('dragging');
  }
  if (dragging) {
    const dx = e.screenX - dragStart.screenX;
    const dy = e.screenY - dragStart.screenY;
    posX = posX0 + dx;
    posY = posY0 + dy;
    window.petAPI.setWindowPosition(posX, posY);
    velocitySamples.push({ x: e.screenX, y: e.screenY, t: performance.now() });
    if (velocitySamples.length > 6) velocitySamples.shift();
  }
});

window.addEventListener('mouseup', () => {
  if (!pointerDown) return;
  pointerDown = false;
  if (dragging) {
    dragging = false;
    const samples = velocitySamples;
    let vx = 0;
    let vy = 0;
    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = Math.max(1, last.t - first.t) / 1000;
      vx = (last.x - first.x) / dt;
      vy = (last.y - first.y) / dt;
    }
    startThrow(vx, vy);
  } else {
    const zone = zoneAt(dragStart.x, dragStart.y);
    if (zone) triggerReaction(zone);
    else quickBlink();
  }
});

function triggerReaction(zone: 'head' | 'tail' | 'belly'): void {
  cancelScheduledAction();
  const stateName: 'petHead' | 'petTail' | 'pokeBelly' =
    zone === 'head' ? 'petHead' : zone === 'tail' ? 'petTail' : 'pokeBelly';
  setState(stateName);
  const lines = REACTION_BUBBLES[stateName];
  showBubble(lines[Math.floor(Math.random() * lines.length)]);
  window.setTimeout(() => {
    if (dragging) return; // 反应播完之前用户已经把她拎起来了，别抢状态
    setState('idle');
    scheduleNextAction();
  }, 1600);
}

function quickBlink(): void {
  cancelScheduledAction();
  setState('blink');
  window.setTimeout(() => {
    if (dragging) return;
    setState('idle');
    scheduleNextAction();
  }, 500);
}

/* ---------------- 抛出物理（重力 + 落地弹跳） ---------------- */

let physicsRaf = 0;

function startThrow(vx: number, vy: number): void {
  setState('falling');
  let velX = vx * 0.35; // 屏幕像素速度直接用会太夸张，做个衰减
  let velY = vy * 0.35;
  let lastT = performance.now();
  const gravity = 2200; // px/s^2
  const bounceDamping = 0.45;
  const frictionDamping = 0.7;

  function step(now: number): void {
    const dt = Math.min(0.032, (now - lastT) / 1000);
    lastT = now;

    velY += gravity * dt;
    posX = clampX(posX + velX * dt);
    posY = posY + velY * dt;

    const gy = groundY();
    if (posY >= gy) {
      posY = gy;
      if (Math.abs(velY) > 60) {
        velY = -velY * bounceDamping;
        velX *= frictionDamping;
      } else {
        velY = 0;
        velX = 0;
      }
    }

    window.petAPI.setWindowPosition(posX, posY);

    if (posY >= gy && Math.abs(velY) < 5 && Math.abs(velX) < 5) {
      posY = gy;
      window.petAPI.setWindowPosition(posX, posY);
      setState('idle');
      scheduleNextAction();
      return;
    }
    physicsRaf = requestAnimationFrame(step);
  }

  cancelAnimationFrame(physicsRaf);
  physicsRaf = requestAnimationFrame(step);
}

/* ---------------- 待机小动作 + 随机走动 ---------------- */

function cancelScheduledAction(): void {
  if (actionTimer !== null) {
    window.clearTimeout(actionTimer);
    actionTimer = null;
  }
}

function scheduleNextAction(): void {
  cancelScheduledAction();
  const delay = 4000 + Math.random() * 6000;
  actionTimer = window.setTimeout(runRandomIdleAction, delay);
}

function runRandomIdleAction(): void {
  if (dragging || state === 'falling') return;
  const roll = Math.random();
  if (roll < 0.35) {
    quickBlink();
  } else if (roll < 0.55) {
    setState('tailSwing');
    window.setTimeout(() => {
      if (dragging) return;
      setState('idle');
      scheduleNextAction();
    }, 700);
  } else {
    walkToRandomSpot();
  }
}

function walkToRandomSpot(): void {
  const targetX = clampX(workArea.x + Math.random() * workArea.width);
  const facingLeft = targetX < posX;
  spriteEl.classList.toggle('face-left', facingLeft);
  setState('walking');
  const speed = 60; // px/s
  let lastT = performance.now();

  function step(now: number): void {
    if (dragging) return; // 被拎起来了，中断走动
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const dir = targetX > posX ? 1 : -1;
    posX = clampX(posX + dir * speed * dt);
    posY = groundY();
    window.petAPI.setWindowPosition(posX, posY);
    if (Math.abs(targetX - posX) < 2) {
      spriteEl.classList.remove('face-left');
      setState('idle');
      scheduleNextAction();
      return;
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------------- 启动 ---------------- */

async function init(): Promise<void> {
  spriteSize = await window.petAPI.getSpriteSize();
  workArea = await window.petAPI.getWorkArea();
  const pos = await window.petAPI.getWindowPosition();
  posX = pos.x;
  posY = pos.y;

  document.getElementById('stage')!.style.width = `${spriteSize}px`;
  document.getElementById('stage')!.style.height = `${spriteSize}px`;

  await setState('idle');
  scheduleNextAction();
}

void init();
