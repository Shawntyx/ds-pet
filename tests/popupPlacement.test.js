// 气泡/面板摆位的纯函数测试：这是用户实际能看到的 bug 高发区
// （"气泡飘得离人物很远""贴着屏幕边就被切掉"）。
const test = require('node:test');
const assert = require('node:assert');

const { placeBubble, placeSidePanel } = require('../dist/main/popupPlacement');

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const bubble = { width: 220, height: 130 };
const panel = { width: 168, height: 320 };

/** 人物站在屏幕底部中间的 anchor（220 宽，底边贴着工作区底部）。 */
const bottomCenter = { x: 850, y: 820, width: 220, height: 220 };

test('人物在屏幕中间：气泡摆正上方、水平居中', () => {
  const { x, y } = placeBubble(bottomCenter, workArea, bubble);
  assert.equal(x, 850 + 110 - 110);
  assert.equal(y, 820 - 130 - 8);
});

test('人物贴着左边缘：气泡改摆到右边', () => {
  const anchor = { x: -60, y: 820, width: 220, height: 220 }; // 扒左边缘探头时窗口 x 是负的
  const { x, y } = placeBubble(anchor, workArea, bubble);
  assert.ok(x >= 0, `气泡不该跑到屏幕外: ${x}`);
  assert.equal(x, anchor.x + anchor.width + 8);
  assert.ok(y >= workArea.y && y + bubble.height <= workArea.y + workArea.height);
});

test('人物贴着右边缘：气泡改摆到左边', () => {
  const anchor = { x: 1700, y: 820, width: 220, height: 220 };
  const { x } = placeBubble(anchor, workArea, bubble);
  assert.equal(x, 1700 - 220 - 8);
  assert.ok(x + bubble.width <= workArea.x + workArea.width);
});

test('人物贴左边缘且两侧都很窄时也不会越界', () => {
  const narrow = { x: 0, y: 0, width: 300, height: 400 };
  const anchor = { x: 0, y: 180, width: 120, height: 120 };
  const { x, y } = placeBubble(anchor, narrow, bubble);
  assert.ok(x >= narrow.x, `x=${x}`);
  assert.ok(x + bubble.width <= narrow.x + narrow.width, `右边越界: ${x + bubble.width}`);
  assert.ok(y >= narrow.y && y + bubble.height <= narrow.y + narrow.height);
});

test('人物在屏幕顶部、上方放不下时：气泡摆到下方', () => {
  const anchor = { x: 800, y: 0, width: 220, height: 220 };
  const { x, y } = placeBubble(anchor, workArea, bubble);
  assert.equal(x, 800 + 110 - 110);
  assert.equal(y, anchor.y + anchor.height + 8);
});

test('气泡永远不会跑出工作区', () => {
  const cases = [
    { x: -60, y: 820, width: 220, height: 220 },
    { x: 1700, y: 820, width: 220, height: 220 },
    { x: 0, y: 0, width: 165, height: 165 }, // 探头缩到 0.75 倍时的 anchor
    { x: 958, y: 100, width: 165, height: 165 },
    { x: 1755, y: 0, width: 165, height: 165 },
  ];
  for (const anchor of cases) {
    const { x, y } = placeBubble(anchor, workArea, bubble);
    assert.ok(x >= workArea.x && x + bubble.width <= workArea.x + workArea.width, `x 越界: ${x} (anchor ${JSON.stringify(anchor)})`);
    assert.ok(y >= workArea.y && y + bubble.height <= workArea.y + workArea.height, `y 越界: ${y}`);
  }
});

test('右键菜单默认摆人物右边', () => {
  const { x, y } = placeSidePanel(bottomCenter, workArea, panel);
  assert.equal(x, bottomCenter.x + bottomCenter.width + 8);
  assert.equal(y, workArea.y + workArea.height - panel.height); // 贴底时上移，别被切掉
});

test('人物贴右边缘时右键菜单改摆左边', () => {
  const anchor = { x: 1700, y: 820, width: 220, height: 220 };
  const { x } = placeSidePanel(anchor, workArea, panel);
  assert.equal(x, anchor.x - panel.width - 8);
  assert.ok(x >= workArea.x);
});

test('人物在左侧偏上时右键菜单仍在右边且不出界', () => {
  const anchor = { x: 40, y: 120, width: 220, height: 220 };
  const { x, y } = placeSidePanel(anchor, workArea, panel);
  assert.equal(x, anchor.x + anchor.width + 8);
  assert.equal(y, anchor.y);
});

test('右键菜单放不下时向上移，仍留在工作区内', () => {
  const workAreaTall = { x: 0, y: 0, width: 800, height: 500 };
  const anchor = { x: 300, y: 450, width: 165, height: 165 }; // 人物底边已经超出工作区
  const { x, y } = placeSidePanel(anchor, workAreaTall, panel);
  assert.equal(y, 500 - panel.height);
  assert.ok(x >= 0 && x + panel.width <= 800);
});
