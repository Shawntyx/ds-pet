// 渲染进程主逻辑：状态机、像素级点击穿透、拖拽抛出、行走、摸头摸尾巴互动、主进程事件处理。
// 注意：这个文件故意不用 import/export（不当 ES module 用），
// 因为窗口没开 nodeIntegration，浏览器端没有 require，写成普通 <script> 直接跑最省事。
//
// 姿势表/数值表在 poses.ts（POSES），纯几何计算在 geometry.ts（GEOMETRY），
// 由 index.html 按 poses.js → geometry.js → pet.js 的顺序加载。
// 顶层 const 在浏览器里是所有 <script> 共享的，所以这里直接用 POSES / GEOMETRY 就行。
//
// 姿势/区域数值全部来自 ASSETS.md（核对过原项目 whale-moe-core.js 的真实触发逻辑），
// 不是随便猜的，改动前先看那份文档。

// 这个文件不含 import/export，TS 把它当成普通全局脚本处理，
// 所以直接给 Window 接口做声明合并就行，不需要（也不能用）declare global 包一层。
// （类型 PetMenuAction / PresenceState / PetState / ZoneRect 声明在 poses.ts，全局共享。）
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
    onThinkingStart(callback: () => void): void;
    onReply(
      callback: (payload: {
        text: string;
        emotion: string | null;
        pose?: string | null;
        bubble?: boolean;
      }) => void
    ): void;
    onPresence(callback: (presence: PresenceState) => void): void;
    onBalanceLow(callback: (payload: { text: string }) => void): void;
    setAnchor(rect: { dx: number; dy: number; width: number; height: number }): void;
    showBubble(text: string): void;
  };
}

// 运行时代码整体包一层 IIFE：这几个渲染脚本都是全局脚本（没有 import/export），
// 顶层标识符会共享同一个作用域，不包一层的话换个文件写个同名变量就会撞车报错
// （interface/type 声明留在外面，因为要跟全局 Window 接口做声明合并）。
(function () {

const spriteEl = document.getElementById('sprite') as HTMLImageElement;
spriteEl.addEventListener('error', () => console.error('[whale-pet] 立绘加载失败:', spriteEl.src));

let spriteSize = 220;
let workArea = { x: 0, y: 0, width: 1920, height: 1080 };
let posX = 0;
let posY = 0;
let ignoring = true;
let state: PetState = 'idle';
let currentFile = POSES.spriteFiles.idle;
let actionTimer: number | null = null;
/** 主进程推过来的"人在不在"，只有它是 active 时才播随机小动作和走动。 */
let presence: PresenceState = 'active';

// 每张图只解码一次，缓存像素数据用于透明度检测。
const imageDataCache = new Map<string, { data: ImageData; width: number; height: number }>();
const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true })!;

function groundY(): number {
  return GEOMETRY.groundY(workArea, spriteSize);
}

function clampX(x: number): number {
  return GEOMETRY.clampX(x, workArea, spriteSize);
}

function clampY(y: number): number {
  return GEOMETRY.clampY(y, workArea, spriteSize);
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
  // afk/sleep 是静止的睡姿，配上呼吸动画正好；night 是深夜揉眼睛，也顺带呼吸一下。
  const breathe =
    next === 'idle' ||
    next === 'peekLeft' ||
    next === 'peekRight' ||
    next === 'thinking' ||
    next === 'afk' ||
    next === 'sleep' ||
    next === 'night';
  await setSprite(POSES.spriteFiles[next], breathe, next === 'walking');

  // home-peek 头偏大，整体缩小一点，锚点在底部中间（手抓的地方不挪）；其他姿势都是原大小。
  if (next === 'peekHome') {
    spriteEl.style.transformOrigin = 'bottom center';
    spriteEl.style.transform = `scale(${POSES.peek.homeScale})`;
  } else {
    spriteEl.style.transform = '';
    spriteEl.style.transformOrigin = '';
  }

  publishAnchor();
}

/**
 * 告诉主进程"角色实际画面"相对窗口的位置：窗口是个方块，角色周围一圈是透明的，
 * 探头姿势还整体缩小到 0.75 倍。气泡/右键菜单/聊天面板按这个矩形来摆，
 * 才不会飘得离人物很远、或者明明贴边了却没翻到另一边。
 */
function publishAnchor(): void {
  const scale = state === 'peekHome' ? POSES.peek.homeScale : 1;
  const size = spriteSize * scale;
  window.petAPI.setAnchor({
    dx: (spriteSize - size) / 2, // peekHome 时缩放在水平方向居中
    dy: spriteSize - size, // 缩放锚点在底部，所以上边留白
    width: size,
    height: size,
  });
}

/** 演完临时姿势之后要回去的探头姿势（她原来就扒在边缘/底边的话）。 */
let peekToResume: PetState | null = null;

/**
 * 播一个临时姿势，过一会儿自动回到待机（除非中途被拖走了）。
 *
 * keepPoseWhilePeeking=true 是"说话"用的：她正扒在边缘/底边时**保持那个姿势不动**，
 * 只把话冒出来。用户把她拖到角落里本来就是为了让她别乱跑，说句话就站起来再随机走动会很打扰。
 *
 * 互动（摸头/投喂/夸夸…）还是照常换个表情演一下，但演完会回到原来的探头姿势（见 settleIdle），
 * 同样不会站起来到处走。
 */
function playTransient(
  next: PetState,
  durationMs: number,
  bubbleText?: string,
  keepPoseWhilePeeking = false
): void {
  cancelScheduledAction();
  const peeking: PetState | null = PEEK_STATES.includes(state) ? state : null;

  if (keepPoseWhilePeeking && peeking) {
    peekToResume = null;
    if (bubbleText) window.petAPI.showBubble(bubbleText);
    return; // 姿势不动，也不排随机小动作：她就待在那儿
  }

  peekToResume = peeking;
  setState(next);
  if (bubbleText) window.petAPI.showBubble(bubbleText);
  window.setTimeout(() => {
    if (dragging) return; // 反应播完之前用户已经把她拎起来了，别抢状态
    settleIdle();
  }, durationMs);
}

/**
 * 临时姿势演完之后回到"现在该有的状态"：
 *   1) 原来正扒在边缘/底边 → 回到那个探头姿势（不排随机动作，所以她不会跑开）；
 *   2) 用户在电脑前 → 待机 + 排下一个随机小动作；
 *   3) 用户走开了 → 继续趴着/睡着。
 */
function settleIdle(): void {
  if (peekToResume) {
    const peek = peekToResume;
    peekToResume = null;
    setState(peek);
    return;
  }
  const away = presence;
  if (away === 'active') {
    setState('idle');
    scheduleNextAction();
  } else {
    setState(away);
  }
}

function alphaAt(clientX: number, clientY: number): number {
  const cached = imageDataCache.get(currentFile);
  if (!cached) return 0;

  // home-peek 用 CSS transform 整体缩小了（锚点底部居中），点击穿透判定要按同样的变换换算回去，
  // 不然摸不准她、或者穿透区域跟画面对不上。
  const { x, y } =
    state === 'peekHome'
      ? GEOMETRY.peekHomeUntransform(clientX, clientY, spriteSize, POSES.peek.homeScale)
      : { x: clientX, y: clientY };

  const rect = GEOMETRY.containRect(cached.width, cached.height, spriteSize, spriteSize);
  if (x < rect.left || x > rect.left + rect.width || y < rect.top || y > rect.top + rect.height) {
    return 0;
  }
  const px = Math.floor((x - rect.left) / rect.scale);
  const py = Math.floor((y - rect.top) / rect.scale);
  if (px < 0 || py < 0 || px >= cached.width || py >= cached.height) return 0;
  const idx = (py * cached.width + px) * 4 + 3;
  return cached.data.data[idx];
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
    peekToResume = null; // 被拎起来了，之前记的"演完回探头姿势"作废
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
    if (posY >= groundY() + POSES.bottomEdgeThresholdPx) {
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
    triggerReaction(GEOMETRY.zoneAt(dragStart.x, dragStart.y, spriteSize, POSES.zones));
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
  const lines = POSES.reactionBubbles[stateName];
  playTransient(stateName, 1600, lines[Math.floor(Math.random() * lines.length)]);
}

// 菜单里点了投喂/戳一下/夸夸，主进程转发过来。
window.petAPI.onTriggerAction((action) => {
  const lines = POSES.menuActionBubbles[action];
  playTransient(POSES.menuActionState[action], 1600, lines[Math.floor(Math.random() * lines.length)]);
});

// 从隐藏状态召唤回来时打个招呼。
window.petAPI.onShown(() => {
  playTransient('greet', 1400);
});

// 发消息后、模型第一个 token 回来之前：切到思考状态。
// 但她正扒在边缘/底边时不切——保持姿势（用户把她放那儿就是为了别打扰他）。
window.petAPI.onThinkingStart(() => {
  cancelScheduledAction();
  if (PEEK_STATES.includes(state)) return;
  setState('thinking');
});

// 模型回完了（或者聊天面板关闭时补播最新一句）：按情绪标签切表情 + 冒气泡。
// 主动说话（深夜提醒）会额外带一个整张姿势 pose，比情绪标签更贴题，优先用它。
// bubble=false（聊天面板开着的时候）就只换表情、不弹气泡，免得挡着面板。
// 最后一个参数 true：她正扒在边缘/底边时保持不变，只冒气泡（不站起来、不乱走）。
window.petAPI.onReply(({ text, emotion, pose, bubble }) => {
  const next =
    (pose && POSES.poseState[pose]) || (emotion && POSES.emotionState[emotion]) || 'replyHappy';
  const bubbleText = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  playTransient(next, 2400, bubble === false ? undefined : bubbleText || undefined, true);
});

// 余额不足：主进程只在"够用 → 不足"那一刻发一次，这里直接播，不需要去重。
// 同样保持探头姿势：这是系统提醒，不该让她换个地方站着。
window.petAPI.onBalanceLow(({ text }) => {
  playTransient('balanceLow', 5000, text, true);
});

// 用户走开/回来（主进程按系统空闲时间判断，见 src/main/presence.ts）。
window.petAPI.onPresence((next) => {
  const wasAway = presence !== 'active';
  presence = next;

  if (next === 'active') {
    // 只有真的在睡着/趴着时才醒过来打招呼；本来就在活动就什么都不做。
    if (wasAway && (state === 'afk' || state === 'sleep')) {
      playTransient('greet', 1600, POSES.wakeBubbles[Math.floor(Math.random() * POSES.wakeBubbles.length)]);
    }
    return;
  }

  // 走开了：只有站在地上发呆或走路时才切睡姿。拖拽中、扒在边缘、正在播临时反应都不打断，
  // 那些动作演完会走 settleIdle()，到时候自然会跟着趴下。
  if (state !== 'idle' && state !== 'walking') return;
  cancelScheduledAction();
  setState(next);
});

/* ---------------- 抛出物理（重力 + 落地弹跳） ---------------- */

let physicsRaf = 0;

function startThrow(vx: number, vy: number): void {
  peekToResume = null;
  setState('falling');
  // 屏幕像素速度直接用会太夸张，做个衰减；再封顶一次——鼠标/触控板的一次快甩能测出
  // 上万 px/s，实测能把她扔到屏幕上方两万像素处（然后触发下面那个"冻结"问题）。
  const MAX_THROW_SPEED = 2600; // px/s
  const cap = (value: number): number => Math.min(MAX_THROW_SPEED, Math.max(-MAX_THROW_SPEED, value));
  let velX = cap(vx * 0.35);
  let velY = cap(vy * 0.35);
  let lastT = performance.now();
  const gravity = 2200; // px/s^2
  const bounceDamping = 0.45;
  const frictionDamping = 0.7;

  function step(now: number): void {
    const dt = Math.min(0.032, (now - lastT) / 1000);
    lastT = now;

    velY += gravity * dt;
    posX = clampX(posX + velX * dt);
    // 上下边界都在 geometry.bounceVertically 里夹（上面不夹的话她会飞出屏幕上边、
    // 然后因为背景节流把物理循环冻住，永远停在半空——见那个函数的注释）。
    const vertical = GEOMETRY.bounceVertically(posY + velY * dt, velY, workArea, spriteSize, bounceDamping);
    posY = vertical.y;
    velY = vertical.velY;
    if (vertical.bounced) velX *= frictionDamping;
    if (vertical.resting) velX = 0;

    window.petAPI.setWindowPosition(posX, posY);

    const gy = groundY();
    if (posY >= gy && Math.abs(velY) < 5 && Math.abs(velX) < 5) {
      posY = gy;
      window.petAPI.setWindowPosition(posX, posY);
      // 抛出后弹跳/滑动刚好停在边缘：也永久扒着（贴边松手的情况在 mouseup 里已经提前处理了，不会走到这）。
      const side = edgeSideAt(posX);
      if (side) {
        enterPeek(side, true);
      } else {
        settleIdle();
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
  return GEOMETRY.edgeSideAt(x, workArea, spriteSize, POSES.edgeThresholdPx);
}

const PEEK_STATES: PetState[] = ['peekLeft', 'peekRight', 'peekHome'];

/**
 * 进入扒边缘/底边探头姿势。
 * permanent=true（手动拖到边缘松手）：一直保持，不再自动回待机，直到下次被拖走或摸她才会恢复。
 * permanent=false（自己走到边缘触发）：5~10 秒后自动回待机。
 */
function enterPeek(side: 'left' | 'right' | 'bottom', permanent: boolean): void {
  cancelScheduledAction();
  peekToResume = null; // 重新决定扒哪儿，之前记的恢复目标作废
  if (side === 'bottom') {
    posX = clampX(posX); // 水平位置保持拖到哪算哪，只夹一下别出界
    posY = GEOMETRY.peekWindowYBottom(workArea, spriteSize, POSES.peek);
  } else {
    posX = GEOMETRY.peekWindowX(side, workArea, spriteSize, POSES.peek);
    posY = clampY(posY);
  }
  window.petAPI.setWindowPosition(posX, posY);
  setState(side === 'left' ? 'peekLeft' : side === 'right' ? 'peekRight' : 'peekHome');
  if (!permanent) {
    const duration = 5000 + Math.random() * 5000;
    window.setTimeout(() => {
      if (dragging) return;
      if (!PEEK_STATES.includes(state)) return; // 已经被别的交互打断了
      settleIdle();
    }, duration);
  }
}

function runRandomIdleAction(): void {
  // 用户走开了就别再自己动来动去（afk/sleep 是静止姿势，走动会把人吵醒一样奇怪）。
  if (dragging || state === 'falling' || presence !== 'active') return;
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
  const file = POSES.idleActionFiles[Math.floor(Math.random() * POSES.idleActionFiles.length)];
  setSprite(file, true, false);
  window.setTimeout(() => {
    if (dragging) return;
    settleIdle();
  }, 1800 + Math.random() * 1400);
}

/** 走到指定 x 坐标，到了之后调用 onArrive；中途被拖走或用户走开会自动中断（不调用 onArrive）。 */
function walkTo(targetX: number, onArrive: () => void): void {
  const facingLeft = targetX < posX;
  spriteEl.classList.toggle('face-left', facingLeft);
  peekToResume = null;
  setState('walking');
  const speed = 60; // px/s
  let lastT = performance.now();

  function step(now: number): void {
    if (dragging) return; // 被拎起来了，中断走动
    if (presence !== 'active') {
      settleIdle(); // 走到一半用户走开了：就地趴下，别继续挪
      return;
    }
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
    settleIdle();
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
      settleIdle();
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

  await setSprite(POSES.spriteFiles.idle, true, false); // 先把待机图解码缓存好，再叠一下打招呼
  publishAnchor(); // 让主进程先拿到一次画面矩形，气泡/菜单第一次弹就知道该摆哪
  playTransient('greet', 1400);
}

void init();

})();
