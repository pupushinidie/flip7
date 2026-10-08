"""第二轮：特效动画（/animate-with-text-v3）。首帧 = 选定的 32px 图标放大 2 倍（最近邻）到 64px。
结果在 out/r2/<名字>/<名字>-s<种子>-NN.png；sheet.py 拼成横排帧条后导出。

- bust：爆掉时的爆炸变成一团烟散开（不循环）。
- flip7：翻七时奖杯后面放烟花（不循环）。

用法：python fx.py <任务 ...>
"""
from __future__ import annotations

import base64
import io
import json
import sys

from PIL import Image

import pixellab

ART = pixellab.ART
OUT = ART / "out" / "r2"
SELECTION = json.loads((ART / "selection.json").read_text())


def doubled(key: str) -> dict:
    image = Image.open(ART / SELECTION[key]).convert("RGBA")
    image = image.resize((image.width * 2, image.height * 2), Image.NEAREST)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return {"type": "base64", "base64": base64.b64encode(buffer.getvalue()).decode(), "format": "png"}


def animate(name: str, key: str, action: str, frames: int, seeds: tuple[int, ...]) -> None:
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / name / f"{target}-00.png").exists():
            continue
        body = {
            "first_frame": doubled(key),
            "action": action,
            "frame_count": frames,
            "seed": seed,
            "no_background": True,
        }
        pixellab.animate(target, body, OUT / name, endpoint="/animate-with-text-v3")
        print(target, "done; spent", round(pixellab.spent_usd(), 4), flush=True)


TASKS = {
    "bust": lambda: animate(
        "bust", "bust",
        "the cartoon explosion bursts outward with flying sparks, then turns into a puff of grey smoke that drifts up and disappears",
        8, (401, 402)),
    "flip7": lambda: animate(
        "flip7", "_flip7-plain",
        "colorful fireworks burst behind the golden trophy and rain down small sparkles, the trophy stays still",
        8, (411, 412)),
}


if __name__ == "__main__":
    for task in sys.argv[1:]:
        try:
            TASKS[task]()
        except Exception as error:
            print(task, "失败：", error, flush=True)
