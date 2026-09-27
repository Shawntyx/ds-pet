// 聊天面板逻辑。和 pet.ts/menu.ts 一样不用 import/export，直接当全局脚本跑。
// 运行时代码整体包一层 IIFE：这几个渲染脚本都是全局脚本，顶层标识符共享同一个作用域，
// 不包一层的话换个文件写个同名变量（比如 form/init）就会跟别的文件撞车报错。

interface Window {
  chatAPI: {
    getHistory(): Promise<{ role: 'user' | 'assistant'; content: string }[]>;
    sendMessage(text: string): void;
    onDelta(callback: (delta: string) => void): void;
    onDone(callback: () => void): void;
    onError(callback: (message: string) => void): void;
  };
}

(function () {
  const messagesEl = document.getElementById('messages') as HTMLDivElement;
  const form = document.getElementById('composer') as HTMLFormElement;
  const input = document.getElementById('input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('send') as HTMLButtonElement;

  let pendingBubble: HTMLDivElement | null = null;
  let sending = false;

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

  function setSending(next: boolean): void {
    sending = next;
    sendBtn.disabled = next;
    input.disabled = next;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (sending) return;
    const text = input.value.trim();
    if (!text) return;

    addMessage('user', text);
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
    setSending(false);
  });

  window.chatAPI.onError((message) => {
    if (pendingBubble && !pendingBubble.textContent) {
      pendingBubble.remove();
    } else {
      pendingBubble?.classList.remove('pending');
    }
    pendingBubble = null;
    addMessage('error', message);
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
