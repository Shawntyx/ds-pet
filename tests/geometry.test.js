// 渲染进程几何计算的回归测试（geometry.ts 是纯函数，不依赖 DOM/Electron）。
// 探头留白那几个比例是手工调出来的，这里把算出来的窗口坐标锁住，避免重构时悄悄挪位。
const test = require('node:test');
const assert = require('node:assert');

// geometry.ts 是给浏览器用的全局脚本（顶层 const），为了能在 Node 里测，
// 它额外把 GEOMETRY 挂到了 globalThis 上（浏览器里就是 window）。
require('../dist/renderer/geometry');
const { GEOMETRY } = globalThis;

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const spriteSize = 220;
const padding = { leftPaddingFrac: 0.275, rightPaddingFrac: 0.294, bottomPaddingFrac: 0.096, homeScale: 0.75 };

test('groundY 让脚底贴着工作区底部', () => {
  assert.equal(GEOMETRY.groundY(workArea, spriteSize), 820);
  // 副屏有偏移时也要跟着偏移
  assert.equal(GEOMETRY.groundY({ x: -1920, y: -200, width: 1920, height: 1040 }, spriteSize), 620);
});

test('clampX / clampY 把窗口夹在工作区内', () => {
  assert.equal(GEOMETRY.clampX(-100, workArea, spriteSize), 0);
  assert.equal(GEOMETRY.clampX(5000, workArea, spriteSize), 1700);
  assert.equal(GEOMETRY.clampX(300, workArea, spriteSize), 300);
  assert.equal(GEOMETRY.clampY(5000, workArea, spriteSize), 820);
  assert.equal(GEOMETRY.clampY(-50, workArea, spriteSize), 0);
});

test('探头贴边坐标把素材留白让出去', () => {
  // 这几个数是"像素坐标"，用近似比较（0.275 * 220 这种乘法会有浮点误差）
  const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  // 左边缘：窗口 x 是负的，角色画面才真的贴到屏幕左边
  closeTo(GEOMETRY.peekWindowX('left', workArea, spriteSize, padding), -60.5);
  // 右边缘：窗口 x 超过 workArea 右边界，同理
  closeTo(GEOMETRY.peekWindowX('right', workArea, spriteSize, padding), 1764.68);
  // 底边：地面线再往下让出留白（留白按 homeScale 缩小后的像素算）
  closeTo(GEOMETRY.peekWindowYBottom(workArea, spriteSize, padding), 835.84);
});

test('containRect 处理正方形素材', () => {
  const rect = GEOMETRY.containRect(512, 512, 220, 220);
  assert.equal(rect.left, 0);
  assert.equal(rect.top, 0);
  assert.equal(rect.width, 220);
  assert.equal(rect.height, 220);
  assert.equal(rect.scale, 220 / 512);
});

test('containRect 处理非正方形素材（未来换素材不会算错）', () => {
  const rect = GEOMETRY.containRect(512, 256, 200, 200);
  assert.equal(rect.left, 0);
  assert.equal(rect.top, 50);
  assert.equal(rect.width, 200);
  assert.equal(rect.height, 100);
});

test('edgeSideAt 只在贴边时返回方向', () => {
  assert.equal(GEOMETRY.edgeSideAt(0, workArea, spriteSize, 5), 'left');
  assert.equal(GEOMETRY.edgeSideAt(4, workArea, spriteSize, 5), 'left');
  assert.equal(GEOMETRY.edgeSideAt(1700, workArea, spriteSize, 5), 'right');
  assert.equal(GEOMETRY.edgeSideAt(1697, workArea, spriteSize, 5), 'right');
  assert.equal(GEOMETRY.edgeSideAt(900, workArea, spriteSize, 5), null);
});

test('zoneAt 按 ASSETS.md §0 的顺序判定：尾巴优先，其次肚子，都不命中算头', () => {
  const zones = {
    tail: { x: 0.0, y: 0.78, w: 1.0, h: 0.22 },
    belly: { x: 0.18, y: 0.45, w: 0.64, h: 0.33 },
    head: { x: 0.2, y: 0.0, w: 0.6, h: 0.45 },
  };
  const at = (fx, fy) => GEOMETRY.zoneAt(fx * spriteSize, fy * spriteSize, spriteSize, zones);
  assert.equal(at(0.5, 0.9), 'tail'); // 最下面一条满宽都是尾巴
  assert.equal(at(0.1, 0.9), 'tail'); // 尾巴优先于"算头"
  assert.equal(at(0.5, 0.5), 'belly');
  assert.equal(at(0.05, 0.5), 'head'); // 肚子 x 范围之外落回头
  assert.equal(at(0.5, 0.1), 'head');
  assert.equal(at(0.5, 0.85), 'tail'); // 尾巴和肚子的交界处算尾巴
});

test('peekHome 的坐标反算把"底部中间"当成不动点', () => {
  const bottomCenterX = spriteSize / 2;
  const bottomY = spriteSize;
  const anchor = GEOMETRY.peekHomeUntransform(bottomCenterX, bottomY, spriteSize, padding.homeScale);
  assert.equal(anchor.x, bottomCenterX);
  assert.ok(Math.abs(anchor.y - bottomY) < 1e-9);
  // 窗口顶部那一块在缩小后已经跑到画面外了（算出来是负数 → 不响应鼠标）
  assert.ok(GEOMETRY.peekHomeUntransform(bottomCenterX, 0, spriteSize, padding.homeScale).y < 0);
});
