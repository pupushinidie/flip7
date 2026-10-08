"""把一批候选拼成一张对照图（编号写在每格左上角），方便挑选。用法：python sheet.py <输出.png> <缩放> <图片...>"""
from __future__ import annotations

import sys

from PIL import Image, ImageDraw


def sheet(paths: list[str], out: str, scale: int = 3, columns: int = 8, bg=(46, 52, 64)) -> None:
    images = [Image.open(path).convert("RGBA") for path in paths]
    width = max(image.width for image in images) * scale
    height = max(image.height for image in images) * scale
    rows = (len(images) + columns - 1) // columns
    canvas = Image.new("RGBA", (columns * (width + 6) + 6, rows * (height + 18) + 6), bg + (255,))
    draw = ImageDraw.Draw(canvas)
    for index, (path, image) in enumerate(zip(paths, images)):
        x = 6 + (index % columns) * (width + 6)
        y = 6 + (index // columns) * (height + 18)
        canvas.alpha_composite(image.resize((image.width * scale, image.height * scale), Image.NEAREST), (x, y + 12))
        label = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        draw.text((x, y), label[-14:], fill=(230, 230, 230, 255))
    canvas.save(out)


if __name__ == "__main__":
    out, scale, *paths = sys.argv[1:]
    sheet(paths, out, int(scale))
