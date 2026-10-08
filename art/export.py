"""把 selection.json 里选定的图导出到 apps/web/public/art/<名字>.png（名字以 _ 开头的不导出）。用法：python export.py"""
from __future__ import annotations

import json
import pathlib
import shutil

ART = pathlib.Path(__file__).resolve().parent
TARGET = ART.parent / "apps" / "web" / "public" / "art"

if __name__ == "__main__":
    TARGET.mkdir(parents=True, exist_ok=True)
    for name, source in json.loads((ART / "selection.json").read_text()).items():
        if name.startswith("_"):  # 只当别的图的素材（比如动画首帧），不上线
            continue
        shutil.copyfile(ART / source, TARGET / f"{name}.png")
        print(name, "←", source)

# 特效帧条：横排，每帧 64px。爆炸末尾补一帧空白（播完就消失）；烟花最后停在奖杯上。
FX = {
    "fx-bust": (["out/r2/bust/bust-s401-%02d.png" % i for i in range(9)], True),
    "fx-flip7": (["out/r2/flip7/flip7-s412-%02d.png" % i for i in range(9)], False),
}


def export_fx() -> None:
    from PIL import Image

    for name, (frames, blank_end) in FX.items():
        images = [Image.open(ART / frame).convert("RGBA") for frame in frames]
        if blank_end:
            images.append(Image.new("RGBA", images[0].size, (0, 0, 0, 0)))
        width, height = images[0].size
        strip = Image.new("RGBA", (width * len(images), height), (0, 0, 0, 0))
        for index, image in enumerate(images):
            strip.paste(image, (index * width, 0))
        strip.save(TARGET / f"{name}.png")
        print(name, "←", len(images), "帧")


if __name__ == "__main__":
    export_fx()
