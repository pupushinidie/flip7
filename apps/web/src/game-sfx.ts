import { useEffect, useRef } from "react";
import type { GameEvent, GameState } from "@flip7/game";
import { sfx, synth } from "./gm-sound.js";

/**
 * 翻七的动作音效：每次对局状态的 version 变了，就按这一步的 events（引擎给的本次操作产生的事件）放声音，
 * 时间和牌桌上的翻牌动画对齐（每张新牌错开 STEP_MS，爆了 / 冻结 / 翻七的印章跟在那张牌后面）。
 *
 * - 自己的事（自己摸的牌、自己被冻结、自己翻七）响亮，别人的减半；观战时都算别人的。
 * - 第一次拿到状态（进房间、重连、观战刚进来、教程练习局重开）不出声；version 一下跳了很多步（断线回来）只提示轮到你。
 * - 招牌声音：翻七大奖（游乐场铃铛 + 上行琶音）、冻结（冰晶的叮叮）、二次机会挡下爆牌（盾牌一声「当」）。
 *
 * 开发时每个声音的名字记在 window.__sfxLog（测试脚本用来确认响的是哪个）。
 */

const STEP_MS = 260;

function log(name: string) {
  if (import.meta.env.DEV) (window as unknown as { __sfxLog?: string[] }).__sfxLog?.push(name);
}

/** 招牌：翻七大奖——游乐场摊位的铃铛连响，再一串上行琶音。 */
function jackpot(mine: boolean) {
  const v = synth.level(mine);
  for (let i = 0; i < 4; i += 1) {
    synth.tone(1760, { at: i * 0.09, duration: 0.12, volume: 0.13 * v, type: "square" });
    synth.tone(2637, { at: i * 0.09 + 0.01, duration: 0.1, volume: 0.06 * v });
  }
  [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => synth.tone(f, { at: 0.4 + i * 0.07, duration: 0.35, volume: 0.14 * v, type: "triangle" }));
  synth.tone(2093, { at: 0.85, duration: 0.6, volume: 0.1 * v, type: "triangle" });
  synth.noise({ at: 0.4, duration: 0.6, volume: 0.06 * v, filter: "highpass", freq: 6000 });
}

/** 招牌：冻结——高处滑下来的冰晶叮叮 + 一阵冷风。 */
function freeze(mine: boolean) {
  const v = synth.level(mine);
  synth.noise({ duration: 0.45, volume: 0.12 * v, filter: "highpass", freq: 5000, freqTo: 2500 });
  [3136, 2637, 2349, 1976].forEach((f, i) => synth.tone(f * synth.jitter(0.02), { at: 0.03 + i * 0.06, duration: 0.3, volume: 0.07 * v }));
  synth.tone(880, { at: 0.05, duration: 0.45, volume: 0.08 * v, type: "triangle", glideTo: 660 });
}

/** 招牌：二次机会挡下重复的数字——盾牌「当」的一声，带一点亮光。 */
function shield(mine: boolean) {
  const v = synth.level(mine);
  synth.noise({ duration: 0.04, volume: 0.3 * v, freq: 2500, q: 3 });
  synth.tone(1175, { duration: 0.5, volume: 0.16 * v, type: "triangle" });
  synth.tone(1760, { duration: 0.35, volume: 0.08 * v });
  synth.tone(1568, { at: 0.12, duration: 0.3, volume: 0.1 * v, type: "triangle" });
}

/** 别人领到二次机会：轻轻收进手里，带一下亮光。 */
function gotChance(mine: boolean) {
  sfx.draw(mine);
  synth.tone(1568, { at: 0.08, duration: 0.2, volume: 0.07 * synth.level(mine), type: "triangle" });
}

/** 结算画面里有人点了「下一轮」（别人的；自己的按钮自带轻点）。 */
function readyTick() {
  synth.tone(1175, { duration: 0.06, volume: 0.05, type: "triangle" });
}

/** 这一刻轮到自己做决定（要牌/停牌、给牌选目标、翻七选择）。 */
function needsMe(game: GameState, selfId: string): boolean {
  if (!selfId || game.phase !== "playing" || game.stage === "roundEnd" || game.actor < 0) return false;
  return game.players[game.actor]?.id === selfId;
}

interface Planned {
  at: number;
  name: string;
  play: () => void;
}

/** 把一步的事件排成声音时间表（毫秒）。返回最后一个声音的时间，后面的提示音接在它后面。 */
function plan(events: readonly GameEvent[], game: GameState, selfId: string): Planned[] {
  const mine = (...ids: (string | null | undefined)[]) => !!selfId && ids.includes(selfId);
  const out: Planned[] = [];
  const add = (at: number, name: string, play: () => void) => out.push({ at, name, play });
  // 和 GameBoard 的 freshFrom 一样数第几张新牌；前面有「新一轮」「翻三」这种先声明的事，翻牌整体往后挪一点。
  let step = 0;
  let base = 0;
  let cursor = 0;
  const cardAt = (k: number) => base + k * STEP_MS;
  for (const event of events) {
    switch (event.type) {
      case "RoundStarted":
        add(0, "roundStart", () => sfx.roundStart());
        base = 220;
        cursor = base;
        break;
      case "Drew": {
        const at = cardAt(step);
        const m = mine(event.player);
        add(at, "flip", () => sfx.flip(m));
        if (event.card.kind === "plus" || event.card.kind === "times2") add(at + 140, "coin", () => sfx.coin(m));
        step += 1;
        cursor = at + 160;
        break;
      }
      case "Busted": {
        const at = base + step * STEP_MS + 40;
        const m = mine(event.player);
        add(at, "bust", () => sfx.bust(m));
        cursor = at + 350;
        break;
      }
      case "Saved": {
        const at = base + step * STEP_MS + 40;
        const m = mine(event.player);
        add(at, "shield", () => shield(m));
        cursor = at + 300;
        break;
      }
      case "Stayed": {
        const m = mine(event.player);
        if (event.forced) add(cursor, "pass", () => sfx.pass(m));
        else add(cursor, "chips", () => sfx.chips(2, m));
        cursor += 200;
        break;
      }
      case "Frozen": {
        const at = Math.max(cursor, base + step * STEP_MS);
        const m = mine(event.by, event.target);
        add(at, "freeze", () => freeze(m));
        cursor = at + 350;
        break;
      }
      case "FlipThree": {
        const m = mine(event.by, event.target);
        add(cursor, "hit", () => sfx.hit(m));
        base = Math.max(base, cursor + 260 - step * STEP_MS);
        cursor = cardAt(step);
        break;
      }
      case "SecondChanceGiven": {
        const m = mine(event.by, event.target);
        add(cursor, "draw", () => gotChance(m));
        cursor += 200;
        break;
      }
      case "ModifierGiven": {
        const m = mine(event.by, event.target);
        add(cursor, "card", () => sfx.card(m));
        cursor += 180;
        break;
      }
      case "Discarded": {
        const m = mine(event.player);
        add(cursor, "pass", () => sfx.pass(m));
        cursor += 180;
        break;
      }
      case "Flip7": {
        const at = base + step * STEP_MS + 40;
        const m = mine(event.player);
        add(at, "jackpot", () => jackpot(m));
        cursor = at + 1100;
        break;
      }
      case "Flip7Choice": {
        const m = mine(event.player);
        if (event.target === null) add(cursor, "score", () => sfx.score(m, true));
        else {
          const hurt = mine(event.player, event.target);
          add(cursor, "hit", () => sfx.hit(hurt));
        }
        cursor += 300;
        break;
      }
      case "Reshuffled":
        add(cursor, "shuffle", () => sfx.shuffle());
        cursor += 350;
        break;
      case "TurnTimedOut":
        // 只有自己超时才响（别人的超时紧跟着是系统替他做的动作，那个动作本身会响）。
        if (mine(event.player)) {
          add(cursor, "timeout", () => sfx.timeout());
          cursor += 350;
        }
        break;
      case "RoundEnded": {
        const row = event.scores.find((s) => s.player === selfId);
        const me = game.players.find((p) => p.id === selfId);
        // 自己这轮有分（没爆）：结算时一声得分；爆掉的已经响过了。
        if (row && row.score > 0 && me?.status !== "busted" && !events.some((e) => e.type === "GameEnded")) {
          add(cursor + 250, "score", () => sfx.score(true, row.score >= 40));
        }
        cursor += 250;
        break;
      }
      case "GameEnded": {
        const won = !!selfId && event.winners.includes(selfId);
        add(cursor + 500, "gameOver", () => sfx.gameOver(won));
        cursor += 500;
        break;
      }
    }
  }
  return out;
}

/** 翻七的牌桌音效。selfId：自己的玩家 id，观战时传 ""。 */
export function useGameSfx(game: GameState, selfId: string) {
  const prev = useRef<GameState | null>(null);
  const timers = useRef<number[]>([]);
  /** 「轮到你」「交出回合」这类提示音：局面又变了（比如自己手快已经点了）就不再响。 */
  const prompts = useRef<number[]>([]);

  useEffect(() => () => [...timers.current, ...prompts.current].forEach((t) => window.clearTimeout(t)), []);

  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before || before === game) return;
    const later = (ms: number, name: string, play: () => void, prompt = false) => {
      const run = () => {
        log(name);
        play();
      };
      if (ms <= 0) run();
      else (prompt ? prompts : timers).current.push(window.setTimeout(run, ms));
    };
    if (game.version !== before.version) {
      prompts.current.forEach((t) => window.clearTimeout(t));
      prompts.current = [];
    }

    // 再来一局：新的一局从头开始（version 变小）。开局的声音由 useRoomSfx 负责；这里只补「轮到你」。
    if (game.version < before.version || (before.phase === "finished" && game.phase === "playing")) {
      if (before.phase === "finished") later(0, "gameStart", () => sfx.gameStart());
      if (needsMe(game, selfId)) later(900, "yourTurn", () => sfx.yourTurn(), true);
      return;
    }
    // 聊天、成员变化也会推整个房间（version 不变），不出声。
    if (game.version === before.version) return;

    const jump = game.version - before.version;
    let end = 0;
    // events 只有最后一步的事件：跳了一两步（教程里点「下一轮」时咕噜们一起点）照常放；跳了很多步（断线回来）就不放了。
    if (jump <= 5) {
      for (const item of plan(game.events, game, selfId)) {
        later(item.at, item.name, item.play);
        end = Math.max(end, item.at);
      }
      // 结算画面：别人点了「下一轮」
      if (game.stage === "roundEnd" && before.stage === "roundEnd" && game.ready.length > before.ready.length) {
        const added = game.ready.filter((id) => !before.ready.includes(id));
        if (added.some((id) => id !== selfId)) later(0, "ready", readyTick);
      }
    }

    const nowMine = needsMe(game, selfId);
    const wasMine = needsMe(before, selfId);
    const timedOut = game.events.some((e) => e.type === "TurnTimedOut" && e.player === selfId);
    if (nowMine && (!wasMine || game.stage !== before.stage)) later(end + 350, "yourTurn", () => sfx.yourTurn(), true);
    else if (wasMine && !nowMine && !timedOut && game.phase === "playing" && game.stage !== "roundEnd") later(end + 300, "turnPassed", () => sfx.turnPassed(), true);
  }, [game, selfId]);
}
