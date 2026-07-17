from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "icons"
FONT = "/System/Library/Fonts/Apple Color Emoji.ttc"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(FONT, 96)
    draw.text((64, 61), "🔥", font=font, anchor="mm", embedded_color=True)
    for size in (16, 32, 48, 128):
        icon = canvas.resize((size, size), Image.Resampling.LANCZOS)
        icon.save(OUT / f"fire-{size}.png", optimize=True)


if __name__ == "__main__":
    main()
