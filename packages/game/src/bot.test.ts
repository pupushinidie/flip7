import { describe, expect, it } from "vitest";
import { botCommand } from "./bot.js";
import { applyCommand, createGame, legalActions, redactGameForViewer, timeoutTurn } from "./engine.js";
import type { Card, GameState } from "./types.js";

function newGame(count: number, seed: number): GameState {
  return createGame(Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` })), seed);
}

let nextId = 1000;
const number = (value: number): Card => ({ id: nextId++, kind: "number", value });

/** p1 要牌 / 停牌的局面：面前是 values，牌堆里各种牌按 deckLeft。 */
function deciding(values: number[], deckLeft: Record<string, number>): GameState {
  const game = newGame(3, 1);
  game.stage = "turn";
  game.actor = 0;
  game.currentPlayer = 0;
  game.pending = [];
  game.players.forEach((player) => { player.status = "active"; player.numbers = []; player.modifiers = []; player.secondChance = null; });
  game.players[0]!.numbers = values.map(number);
  game.deckLeft = deckLeft;
  game.deckCount = Object.values(deckLeft).reduce((sum, count) => sum + count, 0);
  return game;
}

describe("人机", () => {
  it("不用它做决定时不行动", () => {
    const game = newGame(3, 3);
    const idle = game.players.find((_, index) => index !== game.actor)!;
    expect(botCommand(game, idle.id)).toBeNull();
  });

  it("全由人机打的 100 局都正常打完，每一步都是合法动作", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      let game = newGame(3 + (seed % 5), seed);
      let steps = 0;
      while (game.phase === "playing") {
        steps += 1;
        expect(steps).toBeLessThan(20_000);
        if (game.stage === "roundEnd") {
          game = timeoutTurn(game);
          continue;
        }
        const playerId = game.players[game.actor]!.id;
        const command = botCommand(redactGameForViewer(game, playerId), playerId)!;
        expect(legalActions(game, playerId)).toContainEqual(command);
        game = applyCommand(game, playerId, command);
      }
      expect(game.finalResult?.winners.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it("面前只有一张小牌、牌堆里几乎不会撞：要牌", () => {
    expect(botCommand(deciding([1], { n1: 0, n12: 12, n11: 11, n10: 10 }), "p1")).toEqual({ type: "HIT" });
  });

  it("面前分很多、牌堆里大半会撞：停牌", () => {
    expect(botCommand(deciding([12, 11, 10, 9], { n12: 6, n11: 5, n10: 4, n9: 3, n0: 1 }), "p1")).toEqual({ type: "STAY" });
  });

  it("冻结交给本轮分最少的对手", () => {
    const game = deciding([5], { n1: 1 });
    game.stage = "target";
    game.players[1]!.numbers = [number(12), number(11)];
    game.players[2]!.numbers = [number(2)];
    game.pending = [{ type: "target", chooser: 0, card: { id: 1, kind: "freeze", value: 0 } }];
    expect(botCommand(game, "p1")).toEqual({ type: "TARGET", target: "p3" });
  });
});
