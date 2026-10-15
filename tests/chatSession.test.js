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

test('extractEmotion 不认识的标签不当成情绪', () => {
  assert.deepEqual(extractEmotion('[unknown]文本'), { text: '[unknown]文本', emotion: null });
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

test('不是标签的方括号内容要原样吐出来', () => {
  assert.equal(relayThrough(['[', 'x]y']), '[x]y');
});

test('普通文本按原样流式输出', () => {
  assert.equal(relayThrough(['普通', '文本', '而已']), '普通文本而已');
});

test('开头一直像标签但迟迟不闭合，到上限就放弃等待', () => {
  const long = '[' + 'a'.repeat(25);
  assert.equal(relayThrough([long]), long);
});
