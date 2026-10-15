// "她刚刚主动说的那句话"的暂存处。
//
// 为什么单独一个模块：用户在气泡里回复主动说话时要开启一段新对话，并以那句话作为开头，
// 所以 bubbleWindow 需要知道"当前这条气泡是不是主动说话"。这件事由说话的一方（proactive.ts、
// 余额提醒）先登记、气泡弹出时再取走。
//
// 如果把这个状态直接放在 bubbleWindow 里，就会出现
//   chatSession → balance → bubbleWindow → chatSession
// 这样的循环依赖（绕回来时 chatSession 还没加载完）。放这里就是个谁都能引用的叶子模块。

let pending: string | null = null;

/** 登记"马上要弹出来的这句是主动说话"。 */
export function markProactiveLine(text: string): void {
  pending = text || null;
}

/** 取走并清空（气泡每次弹出时调一次，避免把上一句的状态带过来）。 */
export function consumeProactiveLine(): string | null {
  const text = pending;
  pending = null;
  return text;
}
