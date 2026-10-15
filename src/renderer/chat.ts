// 聊天面板逻辑。和 pet.ts/menu.ts 一样不用 import/export，直接当全局脚本跑。
// 运行时代码整体包一层 IIFE：这几个渲染脚本都是全局脚本，顶层标识符共享同一个作用域，
// 不包一层的话换个文件写个同名变量（比如 form/init）就会跟别的文件撞车报错。

interface Window {
  chatAPI: {
    getHistory(): Promise<{ role: 'user' | 'assistant'; content: string }[]>;
    sendMessage(text: string): void;
    cancel(): void;
    onDelta(callback: (delta: string) => void): void;
    onDone(callback: () => void): void;
    onStopped(callback: (payload: { text: string } | null) => void): void;
    onError(callback: (message: string) => void): void;
  };
}

(function () {
  const messagesEl = document.getElementById('messages') as HTMLDivElement;
  const form = document.getElementById('composer') as HTMLFormElement;
  const input = document.getElementById('input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('send') as HTMLButtonElement;
  const stopBtn = document.getElementById('stop') as HTMLButtonElement;

  let pendingBubble: HTMLDivElement | null = null;
  let sending = false;
  /** 最近一条用户消息的元素：发送失败/被停止时要给它打标记（主进程那边记录已经撤回了）。 */
  let lastUserEl: HTMLDivElement | null = null;

  function scrollToBottom(): void {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role: 'user' | 'assistant' | 'error', text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  /** 发送中：锁输入框、把"发送"换成"停止"。 */
  function setSending(next: boolean): void {
    sending = next;
    sendBtn.disabled = next;
    input.disabled = next;
    stopBtn.disabled = false;
    stopBtn.hidden = !next;
    if (!next) input.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (sending) return;
    const text = input.value.trim();
    if (!text) return;

    lastUserEl = addMessage('user', text);
    input.value = '';
    setSending(true);

    pendingBubble = addMessage('assistant', '');
    pendingBubble.classList.add('pending');

    window.chatAPI.sendMessage(text);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // 停止生成：主进程中断请求，结果通过 onStopped 回来（已经吐出来的部分会保留）。
  stopBtn.addEventListener('click', () => {
    stopBtn.disabled = true;
    stopBtn.textContent = '停止中…';
    window.chatAPI.cancel();
  });

  window.chatAPI.onDelta((delta) => {
    if (!pendingBubble) {
      pendingBubble = addMessage('assistant', '');
      pendingBubble.classList.add('pending');
    }
    pendingBubble.textContent += delta;
    scrollToBottom();
  });

  window.chatAPI.onDone(() => {
    pendingBubble?.classList.remove('pending');
    pendingBubble = null;
    stopBtn.textContent = '停止';
    setSending(false);
  });

  window.chatAPI.onStopped((payload) => {
    stopBtn.textContent = '停止';
    if (payload) {
      // 收到了半句：保留在面板上（记录里也留下了），标一下"这是停下来的"。
      if (pendingBubble) {
        pendingBubble.classList.remove('pending');
        pendingBubble.classList.add('stopped');
      }
    } else {
      // 一个字都没收到：主进程把那条提问也撤回了，界面上跟着标出来，别让人以为发出去了。
      pendingBubble?.remove();
      lastUserEl?.classList.add('withdrawn');
    }
    pendingBubble = null;
    setSending(false);
  });

  window.chatAPI.onError((message) => {
    if (pendingBubble && !pendingBubble.textContent) {
      pendingBubble.remove();
    } else {
      pendingBubble?.classList.remove('pending');
    }
    pendingBubble = null;
    // 失败时主进程会把那条提问从历史里撤回，界面上也要标出来，不然会以为"她只是没理我"。
    lastUserEl?.classList.add('failed');
    addMessage('error', message);
    stopBtn.textContent = '停止';
    setSending(false);
  });

  async function init(): Promise<void> {
    const history = await window.chatAPI.getHistory();
    for (const m of history) {
      addMessage(m.role, m.content);
    }
    input.focus();
  }

  void init();
})();
