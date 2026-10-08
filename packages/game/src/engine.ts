import { createRng, type Rng } from "./rng.js";
import type {
  Card,
  CardKind,
  Config,
  DrawVia,
  GameCommand,
  GameEvent,
  GameState,
  Pending,
  Player,
  RoundScore,
  Stage,
} from "./types.js";

export const HISTORY_LIMIT = 60;
export const PLUS_VALUES = [2, 4, 6, 8, 10] as const;

export function defaultConfig(_playerCount: number, overrides: Partial<Config> = {}): Config {
  return {
    minPlayers: 3,
    maxPlayers: 10,
    targetScore: 200,
    flip7Bonus: 15,
    brutal: true,
    stepTimeoutSec: 30,
    roundEndSec: 20,
    ...overrides,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

/** 整副 94 张牌（规则 2）。 */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (let value = 0; value <= 12; value += 1) {
    for (let copy = 0; copy < Math.max(1, value); copy += 1) cards.push({ id: id++, kind: "number", value });
  }
  for (const kind of ["freeze", "flipThree", "secondChance"] as const) {
    for (let copy = 0; copy < 3; copy += 1) cards.push({ id: id++, kind, value: 0 });
  }
  for (const value of PLUS_VALUES) cards.push({ id: id++, kind: "plus", value });
  cards.push({ id: id++, kind: "times2", value: 0 });
  return cards;
}

/** 牌的种类键：n0–n12、freeze、flipThree、secondChance、plus2–plus10、times2。 */
export function cardKey(card: Pick<Card, "kind" | "value">): string {
  if (card.kind === "number") return `n${card.value}`;
  if (card.kind === "plus") return `plus${card.value}`;
  return card.kind;
}

const isAction = (kind: CardKind) => kind === "freeze" || kind === "flipThree" || kind === "secondChance";
const isModifier = (kind: CardKind) => kind === "plus" || kind === "times2";

/** 一位玩家此刻（或本轮结束时）的得分。flip7Target 见 GameState。 */
export function scorePlayer(state: Pick<GameState, "config" | "players" | "flip7Player" | "flip7Target">, index: number): RoundScore {
  const player = state.players[index]!;
  const flipper = state.players[state.flip7Player];
  const penalty = state.config.brutal && flipper && flipper.id !== player.id && state.flip7Target === player.id ? -state.config.flip7Bonus : 0;
  if (player.status === "busted") {
    return { numbers: 0, plus: 0, doubled: false, bonus: 0, penalty, busted: true, total: penalty };
  }
  const numbers = player.numbers.reduce((sum, card) => sum + card.value, 0);
  const plus = player.modifiers.reduce((sum, card) => sum + (card.kind === "plus" ? card.value : 0), 0);
  const doubled = player.modifiers.some((card) => card.kind === "times2");
  // 规则 6：数字牌相加，再加修饰牌；有 ×2 就先加完再翻倍；最后加翻七奖励。
  const tookBonus = player.flip7 && !(state.config.brutal && typeof state.flip7Target === "string");
  const bonus = tookBonus ? state.config.flip7Bonus : 0;
  const total = (numbers + plus) * (doubled ? 2 : 1) + bonus + penalty;
  return { numbers, plus, doubled, bonus, penalty, busted: false, total };
}

const pid = (state: GameState, index: number) => state.players[index]?.id ?? "";

function indexOf(state: GameState, playerId: string): number {
  return state.players.findIndex((player) => player.id === playerId);
}

/** 从 from 的下一位开始按座位顺序数，最后才数到 from 自己。 */
function seatOrder(state: GameState, from: number): number[] {
  const n = state.players.length;
  return Array.from({ length: n }, (_, k) => (from + 1 + k) % n);
}

/** 这张要交出去的牌能给谁（players 下标，按座位顺序从 chooser 的下一位开始）。 */
export function targetsFor(state: GameState, chooser: number, card: Card): number[] {
  const order = seatOrder(state, chooser);
  switch (card.kind) {
    case "freeze":
    case "flipThree":
      // 只能给还在要牌的人（包括自己）。
      return order.filter((index) => state.players[index]!.status === "active");
    case "secondChance":
      // 自己已经有一张了，只能给别的、还在要牌、手里没有二次机会的人。
      return order.filter((index) => index !== chooser && state.players[index]!.status === "active" && !state.players[index]!.secondChance);
    case "plus":
    case "times2":
      // 残酷模式：谁都可以，包括已经爆掉的人。
      return order;
    default:
      return [];
  }
}

interface Ctx {
  readonly state: GameState;
  readonly rng: Rng;
  readonly events: GameEvent[];
}

/** 摸一张：牌堆空了先把弃牌堆洗成新牌堆（规则 7）；两边都空了返回 null。 */
function draw(ctx: Ctx): Card | null {
  const { state } = ctx;
  if (state.deck!.length === 0) {
    if (state.discard!.length === 0) return null;
    state.deck = ctx.rng.shuffle(state.discard!);
    state.discard = [];
    ctx.events.push({ type: "Reshuffled", count: state.deck.length });
  }
  return state.deck!.pop() ?? null;
}

/** 某人拿到一张牌（发牌、要牌、被翻三）。flip：正在翻三时，行动牌先攒起来。 */
function takeCard(ctx: Ctx, index: number, card: Card, via: DrawVia, flip?: Extract<Pending, { type: "flip" }>): void {
  const { state, events } = ctx;
  const player = state.players[index]!;
  events.push({ type: "Drew", player: player.id, card, via });
  if (card.kind === "number") {
    if (player.numbers.some((owned) => owned.value === card.value)) {
      if (player.secondChance) {
        // 规则 2.2：重复的牌和二次机会一起弃掉，继续游戏。
        state.discard!.push(card, player.secondChance);
        player.secondChance = null;
        events.push({ type: "Saved", player: player.id, card });
      } else {
        player.status = "busted";
        player.bustCard = card;
        events.push({ type: "Busted", player: player.id, card });
      }
      return;
    }
    player.numbers.push(card);
    if (player.numbers.length >= 7 && state.roundOver === null) {
      player.flip7 = true;
      state.flip7Player = index;
      state.roundOver = "flip7";
      events.push({ type: "Flip7", player: player.id });
    }
    return;
  }
  if (isModifier(card.kind) && !state.config.brutal) {
    player.modifiers.push(card);
    return;
  }
  if (card.kind === "secondChance" && !player.secondChance) {
    player.secondChance = card;
    return;
  }
  // 冻结、翻三、多出来的二次机会、残酷模式的修饰牌：要交给某人。翻三途中先攒着（规则 2.2）。
  if (flip) flip.queued.push(card);
  else state.pending.push({ type: "target", chooser: index, card });
}

/** 把 chooser 手上的牌交给 target。 */
function giveCard(ctx: Ctx, chooser: number, card: Card, target: number): void {
  const { state, events } = ctx;
  const to = state.players[target]!;
  const by = pid(state, chooser);
  switch (card.kind) {
    case "freeze":
      to.status = "frozen";
      to.actions.push(card);
      events.push({ type: "Frozen", by, target: to.id });
      break;
    case "flipThree":
      to.actions.push(card);
      events.push({ type: "FlipThree", by, target: to.id });
      state.pending.push({ type: "flip", target, remaining: 3, queued: [] });
      break;
    case "secondChance":
      to.secondChance = card;
      events.push({ type: "SecondChanceGiven", by, target: to.id });
      break;
    default:
      to.modifiers.push(card);
      events.push({ type: "ModifierGiven", by, target: to.id, card });
  }
}

/** 下一位还在要牌的人（从 from 的下一位数起，最后数到自己）；没有返回 -1。 */
function nextActive(state: GameState, from: number): number {
  return seatOrder(state, from).find((index) => state.players[index]!.status === "active") ?? -1;
}

/** 自动往下走（发牌、翻三、轮转），直到需要有人做决定，或者这一轮结束。 */
function advance(ctx: Ctx): void {
  const { state, events } = ctx;
  for (let guard = 0; guard < 2000; guard += 1) {
    if (state.roundOver) {
      // 这一轮结束了：没处理完的事作废，牌进弃牌堆。
      for (const item of state.pending) {
        if (item.type === "target") state.discard!.push(item.card);
        else state.discard!.push(...item.queued);
      }
      state.pending = [];
      state.dealQueue = [];
      if (state.roundOver === "flip7" && state.config.brutal && state.flip7Target === undefined) {
        state.stage = "flip7Choice";
        state.actor = state.flip7Player;
        return;
      }
      endRound(ctx);
      return;
    }
    const top = state.pending.at(-1);
    if (top?.type === "target") {
      const options = targetsFor(state, top.chooser, top.card);
      if (options.length === 0) {
        state.pending.pop();
        state.discard!.push(top.card);
        events.push({ type: "Discarded", player: pid(state, top.chooser), card: top.card });
        continue;
      }
      if (options.length === 1) {
        // 只有一个人能接（比如只剩自己还在要牌），不用问。
        state.pending.pop();
        giveCard(ctx, top.chooser, top.card, options[0]!);
        continue;
      }
      state.stage = "target";
      state.actor = top.chooser;
      return;
    }
    if (top?.type === "flip") {
      const target = state.players[top.target]!;
      if (target.status !== "active" || top.remaining === 0) {
        state.pending.pop();
        if (target.status === "busted") {
          // 翻三时爆掉：攒下的行动牌作废。
          for (const card of top.queued) {
            state.discard!.push(card);
            events.push({ type: "Discarded", player: target.id, card });
          }
        } else {
          // 三张翻完再逐张处理攒下的牌，先翻到的先处理。
          for (const card of [...top.queued].reverse()) state.pending.push({ type: "target", chooser: top.target, card });
        }
        continue;
      }
      const card = draw(ctx);
      if (!card) {
        top.remaining = 0;
        continue;
      }
      top.remaining -= 1;
      takeCard(ctx, top.target, card, "flip3", top);
      continue;
    }
    if (state.dealQueue.length > 0) {
      const index = state.dealQueue.shift()!;
      if (state.players[index]!.status !== "active") continue;
      const card = draw(ctx);
      if (!card) {
        state.dealQueue = [];
        continue;
      }
      takeCard(ctx, index, card, "deal");
      continue;
    }
    if (state.turnDone || state.players[state.currentPlayer]!.status !== "active") {
      const next = nextActive(state, state.currentPlayer);
      if (next === -1) {
        state.roundOver = "allDone";
        continue;
      }
      state.currentPlayer = next;
      state.turnDone = false;
    }
    state.stage = "turn";
    state.actor = state.currentPlayer;
    return;
  }
  throw new Error("对局卡住了。");
}

function endRound(ctx: Ctx): void {
  const { state, events } = ctx;
  const scores = state.players.map((player, index) => {
    const result = scorePlayer(state, index);
    player.lastRound = result;
    player.score += result.total;
    return { player: player.id, score: result.total, total: player.score };
  });
  state.stage = "roundEnd";
  state.actor = -1;
  state.ready = [];
  events.push({ type: "RoundEnded", round: state.round, reason: state.roundOver ?? "allDone", scores });
  const best = Math.max(...state.players.map((player) => player.score));
  if (best >= state.config.targetScore) {
    // 规则 8：打完这一轮，总分最高者获胜；一样高就并列。
    const winners = state.players.filter((player) => player.score === best).map((player) => player.id);
    state.phase = "finished";
    state.finalResult = { winner: winners[0]!, winners };
    events.push({ type: "GameEnded", winners });
  }
}

/** 新的一轮：桌上的牌进弃牌堆（不洗回牌堆），庄家往下一位轮换，从庄家左手边开始每人明发一张。 */
function startRound(ctx: Ctx, first = false): void {
  const { state, events } = ctx;
  for (const player of state.players) {
    state.discard!.push(...player.numbers, ...player.modifiers, ...player.actions);
    if (player.secondChance) state.discard!.push(player.secondChance);
    if (player.bustCard) state.discard!.push(player.bustCard);
    player.status = "active";
    player.numbers = [];
    player.modifiers = [];
    player.actions = [];
    player.secondChance = null;
    player.bustCard = null;
    player.flip7 = false;
  }
  state.round += 1;
  if (!first) state.dealer = (state.dealer + 1) % state.players.length;
  state.dealQueue = seatOrder(state, state.dealer);
  state.currentPlayer = state.dealer;
  state.turnDone = true;
  state.pending = [];
  state.flip7Player = -1;
  delete state.flip7Target;
  state.roundOver = null;
  state.ready = [];
  events.push({ type: "RoundStarted", round: state.round, dealer: pid(state, state.dealer) });
  advance(ctx);
}

/** 公开的牌堆信息：张数、各种牌还剩几张。 */
function syncCounts(state: GameState): void {
  state.deckCount = state.deck!.length;
  state.discardCount = state.discard!.length;
  const left: Record<string, number> = {};
  for (const card of state.deck!) left[cardKey(card)] = (left[cardKey(card)] ?? 0) + 1;
  state.deckLeft = left;
}

function finishStep(state: GameState, previous: GameState, rng: Rng, events: GameEvent[], log: GameState["log"]): { state: GameState; events: GameEvent[] } {
  syncCounts(state);
  state.rng = rng.state;
  state.version = previous.version + 1;
  state.events = events;
  state.history = [...previous.history, ...events].slice(-HISTORY_LIMIT);
  state.log = [...(previous.log ?? []), ...(log ?? [])];
  return { state, events };
}

function runCommand(state: GameState, playerId: string, command: GameCommand): { state: GameState; events: GameEvent[] } {
  if (state.phase !== "playing") throw new Error("对局已经结束。");
  const me = indexOf(state, playerId);
  if (me === -1) throw new Error("你不在这局里。");
  const next = structuredClone(state);
  const rng = createRng(next.rng ?? 1);
  const events: GameEvent[] = [];
  const ctx: Ctx = { state: next, rng, events };

  if (command.type === "READY") {
    if (next.stage !== "roundEnd") throw new Error("这一轮还没结束。");
    if (!next.ready.includes(playerId)) next.ready.push(playerId);
    if (next.ready.length >= next.players.length) startRound(ctx);
  } else {
    if (next.actor !== me) throw new Error("还没轮到你。");
    switch (command.type) {
      case "HIT": {
        if (next.stage !== "turn") throw new Error("现在不能要牌。");
        const card = draw(ctx);
        const player = next.players[me]!;
        if (!card) {
          // 牌堆和弃牌堆都空了（几乎不会发生）：只能停牌。
          player.status = "stayed";
          events.push({ type: "Stayed", player: playerId, forced: true });
        } else {
          takeCard(ctx, me, card, "hit");
        }
        next.turnDone = true;
        advance(ctx);
        break;
      }
      case "STAY": {
        if (next.stage !== "turn") throw new Error("现在不能停牌。");
        next.players[me]!.status = "stayed";
        events.push({ type: "Stayed", player: playerId });
        next.turnDone = true;
        advance(ctx);
        break;
      }
      case "TARGET": {
        const top = next.pending.at(-1);
        if (next.stage !== "target" || top?.type !== "target") throw new Error("现在没有要交出去的牌。");
        const target = indexOf(next, command.target);
        if (!targetsFor(next, me, top.card).includes(target)) throw new Error("这张牌不能给这位玩家。");
        next.pending.pop();
        giveCard(ctx, me, top.card, target);
        advance(ctx);
        break;
      }
      case "FLIP7": {
        if (next.stage !== "flip7Choice") throw new Error("现在不用选。");
        if (command.target !== null) {
          const target = indexOf(next, command.target);
          if (target === -1 || target === me) throw new Error("只能罚一位对手。");
        }
        next.flip7Target = command.target;
        events.push({ type: "Flip7Choice", player: playerId, target: command.target });
        advance(ctx);
        break;
      }
      default:
        throw new Error("未知操作。");
    }
  }
  return finishStep(next, state, rng, events, [{ player: playerId, command }]);
}

export function apply(state: GameState, playerId: string, command: GameCommand): { state: GameState; events: GameEvent[] } {
  return runCommand(state, playerId, command);
}

export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  return runCommand(state, playerId, command).state;
}

/** 某位玩家此刻能做的所有操作。 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase !== "playing") return [];
  const me = indexOf(state, playerId);
  if (me === -1) return [];
  if (state.stage === "roundEnd") return state.ready.includes(playerId) ? [] : [{ type: "READY" }];
  if (state.actor !== me) return [];
  if (state.stage === "turn") return [{ type: "HIT" }, { type: "STAY" }];
  if (state.stage === "target") {
    const top = state.pending.at(-1);
    if (top?.type !== "target") return [];
    return targetsFor(state, me, top.card).map((index) => ({ type: "TARGET", target: pid(state, index) }));
  }
  return [{ type: "FLIP7", target: null }, ...state.players.filter((_, index) => index !== me).map((player): GameCommand => ({ type: "FLIP7", target: player.id }))];
}

/** 超时没选目标时的默认目标：冻结给自己（停牌保分）；翻三给下一位还在要牌的对手；其他给座位顺序上的第一位。 */
export function defaultTarget(state: GameState, chooser: number, card: Card): number {
  const options = targetsFor(state, chooser, card);
  if (card.kind === "freeze" && options.includes(chooser)) return chooser;
  if (isModifier(card.kind) && options.includes(chooser)) return chooser;
  if (card.kind === "flipThree") return options.find((index) => index !== chooser) ?? options[0]!;
  return options[0]!;
}

/**
 * 超时自动处理：要牌/停牌 → 停牌；选目标 → defaultTarget；
 * 翻七选择 → 自己 +15；结算画面 → 开始下一轮。
 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "finished") return state;
  const stage = state.stage;
  if (stage === "roundEnd") {
    const next = structuredClone(state);
    const rng = createRng(next.rng ?? 1);
    const events: GameEvent[] = [];
    startRound({ state: next, rng, events });
    return finishStep(next, state, rng, events, [{ player: "", command: { type: "TIMEOUT" } }]).state;
  }
  const actor = state.players[state.actor]!;
  let command: GameCommand;
  if (stage === "turn") command = { type: "STAY" };
  else if (stage === "flip7Choice") command = { type: "FLIP7", target: null };
  else {
    const top = state.pending.at(-1) as Extract<Pending, { type: "target" }>;
    command = { type: "TARGET", target: pid(state, defaultTarget(state, state.actor, top.card)) };
  }
  const result = runCommand(state, actor.id, command);
  result.state.events = [{ type: "TurnTimedOut", player: actor.id, stage }, ...result.events];
  result.state.history = [...state.history, ...result.state.events].slice(-HISTORY_LIMIT);
  result.state.log = [...(state.log ?? []), { player: actor.id, command: { type: "TIMEOUT" } }];
  return result.state;
}

/** 服务端计时用：每一个决定单独计时；结算画面按轮计时（别人点「下一轮」不重置）。 */
export function timerKey(state: GameState): string {
  return state.stage === "roundEnd" ? `round-${state.round}` : `v${state.version}`;
}

export function timerSeconds(state: GameState): number {
  return state.stage === "roundEnd" ? state.config.roundEndSec : state.config.stepTimeoutSec;
}

/** 发给玩家看的状态：去掉牌堆顺序、弃牌堆、随机数和种子（桌上的牌都是明牌，没有别的隐藏信息）。 */
export function redactGameForViewer(state: GameState, _viewerId: string): GameState {
  const { deck: _deck, discard: _discard, rng: _rng, seed: _seed, log: _log, ...rest } = state;
  return rest;
}

export interface CreateOptions {
  /** 测试用：这些牌（cardKey）按顺序放在牌堆顶，先发先摸。 */
  readonly top?: readonly string[];
  /** 测试用：指定第一轮的庄家。 */
  readonly dealer?: number;
}

export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  overrides: Partial<Config> = {},
  options: CreateOptions = {},
): GameState {
  const config = defaultConfig(players.length, overrides);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  const rng = createRng(seed);
  const deck = rng.shuffle(buildDeck());
  if (options.top) stackDeck(deck, options.top);
  const state: GameState = {
    config,
    phase: "playing",
    players: players.map((player, index): Player => ({
      id: player.id,
      name: player.name,
      color: index,
      score: 0,
      status: "active",
      numbers: [],
      modifiers: [],
      secondChance: null,
      actions: [],
      bustCard: null,
      flip7: false,
      lastRound: null,
    })),
    round: 0,
    dealer: options.dealer ?? rng.int(players.length),
    currentPlayer: 0,
    stage: "turn",
    actor: 0,
    pending: [],
    dealQueue: [],
    turnDone: true,
    flip7Player: -1,
    roundOver: null,
    deckCount: deck.length,
    discardCount: 0,
    deckLeft: {},
    ready: [],
    events: [],
    history: [],
    version: 0,
    deck,
    discard: [],
    seed,
  };
  const events: GameEvent[] = [];
  startRound({ state, rng, events }, true);
  syncCounts(state);
  state.rng = rng.state;
  state.events = events;
  state.history = events.slice(-HISTORY_LIMIT);
  state.log = [];
  return state;
}

/** 把指定的牌（cardKey，第一个最先摸到）挪到牌堆顶。牌堆数组的末尾是堆顶。 */
export function stackDeck(deck: Card[], keys: readonly string[]): void {
  const picked: Card[] = [];
  for (const key of keys) {
    const at = deck.findIndex((card) => cardKey(card) === key);
    if (at === -1) throw new Error(`牌堆里没有 ${key}`);
    picked.push(deck.splice(at, 1)[0]!);
  }
  deck.push(...picked.reverse());
}

/** 再要一张会爆掉的概率（只看牌堆里剩下的牌；有二次机会算 0）。 */
export function bustChance(state: Pick<GameState, "deckLeft" | "deckCount">, player: Player): number {
  if (player.secondChance || state.deckCount === 0) return 0;
  const risky = player.numbers.reduce((sum, card) => sum + (state.deckLeft[cardKey(card)] ?? 0), 0);
  return risky / state.deckCount;
}

export { isAction, isModifier };
export type { Stage };
