"""Accept a part with two uniform placements blended smoothly along y (for a generated body whose proportions differ
slightly from the original: e.g. shoulders fit at one scale, legs at another). Local shapes are preserved.
Usage: python -I tools/model-authoring/accept_blend.py part ver  s1 dx1 dy1  s2 dx2 dy2  y_from y_to
(placement 1 above y_from, placement 2 below y_to, smooth in between; canvas y)
"""
import json, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check

ROOT = check.ROOT


def main():
    part, ver = sys.argv[1], int(sys.argv[2])
    s1, dx1, dy1, s2, dx2, dy2, ya, yb = map(float, sys.argv[3:11])
    parts, zooms = check.load(ROOT / 'authoring/parts.json'), check.load(ROOT / 'authoring/zooms.json')
    img = Image.open(ROOT / 'parts' / part / f'{part}-v{ver}.png')
    a = np.asarray(img.convert('RGBA')).astype(np.float32) / 255
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    M1 = check.placement(parts[part], zooms, img.size, dx1, dy1, s1)
    M2 = check.placement(parts[part], zooms, img.size, dx2, dy2, s2)
    W, H = check.CANVAS
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    t = np.clip((yy - ya) / (yb - ya), 0, 1); w = t * t * (3 - 2 * t)  # 0 -> placement 1, 1 -> placement 2
    def inv(M):
        s = M[0, 0]
        return (xx - M[0, 2]) / s, (yy - M[1, 2]) / s
    x1, y1 = inv(M1); x2, y2 = inv(M2)
    mx = (x1 * (1 - w) + x2 * w).astype(np.float32); my = (y1 * (1 - w) + y2 * w).astype(np.float32)
    out = cv2.remap(pm, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    al = out[..., 3:4]
    rgb = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0)
    res = np.concatenate([np.clip(rgb, 0, 1), np.clip(al, 0, 1)], -1)
    Image.fromarray((res * 255 + 0.5).astype(np.uint8), 'RGBA').save(ROOT / 'parts-aligned' / f'{part}.png')
    rp = ROOT / 'records' / f'{part}.json'
    rec = json.loads(rp.read_text(encoding='utf8'))
    v = next(v for v in rec['versions'] if v['version'] == ver)
    v['acceptedPlacement'] = {'blend': True, 'upper': {'scale': s1, 'dx': dx1, 'dy': dy1}, 'lower': {'scale': s2, 'dx': dx2, 'dy': dy2}, 'y': [ya, yb]}
    v['acceptedMatrix'] = {'upper': M1.round(5).tolist(), 'lower': M2.round(5).tolist()}
    rec['selected'] = ver
    rp.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print('accepted', part, ver, v['acceptedPlacement'])


if __name__ == '__main__':
    main()
