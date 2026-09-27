// 渲染进程主逻辑：状态机、像素级点击穿透、拖拽抛出、行走、摸头摸尾巴互动、右键菜单。
// 注意：这个文件故意不用 import/export（不当 ES module 用），
// 因为窗口没开 nodeIntegration，浏览器端没有 require，写成普通 <script> 直接跑最省事。
//
// 姿势/区域数值全部来自 ASSETS.md（核对过原项目 whale-moe-core.js 的真实触发逻辑），
// 不是随便猜的，改动前先看那份文档。

// 这个文件不含 import/export，TS 把它当成普通全局脚本处理，
// 所以直接给 Window 接口做声明合并就行，不需要（也不能用）declare global 包一层。
type PetMenuAction = 'feed' | 'poke' | 'praise';

interface Window {
  petAPI: {
    resolveAsset(filename: string): string;
    setIgnoreMouseEvents(ignore: boolean, forward?: boolean): void;
    setWindowPosition(x: number, y: number): void;
    getWindowPosition(): Promise<{ x: number; y: number }>;
    getWorkArea(): Promise<{ x: number; y: number; width: number; height: number }>;
    getSpriteSize(): Promise<number>;
    requestContextMenu(): void;
    onTriggerAction(callback: (action: PetMenuAction) => void): void;
    onShown(callback: () => void): void;
  };
}

// 会持续跟踪/参与逻辑判断的"命名状态"；随机待机小动作池里的姿势不需要进这个枚举，
// 直接用文件名播放就行（见 IDLE_ACTION_FILES）。
type PetState =
  | 'idle'
  | 'walking'
  | 'dragging'
  | 'falling'
  | 'petHead'
  | 'petTail'
  | 'pokeBelly'
  | 'greet'
  | 'eat'
  | 'angry'
  | 'praise'
  | 'peekLeft'
  | 'peekRight'
  | 'peekHome';

interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 和 src/shared/types.ts 里的 DEFAULT_ZONES 保持一致（渲染进程不能直接 import 主进程模块，改配置时两边都要改）。
// 数值来自 ASSETS.md §0：先匹配尾巴（贴底部满宽），再匹配肚子，都不命中算头。
const ZONES: Record<'head' | 'tail' | 'belly', ZoneRect> = {
  tail: { x: 0.0, y: 0.78, w: 1.0, h: 0.22 },
  belly: { x: 0.18, y: 0.45, w: 0.64, h: 0.33 },
  head: { x: 0.2, y: 0.0, w: 0.6, h: 0.45 },
};

const SPRITE_FILES: Record<PetState, string> = {
  idle: 'dsh-whale-state-idle-cute.webp',
  // running.webp 画的其实是"抱着笔记本电脑"，是阶段 2/3 的"工作中"姿势，不是走路动画，
  // 这里素材没有专门的走路姿势，就用待机图 + CSS 上下晃动凑一个走路的感觉。
  walking: 'dsh-whale-state-idle-cute.webp',
  dragging: 'dsh-whale-state-pick-up.webp',
  falling: 'dsh-whale-state-pick-up.webp',
  petHead: 'dsh-whale-state-react-head.webp',
  petTail: 'dsh-whale-state-react-tail.webp',
  pokeBelly: 'dsh-whale-state-react-belly.webp',
  greet: 'dsh-whale-state-greet.webp',
  eat: 'dsh-whale-state-eat.webp',
  angry: 'dsh-whale-state-angry.webp',
  praise: 'dsh-whale-state-tail-swing.webp',
  // ASSETS.md §10：settings-peek 扒左边缘，workbench-peek 扒右边缘，home-peek 扒底边/任务栏。
  peekLeft: 'dsh-whale-settings-peek.webp',
  peekRight: 'dsh-whale-workbench-peek.webp',
  peekHome: 'dsh-whale-home-peek.webp',
};

/** 离左/右边缘多近算"在边缘"，用于判断要不要触发探头。 */
const EDGE_THRESHOLD_PX = 5;
/** 往下拖超过正常站立线（groundY）多少像素算"拖到底边"，触发 home-peek。 */
const BOTTOM_EDGE_THRESHOLD_PX = 10;

// 探头素材自己带了对称留白，不是紧贴画布边缘画的——用 canvas 扫过 alpha 边界实测出来的：
//   settings-peek（左边缘）：不透明内容在画布 25.8%~73.6% 之间
//   workbench-peek（右边缘）：不透明内容在画布 27.7%~72.3% 之间
//   home-peek（底边）：peek-calibration.json 里 padBottom=40/512≈7.8%
// 如果贴边效果还是不对（离屏幕边缘有空隙，或者反而探出去太多），直接改这几个比例就行：
// 数值越大 = 角色往屏幕外挪得越多（留白让得越多）；改完不用重新量，改完 npm run build 重启看效果。
const PEEK_LEFT_PADDING_FRAC = 0.275;  // 优化后的，除非有其他需求不然不用改
const PEEK_RIGHT_PADDING_FRAC = 0.294; // 同上
const PEEK_BOTTOM_PADDING_FRAC = 0.103; // 同上

// home-peek 是近景构图（只画头+手），头在 512×512 画布里占比比 idle-cute（全身构图）大很多，
// 所以哪怕窗口一样大，头看起来也明显更大。这里把整张图整体缩小一点，
// 缩放锚点定在窗口底部中间（正好是手扒着的地方），这样缩小后手还是贴着任务栏，只是头变小。
// 数值越小头越小；调这个数不用管 PEEK_BOTTOM_PADDING_FRAC，位置计算会自动跟着缩放比例走。
const PEEK_HOME_SCALE = 0.75;

// ASSETS.md §3：待机时随机轮换的小动作池，播几秒后回到 idle-cute。
const IDLE_ACTION_FILES = [
  'dsh-whale-state-daily-eat.webp',
  'dsh-whale-state-daily-coffee.webp',
  'dsh-whale-state-daily-stretch.webp',
  'dsh-whale-state-daily-pajama.webp',
  'dsh-whale-state-daily-shower.webp',
  'dsh-whale-state-cool-shades.webp',
  'dsh-whale-state-meme-smug.webp',
  'dsh-whale-state-daily-picnic.webp',
  'dsh-whale-state-daily-cooking.webp',
  'dsh-whale-state-daily-fishing.webp',
  'dsh-whale-state-daily-painting.webp',
  'dsh-whale-state-daily-gaming.webp',
  'dsh-whale-state-tail-swing.webp',
  'dsh-whale-state-meme-music.webp',
  'dsh-whale-state-wink.webp',
];

const REACTION_BUBBLES: Record<'petHead' | 'petTail' | 'pokeBelly', string[]> = {
  petHead: ['诶、诶？！', '别、别乱摸啦…', '哼，心情变好了一点点'],
  petTail: ['尾巴不可以随便碰！', '呜哇！', '…其实还挺舒服的'],
  pokeBelly: ['肚、肚子不可以戳！', '嗯啊！？', '别戳啦，会笑出来的'],
};

const MENU_ACTION_STATE: Record<PetMenuAction, PetState> = {
  feed: 'eat',
  poke: 'angry',
  praise: 'praise',
};

const MENU_ACTION_BUBBLES: Record<PetMenuAction, string[]> = {
  feed: ['谢谢投喂～', '好吃！', '还要还要'],
  poke: ['诶，戳我干嘛！', '呜——', '别戳啦'],
  praise: ['嘿嘿，谢谢夸奖～', '哼，就知道一点点开心', '再多夸夸我嘛'],
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
let currentFile = SPRITE_FILES.idle;
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

function clampY(y: number): number {
  return Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - spriteSize);
}

/** 探头贴边时窗口该放的 x：把素材里留白也算进去，让角色实际画面贴到屏幕真边缘。 */
function peekWindowX(side: 'left' | 'right'): number {
  if (side === 'left') return workArea.x - PEEK_LEFT_PADDING_FRAC * spriteSize;
  return workArea.x + workArea.width - spriteSize + PEEK_RIGHT_PADDING_FRAC * spriteSize;
}

/** home-peek 贴底边时窗口该放的 y，同样把底部留白让出去；整体缩小后留白的实际像素也跟着变小。 */
function peekWindowYBottom(): number {
  return groundY() + PEEK_BOTTOM_PADDING_FRAC * PEEK_HOME_SCALE * spriteSize;
}

/** 切换当前显示的立绘文件；state 之外的临时姿势（待机小动作池）也走这个函数。 */
async function setSprite(filename: string, breathe: boolean, walkBob: boolean): Promise<void> {
  currentFile = filename;
  spriteEl.src = window.petAPI.resolveAsset(filename);
  spriteEl.classList.toggle('anim-breathe', breathe);
  spriteEl.classList.toggle('anim-walk-bob', walkBob);

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

async function setState(next: PetState): Promise<void> {
  state = next;
  // 呼吸动画靠 CSS keyframes 改 transform，和下面手动设的 scale() 会互相覆盖，
  // 所以 peekHome 不叠加呼吸动画（反正这个姿势本来就是静止扒着，不呼吸也没关系）。
  const breathe = next === 'idle' || next === 'peekLeft' || next === 'peekRight';
  await setSprite(SPRITE_FILES[next], breathe, next === 'walking');

  // home-peek 头偏大，整体缩小一点，锚点在底部中间（手抓的地方不挪）；其他姿势都是原大小。
  if (next === 'peekHome') {
    spriteEl.style.transformOrigin = 'bottom center';
    spriteEl.style.transform = `scale(${PEEK_HOME_SCALE})`;
  } else {
    spriteEl.style.transform = '';
    spriteEl.style.transformOrigin = '';
  }
}

/** 播一个临时姿势，过一会儿自动回到待机（除非中途被拖走了）。 */
function playTransient(next: PetState, durationMs: number, bubbleText?: string): void {
  cancelScheduledAction();
  setState(next);
  if (bubbleText) showBubble(bubbleText);
  window.setTimeout(() => {
    if (dragging) return; // 反应播完之前用户已经把她拎起来了，别抢状态
    setState('idle');
    scheduleNextAction();
  }, durationMs);
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

/** object-fit: contain 下，图片实际渲染的矩形（相对窗口左上角）。素材都是 512×512 正方形，
 * 和正方形窗口同比例，理论上不会有留白，这里还是按通用公式算，换非正方形素材也不会错。 */
function containRect(natW: number, natH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / natW, boxH / natH);
  const width = natW * scale;
  const height = natH * scale;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height, scale };
}

function alphaAt(clientX: number, clientY: number): number {
  const cached = imageDataCache.get(currentFile);
  if (!cached) return 0;

  // home-peek 用 CSS transform 整体缩小了（锚点底部居中），点击穿透判定要按同样的变换换算回去，
  // 不然摸不准她、或者穿透区域跟画面对不上。
  let x = clientX;
  let y = clientY;
  if (state === 'peekHome') {
    x = (clientX - spriteSize / 2) / PEEK_HOME_SCALE + spriteSize / 2;
    y = (clientY - spriteSize * (1 - PEEK_HOME_SCALE)) / PEEK_HOME_SCALE;
  }

  const rect = containRect(cached.width, cached.height, spriteSize, spriteSize);
  if (x < rect.left || x > rect.left + rect.width || y < rect.top || y > rect.top + rect.height) {
    return 0;
  }
  const px = Math.floor((x - rect.left) / rect.scale);
  const py = Math.floor((y - rect.top) / rect.scale);
  if (px < 0 || py < 0 || px >= cached.width || py >= cached.height) return 0;
  const idx = (py * cached.width + px) * 4 + 3;
  return cached.data.data[idx];
}

/** ASSETS.md §0：先匹配尾巴，再匹配肚子，都不命中算头——所以这里永远有返回值，不会是 null。 */
function zoneAt(clientX: number, clientY: number): 'head' | 'tail' | 'belly' {
  const fx = clientX / spriteSize;
  const fy = clientY / spriteSize;
  if (fy >= ZONES.tail.y) return 'tail';
  const b = ZONES.belly;
  if (fy >= b.y && fx >= b.x && fx <= b.x + b.w) return 'belly';
  return 'head';
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
  if (e.button !== 0) return; // 右键留给右键菜单，不进拖拽判定
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
    // 往下拖过正常站立线：直接原地扒着底边探头（home-peek），不用先掉到地上。
    if (posY >= groundY() + BOTTOM_EDGE_THRESHOLD_PX) {
      enterPeek('bottom', true);
      return;
    }
    // 贴着左右边缘松手：不管当时多高，直接原地扒着探头，不用先掉到地上再判定。
    const edgeSide = edgeSideAt(posX);
    if (edgeSide) {
      enterPeek(edgeSide, true);
      return;
    }
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
    triggerReaction(zoneAt(dragStart.x, dragStart.y));
  }
});

// 右键：只在不透明像素上（即没穿透时）弹自绘菜单，阻止系统右键菜单。
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (ignoring) return;
  window.petAPI.requestContextMenu();
});

function triggerReaction(zone: 'head' | 'tail' | 'belly'): void {
  const stateName: 'petHead' | 'petTail' | 'pokeBelly' =
    zone === 'head' ? 'petHead' : zone === 'tail' ? 'petTail' : 'pokeBelly';
  const lines = REACTION_BUBBLES[stateName];
  playTransient(stateName, 1600, lines[Math.floor(Math.random() * lines.length)]);
}

// 菜单里点了投喂/戳一下/夸夸，主进程转发过来。
window.petAPI.onTriggerAction((action) => {
  const lines = MENU_ACTION_BUBBLES[action];
  playTransient(MENU_ACTION_STATE[action], 1600, lines[Math.floor(Math.random() * lines.length)]);
});

// 从隐藏状态召唤回来时打个招呼。
window.petAPI.onShown(() => {
  playTransient('greet', 1400);
});

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
      // 抛出后弹跳/滑动刚好停在边缘：也永久扒着（贴边松手的情况在 mouseup 里已经提前处理了，不会走到这）。
      const side = edgeSideAt(posX);
      if (side) {
        enterPeek(side, true);
      } else {
        setState('idle');
        scheduleNextAction();
      }
      return;
    }
    physicsRaf = requestAnimationFrame(step);
  }

  cancelAnimationFrame(physicsRaf);
  physicsRaf = requestAnimationFrame(step);
}

/* ---------------- 待机小动作 + 随机走动 + 扒边缘探头 ---------------- */

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

/** 贴不贴着左/右边缘，用于判断要不要探头。不是边缘返回 null。 */
function edgeSideAt(x: number): 'left' | 'right' | null {
  if (x - workArea.x <= EDGE_THRESHOLD_PX) return 'left';
  if (workArea.x + workArea.width - spriteSize - x <= EDGE_THRESHOLD_PX) return 'right';
  return null;
}

const PEEK_STATES: PetState[] = ['peekLeft', 'peekRight', 'peekHome'];

/**
 * 进入扒边缘/底边探头姿势。
 * permanent=true（手动拖到边缘松手）：一直保持，不再自动回待机，直到下次被拖走或摸她才会恢复。
 * permanent=false（自己走到边缘触发）：5~10 秒后自动回待机。
 */
function enterPeek(side: 'left' | 'right' | 'bottom', permanent: boolean): void {
  cancelScheduledAction();
  if (side === 'bottom') {
    posX = clampX(posX); // 水平位置保持拖到哪算哪，只夹一下别出界
    posY = peekWindowYBottom();
  } else {
    posX = peekWindowX(side);
    posY = clampY(posY);
  }
  window.petAPI.setWindowPosition(posX, posY);
  setState(side === 'left' ? 'peekLeft' : side === 'right' ? 'peekRight' : 'peekHome');
  if (!permanent) {
    const duration = 5000 + Math.random() * 5000;
    window.setTimeout(() => {
      if (dragging) return;
      if (!PEEK_STATES.includes(state)) return; // 已经被别的交互打断了
      setState('idle');
      scheduleNextAction();
    }, duration);
  }
}

function runRandomIdleAction(): void {
  if (dragging || state === 'falling') return;
  const roll = Math.random();
  if (roll < 0.5) {
    playIdlePoolAction();
  } else if (roll < 0.7) {
    walkToEdge();
  } else {
    walkToRandomSpot();
  }
}

function playIdlePoolAction(): void {
  cancelScheduledAction();
  const file = IDLE_ACTION_FILES[Math.floor(Math.random() * IDLE_ACTION_FILES.length)];
  setSprite(file, true, false);
  window.setTimeout(() => {
    if (dragging) return;
    setState('idle');
    scheduleNextAction();
  }, 1800 + Math.random() * 1400);
}

/** 走到指定 x 坐标，到了之后调用 onArrive；中途被拖走会自动中断（不调用 onArrive）。 */
function walkTo(targetX: number, onArrive: () => void): void {
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
      onArrive();
      return;
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function walkToRandomSpot(): void {
  const targetX = clampX(workArea.x + Math.random() * workArea.width);
  walkTo(targetX, () => {
    setState('idle');
    scheduleNextAction();
  });
}

/** 特意走到屏幕左或右边缘；到了以后 10% 概率扒着探头，5~10 秒后自己回待机。 */
function walkToEdge(): void {
  const side: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
  const targetX = side === 'left' ? workArea.x : workArea.x + workArea.width - spriteSize;
  walkTo(targetX, () => {
    if (Math.random() < 0.1) {
      enterPeek(side, false);
    } else {
      setState('idle');
      scheduleNextAction();
    }
  });
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

  await setSprite(SPRITE_FILES.idle, true, false); // 先把待机图解码缓存好，再叠一下打招呼
  playTransient('greet', 1400);
}

void init();
