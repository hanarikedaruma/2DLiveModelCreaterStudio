"""Fit the per-layer displacement fields of the face turn from the correspondences (authoring/turnref-<side>.json) and
write authoring/turnfield.json for build.ts:
- the amount is normalised: the near eye moves `amount` px at FaceAngleX = +-30 (the generated references turn more,
  and by different amounts on each side);
- face: thin-plate spline from the face matches and the jaw line; frontHair: thin-plate spline (falls back to the face
  field); ornament, earL: affine; layers without enough matches are left to build.ts (depth-based parallel move).
Also renders a check: the fitted fields at full strength (unscaled) applied to the head layers, over the reference.
Usage: python -I tools/model-authoring/turnfit.py
"""
import json, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT, SCRATCH  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
OUT = SCRATCH
CFG = json.loads((ROOT / 'authoring' / 'turnref.json').read_text(encoding='utf8'))
FIT = CFG.get('fit', {'faceLambda': 2000, 'hairLambda': 20000, 'minTps': 8, 'minAffine': 6})


def U(r):
    with np.errstate(divide='ignore', invalid='ignore'):
        v = r * r * np.log(r)
    return np.nan_to_num(v)


def dedupe(src, dst, tol=2.0):
    keep = []
    for i, p in enumerate(src):
        if all(np.hypot(*(p - src[j])) > tol for j in keep):
            keep.append(i)
    return src[keep], dst[keep]


def fit_tps(src, disp, lam):
    n = len(src)
    K = U(np.linalg.norm(src[:, None] - src[None], axis=-1)) + lam * np.eye(n)
    P = np.c_[np.ones(n), src]
    A = np.zeros((n + 3, n + 3)); A[:n, :n] = K; A[:n, n:] = P; A[n:, :n] = P.T
    b = np.zeros((n + 3, 2)); b[:n] = disp
    sol = np.linalg.solve(A, b)
    return {'type': 'tps', 'centers': src.round(3).tolist(), 'weights': sol[:n].round(6).tolist(), 'affine': sol[n:].round(6).tolist()}


def eval_field(f, pts):
    pts = np.asarray(pts, float)
    if f['type'] == 'tps':
        c = np.array(f['centers']); w = np.array(f['weights']); a = np.array(f['affine'])
        return np.c_[np.ones(len(pts)), pts] @ a + U(np.linalg.norm(pts[:, None] - c[None], axis=-1)) @ w
    A = np.array(f['A'])  # 2x3, maps p -> p + displacement
    return pts @ A[:, :2].T + A[:, 2] - pts


def fit_side(side):
    c = CFG[side]
    data = json.loads((ROOT / 'authoring' / f'turnref-{side}.json').read_text(encoding='utf8'))
    L = data['layers']
    face_src = np.array(L.get('face', {}).get('src', []), float).reshape(-1, 2)
    face_dst = np.array(L.get('face', {}).get('dst', []), float).reshape(-1, 2)
    near = np.array(c['nearEye'], float)
    m = np.hypot(*(face_src - near).T) < 28
    near_dx = float(np.median((face_dst - face_src)[m, 0])) if m.sum() >= 3 else float(np.median((face_dst - face_src)[:, 0]))
    scale = c.get('amountOverride', CFG['amount']) / abs(near_dx)
    fields = {}
    # face: matches + jaw line (the jaw line is the outline, so it is given a little more weight by repeating it)
    js = np.array(data['jaw']['src'], float); jd = np.array(data['jaw']['dst'], float)
    src = np.r_[face_src, js]; dst = np.r_[face_dst, jd]
    src, dst = dedupe(src, dst)
    fields['face'] = fit_tps(src, dst - src, FIT['faceLambda'])
    for layer, kind in (('frontHair', 'tps'), ('ornament', 'affine'), ('earL', 'affine'), ('backHair', 'affine')):
        if layer not in L:
            continue
        s = np.array(L[layer]['src'], float); d = np.array(L[layer]['dst'], float)
        s, d = dedupe(s, d)
        if kind == 'tps' and len(s) >= FIT['minTps']:
            fields[layer] = fit_tps(s, d - s, FIT['hairLambda'])
        elif len(s) >= FIT['minAffine']:
            A, _ = cv2.estimateAffine2D(s.astype(np.float32), d.astype(np.float32), method=cv2.LMEDS)
            if A is not None:
                fields[layer] = {'type': 'affine', 'A': np.round(A, 6).tolist()}
    return {'parameter': c['parameter'], 'scale': round(scale, 5), 'nearEyeDx': round(near_dx, 2), 'fields': fields}


def check_image(side, res):
    """Full-strength fields applied to the head layers' aligned images (by warping the images), over the reference."""
    proj = json.loads((ROOT / 'project.json').read_text(encoding='utf8'))
    order = [pid[5:] for pid in proj['model']['drawOrder']]
    layer_of = {}
    for layer, parts in {'face': ['face', 'cheek', 'eyeWhiteL', 'irisL', 'highlightL', 'upperLidL', 'lowerLidL', 'eyeWhiteR', 'irisR', 'highlightR', 'upperLidR', 'lowerLidR',
                                  'browL', 'browR', 'upperLip', 'lowerLip'], 'frontHair': ['frontHair'], 'ornament': ['hairOrnament', 'ribbonLong', 'ribbonShort'],
                         'earL': ['earL', 'earringL']}.items():
        for p in parts:
            layer_of[p] = layer
    box = (300, 100, 760, 470)
    yy, xx = np.mgrid[box[1]:box[3], box[0]:box[2]].astype(np.float32)
    comp = np.ones((box[3] - box[1], box[2] - box[0], 3), np.float32)
    for pid in order:
        if pid not in layer_of or layer_of[pid] not in res['fields']:
            continue
        f = res['fields'][layer_of[pid]]
        img = np.asarray(Image.open(ROOT / 'parts-aligned' / f'{pid}.png').convert('RGBA')).astype(np.float32) / 255
        # inverse map approximately: sample at p - d(p) (fixed point iteration)
        q = np.stack([xx.ravel(), yy.ravel()], 1)
        src = q.copy()
        for _ in range(4):
            src = q - eval_field(f, src)
        mx = src[:, 0].reshape(xx.shape).astype(np.float32); my = src[:, 1].reshape(xx.shape).astype(np.float32)
        warped = cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        if pid.startswith(('iris', 'highlight')):
            continue
        a = warped[..., 3:4]
        comp = comp * (1 - a) + warped[..., :3] * a
    ref = np.asarray(Image.open(ROOT / 'reference' / f'turn-{side}-v{CFG[side]["version"]}.png').convert('RGB')).astype(np.float32)[box[1]:box[3], box[0]:box[2]] / 255
    blend = (comp * 0.5 + ref * 0.5)
    out = np.concatenate([ref, comp, blend], 1)
    Image.fromarray((out * 255).astype(np.uint8)).save(OUT / f'turnfit-{side}.png')


def main():
    res = {side: fit_side(side) for side in ('left', 'right')}
    (ROOT / 'authoring' / 'turnfield.json').write_text(json.dumps(res), encoding='utf8')
    for side in ('left', 'right'):
        r = res[side]
        print(side, 'near eye dx', r['nearEyeDx'], 'scale', r['scale'], 'fields', {k: v['type'] for k, v in r['fields'].items()})
        check_image(side, r)


if __name__ == '__main__':
    main()
