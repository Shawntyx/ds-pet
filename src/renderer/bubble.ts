// 气泡悬浮窗内容：上面显示文字（点一下打开完整聊天面板），下面一行输入框可以直接回话。
// 和其他渲染脚本一样不用 import/export，直接当全局脚本跑。

interface Window {
  bubbleAPI: {
    onSetText(callback: (text: string) => void): void;
    sendMessage(text: string): void;
    onDelta(callback: (delta: string) => void): void;
    onDone(callback: () => void): void;
    onError(callback: (message: string) => void): void;
    openChat(): void;
  };
}

(function () {
  const bubbleEl = document.getElementById('bubble') as HTMLDivElement;
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

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    streaming = true;
    bubbleEl.textContent = '';
    window.bubbleAPI.sendMessage(text);
  });

  window.bubbleAPI.onDelta((delta) => {
    bubbleEl.textContent += delta;
  });

  window.bubbleAPI.onDone(() => {
    streaming = false;
  });

  window.bubbleAPI.onError((message) => {
    streaming = false;
    bubbleEl.textContent = message;
  });
})();
