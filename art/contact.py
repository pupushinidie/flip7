"""把一组 v2 候选（64 张）拼成带编号的总览图：python contact.py <名字> [放大倍数]"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"

def sheet(name: str, scale: int = 3) -> pathlib.Path:
    folder = OUT / "r1" / name
    files = sorted(folder.glob(f"{name}*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]) if p.stem.rsplit("-", 1)[-1].isdigit() else 0)
    images = [Image.open(f).convert("RGBA") for f in files]
    w, h = images[0].size
    cell_w, cell_h = w * scale + 8, h * scale + 20
    cols = 8
    rows = (len(images) + cols - 1) // cols
    board = Image.new("RGBA", (cols * cell_w, rows * cell_h), (40, 48, 72, 255))
    draw = ImageDraw.Draw(board)
    for i, (f, im) in enumerate(zip(files, images)):
        x, y = (i % cols) * cell_w, (i // cols) * cell_h
        # 棋盘格底，看得出透明
        for cy in range(0, h * scale, 8):
            for cx in range(0, w * scale, 8):
                if (cx // 8 + cy // 8) % 2:
                    draw.rectangle([x + 4 + cx, y + 16 + cy, x + 4 + cx + 7, y + 16 + cy + 7], fill=(56, 66, 96, 255))
        board.alpha_composite(im.resize((w * scale, h * scale), Image.NEAREST), (x + 4, y + 16))
        suffix = f.stem.rsplit("-", 1)[1] if f.stem.rsplit("-", 1)[-1].isdigit() else "0"
        draw.text((x + 4, y + 2), suffix, fill=(255, 230, 140, 255))
    path = OUT / "sheets" / f"{name}.png"
    board.save(path)
    return path

if __name__ == "__main__":
    print(sheet(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 3))
