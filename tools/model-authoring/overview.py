"""Contact sheet: for each part/version, the original crop | the part over the original (placement as stored, or
the plain crop mapping) with the part outline in red. Usage: python -I tools/model-authoring/overview.py out.png part:ver ...
"""
import json, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check

ROOT = check.ROOT


def placed(part, version, use_stored=True):
    parts, zooms = check.load(ROOT / 'authoring/parts.json'), check.load(ROOT / 'authoring/zooms.json')
    img = Image.open(ROOT / 'parts' / part / f'{part}-v{version}.png')
    pl = {'scale': 1, 'dx': 0, 'dy': 0}
    if use_stored:
        rec = json.loads((ROOT / 'records' / f'{part}.json').read_text(encoding='utf8'))
        v = next(v for v in rec['versions'] if v['version'] == version)
        pl = v.get('placement', pl)
    spec = dict(parts[part])
    if 'zoomUsed' in pl:  # versions generated with an older crop
        spec.pop('zoom', None)
        if pl['zoomUsed']:
            spec['zoom'] = pl['zoomUsed']
    M = check.placement(spec, zooms, img.size, pl['dx'], pl['dy'], pl['scale'])
    return check.warp_rgba(img, M), spec, zooms


def tile(part, version, size=300):
    p, spec, zooms = placed(part, version)
    box = zooms[spec['zoom']]['box'] if spec.get('zoom') else [0, 0, *check.CANVAS]
    x, y, w, h = box
    x0, y0, x1, y1 = max(0, x), max(0, y), min(1024, x + w), min(1536, y + h)
    orig = Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGBA').crop((x0, y0, x1, y1))
    part_img = Image.fromarray((p * 255).astype(np.uint8), 'RGBA').crop((x0, y0, x1, y1))
    s = size / max(x1 - x0, y1 - y0)
    sz = (max(1, int((x1 - x0) * s)), max(1, int((y1 - y0) * s)))
    o = orig.resize(sz, Image.LANCZOS); pi = part_img.resize(sz, Image.LANCZOS)
    over = o.copy(); over.alpha_composite(pi)
    ln = o.copy(); d = ImageDraw.Draw(ln)
    cs, _ = cv2.findContours((np.asarray(pi)[..., 3] > 127).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    for c in cs:
        pts = [tuple(int(v) for v in q[0]) for q in c]
        if len(pts) > 2:
            d.line(pts + [pts[0]], fill=(255, 0, 0, 255), width=2)
    gray = Image.new('RGBA', sz, (110, 110, 120, 255)); gray.alpha_composite(pi)
    t = Image.new('RGB', (size * 3 + 20, size + 18), 'white')
    for i, im in enumerate((gray, over, ln)):
        t.paste(im.convert('RGB'), (i * (size + 10), 18))
    ImageDraw.Draw(t).text((3, 3), f'{part} v{version}', fill=(0, 0, 0))
    return t


def main():
    out = sys.argv[1]
    tiles = [tile(*(it.split(':')[0], int(it.split(':')[1]))) for it in sys.argv[2:]]
    cols = 2
    W, H = tiles[0].width, max(t.height for t in tiles)
    sheet = Image.new('RGB', (W * cols, H * ((len(tiles) + cols - 1) // cols)), 'white')
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * W, (i // cols) * H))
    p = check.SCRATCH / out
    sheet.save(p)
    print(p)


if __name__ == '__main__':
    main()
