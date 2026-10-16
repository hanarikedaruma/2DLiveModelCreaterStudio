"""Show a part's outline at the plain crop mapping (red) and at a candidate placement (blue) over the original.
Usage: python -I tools/model-authoring/compare_place.py part ver scale dx dy x y w h [zoom]
"""
import sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check

ROOT = check.ROOT


def main():
    part, ver = sys.argv[1], int(sys.argv[2])
    scale, dx, dy = map(float, sys.argv[3:6])
    x, y, w, h = map(int, sys.argv[6:10])
    z = int(sys.argv[10]) if len(sys.argv) > 10 else 4
    parts, zooms = check.load(ROOT / 'authoring/parts.json'), check.load(ROOT / 'authoring/zooms.json')
    img = Image.open(ROOT / 'parts' / part / f'{part}-v{ver}.png')
    orig = Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB').crop((x, y, x + w, y + h)).resize((w * z, h * z), Image.LANCZOS)
    d = ImageDraw.Draw(orig)
    for (s, ddx, ddy), col in (((1, 0, 0), (255, 0, 0)), ((scale, dx, dy), (0, 80, 255))):
        p = check.warp_rgba(img, check.placement(parts[part], zooms, img.size, ddx, ddy, s))
        m = (p[y:y + h, x:x + w, 3] > 0.5).astype(np.uint8)
        m = cv2.resize(m, (w * z, h * z), interpolation=cv2.INTER_NEAREST)
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for c in cs:
            pts = [tuple(int(v) for v in q[0]) for q in c]
            if len(pts) > 2:
                d.line(pts + [pts[0]], fill=col, width=2)
    out = check.SCRATCH / f'place-{part}-v{ver}.png'
    orig.save(out)
    print(out)


if __name__ == '__main__':
    main()
