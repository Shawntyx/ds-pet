// 主动说话的台词库：锁住"深夜提醒必须带 night 姿势"这条 ASSETS.md 的映射。
const test = require('node:test');
const assert = require('node:assert');

const { pickHealthLine, pickPhilosophicalQuestion } = require('../dist/main/proactiveLines');

test('深夜提醒一定带 night 姿势', () => {
  for (let i = 0; i < 50; i++) {
    const line = pickHealthLine('lateNight');
    assert.equal(line.pose, 'night', `第 ${i} 次抽到的台词没带 night: ${line.text}`);
    assert.ok(line.text.length > 0);
  }
});

test('久坐/喝水提醒不指定整张姿势（走情绪标签）', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(pickHealthLine('sitting').pose, undefined);
    assert.equal(pickHealthLine('water').pose, undefined);
  }
});

test('哲学问题是非空字符串', () => {
  for (let i = 0; i < 20; i++) {
    const q = pickPhilosophicalQuestion();
    assert.equal(typeof q, 'string');
    assert.ok(q.trim().length > 0);
  }
});
