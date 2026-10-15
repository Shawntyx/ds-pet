// 长期记忆的纯函数：敏感信息过滤、模型输出解析、去重、注入挑选。
// 这几处出错的表现分别是"口令被写进明文文件""记下一堆废话""她记不住新东西"，
// 都不容易在使用中一眼看出来，所以单独锁住行为。
const test = require('node:test');
const assert = require('node:assert');

const {
  isSensitiveMemory,
  normalizeFactText,
  parseFactsResponse,
  dedupeIncoming,
  pickFactsForInjection,
  buildMemorySection,
} = require('../dist/main/memory');

test('敏感信息一律拒绝落盘', () => {
  const bad = [
    '用户的密码是 abc12345',
    '用户的 API Key 是 sk-abcdefghijklmn',
    'user access_token: xyz',
    '用户身份证号 110101199003074512',
    '用户银行卡 6222021234567890123',
    '用户的手机号是 13800138000',
    '用户家庭住址在某某小区 3 栋',
  ];
  for (const text of bad) {
    assert.equal(isSensitiveMemory(text), true, `应该被拦住: ${text}`);
  }
});

test('正常记忆不会被误杀', () => {
  const good = [
    '用户在学数据结构，下周要交实验报告',
    '用户喜欢喝冰美式，晚上不喝咖啡',
    '用户明天下午三点有一场考试',
    '用户在做鲸鱼娘桌宠这个项目',
  ];
  for (const text of good) {
    assert.equal(isSensitiveMemory(text), false, `不该被拦住: ${text}`);
  }
});

test('normalizeFactText 去掉列表符号、多余空白和结尾句读', () => {
  assert.equal(normalizeFactText('  -  用户   喜欢 猫。 '), '用户 喜欢 猫');
  assert.equal(normalizeFactText('1. 用户在学 Java，'), '用户在学 Java');
  assert.equal(normalizeFactText(''), '');
});

test('parseFactsResponse 解析标准 JSON 数组', () => {
  assert.deepEqual(parseFactsResponse('["用户在学数据结构","用户喜欢喝冰美式"]'), [
    '用户在学数据结构',
    '用户喜欢喝冰美式',
  ]);
});

test('parseFactsResponse 容忍 markdown 代码块和前后废话', () => {
  const raw = '好的，这是提取结果：\n```json\n["用户在下周有个 DDL"]\n```\n就这些。';
  assert.deepEqual(parseFactsResponse(raw), ['用户在下周有个 DDL']);
});

test('parseFactsResponse 解析不出来时按行兜底', () => {
  const raw = '- 用户在学数据结构\n- 用户喜欢喝冰美式\n';
  assert.deepEqual(parseFactsResponse(raw), ['用户在学数据结构', '用户喜欢喝冰美式']);
});

test('parseFactsResponse 对空输出和垃圾输出返回空数组', () => {
  assert.deepEqual(parseFactsResponse('[]'), []);
  assert.deepEqual(parseFactsResponse(''), []);
  assert.deepEqual(parseFactsResponse('没有什么值得记住的'), []);
});

test('dedupeIncoming 同时做去重、长度和敏感信息过滤', () => {
  const existing = [{ text: '用户在学数据结构' }];
  const incoming = [
    '用户在学数据结构', // 重复
    '  用户在学数据结构。', // 归一化之后还是重复
    '用户的密码是 abc12345', // 敏感
    '用户在学算法',
    'x'.repeat(200), // 太长
    '',
  ];
  assert.deepEqual(dedupeIncoming(existing, incoming), ['用户在学算法']);
});

test('pickFactsForInjection 取最新的 N 条', () => {
  const facts = [
    { text: '旧的', createdAt: 1 },
    { text: '新的', createdAt: 3 },
    { text: '中间的', createdAt: 2 },
  ];
  assert.deepEqual(
    pickFactsForInjection(facts, 2).map((f) => f.text),
    ['新的', '中间的']
  );
  assert.deepEqual(pickFactsForInjection(facts, 0), []);
  assert.deepEqual(pickFactsForInjection(facts, -5), []);
});

test('pickFactsForInjection 不会改动原数组顺序', () => {
  const facts = [
    { text: '旧的', createdAt: 1 },
    { text: '新的', createdAt: 3 },
  ];
  pickFactsForInjection(facts, 1);
  assert.deepEqual(facts.map((f) => f.text), ['旧的', '新的']);
});

test('buildMemorySection 拼出能直接塞进 system prompt 的文本', () => {
  const facts = [{ text: '用户在学数据结构', createdAt: 1 }];
  const section = buildMemorySection(facts, 5);
  assert.ok(section.includes('【你记得的关于用户的事】'));
  assert.ok(section.includes('- 用户在学数据结构'));
});

test('没有记忆时 buildMemorySection 返回空串（调用方不用特判）', () => {
  assert.equal(buildMemorySection([], 5), '');
  assert.equal(buildMemorySection([{ text: 'x', createdAt: 1 }], 0), '');
});
