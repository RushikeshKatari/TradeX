from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "TradeX-Logo-Source.png"
WEB_LOGO = ROOT / "static" / "images" / "tradex-logo.png"
ICO = ASSETS / "TradeX.ico"
ICNS = ASSETS / "TradeX.icns"


def rounded_logo(size: int) -> Image.Image:
    with Image.open(SOURCE) as source:
        image = source.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * 0.075), fill=255)
    image.putalpha(mask)
    return image


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    WEB_LOGO.parent.mkdir(parents=True, exist_ok=True)
    rounded_logo(512).save(WEB_LOGO, optimize=True)
    rounded_logo(1024).save(
        ICO,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    icon_sizes = [("16x16", 16), ("16x16@2x", 32), ("32x32", 32),
                  ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256),
                  ("256x256", 256), ("256x256@2x", 512),
                  ("512x512", 512), ("512x512@2x", 1024)]
    with tempfile.TemporaryDirectory(prefix="tradex-iconset-") as temp:
        iconset = Path(temp) / "TradeX.iconset"
        iconset.mkdir()
        for name, size in icon_sizes:
            rounded_logo(size).save(iconset / f"icon_{name}.png", optimize=True)
        if shutil.which("iconutil"):
            subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(ICNS)], check=True)
        else:
            print("iconutil is unavailable; the Windows icon and dashboard logo were generated, existing macOS icon retained.")


if __name__ == "__main__":
    main()
