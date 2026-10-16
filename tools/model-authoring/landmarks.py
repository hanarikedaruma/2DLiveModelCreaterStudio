"""Two-landmark placement (uniform scale + shift): ribbon knot and flower centre, measured on the original by colour
(measuring stick only) and found on the generated part by colour. Also accepts explicit point pairs.
Usage: python -I tools/model-authoring/landmarks.py part ver --zoom Z [--accept] [--pairs gx1 gy1 ox1 oy1 gx2 gy2 ox2 oy2]
  (with --pairs, g = generated-image px, o = original canvas px)
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check, colormatch

ROOT = check.ROOT


def knot_and_flower_original(part):
    _, (x0, y0, x1, y1) = colormatch.TARGETS[part]
    dark = colormatch.DARK[y0:y1, x0:x1]; white = colormatch.WHITE[y0:y1, x0:x1] & ~colormatch.DARK[y0:y1, x0:x1]
    ys, xs = np.where(dark)
    top = ys.min() + 0.18 * (ys.max() - ys.min())
    k = np.array([xs[ys <= top].mean(), ys[ys <= top].mean()]) + (x0, y0)
    n, lab, st, cen = cv2.connectedComponentsWithStats(white.astype(np.uint8))
    i = 1 + int(np.argmax(st[1:, 4]))
    f = cen[i] + (x0, y0)
    return k, f


def knot_and_flower_generated(img):
    a = np.asarray(img.convert('RGBA')).astype(np.float32)
    al = a[..., 3] > 127
    Lg = a[..., 0] * .299 + a[..., 1] * .587 + a[..., 2] * .114
    sat = a[..., :3].max(-1) - a[..., :3].min(-1)
    dark = al & (Lg < 140)
    white = al & (Lg > 200) & (sat < 45)
    ys, xs = np.where(dark)
    top = ys.min() + 0.18 * (ys.max() - ys.min())
    k = np.array([xs[ys <= top].mean(), ys[ys <= top].mean()])
    n, lab, st, cen = cv2.connectedComponentsWithStats(cv2.morphologyEx(white.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)))
    i = 1 + int(np.argmax(st[1:, 4]))
    return k, cen[i]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('part'); ap.add_argument('version', type=int)
    ap.add_argument('--zoom', required=True)
    ap.add_argument('--pairs', type=float, nargs=8)
    ap.add_argument('--accept', action='store_true')
    a = ap.parse_args()
    parts, zooms = check.load(ROOT / 'authoring/parts.json'), check.load(ROOT / 'authoring/zooms.json')
    spec = dict(parts[a.part]); spec.pop('zoom', None)
    if a.zoom != 'none':
        spec['zoom'] = a.zoom
    img = Image.open(ROOT / 'parts' / a.part / f'{a.part}-v{a.version}.png')
    if a.pairs:
        g1, o1, g2, o2 = np.array(a.pairs[0:2]), np.array(a.pairs[2:4]), np.array(a.pairs[4:6]), np.array(a.pairs[6:8])
    else:
        o1, o2 = knot_and_flower_original(a.part)
        g1, g2 = knot_and_flower_generated(img)
    S = np.linalg.norm(o2 - o1) / max(np.linalg.norm(g2 - g1), 1e-6)
    T = (o1 + o2) / 2 - S * (g1 + g2) / 2
    M0 = check.placement(spec, zooms, img.size, 0, 0, 1.0)
    Ms = check.placement(spec, zooms, img.size, 0, 0, S / M0[0, 0])
    pl = {'scale': round(float(S / M0[0, 0]), 5), 'dx': round(float(T[0] - Ms[0, 2]), 2), 'dy': round(float(T[1] - Ms[1, 2]), 2),
          'zoomUsed': spec.get('zoom'), 'landmarks': {'generated': [g1.round(1).tolist(), g2.round(1).tolist()], 'original': [o1.round(1).tolist(), o2.round(1).tolist()]}}
    print(a.part, json.dumps(pl))
    rp = ROOT / 'records' / f'{a.part}.json'
    rec = json.loads(rp.read_text(encoding='utf8'))
    v = next(v for v in rec['versions'] if v['version'] == a.version)
    v['placement'] = pl
    if a.accept:
        M = check.placement(spec, zooms, img.size, pl['dx'], pl['dy'], pl['scale'])
        out = check.warp_rgba(img, M)
        Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(ROOT / 'parts-aligned' / f'{a.part}.png')
        v['acceptedPlacement'] = {k: pl[k] for k in ('scale', 'dx', 'dy')}; v['acceptedMatrix'] = M.round(5).tolist(); v['zoomUsed'] = spec.get('zoom')
        rec['selected'] = a.version
    rp.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    main()
