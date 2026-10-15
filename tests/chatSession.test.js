// 情绪标签的两个纯函数：提取（非流式）和边流边剥（流式）。
// 这块一旦出错，用户会直接看到 "[happy]" 这种标签漏在回复里，所以值得锁住行为。
const test = require('node:test');
const assert = require('node:assert');

const { extractEmotion, createTagStrippingRelay } = require('../dist/main/chatSession');

test('extractEmotion 摘掉开头的标签', () => {
  assert.deepEqual(extractEmotion('[happy]你好呀'), { text: '你好呀', emotion: 'happy' });
  assert.deepEqual(extractEmotion('  [shy]  嗯…  '), { text: '嗯…', emotion: 'shy' });
});

test('extractEmotion 大小写不敏感', () => {
  assert.deepEqual(extractEmotion('[LOVE]好喜欢你'), { text: '好喜欢你', emotion: 'love' });
});

test('extractEmotion 没有标签就原样返回', () => {
  assert.deepEqual(extractEmotion('就是普通一句话'), { text: '就是普通一句话', emotion: null });
  // 标签必须出现在开头，出现在中间的不算（否则正文里的方括号会被误吃）
  assert.deepEqual(extractEmotion('你好 [happy] 呀'), { text: '你好 [happy] 呀', emotion: null });
});

test('不认识的标签只去掉、不当成情绪', () => {
  // 实测模型会自己造标签（日志里出现过 "[hmm] 道德哲学啊…"），不认识也得摘掉，
  // 否则用户会在回复里看到 "[hmm]" 这种噪音。
  assert.deepEqual(extractEmotion('[unknown]文本'), { text: '文本', emotion: null });
  assert.deepEqual(extractEmotion('[hmm] 道德哲学啊'), { text: '道德哲学啊', emotion: null });
  assert.deepEqual(extractEmotion('[meme-kyun]好可爱'), { text: '好可爱', emotion: null });
  assert.deepEqual(extractEmotion('[开心]今天好累'), { text: '今天好累', emotion: null });
});

test('纯数字的方括号不算标签（有人爱用 [1] 列清单）', () => {
  assert.deepEqual(extractEmotion('[1] 第一点'), { text: '[1] 第一点', emotion: null });
  assert.deepEqual(extractEmotion('[2026] 年度总结'), { text: '[2026] 年度总结', emotion: null });
});

test('方括号里带空格的不算标签', () => {
  assert.deepEqual(extractEmotion('[hello world] 正文'), {
    text: '[hello world] 正文',
    emotion: null,
  });
});

/** 把一串流式分片喂给 relay，返回最终吐给用户的文本。 */
function relayThrough(chunks) {
  const out = [];
  const relay = createTagStrippingRelay((clean) => out.push(clean));
  for (const chunk of chunks) relay(chunk);
  return out.join('');
}

test('标签被拆成多个分片也能剥掉', () => {
  assert.equal(relayThrough(['[ha', 'ppy]你', '好']), '你好');
});

test('标签后面直接跟正文', () => {
  assert.equal(relayThrough(['[happy]', '嗨']), '嗨');
});

test('标签形状的方括号开头也会被摘掉', () => {
  // [x] 虽然不常见，但形状上就是标签；摘掉比漏给用户看好
  assert.equal(relayThrough(['[', 'x]y']), 'y');
});

test('纯数字方括号开头的正文要原样保留', () => {
  assert.equal(relayThrough(['[1]', ' 第一点']), '[1] 第一点');
  assert.equal(relayThrough(['[1] 第一点']), '[1] 第一点');
});

test('普通文本按原样流式输出', () => {
  assert.equal(relayThrough(['普通', '文本', '而已']), '普通文本而已');
});

test('开头一直像标签但迟迟不闭合，到上限就放弃等待', () => {
  const long = '[' + 'a'.repeat(25);
  assert.equal(relayThrough([long]), long);
});
