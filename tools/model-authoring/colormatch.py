"""Place small parts by overlap with a target mask measured on the original by colour (the original is only a
measuring stick). Score = Dice(part alpha, target) over scale (wide) and position, computed with matchTemplate.
Usage: python -I tools/model-authoring/colormatch.py part ver [--zoom NAME|none] [--scales 0.3 1.5] [--accept]
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check

ROOT = check.ROOT
O = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB')).astype(np.float32)
R, G, B = O[..., 0], O[..., 1], O[..., 2]
L = R * .299 + G * .587 + B * .114
SAT = O.max(-1) - O.min(-1)
DARK = (L < 125) & (B > R - 25)                 # black / navy ribbons
WHITE = (L > 232) & (SAT < 28)                  # white flowers, white drawstring
GOLD = (R - B > 35) & (L > 110) & (L < 215) & (G > B)   # gold earrings and pins
BLUSH = (R - G > 34) & (L > 195) & (R > 235)    # pink blush on skin

# target colour classes and boxes (x0, y0, x1, y1) per part
TARGETS = {
    'hairOrnament': (['DARK', 'WHITE', 'GOLD'], [592, 128, 712, 242]),
    'ribbonLong': (['DARK', 'WHITE'], [660, 228, 698, 378]),
    'ribbonShort': (['DARK', 'WHITE'], [672, 232, 712, 294]),
    'earringL': (['GOLD'], [622, 322, 656, 408]),
    'earringR': (['GOLD'], [398, 366, 434, 452]),
    'sleeveRibbonUpperR': (['DARK', 'WHITE'], [168, 742, 245, 895]),
    'sleeveRibbonLowerR': (['DARK', 'WHITE'], [58, 1028, 145, 1165]),
    'sleeveRibbonUpperL': (['DARK', 'WHITE'], [822, 744, 893, 912]),
    'sleeveRibbonLowerL': (['DARK'], [905, 1028, 965, 1122]),
    'waistRibbon': (['WHITE'], [474, 1020, 606, 1232]),
    'cheek': (['BLUSH'], [415, 310, 630, 372]),
}
CLASSES = {'DARK': DARK, 'WHITE': WHITE, 'GOLD': GOLD, 'BLUSH': BLUSH}


def target_mask(part):
    names, (x0, y0, x1, y1) = TARGETS[part]
    m = np.zeros(L.shape, bool)
    for n in names:
        m |= CLASSES[n]
    out = np.zeros(L.shape, bool)
    out[y0:y1, x0:x1] = m[y0:y1, x0:x1]
    out = cv2.morphologyEx(out.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
    return out, (x0, y0, x1, y1)


def dice_search(alpha, target, box, scales, pad=30, steps=80):
    x0, y0, x1, y1 = box
    X0, Y0 = max(0, x0 - pad), max(0, y0 - pad)
    X1, Y1 = min(1024, x1 + pad), min(1536, y1 + pad)
    T = target[Y0:Y1, X0:X1].astype(np.float32)
    Tsum = float(T.sum())
    ys, xs = np.where(alpha > 0.5)
    bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    A = (alpha[by0:by1, bx0:bx1] > 0.5).astype(np.float32)
    best = None
    for s in np.exp(np.linspace(np.log(scales[0]), np.log(scales[1]), steps)):
        w, h = int(round((bx1 - bx0) * s)), int(round((by1 - by0) * s))
        if w < 3 or h < 3 or w >= T.shape[1] or h >= T.shape[0]:
            continue
        a = (cv2.resize(A, (w, h), interpolation=cv2.INTER_AREA) > 0.5).astype(np.float32)
        area = float(a.sum())
        if area < 5:
            continue
        inter = cv2.matchTemplate(T, a, cv2.TM_CCORR)
        dice = 2 * inter / (area + Tsum)
        iy, ix = np.unravel_index(np.argmax(dice), dice.shape)
        if best is None or dice[iy, ix] > best[0]:
            best = (float(dice[iy, ix]), float(s), X0 + ix, Y0 + iy, w, h)
    d, s, px, py, w, h = best
    # canvas = s_canvas_per_output * (p - [bx0, by0]) + [px, py]; s is canvas px per output px
    return {'dice': round(d, 3), 'S': s * (bx1 - bx0) / ((bx1 - bx0)), 'Sx': w / (bx1 - bx0), 'T': [px - (w / (bx1 - bx0)) * bx0, py - (h / (by1 - by0)) * by0]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('part'); ap.add_argument('version', type=int)
    ap.add_argument('--zoom', default=None, help='zoom the version was generated with (default: current spec); none = full canvas')
    ap.add_argument('--scales', type=float, nargs=2, default=[0.03, 1.6])
    ap.add_argument('--accept', action='store_true')
    a = ap.parse_args()
    parts, zooms = check.load(ROOT / 'authoring/parts.json'), check.load(ROOT / 'authoring/zooms.json')
    spec = dict(parts[a.part])
    if a.zoom:
        spec.pop('zoom', None)
        if a.zoom != 'none':
            spec['zoom'] = a.zoom
    img = Image.open(ROOT / 'parts' / a.part / f'{a.part}-v{a.version}.png')
    alpha = np.asarray(img.convert('RGBA'))[..., 3].astype(np.float32) / 255
    target, box = target_mask(a.part)
    r = dice_search(alpha, target, box, a.scales)
    S = r['Sx']; T = r['T']
    M0 = check.placement(spec, zooms, img.size, 0, 0, 1.0)
    base = M0[0, 0]
    Ms = check.placement(spec, zooms, img.size, 0, 0, S / base)
    pl = {'scale': round(S / base, 5), 'dx': round(T[0] - Ms[0, 2], 2), 'dy': round(T[1] - Ms[1, 2], 2), 'dice': r['dice'], 'zoomUsed': spec.get('zoom')}
    print(a.part, a.version, json.dumps(pl))
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
