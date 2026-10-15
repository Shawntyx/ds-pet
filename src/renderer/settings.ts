// 设置界面逻辑。和 pet.ts/menu.ts/chat.ts 一样不用 import/export，直接当全局脚本跑。
// 运行时代码整体包一层 IIFE：这几个渲染脚本都是全局脚本，顶层标识符共享同一个作用域，
// 不包一层的话换个文件写个同名变量（比如 form/init）就会跟别的文件撞车报错。

interface ProactiveSettingsView {
  enabled: boolean;
  healthReminder: boolean;
  windowTitleRoast: boolean;
  randomQuestion: boolean;
  avgIntervalMinutes: number;
  titleFilterWords: string;
}

interface BalanceViewView {
  ok: boolean;
  supported: boolean;
  currency: string | null;
  total: number | null;
  granted: number | null;
  toppedUp: number | null;
  fetchedAt: number | null;
  error: string | null;
  low: boolean;
}

interface MemoryFactView {
  id: string;
  text: string;
  createdAt: number;
}

interface SettingsDataView {
  baseURL: string;
  model: string;
  toggleShortcut: string;
  hasApiKey: boolean;
  apiKeyState: string;
  apiKeyHint: string;
  userDataPath: string;
  activePersona: string;
  personas: string[];
  afkAfterMinutes: number;
  balanceWarnThreshold: number;
  balance: BalanceViewView;
  chatHistoryRounds: number;
  chatMessageCount: number;
  memoryEnabled: boolean;
  memoryExtractEveryRounds: number;
  memoryInjectCount: number;
  memoryFactCount: number;
  memoryFacts: MemoryFactView[];
  memoryFilePath: string;
  proactive: ProactiveSettingsView;
}

interface Window {
  settingsAPI: {
    load(): Promise<SettingsDataView>;
    save(
      data: Partial<SettingsDataView> & { apiKey?: string }
    ): Promise<{ ok: boolean; error?: string }>;
    openPersonaFile(): void;
    refreshBalance(): Promise<BalanceViewView>;
    clearChatHistory(): Promise<{ ok: boolean; cleared: number }>;
    openMemoryFile(): void;
    deleteMemoryFact(id: string): Promise<{ ok: boolean; remaining: number }>;
    clearMemory(): Promise<{ ok: boolean; cleared: number }>;
  };
}

(function () {
  const form = document.getElementById('form') as HTMLFormElement;
  const apiKeyEl = document.getElementById('apiKey') as HTMLInputElement;
  const apiKeyHintEl = document.getElementById('apiKeyHint') as HTMLParagraphElement;
  const userDataHintEl = document.getElementById('userDataHint') as HTMLParagraphElement;
  const baseURLEl = document.getElementById('baseURL') as HTMLInputElement;
  const modelEl = document.getElementById('model') as HTMLInputElement;
  const personaEl = document.getElementById('persona') as HTMLSelectElement;
  const openPersonaFileBtn = document.getElementById('openPersonaFile') as HTMLButtonElement;
  const toggleShortcutEl = document.getElementById('toggleShortcut') as HTMLInputElement;
  const afkAfterMinutesEl = document.getElementById('afkAfterMinutes') as HTMLInputElement;
  const chatHistoryRoundsEl = document.getElementById('chatHistoryRounds') as HTMLInputElement;
  const chatHistoryHintEl = document.getElementById('chatHistoryHint') as HTMLParagraphElement;
  const clearChatHistoryBtn = document.getElementById('clearChatHistory') as HTMLButtonElement;
  const memoryEnabledEl = document.getElementById('memoryEnabled') as HTMLInputElement;
  const memoryExtractEveryRoundsEl = document.getElementById('memoryExtractEveryRounds') as HTMLInputElement;
  const memoryInjectCountEl = document.getElementById('memoryInjectCount') as HTMLInputElement;
  const memoryHintEl = document.getElementById('memoryHint') as HTMLParagraphElement;
  const memoryListEl = document.getElementById('memoryList') as HTMLUListElement;
  const openMemoryFileBtn = document.getElementById('openMemoryFile') as HTMLButtonElement;
  const clearMemoryBtn = document.getElementById('clearMemory') as HTMLButtonElement;
  const balanceTextEl = document.getElementById('balanceText') as HTMLParagraphElement;
  const refreshBalanceBtn = document.getElementById('refreshBalance') as HTMLButtonElement;
  const balanceWarnThresholdEl = document.getElementById('balanceWarnThreshold') as HTMLInputElement;
  const proactiveEnabledEl = document.getElementById('proactiveEnabled') as HTMLInputElement;
  const healthReminderEl = document.getElementById('healthReminder') as HTMLInputElement;
  const windowTitleRoastEl = document.getElementById('windowTitleRoast') as HTMLInputElement;
  const randomQuestionEl = document.getElementById('randomQuestion') as HTMLInputElement;
  const avgIntervalMinutesEl = document.getElementById('avgIntervalMinutes') as HTMLInputElement;
  const titleFilterWordsEl = document.getElementById('titleFilterWords') as HTMLTextAreaElement;
  const statusEl = document.getElementById('status') as HTMLDivElement;

  function currencySymbol(currency: string | null): string {
    return currency === 'USD' ? '$' : '¥';
  }

  /** "3 分钟前 / 2 小时前"这种，比直接甩一个时间戳好读。 */
  function describeAge(fetchedAt: number): string {
    const minutes = Math.floor((Date.now() - fetchedAt) / 60_000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
  }

  function renderBalance(view: BalanceViewView): void {
    const parts: string[] = [];
    if (view.total !== null) {
      const symbol = currencySymbol(view.currency);
      parts.push(`当前余额 ${symbol}${view.total.toFixed(2)}`);
      if (view.toppedUp !== null) parts.push(`充值 ${symbol}${view.toppedUp.toFixed(2)}`);
      if (view.granted !== null) parts.push(`赠金 ${symbol}${view.granted.toFixed(2)}`);
      if (view.fetchedAt) parts.push(`${describeAge(view.fetchedAt)}查的`);
    }
    if (view.error) parts.push(view.error);
    if (view.low) parts.push('⚠️ 已低于提醒阈值');
    balanceTextEl.textContent = parts.length > 0 ? parts.join(' · ') : '还没查询过';
  }

  /** 记忆列表：每条右边一个 ✕ 直接删，删完重新拉一次数据（顺便刷新条数）。 */
  function renderMemoryList(data: SettingsDataView): void {
    memoryListEl.innerHTML = '';
    for (const fact of data.memoryFacts) {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = fact.text;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'memory-delete';
      del.textContent = '✕';
      del.title = '删掉这条记忆';
      del.addEventListener('click', async () => {
        del.disabled = true;
        await window.settingsAPI.deleteMemoryFact(fact.id);
        fillForm(await window.settingsAPI.load());
      });
      li.appendChild(text);
      li.appendChild(del);
      memoryListEl.appendChild(li);
    }
  }

  function fillForm(data: SettingsDataView): void {
    // Key 状态由主进程判定（文件在不在、能不能解开），这里只负责显示；
    // 解不开时用红字提醒重新填一次，不然用户会一直以为是"没设置"。
    apiKeyHintEl.textContent = data.apiKeyHint;
    apiKeyHintEl.className = data.apiKeyState === 'unreadable' ? 'hint warn' : 'hint';
    userDataHintEl.textContent = `数据目录：${data.userDataPath}`;
    baseURLEl.value = data.baseURL;
    modelEl.value = data.model;
    toggleShortcutEl.value = data.toggleShortcut;
    afkAfterMinutesEl.value = String(data.afkAfterMinutes);
    balanceWarnThresholdEl.value = String(data.balanceWarnThreshold);
    chatHistoryRoundsEl.value = String(data.chatHistoryRounds);
    chatHistoryHintEl.textContent =
      data.chatMessageCount > 0
        ? `本机已保存 ${data.chatMessageCount} 条消息（约 ${Math.ceil(data.chatMessageCount / 2)} 轮）`
        : '还没有聊天记录';

    memoryEnabledEl.checked = data.memoryEnabled;
    memoryExtractEveryRoundsEl.value = String(data.memoryExtractEveryRounds);
    memoryInjectCountEl.value = String(data.memoryInjectCount);
    memoryHintEl.textContent =
      data.memoryFactCount > 0
        ? `本机已记住 ${data.memoryFactCount} 条${data.memoryFactCount > data.memoryFacts.length ? `（下面只列最近 ${data.memoryFacts.length} 条）` : ''}`
        : '还没有记忆，聊几轮之后她自己会记（也可以随时在记忆文件里手写）';
    renderMemoryList(data);

    renderBalance(data.balance);

    personaEl.innerHTML = '';
    for (const name of data.personas) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      personaEl.appendChild(opt);
    }
    personaEl.value = data.activePersona;

    proactiveEnabledEl.checked = data.proactive.enabled;
    healthReminderEl.checked = data.proactive.healthReminder;
    windowTitleRoastEl.checked = data.proactive.windowTitleRoast;
    randomQuestionEl.checked = data.proactive.randomQuestion;
    avgIntervalMinutesEl.value = String(data.proactive.avgIntervalMinutes);
    titleFilterWordsEl.value = data.proactive.titleFilterWords;
  }

  openPersonaFileBtn.addEventListener('click', () => {
    window.settingsAPI.openPersonaFile();
  });

  // 手动查询余额：只读，不写设置，所以不用点保存。
  refreshBalanceBtn.addEventListener('click', async () => {
    refreshBalanceBtn.disabled = true;
    balanceTextEl.textContent = '查询中…';
    try {
      renderBalance(await window.settingsAPI.refreshBalance());
    } finally {
      refreshBalanceBtn.disabled = false;
    }
  });

  // 清空聊天记录：确认框在主进程弹（原生对话框），这里只负责禁用按钮和刷新显示。
  clearChatHistoryBtn.addEventListener('click', async () => {
    clearChatHistoryBtn.disabled = true;
    try {
      const result = await window.settingsAPI.clearChatHistory();
      if (result.ok) {
        statusEl.textContent = `已清空 ${result.cleared} 条聊天记录`;
        statusEl.className = 'ok';
      } else {
        statusEl.textContent = '';
        statusEl.className = '';
      }
      fillForm(await window.settingsAPI.load());
    } finally {
      clearChatHistoryBtn.disabled = false;
    }
  });

  // 打开记忆文件（可以直接改文字、删整行）；清空全部记忆走主进程的原生确认框。
  openMemoryFileBtn.addEventListener('click', () => {
    window.settingsAPI.openMemoryFile();
  });

  clearMemoryBtn.addEventListener('click', async () => {
    clearMemoryBtn.disabled = true;
    try {
      const result = await window.settingsAPI.clearMemory();
      if (result.ok) {
        statusEl.textContent = `已清空 ${result.cleared} 条记忆`;
        statusEl.className = 'ok';
      }
      fillForm(await window.settingsAPI.load());
    } finally {
      clearMemoryBtn.disabled = false;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '保存中…';
    statusEl.className = '';

    const patch: Partial<SettingsDataView> & { apiKey?: string } = {
      baseURL: baseURLEl.value.trim(),
      model: modelEl.value.trim(),
      toggleShortcut: toggleShortcutEl.value.trim(),
      activePersona: personaEl.value,
      afkAfterMinutes: Math.max(1, Number(afkAfterMinutesEl.value) || 3),
      balanceWarnThreshold: Math.max(0, Number(balanceWarnThresholdEl.value) || 0),
      chatHistoryRounds: Math.max(1, Number(chatHistoryRoundsEl.value) || 20),
      memoryEnabled: memoryEnabledEl.checked,
      memoryExtractEveryRounds: Math.max(1, Number(memoryExtractEveryRoundsEl.value) || 5),
      memoryInjectCount: Math.max(0, Number(memoryInjectCountEl.value) || 0),
      proactive: {
        enabled: proactiveEnabledEl.checked,
        healthReminder: healthReminderEl.checked,
        windowTitleRoast: windowTitleRoastEl.checked,
        randomQuestion: randomQuestionEl.checked,
        avgIntervalMinutes: Math.max(1, Number(avgIntervalMinutesEl.value) || 10),
        titleFilterWords: titleFilterWordsEl.value,
      },
    };
    if (apiKeyEl.value.trim()) {
      patch.apiKey = apiKeyEl.value.trim();
    }

    const result = await window.settingsAPI.save(patch);
    if (result.ok) {
      statusEl.textContent = '已保存';
      statusEl.className = 'ok';
      apiKeyEl.value = '';
      const data = await window.settingsAPI.load();
      fillForm(data);
    } else {
      statusEl.textContent = `保存失败：${result.error ?? '未知错误'}`;
      statusEl.className = 'err';
    }
  });

  async function init(): Promise<void> {
    const data = await window.settingsAPI.load();
    fillForm(data);
  }

  void init();
})();
