"""Align a turned-head reference (parts/refTurn*/...) to the original by the parts that do not turn (shoulders, collar
bones, camisole straps: the lower part of the crop), and map it to canvas coordinates.
Usage: python -I tools/model-authoring/ref_align.py refTurnLeft 1   -> prints the similarity, writes reference/turn-<side>-v<ver>.png
(the reference resampled onto the 1024x1536 canvas, white outside) and an onion-skin overlay in checks/ of the project.
"""
import json, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT, SCRATCH  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
OUT = SCRATCH


def main():
    part, ver = sys.argv[1], int(sys.argv[2])
    zooms = json.loads((ROOT / 'authoring' / 'zooms.json').read_text(encoding='utf8'))
    bx, by, bw, bh = zooms['headTurnRef']['box']
    orig = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB'))
    ref = np.asarray(Image.open(ROOT / 'parts' / part / f'{part}-v{ver}.png').convert('RGB'))
    s0 = bw / ref.shape[1]  # reference px -> canvas px (plain mapping)
    # features in the lower part (below the chin): canvas y > 470 in the original, the matching band in the reference
    g1 = cv2.cvtColor(orig, cv2.COLOR_RGB2GRAY); g2 = cv2.cvtColor(ref, cv2.COLOR_RGB2GRAY)
    m1 = np.zeros_like(g1); m1[470:by + bh, bx:bx + bw] = 255
    m2 = np.zeros_like(g2); m2[int((470 - by) / s0) - 20:, :] = 255
    sift = cv2.SIFT_create(nfeatures=6000)
    k1, d1 = sift.detectAndCompute(g1, m1); k2, d2 = sift.detectAndCompute(g2, m2)
    good = [m for m, n in cv2.BFMatcher().knnMatch(d2, d1, k=2) if m.distance < 0.75 * n.distance]
    src = np.float32([k2[m.queryIdx].pt for m in good]); dst = np.float32([k1[m.trainIdx].pt for m in good])
    A, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3, maxIters=10000, confidence=0.999)
    n_in = int(inl.sum()) if inl is not None else 0
    plain = np.array([[s0, 0, bx], [0, s0, by]])
    if A is None or n_in < 12:
        A = plain; note = 'plain mapping (too few matches)'
    else:
        note = 'fitted on shoulders'
    scale = float(np.hypot(A[0, 0], A[1, 0])); rot = float(np.degrees(np.arctan2(A[1, 0], A[0, 0])))
    warped = cv2.warpAffine(ref, A, (1024, 1536), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    side = 'left' if 'Left' in part else 'right'
    Image.fromarray(warped).save(ROOT / 'reference' / f'turn-{side}-v{ver}.png')
    # onion skin over the head region
    a = Image.fromarray(orig).crop((bx, by, bx + bw, by + bh)); b = Image.fromarray(warped).crop((bx, by, bx + bw, by + bh))
    Image.blend(a, b, 0.5).save(OUT / f'onion-{side}-v{ver}.png')
    side_by = Image.new('RGB', (bw * 2 + 10, bh), 'white'); side_by.paste(a, (0, 0)); side_by.paste(b, (bw + 10, 0)); side_by.save(OUT / f'pair-{side}-v{ver}.png')
    res = {'part': part, 'version': ver, 'matches': len(good), 'inliers': n_in, 'scaleVsPlain': round(scale / s0, 4), 'rotationDeg': round(rot, 2),
           'shiftVsPlain': [round(float(A[0, 2] - bx), 1), round(float(A[1, 2] - by), 1)], 'note': note, 'matrix': np.round(A, 6).tolist()}
    (ROOT / 'reference' / f'turn-{side}-v{ver}.json').write_text(json.dumps(res, indent=1), encoding='utf8')
    print(json.dumps(res))


if __name__ == '__main__':
    main()
