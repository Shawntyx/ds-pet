import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createOpenAICompatibleProvider } from '../core/providers/openaiCompatible';
import { loadSettings } from './config';
import { loadApiKey } from './secrets';
import { getConversationMessages, recentRounds } from './chatStore';
import type { ChatMessage } from '../core/providers/types';

// 长期记忆（SPEC §5.4 下半部分）：定期从对话里提取"值得长期记住的事实"，存本地，
// 每次聊天时注入 system prompt。
//
// 存 userData/memory/facts.json（和聊天记录一样用 JSON，理由见 chatStore.ts）。
//
// 隐私：SPEC 要求"不记录密码、Key、身份证件号等敏感信息"，这里做了两道：
//   1) 提取用的 prompt 里明确列了禁止项（模型基本会遵守）；
//   2) 落盘前再过一遍正则（isSensitiveMemory），模型不听话也拦住。
// 第二道是兜底，不是可有可无的——提取结果出错时它才是最后一道门。

/** 最多存这么多条记忆，超了从最旧的丢。 */
const MAX_FACTS = 300;
const SAVE_DEBOUNCE_MS = 800;
/** 提取时最多带多少轮对话给模型看。 */
const EXTRACT_CONTEXT_ROUNDS = 10;
/** 单条记忆的长度上限（太长的多半是模型把整段对话抄回来了）。 */
const MAX_FACT_LENGTH = 120;

export interface MemoryFact {
  id: string;
  text: string;
  /** 预留：以后按关键词召回时用得上，现在提取出来的都是空数组 */
  tags: string[];
  createdAt: number;
  /** 预留：以后按"最近用到"排序时用得上，见下面 pickFactsForInjection 的说明 */
  lastUsedAt: number | null;
  /** 来源：'chat' = 从对话里提取的，'manual' = 以后手写的 */
  source: string;
}

interface StoredFile {
  version: 1;
  facts: MemoryFact[];
}

// 这些正则就是第二道门。宁可多拦（把一条正常记忆当成敏感信息丢掉）也不要漏，
// 漏一次的代价是用户的口令被写进明文 JSON 文件。
const SENSITIVE_PATTERNS: RegExp[] = [
  /(密码|口令|passwd|password|pwd)/i,
  /(api[\s_-]?key|apikey|access[\s_-]?token|secret[\s_-]?key|bearer)/i,
  /sk-[A-Za-z0-9_-]{8,}/,
  /(私钥|助记词|seed phrase)/i,
  /(身份证|证件号)/,
  /\b\d{15,18}[0-9Xx]\b/,
  /(银行卡|信用卡|卡号|cvv|cvc)/i,
  /\b\d{16,19}\b/,
  /(手机号|手机号码|电话号码)/,
  /\b1[3-9]\d{9}\b/,
  /(家庭住址|住址|门牌号)/,
];

const EXTRACT_PROMPT = [
  '你是一个记忆整理助手。用户和他的桌面宠物刚聊过天，你要从中挑出"值得长期记住的关于用户的事实"。',
  '',
  '值得记的：用户在学什么课程/在做什么项目、DDL 和时间安排、喜欢或讨厌什么、作息习惯、称呼和性格偏好、反复提到的目标。',
  '不值得记的：寒暄、一次性的闲聊、宠物自己说的话、临时情绪、任何你可能猜错的推断。',
  '',
  '绝对不能记录：密码、API Key、令牌、身份证号、银行卡号、手机号、住址等隐私或凭据信息。',
  '',
  '只输出一个 JSON 字符串数组，每条是不超过 40 字的中文短句；没有值得记的就输出 []。',
  '严格按这个格式，不要输出解释、不要用 markdown 代码块。',
  '例如：["用户在学数据结构，下周要交实验报告","用户喜欢喝冰美式，晚上不喝咖啡"]',
].join('\n');

let facts: MemoryFact[] = [];
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let exchangesSinceExtract = 0;
let extracting = false;

/* ---------------- 纯函数（都能单独测，见 tests/memory.test.js） ---------------- */

/** 去掉空白、行首的列表符号、结尾的句读，便于去重和展示。 */
export function normalizeFactText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[-*•\d.、）)\s]+/, '')
    .replace(/[。；;，,\s]+$/, '')
    .trim();
}

/** 命中任何一条敏感模式就拒绝落盘。 */
export function isSensitiveMemory(text: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 解析模型的提取结果。正常是 JSON 数组，但模型偶尔会套一层 markdown 代码块、
 * 或者在前后加一句解释，所以先截取第一个 [ 到最后一个 ] 再解析；
 * 实在解析不出来就退化成"按行取，像列表项的留下"。
 */
export function parseFactsResponse(raw: string): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string')
          .map(normalizeFactText)
          .filter(Boolean);
      }
    } catch {
      // 落到下面的按行兜底
    }
  }

  // 兜底：只有"看起来确实是列表"时才按行取（模型有时把结果写成 "- xxx" 列表）。
  // 如果只是普通的解释性句子（比如"没有什么值得记住的"），宁可什么都不记，
  // 也不能把这句话当成一条记忆存进去。
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const looksLikeList = lines.some((line) => /^([-*•]|\d+[.、)])/.test(line));
  if (!looksLikeList) return [];

  return lines
    .map(normalizeFactText)
    .filter(
      (line) =>
        line.length > 1 &&
        line.length <= 60 &&
        !line.startsWith('[') &&
        !line.startsWith(']') &&
        !line.startsWith('{') &&
        !line.startsWith('}')
    );
}

/** 过滤掉敏感信息、过长文本和已有的重复项，返回可以入库的新记忆。 */
export function dedupeIncoming(existing: MemoryFact[], incoming: string[]): string[] {
  const seen = new Set(existing.map((fact) => normalizeFactText(fact.text).toLowerCase()));
  const fresh: string[] = [];
  for (const raw of incoming) {
    const text = normalizeFactText(raw);
    if (!text || text.length > MAX_FACT_LENGTH) continue;
    if (isSensitiveMemory(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(text);
  }
  return fresh;
}

/**
 * 挑要注入 system prompt 的记忆：按创建时间从新到旧取 limit 条。
 *
 * 为什么按"创建时间"而不是"最近使用"：如果注入过就刷新"最近使用"，那注入过的记忆会一直
 * 排在最前面，新提取的记忆永远挤不进限额（富者愈富），用户会发现"她记不住新东西"。
 * lastUsedAt 字段先留着，等以后做关键词召回时再派上用场。
 */
export function pickFactsForInjection(list: MemoryFact[], limit: number): MemoryFact[] {
  const count = Math.max(0, Math.floor(limit) || 0);
  if (count === 0) return [];
  return [...list].sort((a, b) => b.createdAt - a.createdAt).slice(0, count);
}

/** 拼成注入用的文本块；没有可用记忆时返回空串（调用方就不用判断了）。 */
export function buildMemorySection(list: MemoryFact[], limit: number): string {
  const picked = pickFactsForInjection(list, limit);
  if (picked.length === 0) return '';
  return [
    '【你记得的关于用户的事】',
    ...picked.map((fact) => `- ${fact.text}`),
    '（这些是以前聊天时记下的，可以自然地用起来，但不用刻意复述。）',
  ].join('\n');
}

/* ---------------- 存储 ---------------- */

export function memoryFilePath(): string {
  return path.join(app.getPath('userData'), 'memory', 'facts.json');
}

export function initMemoryStore(): void {
  initialized = true;
  facts = readFacts();
  exchangesSinceExtract = 0;
}

export function getFacts(): MemoryFact[] {
  return facts;
}

export function factCount(): number {
  return facts.length;
}

/** 当前该注入给模型的记忆块（设置里关掉记忆就是空串）。 */
export function memorySection(): string {
  const settings = loadSettings();
  if (!settings.memoryEnabled) return '';
  return buildMemorySection(facts, settings.memoryInjectCount);
}

/** 手动/自动写入新记忆，返回真正新增的部分（被过滤和被去重的不会返回）。 */
export function addFacts(texts: string[], source = 'chat'): MemoryFact[] {
  const fresh = dedupeIncoming(facts, texts);
  const created: MemoryFact[] = [];
  for (const text of fresh) {
    const fact: MemoryFact = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      text,
      tags: [],
      createdAt: Date.now(),
      lastUsedAt: null,
      source,
    };
    facts.push(fact);
    created.push(fact);
  }
  if (created.length > 0) {
    if (facts.length > MAX_FACTS) facts.splice(0, facts.length - MAX_FACTS);
    scheduleSave();
  }
  return created;
}

export function deleteFact(id: string): boolean {
  const index = facts.findIndex((fact) => fact.id === id);
  if (index === -1) return false;
  facts.splice(index, 1);
  scheduleSave();
  return true;
}

export function clearFacts(): number {
  const removed = facts.length;
  facts.length = 0;
  scheduleSave();
  return removed;
}

/** 打开记忆文件之前先保证它存在（第一次用的时候文件还没被创建过）。 */
export function ensureMemoryFile(): string {
  const file = memoryFilePath();
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const payload: StoredFile = { version: 1, facts };
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('[whale-pet] 创建记忆文件失败:', err);
  }
  return file;
}

function scheduleSave(): void {
  if (!initialized) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

/** 立刻落盘（退出前调）。 */
export function flushMemoryStore(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveNow();
}

function saveNow(): void {
  saveTimer = null;
  try {
    const file = memoryFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload: StoredFile = { version: 1, facts };
    // 和聊天记录一样：先写临时文件再改名，避免写一半把原文件写坏。
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('[whale-pet] 长期记忆写入失败:', err);
  }
}

function readFacts(): MemoryFact[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(memoryFilePath(), 'utf-8')) as Partial<StoredFile>;
    const list = Array.isArray(parsed.facts) ? parsed.facts : [];
    return list
      .filter(
        (fact): fact is MemoryFact =>
          !!fact && typeof fact.text === 'string' && normalizeFactText(fact.text).length > 0
      )
      .map((fact) => ({
        id: typeof fact.id === 'string' && fact.id ? fact.id : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        text: normalizeFactText(fact.text),
        tags: Array.isArray(fact.tags) ? fact.tags.filter((t): t is string => typeof t === 'string') : [],
        createdAt: typeof fact.createdAt === 'number' ? fact.createdAt : Date.now(),
        lastUsedAt: typeof fact.lastUsedAt === 'number' ? fact.lastUsedAt : null,
        source: typeof fact.source === 'string' ? fact.source : 'chat',
      }));
  } catch {
    return []; // 文件不存在或损坏：从空记忆开始
  }
}

/* ---------------- 提取 ---------------- */

function buildTranscript(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role === 'user' ? '用户' : '她'}：${message.content}`)
    .join('\n');
}

async function extractNow(): Promise<number> {
  const apiKey = loadApiKey();
  if (!apiKey) return 0;

  const settings = loadSettings();
  // 只看当前这段对话：更早的对话已经沉淀成记忆了，不用再反复读一遍。
  const transcript = buildTranscript(recentRounds(getConversationMessages(), EXTRACT_CONTEXT_ROUNDS));
  if (transcript.length < 10) return 0; // 只有一两句寒暄，没什么可记的

  const provider = createOpenAICompatibleProvider({
    apiKey,
    baseURL: settings.baseURL,
    model: settings.model,
  });

  const raw = await new Promise<string>((resolve) => {
    const controller = new AbortController();
    provider
      .streamChat(
        [
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: `最近的对话：\n${transcript}` },
        ],
        {
          onDelta: () => {},
          onDone: (fullText) => resolve(fullText),
          onError: () => resolve(''),
        },
        controller.signal
      )
      .catch(() => resolve(''));
  });

  const created = addFacts(parseFactsResponse(raw));
  if (created.length > 0) {
    console.log(`[whale-pet] 记住了 ${created.length} 条新记忆`);
  }
  return created.length;
}

/**
 * 每完成一轮"用户提问 + 她回答"调一次。攒够 memoryExtractEveryRounds 轮才真的去提取
 * （提取要多花一次模型调用，太频繁既费钱又烦人）。
 */
export async function noteCompletedExchange(): Promise<void> {
  const settings = loadSettings();
  if (!settings.memoryEnabled) return;

  exchangesSinceExtract++;
  if (exchangesSinceExtract < Math.max(1, settings.memoryExtractEveryRounds)) return;
  if (extracting) return; // 上一次还没跑完就先不排队，等下一轮

  exchangesSinceExtract = 0;
  extracting = true;
  try {
    await extractNow();
  } finally {
    extracting = false;
  }
}
