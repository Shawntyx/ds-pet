// 姿势表 / 数值表：所有数值都来自 ASSETS.md（逐个文件核对原项目 whale-moe-core.js 得来），
// 以后要调姿势映射、点击区域、探头留白，只动这一个文件，不用在 700 行的 pet.ts 里翻。
//
// 渲染进程的这几个 .ts 都是"全局脚本"（故意不用 import/export，原因见 pet.ts 顶部），
// 由 index.html 按顺序加载；顶层 const 在浏览器里是所有 <script> 共享的，所以 pet.js 直接用 POSES。
// 类型也集中在这里声明——全局脚本共享同一个作用域，同名的类型/常量整个程序只能有一份。

type PetMenuAction = 'feed' | 'poke' | 'praise';

/** 和 src/shared/types.ts 里的 PresenceState 保持一致（渲染脚本不能 import 主进程模块，改的时候两边都要改）。 */
type PresenceState = 'active' | 'afk' | 'sleep';

/** 会持续跟踪/参与逻辑判断的"命名状态"；随机待机小动作池里的姿势不需要进这个联合类型，
 * 直接用文件名播放就行（见 idleActionFiles）。 */
type PetState =
  | 'idle'
  | 'walking'
  | 'dragging'
  | 'falling'
  | 'petHead'
  | 'petTail'
  | 'pokeBelly'
  | 'greet'
  | 'eat'
  | 'angry'
  | 'praise'
  | 'peekLeft'
  | 'peekRight'
  | 'peekHome'
  | 'thinking'
  | 'replyHappy'
  | 'replyShy'
  | 'replySad'
  | 'replyAngry'
  | 'replySurprised'
  | 'replyLove'
  | 'afk'
  | 'sleep'
  | 'night'
  | 'balanceLow';

/** 互动区域：相对窗口宽高的比例矩形（0~1），方便窗口尺寸变化时跟着缩放。 */
interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PoseTables {
  /** ASSETS.md §0 的点击判定区：先匹配尾巴（贴底部满宽），再匹配肚子，都不命中算头。 */
  zones: Record<'head' | 'tail' | 'belly', ZoneRect>;
  spriteFiles: Record<PetState, string>;
  /** persona.md 里约定的情绪标签 -> 状态名；识别不到就用 replyHappy。 */
  emotionState: Record<string, PetState>;
  /** 主进程在主动说话/余额提醒里指定的整张姿势名 -> 状态名；比情绪标签更具体，优先用。 */
  poseState: Record<string, PetState>;
  /** ASSETS.md §3：待机时随机轮换的小动作池，播几秒后回到 idle-cute。 */
  idleActionFiles: string[];
  reactionBubbles: Record<'petHead' | 'petTail' | 'pokeBelly', string[]>;
  /** 睡醒时冒的气泡，不然"突然站起来打招呼"会有点莫名其妙。 */
  wakeBubbles: string[];
  menuActionState: Record<PetMenuAction, PetState>;
  menuActionBubbles: Record<PetMenuAction, string[]>;
  /** 探头贴边的留白比例，见下面各字段的注释。 */
  peek: {
    leftPaddingFrac: number;
    rightPaddingFrac: number;
    bottomPaddingFrac: number;
    homeScale: number;
  };
  /** 离左/右边缘多近算"在边缘"，用于判断要不要触发探头。 */
  edgeThresholdPx: number;
  /** 往下拖超过正常站立线（groundY）多少像素算"拖到底边"，触发 home-peek。 */
  bottomEdgeThresholdPx: number;
}

const POSES: PoseTables = {
  // 和 src/shared/types.ts 里的 DEFAULT_ZONES 保持一致（渲染进程不能直接 import 主进程模块，改配置时两边都要改）。
  zones: {
    tail: { x: 0.0, y: 0.78, w: 1.0, h: 0.22 },
    belly: { x: 0.18, y: 0.45, w: 0.64, h: 0.33 },
    head: { x: 0.2, y: 0.0, w: 0.6, h: 0.45 },
  },

  spriteFiles: {
    idle: 'dsh-whale-state-idle-cute.webp',
    // running.webp 画的其实是"抱着笔记本电脑"，是阶段 2/3 的"工作中"姿势，不是走路动画，
    // 这里素材没有专门的走路姿势，就用待机图 + CSS 上下晃动凑一个走路的感觉。
    walking: 'dsh-whale-state-idle-cute.webp',
    dragging: 'dsh-whale-state-pick-up.webp',
    falling: 'dsh-whale-state-pick-up.webp',
    petHead: 'dsh-whale-state-react-head.webp',
    petTail: 'dsh-whale-state-react-tail.webp',
    pokeBelly: 'dsh-whale-state-react-belly.webp',
    greet: 'dsh-whale-state-greet.webp',
    eat: 'dsh-whale-state-eat.webp',
    angry: 'dsh-whale-state-angry.webp',
    praise: 'dsh-whale-state-tail-swing.webp',
    // ASSETS.md §10：settings-peek 扒左边缘，workbench-peek 扒右边缘，home-peek 扒底边/任务栏。
    peekLeft: 'dsh-whale-settings-peek.webp',
    peekRight: 'dsh-whale-workbench-peek.webp',
    peekHome: 'dsh-whale-home-peek.webp',
    // 阶段 2：等回复时思考，回复完按 persona.md 里的情绪标签切表情（默认 replyHappy）。
    thinking: 'dsh-whale-state-thinking.webp',
    replyHappy: 'dsh-whale-state-success.webp',
    replyShy: 'dsh-whale-state-blush.webp',
    replySad: 'dsh-whale-state-meme-cry.webp',
    replyAngry: 'dsh-whale-state-angry.webp',
    replySurprised: 'dsh-whale-state-meme-omg.webp',
    replyLove: 'dsh-whale-state-meme-heart.webp',
    // 阶段 3：用户走开趴下 / 深夜走开坐着睡 / 深夜提醒 / 余额不足。
    afk: 'dsh-whale-state-afk.webp',
    sleep: 'dsh-whale-state-sleep.webp',
    night: 'dsh-whale-state-night.webp',
    balanceLow: 'dsh-whale-state-balance-low.webp',
  },

  emotionState: {
    happy: 'replyHappy',
    shy: 'replyShy',
    sad: 'replySad',
    angry: 'replyAngry',
    surprised: 'replySurprised',
    love: 'replyLove',
  },

  poseState: {
    night: 'night',
    balanceLow: 'balanceLow',
    afk: 'afk',
    sleep: 'sleep',
  },

  idleActionFiles: [
    'dsh-whale-state-daily-eat.webp',
    'dsh-whale-state-daily-coffee.webp',
    'dsh-whale-state-daily-stretch.webp',
    'dsh-whale-state-daily-pajama.webp',
    'dsh-whale-state-daily-shower.webp',
    'dsh-whale-state-cool-shades.webp',
    'dsh-whale-state-meme-smug.webp',
    'dsh-whale-state-daily-picnic.webp',
    'dsh-whale-state-daily-cooking.webp',
    'dsh-whale-state-daily-fishing.webp',
    'dsh-whale-state-daily-painting.webp',
    'dsh-whale-state-daily-gaming.webp',
    'dsh-whale-state-tail-swing.webp',
    'dsh-whale-state-meme-music.webp',
    'dsh-whale-state-wink.webp',
  ],

  reactionBubbles: {
    petHead: ['诶、诶？！', '别、别乱摸啦…', '哼，心情变好了一点点'],
    petTail: ['尾巴不可以随便碰！', '呜哇！', '…其实还挺舒服的'],
    pokeBelly: ['肚、肚子不可以戳！', '嗯啊！？', '别戳啦，会笑出来的'],
  },

  wakeBubbles: ['啊…你回来啦', '唔…我睡着了…你回来啦', '你回来啦！我一直在等你哦'],

  menuActionState: {
    feed: 'eat',
    poke: 'angry',
    praise: 'praise',
  },

  menuActionBubbles: {
    feed: ['谢谢投喂～', '好吃！', '还要还要'],
    poke: ['诶，戳我干嘛！', '呜——', '别戳啦'],
    praise: ['嘿嘿，谢谢夸奖～', '哼，就知道一点点开心', '再多夸夸我嘛'],
  },

  // 探头素材自己带了对称留白，不是紧贴画布边缘画的——用 canvas 扫过 alpha 边界实测出来的：
  //   settings-peek（左边缘）：不透明内容在画布 25.8%~73.6% 之间
  //   workbench-peek（右边缘）：不透明内容在画布 27.7%~72.3% 之间
  //   home-peek（底边）：peek-calibration.json 里 padBottom=40/512≈7.8%
  // 如果贴边效果还是不对（离屏幕边缘有空隙，或者反而探出去太多），直接改这几个比例就行：
  // 数值越大 = 角色往屏幕外挪得越多（留白让得越多）；改完不用重新量，改完 npm run build 重启看效果。
  peek: {
    leftPaddingFrac: 0.275, // 优化后的，除非有其他需求不然不用改
    rightPaddingFrac: 0.294, // 同上
    bottomPaddingFrac: 0.096, // 同上
    // home-peek 是近景构图（只画头+手），头在 512×512 画布里占比比 idle-cute（全身构图）大很多，
    // 所以哪怕窗口一样大，头看起来也明显更大。这里把整张图整体缩小一点，
    // 缩放锚点定在窗口底部中间（正好是手扒着的地方），这样缩小后手还是贴着任务栏，只是头变小。
    // 数值越小头越小；调这个数不用管 bottomPaddingFrac，位置计算会自动跟着缩放比例走。
    homeScale: 0.75,
  },

  edgeThresholdPx: 5,
  bottomEdgeThresholdPx: 10,
};
