// 窗口摆位工具的行为锁定：这两个坑（移动改尺寸、小数坐标抛异常）都是实测出来的，
// 这里把"取整 + 拒绝非法值"的部分用测试固定住，别再退回去。
const test = require('node:test');
const assert = require('node:assert');

const { normalizeWindowRect } = require('../dist/main/windowRect');

test('坐标一律取整（setPosition/setBounds 传小数会抛异常）', () => {
  assert.deepEqual(normalizeWindowRect({ x: 100.4, y: 200.6, width: 220.5, height: 115.2 }), {
    x: 100,
    y: 201,
    width: 221,
    height: 115,
  });
});

test('负数坐标（贴屏幕左边缘时会出现）是合法的，但要取整', () => {
  // 注意 Math.round(-60.5) 是 -60（JS 的 .5 一律朝 +∞ 取整），差 1px 无所谓，关键是别留小数
  assert.deepEqual(normalizeWindowRect({ x: -60.5, y: -0.2, width: 220, height: 115 }), {
    x: -60,
    y: -0,
    width: 220,
    height: 115,
  });
  assert.equal(Number.isInteger(normalizeWindowRect({ x: -60.4, y: 3.7, width: 220, height: 115 }).y), true);
});

test('NaN / Infinity / undefined 一律拒绝，绝不传给 Electron', () => {
  const bad = [
    { x: NaN, y: 0, width: 220, height: 115 },
    { x: 0, y: NaN, width: 220, height: 115 },
    { x: 0, y: 0, width: NaN, height: 115 },
    { x: 0, y: 0, width: 220, height: Infinity },
    { x: undefined, y: 0, width: 220, height: 115 },
    { x: 0, y: 0, width: '220', height: 115 },
  ];
  for (const rect of bad) {
    assert.equal(normalizeWindowRect(rect), null, `应该拒绝: ${JSON.stringify(rect)}`);
  }
});

test('尺寸为 0 或负数一律拒绝（会让 Electron 报错）', () => {
  assert.equal(normalizeWindowRect({ x: 0, y: 0, width: 0, height: 115 }), null);
  assert.equal(normalizeWindowRect({ x: 0, y: 0, width: 220, height: -5 }), null);
});
