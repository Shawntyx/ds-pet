// 气泡悬浮窗内容：上面显示文字（点一下打开完整聊天面板）+ 右上角 × 主动关闭，
// 下面一行输入框可以直接回话。
// 和其他渲染脚本一样不用 import/export，直接当全局脚本跑。

interface Window {
  bubbleAPI: {
    onSetText(callback: (text: string) => void): void;
    sendMessage(text: string): void;
    onDelta(callback: (delta: string) => void): void;
    onDone(callback: () => void): void;
    onStopped(callback: (payload: { text: string } | null) => void): void;
    onError(callback: (message: string) => void): void;
    openChat(): void;
    close(): void;
  };
}

(function () {
  const bubbleEl = document.getElementById('bubble') as HTMLDivElement;
  const closeBtn = document.getElementById('closeBubble') as HTMLButtonElement;
  const form = document.getElementById('quickForm') as HTMLFormElement;
  const input = document.getElementById('quickInput') as HTMLInputElement;

  let streaming = false;

  window.bubbleAPI.onSetText((text) => {
    if (streaming) return; // 正在流式显示自己这边的回复，别被外部触发的气泡打断
    bubbleEl.textContent = text;
  });

  bubbleEl.addEventListener('click', () => {
    window.bubbleAPI.openChat();
  });

  // 主动收起气泡（用户回过话的气泡不会自动消失，只能点这里关）。
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.bubbleAPI.close();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (streaming) return; // 上一次还在回，别连发（主进程那边也有单轮锁）
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    streaming = true;
    input.disabled = true; // 等回复期间锁住输入框，避免连发互相覆盖
    bubbleEl.textContent = '';
    window.bubbleAPI.sendMessage(text);
  });

  function finishStreaming(): void {
    streaming = false;
    input.disabled = false;
    input.focus();
  }

  window.bubbleAPI.onDelta((delta) => {
    bubbleEl.textContent += delta;
  });

  window.bubbleAPI.onDone(() => {
    finishStreaming();
  });

  window.bubbleAPI.onStopped((payload) => {
    if (!payload) bubbleEl.textContent = '（已停止）';
    finishStreaming();
  });

  window.bubbleAPI.onError((message) => {
    streaming = false;
    input.disabled = false;
    bubbleEl.textContent = message;
  });
})();
