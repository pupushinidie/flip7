"""把 selection.json 里选定的图导出到 apps/web/public/art/（tile.png、clover.png、hero.png）。用法：python export.py"""
from __future__ import annotations

import json
import pathlib
import shutil

ART = pathlib.Path(__file__).resolve().parent
TARGET = ART.parent / "apps" / "web" / "public" / "art"

if __name__ == "__main__":
    TARGET.mkdir(parents=True, exist_ok=True)
    for name, source in json.loads((ART / "selection.json").read_text()).items():
        shutil.copyfile(ART / source, TARGET / f"{name}.png")
        print(name, "←", source)
