import { useEffect, useState } from "react";
import { CardView } from "./cards.js";

/** 规则说明：一个按钮，点开是像素弹窗。用自己的话写，不照搬原版规则书。 */
function GameRules({ brutal }: { brutal?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className="quiet-button f7-rules-button" type="button" aria-expanded={open} onClick={() => setOpen(true)}>规则</button>
      {open && (
        <div className="gm-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="gm-panel f7-rules" role="dialog" aria-modal="true" aria-labelledby="f7-rules-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="f7-rules-title">翻七怎么玩</h2>
            <div className="game-rules-block">
              <h3>目标</h3>
              <p>一轮一轮地翻牌攒分。有人总分到 <b>200</b> 分时，打完这一轮就结束，<b>总分最高</b>的人获胜（一样高就并列）。</p>
            </div>
            <div className="game-rules-block">
              <h3>每一轮</h3>
              <ol>
                <li>庄家从左手边开始给每人明发一张牌。</li>
                <li>然后从庄家左手边开始轮流选：<b>要牌</b>（再翻一张放到自己面前）或者<b>停牌</b>（这一轮不再要，保住面前的分）。</li>
                <li>翻到和自己面前<b>重复的数字</b>就<b>爆了</b>：这一轮 0 分。所有人都停牌或爆掉，这一轮结束。</li>
                <li>谁先凑齐 <b>7 张不同的数字</b>就是「翻七」：这一轮立刻结束，他额外 <b>+15</b>，其他没爆的人照常算分。</li>
              </ol>
            </div>
            <div className="game-rules-block">
              <h3>牌</h3>
              <div className="f7-rules-cards" aria-hidden="true">
                {[0, 3, 7, 12].map((value) => <CardView key={value} card={{ kind: "number", value }} />)}
                <CardView card={{ kind: "plus", value: 4 }} />
                <CardView card={{ kind: "times2", value: 0 }} />
              </div>
              <ul>
                <li><b>数字牌 0–12</b>：每个数字的张数就是它本身（12 有 12 张，0 只有 1 张）。数字越大越值钱，也越容易撞上重复。</li>
                <li><b>修饰牌</b> +2 / +4 / +6 / +8 / +10 / ×2：结算时加分，有 ×2 就把（数字 + 修饰）翻倍。修饰牌不会让人爆掉。</li>
              </ul>
              <div className="f7-rules-cards" aria-hidden="true">
                <CardView card={{ kind: "freeze", value: 0 }} />
                <CardView card={{ kind: "flipThree", value: 0 }} />
                <CardView card={{ kind: "secondChance", value: 0 }} />
              </div>
              <ul>
                <li><b>冻结</b>：交给任意一位还在要牌的人（可以是自己），他立刻停牌。</li>
                <li><b>翻三</b>：交给任意一位还在要牌的人，他必须连翻 3 张；中途翻到的冻结、翻三等 3 张翻完再处理，翻到重复就爆。</li>
                <li><b>二次机会</b>：自己留着，翻到重复时把重复的牌和它一起弃掉，当作没发生。每人最多 1 张，再摸到要送给别人。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>残酷模式{brutal === true ? "（本房间已开启）" : brutal === false ? "（本房间没开）" : ""}</h3>
              <ul>
                <li>摸到修饰牌要选给谁，可以给任何人（包括已经爆掉的人）。</li>
                <li>翻七的人可以选自己 +15，或者让一位对手这一轮 −15，所以分数可能是负的。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>其他</h3>
              <ul>
                <li>用过的牌放进弃牌堆，下一轮不洗回去；牌堆摸光了才把弃牌堆洗成新牌堆。右边的「再要一张爆掉」就是按牌堆里剩下的牌算的。</li>
                <li>每个决定限时 30 秒：没选要牌/停牌就自动停牌；冻结默认给自己，翻三默认给下一位还在要牌的对手，多出来的二次机会给座位顺序上的下一位，修饰牌留给自己；翻七默认自己 +15。轮到的人离线只等 3 秒。</li>
                <li>快捷键：H 或空格要牌，S 停牌，N 下一轮。</li>
              </ul>
            </div>
            <div className="gm-panel-actions">
              <button className="primary-button" type="button" onClick={() => setOpen(false)}>知道了</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
