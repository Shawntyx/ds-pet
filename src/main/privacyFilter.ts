// SPEC 5.3：窗口标题吐槽前要先过滤，标题包含银行/密码/无痕窗口等关键字时跳过，
// 用户可以自定义追加过滤词。内置黑名单固定生效，不受用户设置影响（防止不小心清空）。

const BUILTIN_BLOCKLIST = [
  '银行',
  '密码',
  '口令',
  '身份证',
  '信用卡',
  '支付宝',
  '微信支付',
  '无痕',
  'incognito',
  'inprivate',
  'private browsing',
  'password',
  'bank',
  'credit card',
  'paypal',
  'ssn',
];

export function isTitleSensitive(title: string, userWords: string[] = []): boolean {
  if (!title) return false;
  const haystack = title.toLowerCase();
  const all = [...BUILTIN_BLOCKLIST, ...userWords];
  return all.some((w) => {
    const word = w.trim().toLowerCase();
    return word && haystack.includes(word);
  });
}

export function parseFilterWords(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
}
