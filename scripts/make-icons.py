#!/usr/bin/env python3
"""
Regenerates the "Navy Live" launcher icon, adaptive icon layers, monochrome icon, splash logo and
favicon (design-spec §5: light-blue logo tile with a navy volleyball on the navy hero gradient).
Usage: python3 scripts/make-icons.py   (needs Pillow). Writes into ./assets.
"""
import math, os
from PIL import Image, ImageDraw, ImageChops

NAVY = (0x00, 0x2E, 0x6E)
NAVY_MID = (0x00, 0x3B, 0x8C)
NAVY_BRIGHT = (0x0A, 0x56, 0xB5)
BLUE = (0x00, 0xBA, 0xF2)
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
SS = 4  # supersampling


def gradient(size):
    """Diagonal hero gradient (navy → navyMid at 70% → navyBright)."""
    w = h = size
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h - 2)
            if t < 0.7:
                k = t / 0.7
                a, b = NAVY, NAVY_MID
            else:
                k = (t - 0.7) / 0.3
                a, b = NAVY_MID, NAVY_BRIGHT
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * k) for i in range(3))
    return img


def ball(size, color, stroke):
    """Volleyball line art: outer ring + three curved seams, transparent background."""
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = stroke * SS
    pad = w // 2 + SS
    d.ellipse([pad, pad, S - pad, S - pad], outline=color, width=w)
    c = S / 2
    r = S / 2 - pad
    # three seams swirling out from the centre: a semicircle on each centre→rim radius (120° apart)
    # and a wider parallel arc beside it, clipped to the ball – the classic volleyball pinwheel
    seams = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(seams)
    for k in range(3):
        deg = -90 + k * 120
        u = (math.cos(math.radians(deg)), math.sin(math.radians(deg)))
        for rr in (r / 2, r * 0.82):
            mx, my = c + u[0] * rr, c + u[1] * rr
            sd.arc([mx - rr, my - rr, mx + rr, my + rr], start=deg, end=deg + 180, fill=color, width=w)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).ellipse([pad, pad, S - pad, S - pad], fill=255)
    seams.putalpha(ImageChops.multiply(seams.getchannel('A'), mask))
    img = Image.alpha_composite(img, seams)
    return img.resize((size, size), Image.LANCZOS)


def tile(size, radius_ratio=0.31):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=BLUE + (255,))
    img = img.resize((size, size), Image.LANCZOS)
    b = ball(int(size * 0.66), NAVY + (255,), max(2, int(size * 0.055)))
    o = (size - b.width) // 2
    img.alpha_composite(b, (o, o))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    # 1024 launcher icon (iOS / legacy): gradient + centred tile
    icon = gradient(1024).convert('RGBA')
    t = tile(600)
    icon.alpha_composite(t, (212, 212))
    icon.convert('RGB').save(os.path.join(OUT, 'icon.png'))
    # adaptive layers (512, foreground within the 66% safe zone)
    gradient(512).convert('RGBA').save(os.path.join(OUT, 'android-icon-background.png'))
    fg = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    t = tile(250)
    fg.alpha_composite(t, (131, 131))
    fg.save(os.path.join(OUT, 'android-icon-foreground.png'))
    mono = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
    b = ball(200, (255, 255, 255, 255), 12)
    mono.alpha_composite(b, (116, 116))
    mono.save(os.path.join(OUT, 'android-icon-monochrome.png'))
    # splash logo: tile on transparent (shown centred on navy)
    sp = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    sp.alpha_composite(tile(400), (312, 312))
    sp.save(os.path.join(OUT, 'splash-icon.png'))
    tile(48, 0.28).save(os.path.join(OUT, 'favicon.png'))


if __name__ == '__main__':
    main()
