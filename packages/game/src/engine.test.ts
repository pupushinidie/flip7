import { describe, expect, it } from "vitest";
import {
  applyCommand,
  buildDeck,
  bustChance,
  cardKey,
  createGame,
  legalActions,
  redactGameForViewer,
  scorePlayer,
  stackDeck,
  timeoutTurn,
} from "./engine.js";
import { createRng } from "./rng.js";
import type { Card, Config, GameCommand, GameState } from "./types.js";

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `玩家${i}` }));

/** n 人局，庄家是最后一位，所以发牌和要牌都从 p0 开始；top 是牌堆顶依次摸到的牌。 */
function game(n: number, top: string[], config: Partial<Config> = {}): GameState {
  return createGame(players(n), 7, { brutal: false, ...config }, { top, dealer: n - 1 });
}

const p = (state: GameState, i: number) => state.players[i]!;
const values = (state: GameState, i: number) => p(state, i).numbers.map((card) => card.value);
const actorId = (state: GameState) => p(state, state.actor).id;
const act = (state: GameState, command: GameCommand) => applyCommand(state, actorId(state), command);
const hit = (state: GameState) => act(state, { type: "HIT" });
const stay = (state: GameState) => act(state, { type: "STAY" });
const give = (state: GameState, target: string) => act(state, { type: "TARGET", target });

/** 所有 94 张牌都还在：牌堆 + 弃牌堆 + 桌上 + 待处理，每张恰好一次。 */
function allCards(state: GameState): Card[] {
  const cards = [...state.deck!, ...state.discard!];
  for (const player of state.players) {
    cards.push(...player.numbers, ...player.modifiers, ...player.actions);
    if (player.secondChance) cards.push(player.secondChance);
    if (player.bustCard) cards.push(player.bustCard);
  }
  for (const item of state.pending) {
    if (item.type === "target") cards.push(item.card);
    else cards.push(...item.queued);
  }
  return cards;
}

describe("牌组", () => {
  it("94 张：数字 0–12 每个数字的张数等于它本身（0 有 1 张），行动牌各 3 张，修饰牌 6 张", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(94);
    const count = (key: string) => deck.filter((card) => cardKey(card) === key).length;
    expect(count("n0")).toBe(1);
    expect(count("n1")).toBe(1);
    for (let value = 2; value <= 12; value += 1) expect(count(`n${value}`)).toBe(value);
    expect(deck.filter((card) => card.kind === "number")).toHaveLength(79);
    for (const key of ["freeze", "flipThree", "secondChance"]) expect(count(key)).toBe(3);
    for (const key of ["plus2", "plus4", "plus6", "plus8", "plus10", "times2"]) expect(count(key)).toBe(1);
    expect(new Set(deck.map((card) => card.id)).size).toBe(94);
  });
});

describe("开局与回合", () => {
  it("从庄家左手边开始每人明发一张，然后从庄家左手边开始轮流要牌", () => {
    const state = game(3, ["n5", "n7", "n9"]);
    expect(values(state, 0)).toEqual([5]);
    expect(values(state, 1)).toEqual([7]);
    expect(values(state, 2)).toEqual([9]);
    expect(state.stage).toBe("turn");
    expect(state.actor).toBe(0);
    expect(state.deckCount).toBe(91);
    expect(redactGameForViewer(state, "p0").deck).toBeUndefined();
  });

  it("要到重复数字就爆掉，本轮 0 分；停牌后不再轮到他", () => {
    let state = game(3, ["n5", "n7", "n9", "n5", "n2"]);
    state = hit(state); // p0 又摸到 5
    expect(p(state, 0).status).toBe("busted");
    expect(p(state, 0).bustCard?.value).toBe(5);
    expect(state.actor).toBe(1);
    state = stay(state); // p1 停牌
    expect(state.actor).toBe(2);
    state = hit(state); // p2 摸到 2
    expect(values(state, 2)).toEqual([9, 2]);
    expect(state.actor).toBe(2); // 只剩他一个还在要牌
    state = stay(state);
    expect(state.stage).toBe("roundEnd");
    expect(state.players.map((player) => player.lastRound!.total)).toEqual([0, 7, 11]);
    expect(state.players.map((player) => player.score)).toEqual([0, 7, 11]);
  });

  it("修饰牌和行动牌不会让人爆掉；×2 是数字加修饰之后再翻倍", () => {
    let state = game(3, ["n5", "n7", "n9", "plus4", "times2", "plus10", "n3"]);
    state = hit(state); // p0 +4
    state = hit(state); // p1 ×2
    state = hit(state); // p2 +10
    state = hit(state); // p0 3
    expect(state.players.map((player) => player.status)).toEqual(["active", "active", "active"]);
    expect(scorePlayer(state, 0)).toMatchObject({ numbers: 8, plus: 4, doubled: false, total: 12 });
    expect(scorePlayer(state, 1)).toMatchObject({ numbers: 7, doubled: true, total: 14 });
    expect(scorePlayer(state, 2).total).toBe(19);
  });
});

describe("二次机会", () => {
  it("抵消一次爆掉：重复的牌和二次机会一起弃掉，继续要牌", () => {
    let state = game(3, ["n5", "n7", "n9", "secondChance", "n1", "n2", "n5"]);
    state = hit(state); // p0 拿到二次机会
    expect(p(state, 0).secondChance).not.toBeNull();
    expect(bustChance(state, p(state, 0))).toBe(0);
    state = hit(state);
    state = hit(state);
    const discard = state.discardCount;
    state = hit(state); // p0 又摸到 5
    expect(p(state, 0).status).toBe("active");
    expect(p(state, 0).secondChance).toBeNull();
    expect(values(state, 0)).toEqual([5]);
    expect(state.discardCount).toBe(discard + 2);
    expect(state.events.some((event) => event.type === "Saved")).toBe(true);
  });

  it("已经有一张再摸到，要交给别的、还在要牌、手里没有二次机会的人", () => {
    let state = game(3, ["n5", "n7", "n9", "secondChance", "n1", "n2", "secondChance"]);
    state = hit(state);
    state = hit(state);
    state = hit(state);
    state = hit(state); // p0 第二张
    expect(state.stage).toBe("target");
    expect(state.actor).toBe(0);
    expect(legalActions(state, "p0")).toEqual([{ type: "TARGET", target: "p1" }, { type: "TARGET", target: "p2" }]);
    expect(() => give(state, "p0")).toThrow();
    state = give(state, "p2");
    expect(p(state, 2).secondChance).not.toBeNull();
    expect(state.stage).toBe("turn");
    expect(state.actor).toBe(1);
  });

  it("只有一个人能接就直接给他，不用问", () => {
    let state = game(3, ["secondChance", "secondChance", "n9", "secondChance"]);
    expect(p(state, 0).secondChance && p(state, 1).secondChance).toBeTruthy();
    state = hit(state); // p0 第二张：只有 p2 能接
    expect(p(state, 2).secondChance).not.toBeNull();
    expect(state.stage).toBe("turn");
    expect(state.actor).toBe(1);
  });

  it("没人能接就弃掉", () => {
    let state = game(3, ["secondChance", "n7", "secondChance", "secondChance"]);
    state = stay(state); // p0
    state = stay(state); // p1
    const discard = state.discardCount;
    state = hit(state); // p2 第二张：p0、p1 都停牌了
    expect(state.discardCount).toBe(discard + 1);
    expect(state.events.some((event) => event.type === "Discarded")).toBe(true);
    expect(state.actor).toBe(2);
  });
});

describe("冻结与翻三", () => {
  it("冻结：目标立刻停牌，按已有的牌计分", () => {
    let state = game(3, ["n5", "n7", "n9", "freeze"]);
    state = hit(state);
    expect(state.stage).toBe("target");
    expect(legalActions(state, "p0").map((action) => (action as { target: string }).target)).toEqual(["p1", "p2", "p0"]);
    state = give(state, "p2");
    expect(p(state, 2).status).toBe("frozen");
    expect(state.actor).toBe(1);
    state = stay(state);
    expect(state.actor).toBe(0);
  });

  it("翻三：目标连翻三张，翻出来的行动牌等三张翻完再处理", () => {
    let state = game(3, ["n5", "n7", "n9", "flipThree", "n1", "freeze", "n2"]);
    state = hit(state);
    state = give(state, "p1");
    expect(values(state, 1)).toEqual([7, 1, 2]);
    expect(state.stage).toBe("target"); // p1 给冻结选目标
    expect(state.actor).toBe(1);
    state = give(state, "p0");
    expect(p(state, 0).status).toBe("frozen");
    expect(state.actor).toBe(1); // p0 的回合结束，轮到 p1
  });

  it("翻三途中爆掉就停，攒下的行动牌作废", () => {
    let state = game(3, ["n5", "n7", "n9", "flipThree", "freeze", "n7", "n3"]);
    state = hit(state);
    state = give(state, "p1");
    expect(p(state, 1).status).toBe("busted");
    expect(values(state, 1)).toEqual([7]);
    expect(state.stage).toBe("turn");
    expect(state.actor).toBe(2);
    expect(state.deck!.at(-1)!.value).toBe(3); // 第三张没翻
  });

  it("翻三时翻到二次机会可以马上用", () => {
    let state = game(3, ["n5", "n7", "n9", "flipThree", "secondChance", "n7", "n4"]);
    state = hit(state);
    state = give(state, "p1");
    expect(p(state, 1).status).toBe("active");
    expect(values(state, 1)).toEqual([7, 4]);
  });

  it("发牌时摸到行动牌立即处理，然后接着发", () => {
    let state = game(3, ["freeze", "n7", "n9"]);
    expect(state.stage).toBe("target");
    expect(state.actor).toBe(0);
    state = give(state, "p1"); // p1 还没发到牌就被冻结，跳过
    expect(p(state, 1).status).toBe("frozen");
    expect(values(state, 1)).toEqual([]);
    expect(values(state, 2)).toEqual([7]);
    expect(state.stage).toBe("turn");
    expect(state.actor).toBe(0);
  });
});

describe("翻七", () => {
  // 发牌 0/7/9；p0 要到 1，p1 要到 12，p2 停或爆；p0 要到 2；p1 停；p0 一路要到 3 4 5 6 凑齐 7 张。
  const flip7Deck = (p2: string | null) => ["n0", "n7", "n9", "n1", "n12", ...(p2 ? [p2] : []), "n2", "n3", "n4", "n5", "n6"];
  function runToFlip7(state: GameState, p2Hits: boolean): GameState {
    state = hit(state); // p0 1
    state = hit(state); // p1 12
    state = p2Hits ? hit(state) : stay(state); // p2
    state = hit(state); // p0 2
    state = stay(state); // p1
    for (let i = 0; i < 4; i += 1) state = hit(state); // p0 3 4 5 6
    return state;
  }

  it("凑齐 7 张不同数字：本轮立刻结束，+15，其他没爆的照常计分", () => {
    const state = runToFlip7(game(3, flip7Deck(null)), false);
    expect(state.stage).toBe("roundEnd");
    expect(p(state, 0).flip7).toBe(true);
    expect(p(state, 0).lastRound).toMatchObject({ numbers: 21, bonus: 15, total: 36 });
    expect(p(state, 1).lastRound!.total).toBe(19);
    expect(p(state, 2).lastRound!.total).toBe(9);
    expect(state.events.find((event) => event.type === "RoundEnded")).toMatchObject({ reason: "flip7" });
  });

  it("翻七时还在要牌的人也按面前的牌计分", () => {
    let state = game(3, ["n0", "n7", "n9", "n1", "n2", "n3", "n4", "n5", "n6"]);
    state = hit(state); // p0 1
    state = hit(state); // p1 2
    state = hit(state); // p2 3
    state = hit(state); // p0 4
    state = stay(state); // p1
    state = stay(state); // p2
    state = hit(hit(state)); // p0 5 6 → 0 1 4 5 6 只有 5 张
    expect(state.stage).toBe("turn");
    expect(scorePlayer(state, 0).total).toBe(16);
  });

  it("残酷模式：翻七的人可以改成罚一位对手 −15，分数可以是负的", () => {
    let state = runToFlip7(game(3, flip7Deck("n9"), { brutal: true }), true);
    expect(p(state, 2).status).toBe("busted");
    expect(state.stage).toBe("flip7Choice");
    expect(state.actor).toBe(0);
    expect(legalActions(state, "p0")).toHaveLength(3);
    expect(() => act(state, { type: "FLIP7", target: "p0" })).toThrow();
    state = act(state, { type: "FLIP7", target: "p2" });
    expect(state.stage).toBe("roundEnd");
    expect(p(state, 0).lastRound).toMatchObject({ numbers: 21, bonus: 0, total: 21 });
    expect(p(state, 2).lastRound).toMatchObject({ busted: true, penalty: -15, total: -15 });
    expect(p(state, 2).score).toBe(-15);
  });

  it("残酷模式：翻七选自己 +15", () => {
    let state = runToFlip7(game(3, flip7Deck(null), { brutal: true }), false);
    state = act(state, { type: "FLIP7", target: null });
    expect(p(state, 0).lastRound!.total).toBe(36);
  });

  it("残酷模式：修饰牌可以交给已经爆掉的人", () => {
    let state = game(3, ["n5", "n7", "n9", "n5", "plus10"], { brutal: true });
    state = hit(state); // p0 爆
    state = hit(state); // p1 摸到 +10，要给人
    expect(state.stage).toBe("target");
    expect(legalActions(state, "p1")).toHaveLength(3);
    state = give(state, "p0");
    expect(p(state, 0).modifiers.map(cardKey)).toEqual(["plus10"]);
    expect(scorePlayer(state, 0).total).toBe(0);
  });
});

describe("多轮与终局", () => {
  it("下一轮：庄家往下一位轮换，用过的牌进弃牌堆，不洗回牌堆", () => {
    let state = game(3, ["n5", "n7", "n9"]);
    state = stay(stay(stay(state)));
    expect(state.stage).toBe("roundEnd");
    const deck = state.deckCount;
    state = applyCommand(state, "p0", { type: "READY" });
    state = applyCommand(state, "p1", { type: "READY" });
    expect(state.stage).toBe("roundEnd");
    state = applyCommand(state, "p2", { type: "READY" });
    expect(state.round).toBe(2);
    expect(state.dealer).toBe(0);
    expect(state.discardCount).toBeGreaterThanOrEqual(3);
    expect(state.deckCount).toBeLessThanOrEqual(deck - 3);
    expect(state.actor).toBe(1); // 庄家 p0 的左手边
  });

  it("牌堆摸光了把弃牌堆洗成新牌堆", () => {
    let state = game(3, ["n5", "n7", "n9"]);
    state = structuredClone(state);
    state.discard!.push(...state.deck!.splice(0, state.deck!.length - 1));
    state.deckCount = 1;
    state = hit(state);
    state = hit(state);
    expect(state.events.some((event) => event.type === "Reshuffled")).toBe(true);
    expect(allCards(state)).toHaveLength(94);
  });

  it("有人到 200 分，打完这一轮总分最高者获胜，一样高就并列", () => {
    let state = game(3, ["n5", "n7", "n9"]);
    state = structuredClone(state);
    state.players[0]!.score = 195;
    state.players[1]!.score = 193;
    state.players[2]!.score = 100;
    state = stay(stay(stay(state)));
    expect(state.phase).toBe("finished");
    expect(state.finalResult!.winners).toEqual(["p0", "p1"]); // 200 和 200
  });

  it("超时：要牌/停牌 → 停牌；冻结默认给自己；翻三默认给下一位；结算画面 → 下一轮", () => {
    let state = game(3, ["n5", "n7", "n9", "freeze", "flipThree", "n1", "n2", "n3"]);
    state = timeoutTurn(state);
    expect(p(state, 0).status).toBe("stayed");
    expect(state.events[0]).toMatchObject({ type: "TurnTimedOut", player: "p0", stage: "turn" });
    state = hit(state); // p1 摸到冻结
    state = timeoutTurn(state);
    expect(p(state, 1).status).toBe("frozen");
    state = hit(state); // p2 摸到翻三：只剩自己在要牌，直接给自己
    expect(values(state, 2)).toEqual([9, 1, 2, 3]);
    state = stay(state);
    expect(state.stage).toBe("roundEnd");
    state = timeoutTurn(state);
    expect(state.round).toBe(2);
  });
});

describe("随机对局", () => {
  it("几百局随机对局：牌不多不少、不会卡住、不变量成立", () => {
    let finished = 0;
    for (let g = 0; g < 200; g += 1) {
      const rng = createRng(1000 + g);
      const n = 3 + (g % 8);
      const brutal = g % 2 === 0;
      let state = createGame(players(n), 5000 + g, { brutal });
      const problems: string[] = [];
      for (let step = 0; step < 5000 && state.phase === "playing"; step += 1) {
        if (rng.next() < 0.03) {
          state = timeoutTurn(state);
        } else if (state.stage === "roundEnd") {
          for (const player of state.players) state = applyCommand(state, player.id, { type: "READY" });
        } else {
          const id = actorId(state);
          const actions = legalActions(state, id);
          if (actions.length === 0) problems.push(`${g}/${step}: 没有可做的操作`);
          const player = p(state, state.actor);
          let command = rng.pick(actions);
          if (state.stage === "turn") command = { type: player.numbers.length < 3 + rng.int(4) ? "HIT" : "STAY" };
          state = applyCommand(state, id, command);
        }
        const cards = allCards(state);
        if (cards.length !== 94 || new Set(cards.map((card) => card.id)).size !== 94) problems.push(`${g}/${step}: 牌数 ${cards.length}`);
        if (state.deckCount !== state.deck!.length) problems.push(`${g}/${step}: 牌堆张数不对`);
        for (const player of state.players) {
          const nums = player.numbers.map((card) => card.value);
          if (new Set(nums).size !== nums.length) problems.push(`${g}/${step}: ${player.id} 有重复数字`);
          if (nums.length > 7) problems.push(`${g}/${step}: ${player.id} 数字牌超过 7 张`);
          if (!brutal && player.score < 0) problems.push(`${g}/${step}: 普通模式出现负分`);
        }
        if (state.stage === "turn" && (state.actor !== state.currentPlayer || p(state, state.actor).status !== "active")) problems.push(`${g}/${step}: 轮到的人不在要牌`);
        if (state.stage !== "roundEnd" && state.phase === "playing" && state.actor < 0) problems.push(`${g}/${step}: 没有行动者`);
        if (problems.length > 0) break;
      }
      expect(problems).toEqual([]);
      if (state.phase === "finished") {
        finished += 1;
        const best = Math.max(...state.players.map((player) => player.score));
        expect(best).toBeGreaterThanOrEqual(200);
        expect(state.finalResult!.winners.every((id) => state.players.find((player) => player.id === id)!.score === best)).toBe(true);
      }
    }
    expect(finished).toBe(200);
  }, 60_000);
});
