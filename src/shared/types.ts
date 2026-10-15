// 主进程和渲染进程都会用到的类型定义。

export type PetState =
  | 'idle'
  | 'blink'
  | 'tailSwing'
  | 'walking'
  | 'dragging'
  | 'falling'
  | 'petHead'
  | 'petTail'
  | 'pokeBelly'
  | 'afk';

/** 主进程按系统空闲时间判断出来的"人在不在"：active=在用电脑，afk=走开了，sleep=走开且是深夜。
 * （渲染进程 pet.ts 里有同名的一份，因为渲染脚本是全局脚本、不能 import 主进程模块，改的时候两边都要改。） */
export type PresenceState = 'active' | 'afk' | 'sleep';

/** 互动区域：相对窗口宽高的比例矩形（0~1），方便窗口尺寸变化时跟着缩放。 */
export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InteractionZones {
  head: ZoneRect;
  tail: ZoneRect;
  belly: ZoneRect;
}

export interface ProactiveSettings {
  enabled: boolean;
  healthReminder: boolean;
  windowTitleRoast: boolean;
  randomQuestion: boolean;
  /** 平均间隔分钟数（实际触发会在这个数上下随机） */
  avgIntervalMinutes: number;
  /** 窗口标题吐槽的隐私过滤词，用户自定义追加的部分（逗号或换行分隔）；
   * 内置黑名单（银行/密码/无痕等）固定生效，不受这个字段影响。 */
  titleFilterWords: string;
}

/** 余额查询结果快照。主进程持有，设置页和托盘菜单都只读这一份。 */
export interface BalanceView {
  /** 是否成功查到过余额 */
  ok: boolean;
  /** 服务端是否支持余额查询接口（换非 DeepSeek 的兼容服务会 fallback 成 false） */
  supported: boolean;
  currency: string | null;
  total: number | null;
  granted: number | null;
  toppedUp: number | null;
  /** 最近一次"成功"查询的时间（epoch ms），从没成功过就是 null */
  fetchedAt: number | null;
  /** 最近一次查询失败的原因；成功后清成 null */
  error: string | null;
  /** 当前余额是否低于设置的提醒阈值 */
  low: boolean;
}

export interface PetSettings {
  /** 显示尺寸（正方形窗口边长，像素） */
  spriteSize: number;
  /** 隐藏/召唤桌宠的全局快捷键 */
  toggleShortcut: string;
  /** 勿扰模式：暂停主动说话 */
  doNotDisturb: boolean;
  /** 桌宠是否可见 */
  visible: boolean;
  /** 互动区域配置，方便以后调整 */
  zones: InteractionZones;
  /** OpenAI 兼容 API 的 base URL，默认接 DeepSeek */
  baseURL: string;
  /** 模型名 */
  model: string;
  /** 当前使用的人设文件名（相对 personas 目录），如 'default.md' */
  activePersona: string;
  /** 系统空闲多少分钟后她趴下/睡着（ASSETS.md §1 的 afk/sleep 姿势） */
  afkAfterMinutes: number;
  /** 余额低于这个数值就提醒一次（切 balance-low 姿势 + 气泡）；<=0 表示不提醒 */
  balanceWarnThreshold: number;
  /** 发给模型时只带最近这么多轮对话（一轮 = 用户一句 + 回复一句），避免上下文越来越长 */
  chatHistoryRounds: number;
  /** 长期记忆总开关：关掉就不提取、也不注入 */
  memoryEnabled: boolean;
  /** 每完成多少轮对话提取一次长期记忆 */
  memoryExtractEveryRounds: number;
  /** 每次聊天最多把多少条记忆注入 system prompt（0 = 不注入） */
  memoryInjectCount: number;
  proactive: ProactiveSettings;
}

// 数值来自 ASSETS.md §0（核对原项目 whale-moe-core.js 点击判定区得出）：
// 先匹配尾巴（贴底部满宽），再匹配肚子，都不命中算头。
export const DEFAULT_ZONES: InteractionZones = {
  tail: { x: 0.0, y: 0.78, w: 1.0, h: 0.22 },
  belly: { x: 0.18, y: 0.45, w: 0.64, h: 0.33 },
  head: { x: 0.2, y: 0.0, w: 0.6, h: 0.45 },
};

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  enabled: true,
  healthReminder: true,
  windowTitleRoast: true,
  randomQuestion: true,
  // 用户手动调的 10 分钟（SPEC 里 20–40 分钟只是"默认较低"的示例，不是硬要求），别改回去。
  avgIntervalMinutes: 10,
  titleFilterWords: '',
};

export const DEFAULT_SETTINGS: PetSettings = {
  spriteSize: 220,
  toggleShortcut: 'Ctrl+Alt+W',
  doNotDisturb: false,
  visible: true,
  zones: DEFAULT_ZONES,
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  activePersona: 'default.md',
  afkAfterMinutes: 3,
  balanceWarnThreshold: 5,
  chatHistoryRounds: 20,
  memoryEnabled: true,
  memoryExtractEveryRounds: 5,
  memoryInjectCount: 20,
  proactive: DEFAULT_PROACTIVE_SETTINGS,
};

/** 桌宠右键菜单可以触发的动作（对应桌宠状态机里的一次性反应）。 */
export type PetMenuAction = 'feed' | 'poke' | 'praise';

/** preload 暴露给渲染进程的 API 形状，主进程和渲染进程共用同一份类型定义。 */
export interface PetBridge {
  resolveAsset(filename: string): string;
  setIgnoreMouseEvents(ignore: boolean, forward?: boolean): void;
  setWindowPosition(x: number, y: number): void;
  getWindowPosition(): Promise<{ x: number; y: number }>;
  getWorkArea(): Promise<{ x: number; y: number; width: number; height: number }>;
  getSpriteSize(): Promise<number>;
  /** 在桌宠身上右键，请求主进程在旁边弹出自绘菜单。 */
  requestContextMenu(): void;
  /** 菜单里点了投喂/戳一下/夸夸，主进程转发过来让桌宠播对应反应。 */
  onTriggerAction(callback: (action: PetMenuAction) => void): void;
  /** 从隐藏状态被召唤出来时触发，用来播一下打招呼动作。 */
  onShown(callback: () => void): void;
  /** 聊天面板发消息后、模型第一个 token 回来之前，切到"思考中"姿势。 */
  onThinkingStart(callback: () => void): void;
  /** 模型回复完了（或聊天面板关闭时），播情绪姿势 + 气泡显示这句话。
   * 主动说话（深夜提醒/余额提醒）会额外带上 pose，指定整张姿势，优先于 emotion；
   * bubble=false 表示"只换表情、不弹气泡"（聊天面板开着时用）。 */
  onReply(
    callback: (payload: {
      text: string;
      emotion: string | null;
      pose?: string | null;
      bubble?: boolean;
    }) => void
  ): void;
  /** 上报"角色实际画面"相对窗口的偏移，气泡/菜单/聊天面板据此避让屏幕边缘。 */
  setAnchor(rect: { dx: number; dy: number; width: number; height: number }): void;
  /** 用户走开/回来了，换 afk/sleep 姿势或醒过来。 */
  onPresence(callback: (presence: PresenceState) => void): void;
  /** 余额低于阈值时提醒一次。 */
  onBalanceLow(callback: (payload: { text: string }) => void): void;
  /** 在桌宠头上方弹一个气泡（独立小窗口，不是画在桌宠窗口里——那个窗口没地方放气泡）。 */
  showBubble(text: string): void;
}

/** menuPreload 暴露给菜单窗口渲染进程的 API 形状。 */
export interface MenuBridge {
  onInit(callback: (data: { doNotDisturb: boolean }) => void): void;
  selectAction(id: string): void;
  close(): void;
}

export interface ChatMessageView {
  role: 'user' | 'assistant';
  content: string;
  /** 属于哪一段对话：面板用它来画"新的对话"分隔线（老数据没有这个字段） */
  conversation?: number;
}

/** chatPreload 暴露给聊天面板渲染进程的 API 形状。 */
export interface ChatBridge {
  getHistory(): Promise<ChatMessageView[]>;
  sendMessage(text: string): void;
  /** 用户按"停止"：中断正在生成的回复（已经吐出来的部分会留在记录里） */
  cancel(): void;
  /** 用户点"新对话"：按常见 LLM 的习惯开一段干净上下文（人设和长期记忆照旧） */
  newConversation(): void;
  onDelta(callback: (delta: string) => void): void;
  onDone(callback: () => void): void;
  /** 用户主动停止；payload 为 null 表示一个字都没收到，那条提问也被撤回了 */
  onStopped(callback: (payload: { text: string } | null) => void): void;
  onError(callback: (message: string) => void): void;
}

/** 设置页展示长期记忆用的精简结构（完整结构在主进程 memory.ts 里）。 */
export interface MemoryFactView {
  id: string;
  text: string;
  createdAt: number;
}

export interface SettingsData {
  baseURL: string;
  model: string;
  toggleShortcut: string;
  /** 是否已经设置了"能读出来"的 API Key（文件在但解不开时算 false） */
  hasApiKey: boolean;
  /** 'missing' | 'ok' | 'unreadable'：unreadable 时界面要提醒重新填一次 */
  apiKeyState: string;
  /** 直接给人看的 Key 状态说明（主进程拼好，界面不用自己判断） */
  apiKeyHint: string;
  /** 应用数据目录（settings.json / apikey.enc / chat / memory 都在这里），排错时给用户看 */
  userDataPath: string;
  activePersona: string;
  personas: string[];
  afkAfterMinutes: number;
  balanceWarnThreshold: number;
  /** 余额快照：设置页只读显示，点"立即查询"会触发主进程重新查一次 */
  balance: BalanceView;
  /** 余额那一行显示什么（主进程用统一的格式化函数拼好，各处显示才一致） */
  balanceText: string;
  /** 只带最近多少轮发给模型 */
  chatHistoryRounds: number;
  /** 本机已经存了多少条聊天消息（设置页显示"当前记录"用） */
  chatMessageCount: number;
  memoryEnabled: boolean;
  memoryExtractEveryRounds: number;
  memoryInjectCount: number;
  /** 本机一共存了多少条长期记忆 */
  memoryFactCount: number;
  /** 记忆列表（最新的在前，最多前 50 条，够设置页展示和逐条删除） */
  memoryFacts: MemoryFactView[];
  /** 记忆文件路径，设置页显示用 */
  memoryFilePath: string;
  proactive: ProactiveSettings;
}

/** settingsPreload 暴露给设置窗口渲染进程的 API 形状。 */
export interface SettingsBridge {
  load(): Promise<SettingsData>;
  save(data: Partial<SettingsData> & { apiKey?: string }): Promise<{ ok: boolean; error?: string }>;
  openPersonaFile(): void;
  refreshBalance(): Promise<BalanceView>;
  /** 主进程查到新余额时主动推过来，设置页不用重新打开就能看到最新数字 */
  onBalanceChanged(callback: (data: SettingsData) => void): void;
  /** 清空本机聊天记录；主进程会先弹一个原生确认框，用户取消就返回 ok:false。 */
  clearChatHistory(): Promise<{ ok: boolean; cleared: number }>;
  /** 用系统默认程序打开记忆文件（可以直接手改/删条目） */
  openMemoryFile(): void;
  /** 删掉一条记忆 */
  deleteMemoryFact(id: string): Promise<{ ok: boolean; remaining: number }>;
  /** 清空全部记忆；同样会先弹原生确认框。 */
  clearMemory(): Promise<{ ok: boolean; cleared: number }>;
}
