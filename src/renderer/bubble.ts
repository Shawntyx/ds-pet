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
  let resizeScheduled = false;

  /**
   * 把"装下当前内容需要多高"报给主进程。
   *
   * 直接用 DOM 实测（气泡高度 + 两个元素之间的间距 + 输入框高度 + body 的上下 padding），
   * 而不是写死常量——CSS 以后调整留白也不会再算错高度（算矮了就会被贴底排从顶部裁掉）。
   */
  function reportSize(): void {
    const wrapRect = wrapEl.getBoundingClientRect();
    const formRect = form.getBoundingClientRect();
    const bodyStyle = window.getComputedStyle(document.body);
    const padTop = parseFloat(bodyStyle.paddingTop) || 0;
    const padBottom = parseFloat(bodyStyle.paddingBottom) || 0;
    const gap = Math.max(0, formRect.top - wrapRect.bottom);
    const needed = Math.ceil(wrapRect.height + gap + formRect.height + padTop + padBottom);
    window.bubbleAPI.resize(needed);
  }

  /**
   * 流式回复时每来一个字都要重新量高度，而且**必须跟得上文字**：
   * 窗口只要比内容矮一帧，贴底排就会把气泡顶部切掉（用户看到的就是"上面被剪切了"）。
   * 用 requestAnimationFrame 合帧：一帧最多量一次，既跟得上又不会太密集。
   */
  function scheduleResize(): void {
    if (resizeScheduled) return;
    resizeScheduled = true;
    window.requestAnimationFrame(() => {
      resizeScheduled = false;
      reportSize();
    });
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
