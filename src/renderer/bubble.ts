// 气泡悬浮窗内容：上面显示文字（点一下打开完整聊天面板）+ 右上角 × 主动关闭，
// 下面一行输入框可以直接回话。
// 和其他渲染脚本一样不用 import/export，直接当全局脚本跑。
//
// 高度：窗口高度由内容决定，量好之后报给主进程去调；气泡内部再高也不会把输入框挤出窗口
// （文字最多长到 CSS 里那个 max-height，再多就在气泡里滚动）。

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
    resize(height: number): void;
  };
}

(function () {
  const wrapEl = document.getElementById('bubbleWrap') as HTMLDivElement;
  const bubbleEl = document.getElementById('bubble') as HTMLDivElement;
  const closeBtn = document.getElementById('closeBubble') as HTMLButtonElement;
  const form = document.getElementById('quickForm') as HTMLFormElement;
  const input = document.getElementById('quickInput') as HTMLInputElement;

  let streaming = false;
  let resizeTimer: number | null = null;

  /**
   * 把"装下当前内容需要多高"报给主进程。body 的 gap 是 6px、上下 padding 是 4+4，
   * 这里一起算进去，免得每次都比实际需要矮一点、又触发一轮调整。
   */
  function reportSize(): void {
    const needed = Math.ceil(wrapEl.offsetHeight + form.offsetHeight + 6 + 8);
    window.bubbleAPI.resize(needed);
  }

  /** 流式回复时每个字都量一次太抖，攒一小会儿再报；文字一多就往上长，长到上限后内部滚动。 */
  function scheduleResize(): void {
    if (resizeTimer !== null) return;
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      reportSize();
    }, 120);
  }

  window.bubbleAPI.onSetText((text) => {
    if (streaming) return; // 正在流式显示自己这边的回复，别被外部触发的气泡打断
    bubbleEl.textContent = text;
    reportSize(); // 新气泡：立刻量一次，出现时就差不多是最终高度
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
    reportSize();
    window.bubbleAPI.sendMessage(text);
  });

  function finishStreaming(): void {
    streaming = false;
    input.disabled = false;
    input.focus();
    reportSize();
  }

  window.bubbleAPI.onDelta((delta) => {
    bubbleEl.textContent += delta;
    scheduleResize();
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
    reportSize();
  });

  // 窗口第一次显示前先量一次，别用默认高度出现。
  reportSize();
})();
