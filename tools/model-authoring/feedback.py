"""Make a marked-up feedback image for a retry: the zoom reference with the previous output's outline (red)
and, for eye whites, the measured eye opening (green). Attached as an extra image; never used as part pixels.
Usage: python -I tools/model-authoring/feedback.py <partId> <version> [--dx --dy]
"""
import sys
import argparse, json
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）


def load(p):
    return json.loads(Path(p).read_text(encoding='utf8'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('part'); ap.add_argument('version', type=int)
    ap.add_argument('--no-previous', action='store_true')
    args = ap.parse_args()
    parts, zooms, meas = load(ROOT / 'authoring/parts.json'), load(ROOT / 'authoring/zooms.json'), load(ROOT / 'authoring/measure.json')
    spec = parts[args.part]
    zname = spec['zoom']
    x, y, w, h = zooms[zname]['box']; ow, oh = zooms[zname]['out']
    s = ow / w
    base = Image.open(ROOT / 'reference' / f'zoom-{zname}.png').convert('RGB')
    d = ImageDraw.Draw(base)
    if not args.no_previous:
        prev = Image.open(ROOT / 'parts' / args.part / f'{args.part}-v{args.version}.png').convert('RGBA')
        prev = prev.resize((ow, oh), Image.LANCZOS)  # the output canvas maps onto the zoom canvas
        mask = (np.asarray(prev)[..., 3] > 127).astype(np.uint8)
        cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for c in cs:
            pts = [tuple(int(v) for v in p[0]) for p in c]
            if len(pts) > 2:
                d.line(pts + [pts[0]], fill=(230, 0, 0), width=4)
    key = {'eyeWhiteL': 'eyeOpeningL', 'eyeWhiteR': 'eyeOpeningR'}.get(args.part)
    if key:
        pts = [((px - x) * s, (py - y) * s) for px, py in meas[key]]
        d.line(pts + [pts[0]], fill=(0, 190, 0), width=5)
    lid = {'upperLidL': 'lidmask-L.npy', 'upperLidR': 'lidmask-R.npy'}.get(args.part)
    if lid:
        m = np.load(ROOT / 'authoring' / lid)[y:y + h, x:x + w].astype(np.uint8) * 255
        m = cv2.resize(m, (ow, oh), interpolation=cv2.INTER_LINEAR)
        cs, _ = cv2.findContours((m > 127).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for c in cs:
            pts = [tuple(int(v) for v in p[0]) for p in c]
            if len(pts) > 2:
                d.line(pts + [pts[0]], fill=(0, 190, 0), width=4)
    spots = meas.get({'highlightL': 'highlightsL', 'highlightR': 'highlightsR'}.get(args.part, ''), [])
    for px, py, r in spots:
        cx, cy, R = (px - x) * s, (py - y) * s, (r + 1.2) * s
        d.ellipse((cx - R, cy - R, cx + R, cy + R), outline=(0, 190, 0), width=4)
    name = f'{args.part}-guide.png' if args.no_previous else f'{args.part}-after-v{args.version}.png'
    out = ROOT / 'authoring' / 'feedback' / name
    out.parent.mkdir(parents=True, exist_ok=True)
    base.save(out)
    print(out)


if __name__ == '__main__':
    main()
