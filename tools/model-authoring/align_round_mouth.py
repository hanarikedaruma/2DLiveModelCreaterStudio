"""丸い口（口の中・縁の線）の生成画像を、見本（reference/open-mouth-target.png）の丸に合わせて置く。

見本は元画像と同じ構図（目・輪郭のずれ 0px）なので、見本の座標をそのまま元画像の座標として使う。
見本の画素はパーツに使わない（丸の大きさと位置を測る物差しだけ）。合わせるのは縦横同じ倍率と平行移動だけ。
使い方: python -I tools/model-authoring/align_round_mouth.py [--inside N] [--rim N]（N は版。省略すると一致率の高い版）
出力: parts-aligned/mouthRoundInside.png・parts-aligned/mouthRim.png（1024×1536）、preview/mouth-round-align.png
"""
import sys
import argparse, json
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
W, H = 1024, 1536
zooms = json.loads((ROOT / 'authoring' / 'zooms.json').read_text(encoding='utf8'))
BOX = zooms['mouthRound']['box']  # [x, y, w, h]（元画像・見本の座標）
OUT = zooms['mouthRound']['out'][0]
K = OUT / BOX[2]  # 拡大の倍率（8）


def target_masks():
    """見本の拡大（白の上）から、丸の縁（暗い線）と、縁の内側（口の中）を求める"""
    z = np.asarray(Image.open(ROOT / 'reference' / 'zoom-mouthRound.png').convert('RGB')).astype(np.float32)
    lum = z @ np.array([0.299, 0.587, 0.114], np.float32)
    yy, xx = np.mgrid[0:OUT, 0:OUT]
    c = ((524.5 - BOX[0]) * K, (379.0 - BOX[1]) * K)  # 丸の中心（測った値）
    near = (xx - c[0]) ** 2 + (yy - c[1]) ** 2 < (24 * K) ** 2
    ring = (lum < 170) & near
    pts = np.argwhere(ring)[:, ::-1].astype(np.int32)
    hull = cv2.convexHull(pts)
    disk = np.zeros((OUT, OUT), np.uint8)
    cv2.fillConvexPoly(disk, hull, 1)
    inner = (disk > 0) & ~ring
    return ring, disk > 0, inner


def alpha_of(path):
    im = Image.open(path).convert('RGBA')
    return im, np.asarray(im)[..., 3]


def bbox(mask):
    ys, xs = np.where(mask)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def fit(gen_mask, target_mask):
    """外接矩形を合わせる縦横同じ倍率と平行移動（生成画像の画素 → 拡大の座標）"""
    gx0, gy0, gx1, gy1 = bbox(gen_mask)
    tx0, ty0, tx1, ty1 = bbox(target_mask)
    s = ((tx1 - tx0) / (gx1 - gx0) + (ty1 - ty0) / (gy1 - gy0)) / 2
    tx = (tx0 + tx1) / 2 - s * (gx0 + gx1) / 2
    ty = (ty0 + ty1) / 2 - s * (gy0 + gy1) / 2
    return s, tx, ty


def warp_to_zoom(im, s, tx, ty):
    m = np.array([[s, 0, tx], [0, s, ty]], np.float32)
    a = np.asarray(im).astype(np.float32)
    # 乗算済みの色で写して、縁の色にじみを防ぐ
    pm = a.copy()
    pm[..., :3] *= pm[..., 3:4] / 255
    out = cv2.warpAffine(pm, m, (OUT, OUT), flags=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC, borderValue=0)
    return out


def to_canvas(pm_zoom):
    """拡大の座標（乗算済み）→ 元画像の 1024×1536 の透明なキャンバス（ストレートの RGBA）"""
    small = cv2.resize(pm_zoom, (BOX[2], BOX[3]), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((H, W, 4), np.float32)
    canvas[BOX[1]:BOX[1] + BOX[3], BOX[0]:BOX[0] + BOX[2]] = small
    a = np.clip(canvas[..., 3:4], 0, 255)
    rgb = np.where(a > 0, canvas[..., :3] * 255 / np.maximum(a, 1e-6), 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a]).astype(np.uint8), 'RGBA')


def iou(a, b):
    return float((a & b).sum() / max(1, (a | b).sum()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--inside', type=int)
    ap.add_argument('--rim', type=int)
    args = ap.parse_args()
    ring, disk, inner = target_masks()
    report = {}
    chosen = {}
    for part, target, which in (('mouthRoundInside', inner, args.inside), ('mouthRoundRim', disk, args.rim)):
        rows = []
        for path in sorted((ROOT / 'parts' / part).glob(f'{part}-v*.png')):
            im, a = alpha_of(path)
            mask = a > 64
            if part == 'mouthRoundRim':
                # 縁は輪なので、内側を埋めた丸で合わせる
                pts = np.argwhere(mask)[:, ::-1].astype(np.int32)
                filled = np.zeros(mask.shape, np.uint8)
                cv2.fillConvexPoly(filled, cv2.convexHull(pts), 1)
                mask = filled > 0
            s, tx, ty = fit(mask, target)
            pm = warp_to_zoom(im, s, tx, ty)
            placed = pm[..., 3] > 64
            if part == 'mouthRoundRim':
                score = iou(placed, ring)  # 線どうしの重なり
            else:
                score = iou(placed, inner)
            version = int(path.stem.split('-v')[-1])
            rows.append({'version': version, 'scale': round(s, 4), 'offset': [round(tx, 1), round(ty, 1)], 'iou': round(score, 3), 'pm': pm})
        best = next(r for r in rows if r['version'] == which) if which else max(rows, key=lambda r: r['iou'])
        chosen[part] = best
        report[part] = {'chosen': best['version'], 'versions': [{k: v for k, v in r.items() if k != 'pm'} for r in rows]}
    inside = to_canvas(chosen['mouthRoundInside']['pm'])
    rim = to_canvas(chosen['mouthRoundRim']['pm'])
    inside.save(ROOT / 'parts-aligned' / 'mouthRoundInside.png')
    rim.save(ROOT / 'parts-aligned' / 'mouthRim.png')

    # 比べる画像: 左から 見本・元画像の肌に口の中と縁を重ねたもの・差（6倍）
    box = (480, 345, 570, 415)
    scale = 6
    target = Image.open(ROOT / 'reference' / 'open-mouth-target.png').convert('RGBA').crop(box)
    base = Image.open(ROOT / 'reference' / 'original.png').convert('RGBA')
    over = base.copy()
    over.alpha_composite(inside)
    over.alpha_composite(rim)
    over = over.crop(box)
    w, h = (box[2] - box[0]) * scale, (box[3] - box[1]) * scale
    sheet = Image.new('RGB', (w * 2 + 12, h), 'white')
    sheet.paste(target.resize((w, h), Image.LANCZOS).convert('RGB'), (0, 0))
    sheet.paste(over.resize((w, h), Image.LANCZOS).convert('RGB'), (w + 12, 0))
    sheet.save(ROOT / 'preview' / 'mouth-round-align.png')
    report['innerFill'] = round(float((np.asarray(inside)[..., 3] > 64).sum()), 0)
    (ROOT / 'authoring' / 'mouth-round-align.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
