// 健康提醒 / 随机哲学问题用的固定台词库——不调模型，零成本、不依赖网络，
// 窗口标题吐槽因为要结合具体标题内容，才真的去调模型生成（见 chatSession.generateProactiveLine）。

export interface ProactiveLine {
  text: string;
  emotion: string | null;
  /** 可选：整张姿势名（如深夜提醒的 'night'），有就优先于 emotion（见 ASSETS.md §1）。 */
  pose?: string;
}

const SITTING_LINES: ProactiveLine[] = [
  { text: '都坐一个小时了，起来走两步啦，再坐下去真的要长蘑菇了。', emotion: 'angry' },
  { text: '喂，动一动嘛，再不起来我要开始碎碎念了哦。', emotion: 'angry' },
  { text: '休息一下吧，伸个懒腰、看看远处，眼睛也要休息的。', emotion: 'shy' },
];

const WATER_LINES: ProactiveLine[] = [
  { text: '记得喝水哦，别总是忘了~', emotion: 'happy' },
  { text: '水杯是不是又忘在旁边没碰过？快喝一口啦。', emotion: 'angry' },
  { text: '补水时间到，喝口水再继续吧。', emotion: 'happy' },
];

// 深夜提醒统一用 night 姿势（揉眼睛、头顶月亮），比只换个表情更贴题。
const LATE_NIGHT_LINES: ProactiveLine[] = [
  { text: '都几点了还不睡？明天起不来可别怪我没提醒你哦。', emotion: 'angry', pose: 'night' },
  { text: '夜深了，早点休息吧，我会在这里守着的。', emotion: 'love', pose: 'night' },
  { text: '再不睡的话，明天一整天都要没精神咯，早点睡嘛。', emotion: 'shy', pose: 'night' },
];

const PHILOSOPHICAL_QUESTIONS: string[] = [
  '如果鲸鱼一直不浮上来换气，它还算在呼吸吗？',
  '如果把忒修斯之船上的每块木板都换掉，它还是原来那艘船吗？',
  '镜子里的你，和你本人，到底谁才是"真正"的你？',
  '如果没有人观测，月亮晚上还在不在原地？',
  '如果你能完整复制一份自己的记忆放进另一个身体，那个"你"还是你吗？',
  '为什么是"有"而不是"无"？',
  '时间如果不流动了，我们还能感觉到它停止了吗？',
  '如果全世界的人都同时忘记了某种颜色的名字，那种颜色还存在吗？',
  '鱼知道自己生活在水里吗？',
  '如果梦里的你比现实里的你更快乐，哪一个才是更真实的人生？',
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickHealthLine(kind: 'sitting' | 'water' | 'lateNight'): ProactiveLine {
  if (kind === 'sitting') return pickRandom(SITTING_LINES);
  if (kind === 'lateNight') return pickRandom(LATE_NIGHT_LINES);
  return pickRandom(WATER_LINES);
}

export function pickPhilosophicalQuestion(): string {
  return pickRandom(PHILOSOPHICAL_QUESTIONS);
}
