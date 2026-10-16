"""グリッドで位置と大きさを確かめる（配置の確かめ）。

1枚の絵（既定は preview/grid-<part>.png）:
- 上の左: 元画像の範囲にグリッド。上の中: 置いたパーツ（parts-aligned）を半透明で重ね、パーツの輪郭を赤で描く。
- 上の右: 元画像の線（青）とパーツの輪郭（赤）。ずれは青と赤の分かれで見える。
- 下: パーツの目印（L 左端・R 右端・T 上端・B 下端・C 中心・M いちばん大きい塊の中心）ごとの拡大（1px のマス目）。赤の十字がパーツの目印、
  緑の十字が記録した元画像の目印。
グリッドは step px ごとの細い線と、5 マスごとの太い線。太い線にキャンバスの座標を書く。マス目の線の右・下の画素が、その座標の画素。

確かめ方:
1. 絵を見て、パーツの目印に当たる所を元画像で探し、その画素の座標を拡大のマス目で読む。元画像で隠れている目印は飛ばす。
2. 読んだ座標を記録する: --orig L 432 335 --orig R 470 330（validation/landmarks.json に残る）。
3. 目印のずれ（元画像 − パーツ）の最大を許容差（目・まぶた・眉・口は 1px、ほかは 2px）と比べる。2点以上あれば、
   縦横同じ倍率と平行移動の当てはめ（直すときの倍率と移動）も出す。結果は validation/placement.json に残る。
outlineToLine（パーツの輪郭から元画像のいちばん近い線までの距離の平均）は、全パーツを先に見るための目安。
元画像で見えている輪郭だけで測る（上に描くパーツに覆われる所・切り抜きの外は除く。描く順は authoring/composite.json）。
CHECK_MEAN を超えたパーツは、ずれている見込みが高い（頬の赤みのように線の無いパーツは大きく出る）。
元画像は物差しとしてだけ使う（パーツの画素には使わない）。
使い方: python -I tools/model-authoring/grid_check.py <part> [<part> ...] [--all] [--orig L x y ...] [--box x y w h] [--step 10] [--zoom 6] [--out file.png]
"""
import sys
import argparse
import json
import re
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）

FINE = re.compile(r'^(eye|iris|pupil|highlight|upperLid|lowerLid|lash|brow|mouth|lip|upperLip|lowerLip|teeth|tongue)', re.I)
LABELS = ('L', 'R', 'T', 'B', 'C', 'M')
CHECK_MEAN = 2.5  # outlineToLine の平均がこれを超えたら、目印で特によく確かめる
LOUPE = 12  # 目印の拡大の半径（px）
LOUPE_ZOOM = 12


_ALPHA = {}


def alpha_of(name):
    """parts-aligned のパーツの透明度（0〜1）。無ければ None。"""
    if name not in _ALPHA:
        f = ROOT / 'parts-aligned' / f'{name}.png'
        _ALPHA[name] = np.asarray(Image.open(f).convert('RGBA'))[..., 3].astype(np.float32) / 255 if f.exists() else None
    return _ALPHA[name]


def visibility(name, box, cfg):
    """元画像（休みの姿勢）で、このパーツが見えている割合の場（box の範囲）。上に描くパーツの覆いと、切り抜きから求める。
    描く順に無いパーツは None。"""
    if not cfg or name not in cfg['order']:
        return None
    x0, y0, x1, y1 = box
    hidden, clip, opac = set(cfg.get('hiddenAtRest', [])), cfg.get('clip', {}), cfg.get('opacity', {})
    cover = np.zeros((y1 - y0, x1 - x0), np.float32)
    for n in cfg['order'][cfg['order'].index(name) + 1:]:
        a = alpha_of(n)
        if n in hidden or a is None:
            continue
        a = a[y0:y1, x0:x1] * opac.get(n, 1.0)
        if n in clip and alpha_of(clip[n]) is not None:
            a = a * alpha_of(clip[n])[y0:y1, x0:x1]
        cover = cover + a * (1 - cover)
    seen = 1 - cover
    if name in clip and alpha_of(clip[name]) is not None:
        seen = seen * alpha_of(clip[name])[y0:y1, x0:x1]
    if name in hidden:
        seen = seen * 0
    return seen


def tolerance(part):
    return 1.0 if FINE.match(part) else 2.0


def outline(alpha, thr=96):
    m = (alpha > thr).astype(np.uint8)
    return cv2.morphologyEx(m, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0


def part_landmarks(alpha):
    """パーツの目印（キャンバスの画素の座標）。端は不透明（α>128）の範囲の端の画素、中心は透明度で重みを付けた重心。"""
    ys, xs = np.where(alpha > 128)
    if not len(xs):
        return {}
    med = lambda v: int(np.median(v))
    lm = {'L': [int(xs.min()), med(ys[xs == xs.min()])], 'R': [int(xs.max()), med(ys[xs == xs.max()])],
          'T': [med(xs[ys == ys.min()]), int(ys.min())], 'B': [med(xs[ys == ys.max()]), int(ys.max())]}
    w = alpha.astype(np.float64)
    lm['C'] = [round(float((w.sum(axis=0) * np.arange(alpha.shape[1])).sum() / w.sum()), 1),
               round(float((w.sum(axis=1) * np.arange(alpha.shape[0])).sum() / w.sum()), 1)]
    n, lab, stats, cents = cv2.connectedComponentsWithStats((alpha > 128).astype(np.uint8), connectivity=8)
    if n > 2:  # 離れた塊がいくつもあるパーツ（ハイライトなど）は、いちばん大きい塊の中心も M にする
        k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        if stats[k, cv2.CC_STAT_AREA] < 0.9 * stats[1:, cv2.CC_STAT_AREA].sum():
            lm['M'] = [round(float(cents[k][0]), 1), round(float(cents[k][1]), 1)]
    return lm


def similarity(pairs):
    """o = (p - c) s + c + t（目印の重心 c のまわりの、縦横同じ倍率 s と平行移動 t）の最小二乗。1点なら平行移動だけ。"""
    P = np.array([p for p, _ in pairs], np.float64)
    Q = np.array([o for _, o in pairs], np.float64)
    pc, qc = P.mean(axis=0), Q.mean(axis=0)
    if len(P) < 2 or np.ptp(P, axis=0).max() < 4:
        return 1.0, qc - pc, pc
    s = float(((P - pc) * (Q - qc)).sum() / ((P - pc) ** 2).sum())
    return s, qc - pc, pc


def evaluate(part_name, lm, orig_lm):
    """目印のずれと、許容差での判定。"""
    tol = tolerance(part_name)
    rows = {k: {'part': lm[k], 'orig': orig_lm[k], 'diff': [round(orig_lm[k][0] - lm[k][0], 1), round(orig_lm[k][1] - lm[k][1], 1)]}
            for k in LABELS if k in orig_lm and k in lm}
    if not rows:
        return {'tol': tol, 'verdict': 'unread'}
    max_diff = max(float(np.hypot(*r['diff'])) for r in rows.values())
    s, t, c = similarity([(r['part'], r['orig']) for r in rows.values()])
    res = {'tol': tol, 'points': rows, 'maxDiff': round(max_diff, 2),
           'fit': {'scale': round(s, 4), 'about': [round(float(c[0]), 1), round(float(c[1]), 1)], 'shift': [round(float(t[0]), 1), round(float(t[1]), 1)]},
           'verdict': 'ok' if max_diff <= tol else 'off'}
    return res


def cross(d, X, Y, color, r=7):
    d.line([(X - r, Y), (X + r, Y)], fill=color, width=2)
    d.line([(X, Y - r), (X, Y + r)], fill=color, width=2)


def check(part_name, args, orig, orig_lm, cfg):
    part = Image.open(ROOT / 'parts-aligned' / f'{part_name}.png').convert('RGBA')
    a = np.asarray(part)[..., 3]
    ys, xs = np.where(a > 32)
    if args.box:
        x, y, w, h = args.box
    else:
        qx = [int(v[0]) for v in orig_lm.values()]  # 記録した元画像の目印も入る範囲
        qy = [int(v[1]) for v in orig_lm.values()]
        x, y = min([int(xs.min())] + qx) - 12, min([int(ys.min())] + qy) - 12
        w, h = max([int(xs.max())] + qx) - x + 13, max([int(ys.max())] + qy) - y + 13
    x, y = max(0, x), max(0, y)
    w, h = min(w, orig.width - x), min(h, orig.height - y)  # キャンバスの中だけ
    box = (x, y, x + w, y + h)
    z = args.zoom
    o = orig.crop(box)
    p = part.crop(box)
    lm = part_landmarks(a)
    result = evaluate(part_name, lm, orig_lm)
    seen = visibility(part_name, box, cfg)  # None: 描く順に無い

    def grid(img, gx0, gy0, gw, gh, zz, step):
        """マス目を薄く重ねる（太い線に座標）。"""
        layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
        dr = ImageDraw.Draw(layer)
        for gx in range((gx0 // step + 1) * step, gx0 + gw, step):
            major = gx % (step * 5) == 0
            X = (gx - gx0) * zz
            dr.line([(X, 0), (X, gh * zz)], fill=(30, 30, 30, 170) if major else (30, 30, 30, 70), width=2 if major else 1)
            if major:
                dr.text((X + 2, 2), str(gx), fill=(0, 0, 0, 255))
        for gy in range((gy0 // step + 1) * step, gy0 + gh, step):
            major = gy % (step * 5) == 0
            Y = (gy - gy0) * zz
            dr.line([(0, Y), (gw * zz, Y)], fill=(30, 30, 30, 170) if major else (30, 30, 30, 70), width=2 if major else 1)
            if major:
                dr.text((2, Y + 2), str(gy), fill=(0, 0, 0, 255))
        return Image.alpha_composite(img.convert('RGBA'), layer)

    big = lambda im: im.resize((w * z, h * z), Image.NEAREST)
    left = grid(big(o).convert('RGBA'), x, y, w, h, z, args.step)
    # 中: パーツを半透明で重ね、パーツの輪郭を赤
    mid = big(o).convert('RGBA')
    pa = np.asarray(big(p)).copy()
    pa[..., 3] = (pa[..., 3] * 0.65).astype(np.uint8)
    mid.alpha_composite(Image.fromarray(pa, 'RGBA'))
    po = outline(np.asarray(big(p))[..., 3])
    mid_np = np.asarray(mid).copy()
    mid_np[po] = (230, 30, 30, 255)
    mid = grid(Image.fromarray(mid_np, 'RGBA'), x, y, w, h, z, args.step)
    # 右: 元画像の線（青）とパーツの輪郭（赤）
    og = cv2.cvtColor(np.asarray(big(o).convert('RGB')), cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(og, 40, 110) > 0
    right_np = np.full((h * z, w * z, 4), 255, np.uint8)
    right_np[edges] = (40, 90, 230, 255)
    if seen is None:
        right_np[po] = (230, 30, 30, 255)
    else:  # 元画像で隠れている輪郭は薄い赤
        vis_big = np.asarray(Image.fromarray((seen * 255).astype(np.uint8)).resize((w * z, h * z), Image.NEAREST)) > 127
        right_np[po & ~vis_big] = (250, 175, 175, 255)
        right_np[po & vis_big] = (230, 30, 30, 255)
    right = grid(Image.fromarray(right_np, 'RGBA'), x, y, w, h, z, args.step)
    for im in (mid, right, left):
        d = ImageDraw.Draw(im)
        for k, (px, py) in lm.items():
            if im is not left:
                cross(d, (px - x + 0.5) * z, (py - y + 0.5) * z, (230, 30, 30, 255))
                d.text(((px - x + 0.5) * z + 6, (py - y + 0.5) * z + 4), k, fill=(200, 0, 0, 255))
        for k, (qx, qy) in orig_lm.items():
            cross(d, (qx - x + 0.5) * z, (qy - y + 0.5) * z, (20, 160, 60, 255))
    # 下: 目印ごとの拡大（元画像、1px のマス目）。パーツは輪郭だけ赤で描く。重なる目印は1つにまとめる
    spots = []
    for k, (px, py) in lm.items():
        same = next((sp for sp in spots if abs(sp[1][0] - px) <= 1.5 and abs(sp[1][1] - py) <= 1.5), None)
        if same:
            same[0].append(k)
        else:
            spots.append(([k], (px, py)))
    loupes = []
    n = 2 * LOUPE + 1
    for ks, (px, py) in spots:
        lx, ly = int(round(px)) - LOUPE, int(round(py)) - LOUPE
        crop = orig.crop((lx, ly, lx + n, ly + n)).resize((n * LOUPE_ZOOM, n * LOUPE_ZOOM), Image.NEAREST).convert('RGBA')
        pc = np.asarray(part.crop((lx, ly, lx + n, ly + n)).resize((n * LOUPE_ZOOM, n * LOUPE_ZOOM), Image.NEAREST))[..., 3]
        crop = grid(crop, lx, ly, n, n, LOUPE_ZOOM, 1)  # 1px のマス目、5px ごとに太い線と座標。元画像の色はそのまま見せる
        cn = np.asarray(crop).copy()
        cn[outline(pc)] = (230, 30, 30, 255)
        crop = Image.fromarray(cn, 'RGBA')
        d = ImageDraw.Draw(crop)
        cross(d, (px - lx + 0.5) * LOUPE_ZOOM, (py - ly + 0.5) * LOUPE_ZOOM, (230, 30, 30, 255), r=10)
        for k in ks:
            if k in orig_lm:
                qx, qy = orig_lm[k]
                cross(d, (qx - lx + 0.5) * LOUPE_ZOOM, (qy - ly + 0.5) * LOUPE_ZOOM, (20, 160, 60, 255), r=10)
        loupes.append(('='.join(ks), (px, py), crop, [orig_lm[k] for k in ks if k in orig_lm]))
    head = 32
    top_w = w * z * 3 + 16
    loupe_px = n * LOUPE_ZOOM
    per_row = max(1, (top_w + 8) // (loupe_px + 8))
    rows = (len(loupes) + per_row - 1) // per_row
    sheet = Image.new('RGB', (max(top_w, min(len(loupes), per_row) * (loupe_px + 8)), h * z + head + rows * (loupe_px + 22) + 4), 'white')
    labels = ['original + grid (green = recorded original landmarks)', f'{part_name} over original (red = part outline)',
              'blue = original lines, red = part outline' + ('' if seen is None else ' (pale = hidden in original)')]
    dr = ImageDraw.Draw(sheet)
    for i, (im, label) in enumerate(zip([left, mid, right], labels)):
        sheet.paste(im.convert('RGB'), (i * (w * z + 8), head))
        dr.text((i * (w * z + 8) + 2, 2), label, fill=(0, 0, 0))
    for j, (k, (px, py), im, qs) in enumerate(loupes):
        X = (j % per_row) * (loupe_px + 8)
        Y = h * z + head + (j // per_row) * (loupe_px + 22) + 18
        sheet.paste(im.convert('RGB'), (X, Y))
        dr.text((X + 2, Y - 14), f'{k}: part ({px:g}, {py:g})' + ''.join(f'  original ({q[0]:g}, {q[1]:g})' for q in qs), fill=(0, 0, 0))
    if result['verdict'] == 'unread':
        msg = 'landmarks: original not recorded yet (use --orig L x y ...)'
    else:
        f = result['fit']
        msg = (f"landmarks: max diff {result['maxDiff']:.1f} px (tol {result['tol']:g}) -> {result['verdict']}"
               f"   fit scale {f['scale']:.3f} shift ({f['shift'][0]:+.1f}, {f['shift'][1]:+.1f})")
    dr.text((2, 16), msg, fill=(0, 120, 0) if result['verdict'] == 'ok' else (200, 0, 0))
    out = Path(args.out) if args.out else ROOT / 'preview' / f'grid-{part_name}.png'
    sheet.save(out)
    # 目安: パーツの輪郭の点から、元画像のいちばん近い線までの距離（元画像の px）
    og1 = cv2.cvtColor(np.asarray(o.convert('RGB')), cv2.COLOR_RGB2GRAY)
    e1 = cv2.Canny(og1, 40, 110) > 0
    dist = cv2.distanceTransform((~e1).astype(np.uint8), cv2.DIST_L2, 3)
    po1 = outline(np.asarray(p)[..., 3])
    vis1 = po1 & (seen > 0.5) if seen is not None else po1
    dd = dist[vis1] if vis1.sum() >= 10 else np.array([np.nan])
    mean = round(float(np.nanmean(dd)), 2) if vis1.sum() >= 10 else None
    o2l = {'mean': mean, 'p90': round(float(np.nanpercentile(dd, 90)), 2) if mean is not None else None,
           'visibleShare': round(float(vis1.sum() / max(1, po1.sum())), 2), 'check': bool(mean is not None and mean > CHECK_MEAN)}
    if seen is None:
        o2l['note'] = 'not in authoring/composite.json order (all outline points used)'
    elif mean is None:
        o2l['note'] = 'hidden in the original (at rest)'
    metric = {'box': list(box), 'outlineToLine': o2l, 'landmarks': result}
    return out, metric


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('parts', nargs='*')
    ap.add_argument('--all', action='store_true', help='parts-aligned の全部')
    ap.add_argument('--orig', nargs=3, action='append', metavar=('LABEL', 'X', 'Y'), help='元画像で読んだ目印の座標を記録する（L R T B C M）')
    ap.add_argument('--forget', nargs='+', metavar='LABEL', help='記録した元画像の目印を消す')
    ap.add_argument('--box', nargs=4, type=int)
    ap.add_argument('--step', type=int, default=10)
    ap.add_argument('--zoom', type=int, default=6)
    ap.add_argument('--out')
    args = ap.parse_args()
    names = sorted(q.stem for q in (ROOT / 'parts-aligned').glob('*.png')) if args.all else args.parts
    if not names:
        ap.error('パーツの名前か --all')
    if (args.out or args.orig or args.forget) and len(names) > 1:
        ap.error('--out・--orig・--forget は1パーツのときだけ')
    raw = Image.open(ROOT / 'reference' / 'original.png').convert('RGBA')
    orig = Image.new('RGBA', raw.size, (255, 255, 255, 255))
    orig.alpha_composite(raw)  # 透明な所は白で見せる
    (ROOT / 'validation').mkdir(exist_ok=True)
    lpath = ROOT / 'validation' / 'landmarks.json'
    marks = json.loads(lpath.read_text(encoding='utf8')) if lpath.exists() else {}
    if args.orig or args.forget:
        cur = marks.setdefault(names[0], {})
        for k, X, Y in args.orig or []:
            if k not in LABELS:
                ap.error(f'目印は {" ".join(LABELS)} のどれか')
            cur[k] = [float(X) if '.' in X else int(X), float(Y) if '.' in Y else int(Y)]
        for k in args.forget or []:
            cur.pop(k, None)
        lpath.write_bytes((json.dumps(marks, ensure_ascii=False, indent=1) + '\n').encode('utf8'))  # LF のまま書く
    cpath = ROOT / 'authoring' / 'composite.json'
    cfg = json.loads(cpath.read_text(encoding='utf8')) if cpath.exists() else None
    vpath = ROOT / 'validation' / 'placement.json'
    data = json.loads(vpath.read_text(encoding='utf8')) if vpath.exists() else {}
    for name in names:
        out, metric = check(name, args, orig, marks.get(name, {}), cfg)
        data[name] = metric
        r = metric['landmarks']
        o2l = metric['outlineToLine']
        mean_s = f"{o2l['mean']:5.2f}" if o2l['mean'] is not None else '  -  '
        line = f"{name:22s} outline->line {mean_s} seen {o2l['visibleShare']:4.2f}{' (check)' if o2l['check'] else '        '}  landmarks {r['verdict']:6s}"
        if r['verdict'] != 'unread':
            line += f" max diff {r['maxDiff']:5.1f} (tol {r['tol']:g})  fit scale {r['fit']['scale']:.3f} shift ({r['fit']['shift'][0]:+.1f}, {r['fit']['shift'][1]:+.1f})"
        print(line + f'  {out.name}')
        vpath.write_bytes((json.dumps(data, ensure_ascii=False, indent=1) + '\n').encode('utf8'))  # LF のまま書く


if __name__ == '__main__':
    main()
