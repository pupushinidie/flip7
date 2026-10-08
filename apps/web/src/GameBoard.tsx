import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CELLS, legalCells, type GameEvent, type GameCommand, type GameState, type LobbyRoomSnapshot, type Player } from "@flip7/game";
import { art, seatColor } from "./art.js";
import GameRules from "./GameRules.js";
import { socket } from "./socket.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onDissolve: () => void;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

const cellName = (cell: number) => `第 ${Math.floor(cell / 4) + 1} 行第 ${(cell % 4) + 1} 列`;

function describeEvent(event: GameEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case "Drew":
      return `${name(event.player)} 从牌池抽了一张`;
    case "Took":
      return `${name(event.player)} 拿走桌面上的 ${event.value}`;
    case "Placed":
      return event.replaced !== undefined
        ? `${name(event.player)} 把 ${event.value} 放在${cellName(event.cell)}，换下 ${event.replaced}`
        : `${name(event.player)} 把 ${event.value} 放在${cellName(event.cell)}`;
    case "Discarded":
      return `${name(event.player)} 弃掉 ${event.value}`;
    case "TurnTimedOut":
      return `${name(event.player)} 超时，自动处理`;
    case "GameEnded":
      return event.reason === "full"
        ? `${event.winners.map(name).join("、")} 填满 16 格，获胜！`
        : `牌池抽光了，${event.winners.map(name).join("、")} 棋盘上的牌最多，获胜！`;
    default:
      return null;
  }
}

/** 一张数字牌。 */
export function Tile({ value, hidden = false, className = "" }: { value: number | null; hidden?: boolean; className?: string }) {
  return (
    <span className={`lk-tile${hidden ? " hidden" : ""} ${className}`} aria-label={hidden ? "背面朝上的牌" : String(value)}>
      {!hidden && <b>{value}</b>}
    </span>
  );
}

function Grid({ player, me, hand, lastPlaced, onCell }: {
  player: Player;
  me: boolean;
  /** 手里的牌：能放的格子高亮。 */
  hand: number | null;
  lastPlaced: number | undefined;
  onCell?: (cell: number) => void;
}) {
  const legal = new Set(hand !== null ? legalCells(player.board, hand) : []);
  return (
    <div className={me ? "lk-grid mine" : "lk-grid"} role="grid" aria-label={`${player.name} 的棋盘`}>
      {Array.from({ length: CELLS }, (_, cell) => {
        const value = player.board[cell] ?? null;
        const can = legal.has(cell);
        const classes = ["lk-cell", can ? (value === null ? "can-place" : "can-swap") : "", cell === lastPlaced ? "last" : ""].join(" ");
        const content = value !== null ? <Tile value={value} /> : null;
        return can && onCell ? (
          <button key={cell} type="button" className={classes} onClick={() => onCell(cell)} title={value === null ? `放在${cellName(cell)}` : `换下 ${value}`}>{content}</button>
        ) : (
          <span key={cell} className={classes}>{content}</span>
        );
      })}
    </div>
  );
}

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, chat, onCommand, onRematch, onDissolve }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  const myId = member?.playerId ?? "";
  const isHost = member?.isHost ?? false;
  const current = game.players[game.currentPlayer]!;
  const myTurn = game.phase === "playing" && current.id === myId;
  const me = game.players.find((player) => player.id === myId);
  const others = game.players.filter((player) => player.id !== myId);
  const secondsLeft = useCountdown(room);
  const nameOf = (playerId: string) => (playerId === myId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const connected = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId)?.connected ?? false;
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";

  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  const seenVersion = useRef(game.version);
  useEffect(() => {
    if (game.version === seenVersion.current) return;
    const restarted = game.version < seenVersion.current;
    seenVersion.current = game.version;
    const lines = game.events
      .map((event, index) => ({ key: `${game.version}-${index}`, text: describeEvent(event, nameOf) }))
      .filter((line): line is { key: string; text: string } => line.text !== null)
      .reverse();
    setLog((previous) => [...lines, ...(restarted ? [] : previous)].slice(0, 60));
  }, [game.version]);

  const hand = myTurn && game.stage === "place" ? game.hand?.value ?? null : null;
  const send = (command: GameCommand) => { if (!busy) onCommand(command); };
  const takeable = (value: number) => myTurn && game.stage === "choose" && me !== undefined && legalCells(me.board, value).length > 0;

  let prompt: string;
  if (game.phase === "finished") prompt = "对局结束";
  else if (myTurn && game.stage === "choose") prompt = game.potCount > 0 ? "轮到你了：从牌池抽一张，或拿桌面上的明牌" : "牌池空了：只能拿桌面上的明牌";
  else if (myTurn && game.hand?.from === "pot") prompt = "点亮着的格子放牌（金框是换下原来的牌），或者弃到桌面";
  else if (myTurn) prompt = "拿了明牌就必须放上棋盘：点亮着的格子";
  else prompt = game.stage === "place" ? `${current.name} 正在放牌` : `${current.name} 在想抽牌还是拿明牌`;

  return (
    <div className="lk-screen" style={{ "--tile-img": `url(${art.tile})` } as CSSProperties}>
      <header className="lk-topbar">
        {brand}
        <div className="lk-turn">
          <span>第 {game.turn} 手</span>
          {game.phase === "playing" && (
            <span className={myTurn ? "lk-turn-who mine" : "lk-turn-who"}>
              <i className="lk-dot" style={{ background: seatColor(current.color) }} />
              {myTurn ? "轮到你" : `轮到 ${current.name}`}
            </span>
          )}
          {game.phase === "playing" && secondsLeft !== null && <b className={secondsLeft <= 10 ? "lk-timer low" : "lk-timer"}>{secondsLeft}s</b>}
        </div>
        <div className="lk-topbar-right">
          {themeToggle}
          <GameRules />
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {connection}
        </div>
      </header>

      <div className="lk-layout">
        <section className="lk-main">
          <div className={myTurn ? "lk-prompt mine" : "lk-prompt"} role="status">
            <i className="lk-dot" style={{ background: seatColor(current.color) }} />{prompt}
          </div>
          {(error || shownNotice) && <p className={error ? "lk-feedback error" : "lk-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}

          <div className="lk-center">
            {me && (
              <div className="lk-board-panel mine" style={{ "--seat": seatColor(me.color) } as CSSProperties}>
                <h3><i className="lk-dot" style={{ background: seatColor(me.color) }} />你的棋盘 <small>{me.score} / 16</small></h3>
                <Grid player={me} me hand={hand} lastPlaced={game.lastPlaced?.player === me.id ? game.lastPlaced.cell : undefined} onCell={(cell) => send({ type: "PLACE", cell })} />
              </div>
            )}

            <div className="lk-supply">
              <section className="lk-panel lk-pot">
                <h3>牌池 <small>剩 {game.potCount} 张</small></h3>
                <button type="button" className="lk-pile" disabled={!myTurn || game.stage !== "choose" || game.potCount === 0 || busy} onClick={() => send({ type: "DRAW" })} title="盲抽一张">
                  <Tile value={null} hidden />
                  <span>{myTurn && game.stage === "choose" && game.potCount > 0 ? "抽一张" : "牌池"}</span>
                </button>
              </section>
              <section className={game.stage === "place" ? "lk-panel lk-hand active" : "lk-panel lk-hand"}>
                <h3>{game.phase === "playing" ? (myTurn ? "你手里的牌" : `${current.name} 手里`) : "手牌"}</h3>
                {game.phase === "playing" && game.stage === "place" && game.hand ? (
                  <>
                    <Tile value={game.hand.value} hidden={game.hand.value === null} className="big" />
                    <small>{game.hand.from === "pot" ? "从牌池抽的" : "从桌面拿的"}</small>
                    {myTurn && game.hand.from === "pot" && (
                      <button type="button" className="quiet-button" disabled={busy} onClick={() => send({ type: "DISCARD" })}>弃到桌面</button>
                    )}
                  </>
                ) : <p className="lk-muted">还没拿牌</p>}
              </section>
            </div>
            <div className="lk-others">
              {others.map((player) => (
                <div
                  key={player.id}
                  className={["lk-board-panel", game.phase === "playing" && player.id === current.id ? "active" : "", !connected(player.id) ? "offline" : ""].join(" ")}
                  style={{ "--seat": seatColor(player.color) } as CSSProperties}
                >
                  <h3>
                    <i className="lk-dot" style={{ background: seatColor(player.color) }} />{player.name}
                    {!connected(player.id) && <small className="lk-offline">离线</small>}
                    <small>{player.score} / 16</small>
                  </h3>
                  <Grid player={player} me={false} hand={null} lastPlaced={game.lastPlaced?.player === player.id ? game.lastPlaced.cell : undefined} />
                </div>
              ))}
            </div>
          </div>

          <section className="lk-panel lk-table">
            <h3>桌面明牌 <small>{game.table.length} 张 · 所有人都能拿，拿了必须放</small></h3>
            {game.table.length === 0 ? <p className="lk-muted">还没有人弃牌。</p> : (
              <div className="lk-table-tiles">
                {game.table.map((value, index) => takeable(value) ? (
                  <button key={index} type="button" className="lk-take" disabled={busy} onClick={() => send({ type: "TAKE", index })} title={`拿走 ${value}`}>
                    <Tile value={value} />
                  </button>
                ) : (
                  <span key={index} className={myTurn && game.stage === "choose" ? "lk-take dim" : "lk-take"}><Tile value={value} /></span>
                ))}
              </div>
            )}
          </section>


        </section>

        <aside className="lk-side">
          <section className="lk-panel lk-log">
            <h3>动作记录</h3>
            {log.length === 0 ? <p className="lk-muted">还没有动作。</p> : <ul>{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>}
          </section>
          <div className="lk-chat">{chat}</div>
        </aside>
      </div>
      {game.phase === "finished" && <FinalDialog game={game} room={room} myId={myId} onRematch={onRematch} />}
    </div>
  );
}

function FinalDialog({ game, room, myId, onRematch }: { game: GameState; room: LobbyRoomSnapshot; myId: string; onRematch: (accept: boolean) => void }) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const won = (id: string) => result.winners.includes(id);
  const rows = [...game.players].sort((a, b) => Number(won(b.id)) - Number(won(a.id)) || b.score - a.score);
  const title = won(myId) ? (result.winners.length > 1 ? "并列获胜！" : "你赢了！") : `${result.winners.map((id) => game.players.find((p) => p.id === id)?.name).join("、")} 获胜`;
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel lk-final" role="dialog" aria-modal="true" aria-labelledby="lk-final-title">
        <img className="lk-final-icon" src={art.clover} alt="" />
        <h2 id="lk-final-title">{title}</h2>
        <p className="lk-muted">{result.reason === "full" ? "第一个填满 16 格。" : "牌池抽光了，按棋盘上的牌数定胜负。"}</p>
        <ol className="lk-standings">
          {rows.map((player) => (
            <li key={player.id} className={won(player.id) ? "winner" : ""}>
              <i className="lk-dot" style={{ background: seatColor(player.color) }} />
              <strong>{player.name}{player.id === myId ? "（你）" : ""}</strong>
              <span>{player.score} / 16</span>
            </li>
          ))}
        </ol>
        {room.rematch && (
          <div className="lk-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
