"""Assemble one eye from placed parts over plain skin and show it next to the original eye.
Usage: python -I tools/model-authoring/eye_preview.py L eyeWhiteL:3 irisL:1 highlightL:2 lowerLidL:1 upperLidL:2 [--out name]
Each part uses the placement stored in records/<part>.json for that version (scale 1, no shift if none).
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check

ROOT = check.ROOT


def placed(part, version):
    parts, zooms = check.load(ROOT / 'authoring/parts.json'), check.load(ROOT / 'authoring/zooms.json')
    rec = json.loads((ROOT / 'records' / f'{part}.json').read_text(encoding='utf8'))
    v = next(v for v in rec['versions'] if v['version'] == version)
    pl = v.get('placement', {'scale': 1, 'dx': 0, 'dy': 0})
    img = Image.open(ROOT / 'parts' / part / f'{part}-v{version}.png')
    M = check.placement(parts[part], zooms, img.size, pl['dx'], pl['dy'], pl['scale'])
    return check.warp_rgba(img, M)


def over(dst, src, clip=None):
    a = src[..., 3:4] * (clip[..., None] if clip is not None else 1)
    return dst * (1 - a) + src[..., :3] * a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('side'); ap.add_argument('items', nargs='+'); ap.add_argument('--out', default=None)
    args = ap.parse_args()
    box = {'L': (530, 250, 100, 75), 'R': (385, 280, 100, 75)}[args.side]
    orig = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB')).astype(np.float32) / 255
    skin = np.median(orig[318:326, 540:600].reshape(-1, 3), 0) if args.side == 'L' else np.median(orig[345:352, 420:470].reshape(-1, 3), 0)
    canvas = np.ones_like(orig) * skin
    white = None
    for it in args.items:
        name, ver = it.split(':')
        p = placed(name, int(ver))
        if name.startswith('eyeWhite'):
            white = p[..., 3]; canvas = over(canvas, p)
        elif name.startswith(('iris', 'highlight')):
            canvas = over(canvas, p, white)
        else:
            canvas = over(canvas, p)
    x, y, w, h = box; s = 6
    a = Image.fromarray((orig[y:y + h, x:x + w] * 255).astype(np.uint8)).resize((w * s, h * s), Image.LANCZOS)
    b = Image.fromarray((np.clip(canvas[y:y + h, x:x + w], 0, 1) * 255).astype(np.uint8)).resize((w * s, h * s), Image.LANCZOS)
    out = Image.new('RGB', (w * s * 2 + 10, h * s + 20), 'white')
    out.paste(a, (0, 20)); out.paste(b, (w * s + 10, 20))
    ImageDraw.Draw(out).text((4, 4), 'original | assembled from generated parts: ' + ' '.join(args.items), fill=(0, 0, 0))
    p = check.SCRATCH / (args.out or f'eye-{args.side}.png'); out.save(p); print(p)


if __name__ == '__main__':
    main()
