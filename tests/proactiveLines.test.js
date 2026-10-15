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

test('不会连续两次说同一句话（用户实测碰到过重复的哲学问题）', () => {
  let previous = pickPhilosophicalQuestion();
  for (let i = 0; i < 60; i++) {
    const next = pickPhilosophicalQuestion();
    assert.notEqual(next, previous, `第 ${i} 次连着重复了: ${next}`);
    previous = next;
  }
});

test('健康提醒的三个池子也都不连着重复', () => {
  for (const kind of ['sitting', 'water', 'lateNight']) {
    let previous = pickHealthLine(kind).text;
    for (let i = 0; i < 40; i++) {
      const next = pickHealthLine(kind).text;
      assert.notEqual(next, previous, `${kind} 第 ${i} 次连着重复了: ${next}`);
      previous = next;
    }
  }
});

test('抽到的台词始终来自对应的池子', () => {
  const sitting = new Set([
    '都坐一个小时了，起来走两步啦，再坐下去真的要长蘑菇了。',
    '喂，动一动嘛，再不起来我要开始碎碎念了哦。',
    '休息一下吧，伸个懒腰、看看远处，眼睛也要休息的。',
  ]);
  const water = new Set([
    '记得喝水哦，别总是忘了~',
    '水杯是不是又忘在旁边没碰过？快喝一口啦。',
    '补水时间到，喝口水再继续吧。',
  ]);
  for (let i = 0; i < 30; i++) {
    assert.ok(sitting.has(pickHealthLine('sitting').text));
    assert.ok(water.has(pickHealthLine('water').text));
  }
});
