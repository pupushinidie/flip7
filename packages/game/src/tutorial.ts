/**
 * 新手教程的剧本（翻七）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器。三人局：你、咕噜一号、咕噜二号。
 * 牌堆顶按 TUTORIAL_DECK 摆好（整局用不完一副牌，不会洗牌），对手按剧本走，
 * 所以「咕噜一号爆掉」「翻三逼爆」「二次机会挡一次」「咕噜二号翻七」这几幕一定发生。
 * 从一局的后半段（第 6 轮，大家都快到 200 分）开始，打两轮就分出胜负：咕噜二号翻七冲过 200，你总分更高赢下。
 * 剧本走完接一局练习：新开三人局，对手交给人机。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tutorial="…"）、
 * 等玩家做什么（do 步骤的 expect）。改了规则或界面，tutorial.test.ts 会检查剧本还能不能从头走到尾。
 */
import { apply, createGame, targetsFor } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px）。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值。
   * 固定的有 goal、hit、stay、risk、targets、summary、ready、standings、hint；
   * 一位玩家的座位是 seat:<玩家 id>，他手里的二次机会是 sc:<玩家 id>，
   * 选目标时的按钮是 target:<玩家 id>，结算框里的一行是 final:<玩家 id>。
   */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand })
  /** 对手按剧本自动走这几步（谁走由局面决定），牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly GameCommand[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_RIVALS = [
  { id: "p2", name: "咕噜一号" },
  { id: "p3", name: "咕噜二号" },
] as const;
const ONE = "p2";
const TWO = "p3";

const HIT: GameCommand = { type: "HIT" };
const STAY: GameCommand = { type: "STAY" };

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // ── 第 6 轮：要牌、修饰牌、爆掉的风险、冻结、停牌、结算 ──
  {
    kind: "info", id: "goal", lesson: "目标", anchor: "goal",
    say: "翻七比的是谁先攒到 200 分。",
    note: "一局打好几轮，每轮的得分加进总分。我们从一局的后半段开始，大家都快到 200 了。",
  },
  {
    kind: "info", id: "deal", lesson: "翻牌攒分", anchor: `seat:${TUTORIAL_SELF}`,
    say: "每轮开始，每人先明发一张牌。",
    note: "你拿到 8。面前的数字牌加起来，就是你这一轮的分。",
  },
  { kind: "do", id: "hit", anchor: "hit", expect: HIT, say: "点「要牌」，再翻一张。" },
  {
    kind: "watch", id: "rivals1",
    say: "8 + 12，你这轮有 20 分了。轮到两个咕噜。",
    moves: [HIT, HIT],
  },
  {
    kind: "info", id: "times2", lesson: "修饰牌", anchor: `seat:${TWO}`,
    say: "咕噜二号翻到「×2」：它这一轮的分翻倍。",
    note: "×2 和 +2 到 +10 都是修饰牌：只加分，永远不会让人爆掉，也不算进「七张数字」。",
  },
  {
    kind: "info", id: "risk", lesson: "爆掉的风险", anchor: "risk", face: "think",
    say: "翻到和自己面前重复的数字，就「爆掉」。",
    note: "爆掉的人这一轮 0 分。这里一直显示你再要一张会爆掉的概率，牌越多越危险。",
  },
  { kind: "do", id: "hit2", anchor: "hit", expect: HIT, say: "还不算危险，再要一张。" },
  {
    kind: "info", id: "freeze", lesson: "冻结", anchor: "targets",
    say: "翻到「冻结」：交给谁，谁就立刻停牌。",
    note: "被冻结的人按现在的牌计分。可以给自己，也可以给任何还在要牌的人。",
  },
  {
    kind: "do", id: "freezeTwo", anchor: `target:${TWO}`, expect: { type: "TARGET", target: TWO },
    say: "冻结咕噜二号。",
    note: "它面前只有一张 6（×2 也才 12 分），冻住它，这一轮它就只能拿这么多。",
  },
  {
    kind: "watch", id: "rivalBust",
    say: "咕噜二号被冻住了，轮到咕噜一号。",
    moves: [HIT],
  },
  {
    kind: "info", id: "bust", anchor: `seat:${ONE}`, face: "surprised",
    say: "咕噜一号又翻到 11，爆了！",
    note: "爆掉的人这一轮的牌全部作废，0 分；以前攒的总分不会丢。",
  },
  {
    kind: "do", id: "stay", lesson: "停牌", anchor: "stay", expect: STAY,
    say: "见好就收：点「停牌」。",
    note: "停牌就锁住这一轮的分。只剩你还在要牌，再贪就只是在冒险了。",
  },
  {
    kind: "info", id: "summary", lesson: "一轮结算", anchor: "summary",
    say: "所有人都停牌或爆掉，这一轮结束。",
    note: "没爆的人把本轮分加进总分：你 +20，咕噜二号 6×2 = +12，咕噜一号 0。",
  },
  {
    kind: "do", id: "ready", anchor: "ready", expect: { type: "READY" },
    say: "点「下一轮」。",
    note: "庄家换成下一位；用过的牌放一边，牌堆摸光了才把它们洗回来。",
  },

  // ── 第 7 轮：二次机会、翻三、停牌、翻七、终局 ──
  {
    kind: "info", id: "second", lesson: "二次机会", anchor: `sc:${TUTORIAL_SELF}`,
    say: "这轮你发到「二次机会」，先留在手里。",
    note: "下次翻到重复的数字，它替你挡掉一次爆掉。每人最多拿一张，再翻到第二张就要送给别人。",
  },
  {
    kind: "watch", id: "rivals2",
    say: "你是这轮的庄家，从你左边的咕噜一号开始。",
    moves: [HIT, HIT],
  },
  { kind: "do", id: "hit3", anchor: "hit", expect: HIT, say: "轮到你了，要牌。" },
  {
    kind: "watch", id: "rivals3",
    say: "看看两个咕噜。",
    moves: [HIT, HIT],
  },
  { kind: "do", id: "hit4", anchor: "hit", expect: HIT, say: "再要一张。" },
  {
    kind: "do", id: "flipThree", lesson: "翻三", anchor: `target:${ONE}`, expect: { type: "TARGET", target: ONE },
    say: "「翻三」：交给谁，谁就得一口气连翻三张。",
    note: "交给咕噜一号：它有三张大数字、33 分，连翻三张很容易撞上重复。",
  },
  {
    kind: "info", id: "flipBust", anchor: `seat:${ONE}`, face: "surprised",
    say: "第二张就翻到 11，咕噜一号又爆了！",
    note: "翻三途中翻到冻结、翻三这些牌，要等三张都翻完、没爆，才由被翻的人处理。",
  },
  {
    kind: "watch", id: "rivals4",
    say: "轮到咕噜二号。",
    moves: [HIT],
  },
  { kind: "do", id: "hit5", anchor: "hit", expect: HIT, say: "要牌。" },
  {
    kind: "info", id: "saved", anchor: `seat:${TUTORIAL_SELF}`, face: "surprised",
    say: "又是 12！二次机会替你挡掉了这次爆掉。",
    note: "重复的 12 和二次机会一起弃掉，你接着玩。",
  },
  {
    kind: "watch", id: "rivals5",
    say: "轮到咕噜二号。",
    moves: [HIT],
  },
  {
    kind: "do", id: "stay2", anchor: "stay", expect: STAY, face: "think",
    say: "没有二次机会护身了，点「停牌」。",
    note: "咕噜二号已经有 5 张不同的数字，看它敢不敢接着翻。",
  },
  {
    kind: "watch", id: "rivals6",
    say: "只剩咕噜二号还在要牌……",
    moves: [HIT, HIT],
  },
  {
    kind: "info", id: "flip7", lesson: "翻七", anchor: `seat:${TWO}`, face: "surprised",
    say: "咕噜二号凑齐 7 张不同的数字：翻七！",
    note: "翻七额外 +15，这一轮立刻结束；其他没爆的人照常计分。",
  },
  {
    kind: "info", id: "end", lesson: "谁赢", anchor: `final:${TUTORIAL_SELF}`, face: "happy",
    say: "有人总分到 200，这一轮打完游戏就结束。",
    note: "总分最高的人赢：咕噜二号翻七冲到 202，可你有 204，你赢了！",
  },
  {
    kind: "info", id: "rules", lesson: "限时和托管",
    say: "真实对局里每个决定限时 30 秒，连续超时 2 次就转成人机托管。",
    note: "托管就是人机替你打，点「取消托管」就收回。房主开「残酷模式」时，修饰牌要选给谁，翻七可以改成罚对手 −15。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了！",
    note: "接下来和两个咕噜从头打一局练习。拿不准的时候点「提示」（键盘 T），我告诉你我会怎么走。",
  },
];

/**
 * 剧本里依次翻出的牌（cardKey，第一个最先翻到），摆在牌堆顶：
 * 第 6 轮发牌是你、咕噜一号、咕噜二号（咕噜二号当庄家），第 7 轮是咕噜一号、咕噜二号、你（你当庄家）。
 */
export const TUTORIAL_DECK: readonly string[] = [
  // 第 6 轮
  "n8", "n11", "n6", // 发牌
  "n12", // 你要牌
  "n9", "times2", // 咕噜一号、咕噜二号要牌
  "freeze", // 你要牌 → 冻结咕噜二号
  "n11", // 咕噜一号爆掉
  // 第 7 轮
  "n10", "n4", "secondChance", // 发牌
  "n12", "n1", // 咕噜一号、咕噜二号
  "n12", // 你要牌
  "n11", "n0", // 咕噜一号、咕噜二号
  "flipThree", // 你要牌 → 交给咕噜一号
  "n6", "n11", // 咕噜一号翻三：第二张爆掉
  "n2", // 咕噜二号
  "n12", // 你：重复，二次机会挡掉
  "n3", // 咕噜二号
  "n5", "n6", // 你停牌后咕噜二号连要两张：翻七
];

/** 剧本开局时的总分（你、咕噜一号、咕噜二号）和轮次。 */
export const TUTORIAL_SCORES = [172, 178, 154] as const;
export const TUTORIAL_ROUND = 6;

const players = (selfName: string) => [{ id: TUTORIAL_SELF, name: selfName }, ...TUTORIAL_RIVALS];

/** 教程开局：三人局、不开残酷模式、第 6 轮、咕噜二号当庄家（你第一个拿牌、第一个要牌）。 */
export function createTutorialGame(selfName: string, seed = 20261010): GameState {
  const game = createGame(players(selfName), seed, { brutal: false }, { top: TUTORIAL_DECK, dealer: 2 });
  game.players.forEach((player, index) => { player.score = TUTORIAL_SCORES[index]!; });
  game.round = TUTORIAL_ROUND;
  const renumber = (event: GameState["events"][number]) => (event.type === "RoundStarted" ? { ...event, round: TUTORIAL_ROUND } : event);
  game.events = game.events.map(renumber);
  game.history = game.history.map(renumber);
  return game;
}

/** 练习局：新开一局三人局（随机），和教程一样不开残酷模式。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame(players(selfName), seed, { brutal: false });
}

/**
 * 教程里走一步：结算画面上你点「下一轮」时，两个咕噜先跟着点（人机总是马上准备好），
 * 所以下一轮立刻开始。其他命令照常交给引擎。
 */
export function tutorialApply(state: GameState, playerId: string, command: GameCommand): GameState {
  let game = state;
  if (command.type === "READY" && game.stage === "roundEnd") {
    for (const player of game.players) {
      if (player.id !== playerId && !game.ready.includes(player.id)) game = apply(game, player.id, { type: "READY" }).state;
    }
  }
  return apply(game, playerId, command).state;
}

/** 现在等谁做决定：结算画面等你点「下一轮」；对局结束返回 null。 */
export function tutorialActor(state: GameState, self: string = TUTORIAL_SELF): string | null {
  if (state.phase !== "playing") return null;
  if (state.stage === "roundEnd") return state.ready.includes(self) ? null : self;
  return state.players[state.actor]?.id ?? null;
}

/** 两条命令是不是同一步（交牌和翻七要比较给谁）。 */
export function sameCommand(a: GameCommand, b: GameCommand): boolean {
  if (a.type !== b.type) return false;
  if ((a.type === "TARGET" && b.type === "TARGET") || (a.type === "FLIP7" && b.type === "FLIP7")) return a.target === b.target;
  return true;
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard 的显示条件）。
 * viewer 是看界面的人（教程里就是你）。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
  const me = state.players.findIndex((player) => player.id === viewer);
  const myMove = state.phase === "playing" && state.actor === me && me !== -1;
  const [name, arg] = anchor.split(":") as [string, string | undefined];
  const player = arg === undefined ? undefined : state.players.find((candidate) => candidate.id === arg);
  switch (name) {
    case "goal":
      return true;
    case "hit":
    case "stay":
      return myMove && state.stage === "turn";
    case "risk":
      return state.players[me]?.status === "active";
    case "targets":
      return myMove && state.stage === "target";
    case "target": {
      const top = state.pending.at(-1);
      if (!myMove || state.stage !== "target" || top?.type !== "target" || !player) return false;
      return targetsFor(state, me, top.card).includes(state.players.indexOf(player));
    }
    case "summary":
      return state.phase === "playing" && state.stage === "roundEnd";
    case "ready":
      return state.phase === "playing" && state.stage === "roundEnd" && !state.ready.includes(viewer);
    case "standings":
      return state.phase === "finished";
    case "final":
      return state.phase === "finished" && player !== undefined;
    case "seat":
      return player !== undefined;
    case "sc":
      return player?.secondChance != null;
    default:
      return false;
  }
}
