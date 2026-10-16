"""Reference-guided face turn (FaceAngleX). From the turned-head references (reference/turn-<side>-v1.png, aligned to
the canvas on the shoulders), measure where each layer of the head moves, and write authoring/turnref-<side>.json with
per-layer displacement models that build.ts turns into FaceAngleX keys.

Correspondences:
- SIFT matches between the original head and the reference (mutual, ratio test), each assigned to the part that is
  drawn on top at that pixel of the original, outliers removed per layer with RANSAC;
- the jaw line traced as the darkest path between hand-set end points (original and reference), sampled by arc
  length on both sides of the chin.
The original is used only as a measuring stick (where things are); no pixels of it go into the model.
Usage: python -I tools/model-authoring/turnref.py left|right
"""
import json, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT, SCRATCH  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
OUT = SCRATCH
PROJECT = json.loads((ROOT / 'project.json').read_text(encoding='utf8'))
CFG = json.loads((ROOT / 'authoring' / 'turnref.json').read_text(encoding='utf8'))

# layers: parts that move together (one displacement model each)
LAYERS = {
    'face': ['face', 'cheek', 'eyeWhiteL', 'irisL', 'highlightL', 'upperLidL', 'lowerLidL', 'eyeWhiteR', 'irisR', 'highlightR', 'upperLidR', 'lowerLidR',
             'browL', 'browR', 'upperLip', 'lowerLip', 'mouthInside', 'teeth'],
    'frontHair': ['frontHair'], 'sideHairR': ['sideHairR', 'strandR'], 'sideHairL': ['sideHairL'], 'sideHairBackL': ['sideHairBackL', 'strandL'],
    'backHair': ['backHair'], 'earL': ['earL', 'earringL'], 'earR': ['earR', 'earringR'],
    'ornament': ['hairOrnament', 'ribbonLong', 'ribbonShort'],
    'body': ['neck', 'torso', 'chest', 'armL', 'armR'],
}
PART_LAYER = {p: l for l, ps in LAYERS.items() for p in ps}


def top_part_map():
    order = [pid[5:] for pid in PROJECT['model']['drawOrder']]
    top = np.full((1536, 1024), -1, np.int32)
    for i, pid in enumerate(order):
        p = ROOT / 'parts-aligned' / f'{pid}.png'
        if not p.exists():
            continue
        a = np.asarray(Image.open(p).convert('RGBA'))[..., 3]
        top[a > 128] = i
    return order, top


def sift_pairs(o, r, box):
    up = 2
    g1 = cv2.resize(cv2.cvtColor(o[box[1]:box[3], box[0]:box[2]], cv2.COLOR_RGB2GRAY), None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
    g2 = cv2.resize(cv2.cvtColor(r[box[1]:box[3], box[0]:box[2]], cv2.COLOR_RGB2GRAY), None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
    sift = cv2.SIFT_create(nfeatures=20000, contrastThreshold=0.02)
    k1, d1 = sift.detectAndCompute(g1, None); k2, d2 = sift.detectAndCompute(g2, None)
    bf = cv2.BFMatcher()
    m12 = {m.queryIdx: m.trainIdx for m, n in bf.knnMatch(d1, d2, k=2) if m.distance < 0.8 * n.distance}
    m21 = {m.queryIdx: m.trainIdx for m, n in bf.knnMatch(d2, d1, k=2) if m.distance < 0.8 * n.distance}
    pairs = [(i, j) for i, j in m12.items() if m21.get(j) == i]
    P1 = np.array([k1[i].pt for i, _ in pairs]) / up + box[:2]
    P2 = np.array([k2[j].pt for _, j in pairs]) / up + box[:2]
    return P1, P2


def trace_line(img, pts, band=10):
    """Darkest path through the given way points (each segment by dynamic programming over columns or rows)."""
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32), (3, 3), 0)
    out = []
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        if abs(x1 - x0) >= abs(y1 - y0):  # walk columns
            xs = np.arange(int(round(x0)), int(round(x1)) + (1 if x1 >= x0 else -1), 1 if x1 >= x0 else -1)
            n = len(xs); cost = np.full((n, 2 * band + 1), np.inf); back = np.zeros_like(cost, int)
            yc = [y0 + (y1 - y0) * k / max(1, n - 1) for k in range(n)]
            for k, x in enumerate(xs):
                ys = np.clip(np.round(yc[k]).astype(int) + np.arange(-band, band + 1), 0, img.shape[0] - 1)
                c = g[ys, x]
                if k == 0:
                    cost[0] = c + np.abs(np.arange(-band, band + 1)) * 50
                    continue
                for j in range(2 * band + 1):
                    lo, hi = max(0, j - 2), min(2 * band + 1, j + 3)
                    jj = lo + int(np.argmin(cost[k - 1, lo:hi])); cost[k, j] = cost[k - 1, jj] + c[j]; back[k, j] = jj
            j = int(np.argmin(cost[-1] + np.abs(np.arange(-band, band + 1)) * 50))
            seg = []
            for k in range(n - 1, -1, -1):
                seg.append((float(xs[k]), float(np.round(yc[k]) - band + j))); j = back[k, j]
            out.extend(seg[::-1])
        else:  # walk rows
            ys = np.arange(int(round(y0)), int(round(y1)) + (1 if y1 >= y0 else -1), 1 if y1 >= y0 else -1)
            n = len(ys); cost = np.full((n, 2 * band + 1), np.inf); back = np.zeros_like(cost, int)
            xc = [x0 + (x1 - x0) * k / max(1, n - 1) for k in range(n)]
            for k, y in enumerate(ys):
                xs = np.clip(np.round(xc[k]).astype(int) + np.arange(-band, band + 1), 0, img.shape[1] - 1)
                c = g[y, xs]
                if k == 0:
                    cost[0] = c + np.abs(np.arange(-band, band + 1)) * 50
                    continue
                for j in range(2 * band + 1):
                    lo, hi = max(0, j - 2), min(2 * band + 1, j + 3)
                    jj = lo + int(np.argmin(cost[k - 1, lo:hi])); cost[k, j] = cost[k - 1, jj] + c[j]; back[k, j] = jj
            j = int(np.argmin(cost[-1] + np.abs(np.arange(-band, band + 1)) * 50))
            seg = []
            for k in range(n - 1, -1, -1):
                seg.append((float(np.round(xc[k]) - band + j), float(ys[k]))); j = back[k, j]
            out.extend(seg[::-1])
    return np.array(out)


def resample(poly, n):
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(poly, axis=0).T))]
    t = np.linspace(0, d[-1], n)
    return np.stack([np.interp(t, d, poly[:, 0]), np.interp(t, d, poly[:, 1])], 1)


def jaw_correspondences(o, r, cfg):
    """Left part (left end -> chin) and right part (chin -> right end), each resampled to n points."""
    res = {}
    for key, img in (('orig', o), ('ref', r)):
        J = cfg['jaw'][key]
        left = trace_line(img, [J['left'], *J.get('leftVia', []), J['chin']])
        right = trace_line(img, [J['chin'], *J.get('rightVia', []), J['right']])
        res[key] = (left, right)
    n = cfg['jaw'].get('samples', 9)
    src = np.concatenate([resample(res['orig'][0], n), resample(res['orig'][1], n)[1:]])
    dst = np.concatenate([resample(res['ref'][0], n), resample(res['ref'][1], n)[1:]])
    return src, dst, res


def ransac_affine(src, dst, thr):
    if len(src) < 4:
        return np.ones(len(src), bool), None
    A, inl = cv2.estimateAffine2D(src.astype(np.float32), dst.astype(np.float32), method=cv2.RANSAC, ransacReprojThreshold=thr, maxIters=5000, confidence=0.995)
    return (inl.ravel() > 0) if inl is not None else np.ones(len(src), bool), A


def main():
    side = sys.argv[1]
    o = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB'))
    cfg = CFG[side]
    r = np.asarray(Image.open(ROOT / 'reference' / f'turn-{side}-v{cfg["version"]}.png').convert('RGB'))
    order, top = top_part_map()
    P1, P2 = sift_pairs(o, r, (220, 0, 820, 520))
    mag = np.hypot(*(P2 - P1).T)
    keep = mag < cfg.get('maxMove', 60)
    P1, P2 = P1[keep], P2[keep]
    groups = {}
    for a, b in zip(P1, P2):
        i = top[int(round(a[1])), int(round(a[0]))]
        if i < 0:
            continue
        layer = PART_LAYER.get(order[i])
        if layer:
            groups.setdefault(layer, []).append((a, b))
    result = {'side': side, 'layers': {}}
    vis = Image.fromarray(np.uint8(o * 0.5 + r * 0.5)).crop((220, 0, 820, 520)).resize((1200, 1040))
    dr = ImageDraw.Draw(vis)
    colors = {'face': (255, 0, 0), 'frontHair': (0, 160, 0), 'sideHairR': (0, 0, 255), 'sideHairL': (0, 160, 255), 'sideHairBackL': (160, 0, 255),
              'backHair': (120, 80, 0), 'earL': (255, 120, 0), 'earR': (255, 120, 0), 'ornament': (255, 0, 200), 'body': (90, 90, 90)}
    for layer, pr in groups.items():
        s = np.array([p[0] for p in pr]); d = np.array([p[1] for p in pr])
        inl, A = ransac_affine(s, d, cfg.get('ransacFace', 10.0) if layer == 'face' else cfg.get('ransac', 5.0))
        s, d = s[inl], d[inl]
        result['layers'][layer] = {'src': s.round(2).tolist(), 'dst': d.round(2).tolist(), 'affine': None if A is None else np.round(A, 5).tolist()}
        for a, b in zip(s, d):
            a2 = ((a[0] - 220) * 2, a[1] * 2); b2 = ((b[0] - 220) * 2, b[1] * 2)
            dr.line([a2, b2], fill=colors.get(layer, (0, 0, 0)), width=2)
    if 'jaw' in cfg:
        js, jd, traced = jaw_correspondences(o, r, cfg)
        result['jaw'] = {'src': js.round(2).tolist(), 'dst': jd.round(2).tolist()}
        for key, col in (('orig', (0, 0, 0)), ('ref', (255, 0, 0))):
            for poly in traced[key]:
                dr.line([((x - 220) * 2, y * 2) for x, y in poly], fill=col, width=2)
        for a, b in zip(js, jd):
            dr.line([((a[0] - 220) * 2, a[1] * 2), ((b[0] - 220) * 2, b[1] * 2)], fill=(255, 0, 0), width=3)
    vis.save(OUT / f'turnref-{side}.png')
    (ROOT / 'authoring' / f'turnref-{side}.json').write_text(json.dumps(result), encoding='utf8')
    print(side, {k: len(v['src']) for k, v in result['layers'].items()}, 'jaw', len(result.get('jaw', {}).get('src', [])))


if __name__ == '__main__':
    main()
