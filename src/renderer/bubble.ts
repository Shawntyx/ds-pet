// 气泡悬浮窗内容，逻辑很简单，不用 import/export，直接当全局脚本跑。

interface Window {
  bubbleAPI: {
    onSetText(callback: (text: string) => void): void;
  };
}

(function () {
  const bubbleEl = document.getElementById('bubble') as HTMLDivElement;
  window.bubbleAPI.onSetText((text) => {
    bubbleEl.textContent = text;
  });
})();
