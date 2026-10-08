import { useState } from "react";

/** 规则说明：用自己的话写，不照搬原版规则书。 */
function GameRules() {
  const [open, setOpen] = useState(false);

  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button
        className="game-rules-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="game-rules-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">✦</span> 游戏规则
        <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>

      {open && (
        <div className="game-rules-panel" id="game-rules-panel">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>每人一块 4×4 的棋盘。把数字牌摆上去，<b>每一行从左到右、每一列从上到下都要越来越大</b>（同一行、同一列不能有相同的数字）。第一个摆满 16 格的人获胜。</p>
          </div>
          <div className="game-rules-block">
            <h3>开局</h3>
            <p>牌池里 1–20 每个数字有「玩家人数」那么多张。每人先盲抽 4 张，从小到大摆在左上到右下的对角线上。</p>
          </div>
          <div className="game-rules-block">
            <h3>每回合二选一</h3>
            <ol>
              <li><b>从牌池抽一张</b>：放上棋盘，或者弃到桌面上（明牌）。</li>
              <li><b>拿桌面上的一张明牌</b>：拿了就必须放上棋盘，不能再弃。</li>
            </ol>
            <p className="game-rules-note">放牌可以放进空格，也可以<b>换下</b>棋盘上已有的一张（换下来的放到桌面，谁都能拿）。不管放哪里，放完都要满足从小到大的规则。</p>
          </div>
          <div className="game-rules-block">
            <h3>结束</h3>
            <ul>
              <li>有人摆满 16 格，立刻获胜。</li>
              <li>牌池抽光还没人摆满：棋盘上牌最多的人获胜，一样多就并列。</li>
              <li>每一步限时 45 秒，超时会自动抽一张弃掉（拿了明牌的会自动放到能放的位置）。</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
