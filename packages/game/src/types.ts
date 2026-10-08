/**
 * 翻七的牌：
 * - number：数字牌 0–12（每个数字的张数等于它本身，0 有 1 张），共 79 张；
 * - freeze / flipThree / secondChance：行动牌，各 3 张；
 * - plus：+2/+4/+6/+8/+10 修饰牌各 1 张；times2：×2 修饰牌 1 张。
 */
export type CardKind = "number" | "freeze" | "flipThree" | "secondChance" | "plus" | "times2";

export interface Card {
  /** 0–93，整副牌里唯一；界面用它做动画的 key。 */
  readonly id: number;
  readonly kind: CardKind;
  /** number：牌面数字；plus：加几分；其他为 0。 */
  readonly value: number;
}

export interface Config {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 有人累计到这个分数，打完这一轮就结束（规则 8）。 */
  readonly targetScore: number;
  /** 翻七奖励（规则 5）。 */
  readonly flip7Bonus: number;
  /**
   * 残酷模式（规则 9）：修饰牌可以交给任何玩家（包括已爆掉的）；
   * 翻七时可以改成让一位对手本轮 −15；所以本轮得分和总分都可能是负数。
   */
  readonly brutal: boolean;
  /** 每一个决定（要牌/停牌、给行动牌选目标、翻七选择）的限时；超时自动处理，见 timeoutTurn。 */
  readonly stepTimeoutSec: number;
  /** 每轮结算画面停留的秒数；所有人都点「下一轮」会提前开始。 */
  readonly roundEndSec: number;
}

/** active：还在要牌；stayed：自己停牌；frozen：被冻结（等于停牌）；busted：爆掉，本轮 0 分。 */
export type PlayerStatus = "active" | "stayed" | "frozen" | "busted";

export interface RoundScore {
  /** 数字牌之和。 */
  readonly numbers: number;
  /** +修饰牌之和。 */
  readonly plus: number;
  /** 有 ×2：(数字 + 修饰) 翻倍。 */
  readonly doubled: boolean;
  /** 翻七奖励（0 或 15）。 */
  readonly bonus: number;
  /** 残酷模式里被别人的翻七罚的分（0 或 −15）。 */
  readonly penalty: number;
  readonly busted: boolean;
  readonly total: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 座位色下标 0–9，开局按入座顺序定。 */
  readonly color: number;
  /** 累计总分；房间列表里当作「分数」显示。 */
  score: number;
  status: PlayerStatus;
  /** 本轮面前的数字牌，按拿到的先后排列；不会有重复数字（重复就爆掉了）。 */
  numbers: Card[];
  /** 本轮面前的修饰牌（+N、×2）。 */
  modifiers: Card[];
  /** 手里留着的二次机会（每人最多 1 张）。 */
  secondChance: Card | null;
  /** 本轮落在他身上的冻结 / 翻三，摆在面前给大家看，轮末弃掉。 */
  actions: Card[];
  /** 爆掉时那张重复的数字牌。 */
  bustCard: Card | null;
  /** 本轮凑齐了 7 张不同的数字牌。 */
  flip7: boolean;
  /** 最近一轮的得分明细（结算后才有）。 */
  lastRound: RoundScore | null;
}

/**
 * 待处理的事，按栈存（最后一项先处理）：
 * - target：有人拿到一张要交出去的牌（冻结 / 翻三 / 多出来的二次机会 / 残酷模式的修饰牌），等他选给谁；
 * - flip：某人正在被「翻三」，还要连翻 remaining 张；翻出来的行动牌先攒在 queued，翻完（没爆）再逐张处理。
 */
export type Pending =
  | { readonly type: "target"; readonly chooser: number; readonly card: Card }
  | { readonly type: "flip"; readonly target: number; remaining: number; readonly queued: Card[] };

/**
 * turn：轮到 currentPlayer 选要牌还是停牌；
 * target：actor 给手上的牌选目标；
 * flip7Choice：残酷模式下翻七的人选 +15 给自己还是 −15 给一位对手；
 * roundEnd：一轮结束，显示结算，等下一轮。
 */
export type Stage = "turn" | "target" | "flip7Choice" | "roundEnd";

export type GameCommand =
  | { readonly type: "HIT" }
  | { readonly type: "STAY" }
  /** 把 pending 顶上那张牌交给 target（玩家 id）。 */
  | { readonly type: "TARGET"; readonly target: string }
  /** 残酷模式翻七：target 为 null 是自己 +15，否则是让这位对手 −15。 */
  | { readonly type: "FLIP7"; readonly target: string | null }
  /** 结算画面：准备好下一轮。 */
  | { readonly type: "READY" };

export type DrawVia = "deal" | "hit" | "flip3";

export type GameEvent =
  | { readonly type: "RoundStarted"; readonly round: number; readonly dealer: string }
  | { readonly type: "Drew"; readonly player: string; readonly card: Card; readonly via: DrawVia }
  | { readonly type: "Busted"; readonly player: string; readonly card: Card }
  /** 二次机会抵消了一次爆掉：重复的牌和二次机会一起弃掉。 */
  | { readonly type: "Saved"; readonly player: string; readonly card: Card }
  | { readonly type: "Stayed"; readonly player: string; readonly forced?: boolean }
  | { readonly type: "Frozen"; readonly by: string; readonly target: string }
  | { readonly type: "FlipThree"; readonly by: string; readonly target: string }
  | { readonly type: "SecondChanceGiven"; readonly by: string; readonly target: string }
  | { readonly type: "ModifierGiven"; readonly by: string; readonly target: string; readonly card: Card }
  /** 没有人能接的牌（比如人人都有二次机会），直接弃掉；或者翻三时爆掉，攒下的行动牌作废。 */
  | { readonly type: "Discarded"; readonly player: string; readonly card: Card }
  | { readonly type: "Flip7"; readonly player: string }
  | { readonly type: "Flip7Choice"; readonly player: string; readonly target: string | null }
  | { readonly type: "Reshuffled"; readonly count: number }
  | { readonly type: "TurnTimedOut"; readonly player: string; readonly stage: Stage }
  | {
      readonly type: "RoundEnded";
      readonly round: number;
      readonly reason: "flip7" | "allDone";
      readonly scores: { readonly player: string; readonly score: number; readonly total: number }[];
    }
  | { readonly type: "GameEnded"; readonly winners: string[] };

export interface FinalResult {
  /** 第一位获胜者（并列时见 winners）。 */
  readonly winner: string;
  readonly winners: string[];
}

export interface GameState {
  readonly config: Config;
  phase: "playing" | "finished";
  players: Player[];
  /** 第几轮，从 1 开始。 */
  round: number;
  /** 本轮庄家（players 下标）；每轮往左（下一位）轮换。 */
  dealer: number;
  /** 轮到谁要牌 / 停牌。 */
  currentPlayer: number;
  stage: Stage;
  /** 此刻要做决定的人（players 下标）；roundEnd 时为 -1。 */
  actor: number;
  pending: Pending[];
  /** 本轮开局还没发到牌的人（按发牌顺序）。 */
  dealQueue: number[];
  /** currentPlayer 这次要牌已经结算完，该交给下一位了。 */
  turnDone: boolean;
  /** 本轮凑齐翻七的人（players 下标），没有为 -1。 */
  flip7Player: number;
  /** 残酷模式翻七的选择：undefined 还没选；null 自己 +15；否则是被罚 −15 的对手 id。 */
  flip7Target?: string | null;
  /** 本轮已经结束（还没进结算画面，比如翻七的人还在选）。 */
  roundOver: "flip7" | "allDone" | null;
  /** 牌堆和弃牌堆的张数。 */
  deckCount: number;
  discardCount: number;
  /**
   * 牌堆里各种牌还剩几张（键见 cardKey）。所有牌都是明着翻的，这是公开信息，
   * 界面用它算「再要一张爆掉的概率」。
   */
  deckLeft: Record<string, number>;
  /** 结算画面里已经点了「下一轮」的玩家 id。 */
  ready: string[];
  /** 本次操作产生的事件。 */
  events: GameEvent[];
  /** 最近的事件（最多 HISTORY_LIMIT 条），断线重连后还能看到动作记录。 */
  history: GameEvent[];
  finalResult?: FinalResult;
  /** 每个动作 +1；前端据此判断是不是新事件，服务端据此给每一步计时。 */
  version: number;
  /** 以下只在服务端：牌堆顺序、弃牌堆、随机数状态、种子、动作序列。 */
  deck?: Card[];
  discard?: Card[];
  rng?: number;
  seed?: number;
  log?: { player: string; command: GameCommand | { type: "TIMEOUT" } }[];
}
