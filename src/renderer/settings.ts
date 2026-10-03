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

interface SettingsDataView {
  baseURL: string;
  model: string;
  toggleShortcut: string;
  hasApiKey: boolean;
  activePersona: string;
  personas: string[];
  proactive: ProactiveSettingsView;
}

interface Window {
  settingsAPI: {
    load(): Promise<SettingsDataView>;
    save(
      data: Partial<SettingsDataView> & { apiKey?: string }
    ): Promise<{ ok: boolean; error?: string }>;
    openPersonaFile(): void;
  };
}

(function () {
  const form = document.getElementById('form') as HTMLFormElement;
  const apiKeyEl = document.getElementById('apiKey') as HTMLInputElement;
  const apiKeyHintEl = document.getElementById('apiKeyHint') as HTMLParagraphElement;
  const baseURLEl = document.getElementById('baseURL') as HTMLInputElement;
  const modelEl = document.getElementById('model') as HTMLInputElement;
  const personaEl = document.getElementById('persona') as HTMLSelectElement;
  const openPersonaFileBtn = document.getElementById('openPersonaFile') as HTMLButtonElement;
  const toggleShortcutEl = document.getElementById('toggleShortcut') as HTMLInputElement;
  const proactiveEnabledEl = document.getElementById('proactiveEnabled') as HTMLInputElement;
  const healthReminderEl = document.getElementById('healthReminder') as HTMLInputElement;
  const windowTitleRoastEl = document.getElementById('windowTitleRoast') as HTMLInputElement;
  const randomQuestionEl = document.getElementById('randomQuestion') as HTMLInputElement;
  const avgIntervalMinutesEl = document.getElementById('avgIntervalMinutes') as HTMLInputElement;
  const titleFilterWordsEl = document.getElementById('titleFilterWords') as HTMLTextAreaElement;
  const statusEl = document.getElementById('status') as HTMLDivElement;

  function fillForm(data: SettingsDataView): void {
    apiKeyHintEl.textContent = data.hasApiKey
      ? '已设置（留空保存 = 不修改；输入新的会覆盖旧的）'
      : '还没设置，回复消息前必须先填一个';
    baseURLEl.value = data.baseURL;
    modelEl.value = data.model;
    toggleShortcutEl.value = data.toggleShortcut;

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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '保存中…';
    statusEl.className = '';

    const patch: Partial<SettingsDataView> & { apiKey?: string } = {
      baseURL: baseURLEl.value.trim(),
      model: modelEl.value.trim(),
      toggleShortcut: toggleShortcutEl.value.trim(),
      activePersona: personaEl.value,
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
