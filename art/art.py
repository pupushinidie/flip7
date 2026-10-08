"""翻七美术第一轮：定画风、出候选。结果在 out/r1/<名字>/（小图一组一个目录）或 out/r1/<名字>-s<种子>.png（大图）。

主题：夜晚的游乐场牌摊（深蓝夜空、彩灯串、条纹帐篷），和网站的夜色蓝灰界面搭。
- 牌面本身用 CSS 画（纯色底 + 像素边框 + 像素字体数字），这样牌可以随屏幕缩放；
  牌上的图标、牌背徽记、头像是 32px 小图，只按整数倍（32/64px）显示。
- 小图（≤42px）用 /generate-image-v2：一次出 64 个候选，挑一个。
- 大图（牌桌背景、首页主图）用 /create-image-pixen，512×288。
PixelLab 同一时间只跑一个任务，按顺序一个一个来。

用法：python art.py [名字 ...]（不写就全跑；已经出过的跳过）
"""
from __future__ import annotations

import sys

import pixellab

OUT = pixellab.ART / "out" / "r1"

# 名字: (提示词, 宽, 高, 透明背景)
SPRITES: dict[str, tuple[str, int, int, bool]] = {
    "icon-freeze": ("game icon: a frozen blue ice cube with a white snowflake inside, frosty sparkles", 32, 32, True),
    "icon-flip3": ("game icon: three playing cards fanned out and flipping over, curved motion arrows", 32, 32, True),
    "icon-second": ("game icon: a shiny red heart with a small golden plus sign, extra life", 32, 32, True),
    "icon-coins": ("game icon: a small stack of shiny gold coins", 32, 32, True),
    "icon-double": ("game icon: two bright golden stars side by side, sparkling", 32, 32, True),
    "icon-bust": ("game icon: a cartoon explosion burst, red and orange flames with a puff of grey smoke", 32, 32, True),
    "icon-flip7": ("game icon: a golden trophy cup with colorful fireworks bursting behind it", 32, 32, True),
    "emblem": ("a round golden carnival emblem medallion with a seven pointed star in the middle, ornate rim, symmetric, front view", 32, 32, True),
    "avatar": ("cute round cartoon animal face portrait for a game avatar, front view, big eyes, colorful, head only", 32, 32, True),
}

SCENES: dict[str, tuple[str, tuple[int, ...]]] = {
    "backdrop": ("a carnival midway at night, red and white striped circus tents, strings of warm colorful light bulbs, a lit ferris wheel in the distance, deep blue starry sky, wide view, no people", (11, 12, 13)),
    "hero": ("a carnival card game booth at night with a striped awning and strings of warm light bulbs, colorful playing cards flying through the air above the counter, deep blue starry sky, no people, no text", (21, 22, 23)),
}


def sprite(name: str) -> None:
    prompt, width, height, transparent = SPRITES[name]
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        print(name, "已有，跳过", flush=True)
        return
    pixellab.generate_async(name, {
        "description": prompt,
        "image_size": {"width": width, "height": height},
        "no_background": transparent,
        "seed": 701,
    }, folder, endpoint="/generate-image-v2")


def scene(name: str) -> None:
    prompt, seeds = SCENES[name]
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": prompt,
            "image_size": {"width": 512, "height": 288},
            "detail": "highly detailed",
            "seed": seed,
        }, OUT, endpoint="/create-image-pixen")


if __name__ == "__main__":
    names = sys.argv[1:] or [*SCENES, *SPRITES]
    for name in names:
        try:
            if name in SPRITES:
                sprite(name)
            else:
                scene(name)
        except Exception as error:  # 一项失败不影响后面的
            print(name, "失败：", error, flush=True)
            continue
        print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
