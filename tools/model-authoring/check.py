"""Place a generated part on the original canvas and make overlay sheets / shape metrics.

The original is used only as a measuring stick (position, outline); its pixels never enter a part.
Usage: python -I tools/model-authoring/check.py <partId> <version> [--dx 0 --dy 0 --scale 1] [--box x y w h]
"""
import sys
import argparse, json
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT, SCRATCH  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
SCRATCH = SCRATCH
CANVAS = (1024, 1536)


def load(p):
    return json.loads(Path(p).read_text(encoding='utf8'))


def placement(spec, zooms, out_size, dx=0.0, dy=0.0, scale=1.0):
    """Affine matrix (2x3) from generated-image px to canvas px (uniform scale + shift only)."""
    if spec.get('zoom'):
        x, y, w, h = zooms[spec['zoom']]['box']
    else:
        x, y, w, h = 0, 0, *CANVAS
    s = (w / out_size[0] + h / out_size[1]) / 2 * scale
    cx, cy = x + w / 2, y + h / 2  # scale about the crop centre
    ox, oy = out_size[0] / 2, out_size[1] / 2
    return np.array([[s, 0, cx - ox * s + dx], [0, s, cy - oy * s + dy]], np.float64)


def warp_rgba(img, M):
    a = np.asarray(img.convert('RGBA')).astype(np.float32) / 255
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    flags = cv2.INTER_AREA if M[0, 0] < 1 else cv2.INTER_CUBIC
    out = np.clip(cv2.warpAffine(pm, M, CANVAS, flags=flags, borderMode=cv2.BORDER_CONSTANT, borderValue=0), 0, 1)
    al = out[..., 3:4]
    rgb = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0)
    return np.concatenate([np.clip(rgb, 0, 1), al], -1)


def poly_mask(points):
    m = Image.new('L', CANVAS, 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in points], fill=255)
    return np.asarray(m) > 127


def edge_profile(mask, xs):
    top, bot = [], []
    for x in xs:
        col = np.where(mask[:, x])[0]
        top.append(col.min() if col.size else np.nan); bot.append(col.max() if col.size else np.nan)
    return np.array(top, float), np.array(bot, float)


def eye_metrics(part_alpha, ref_points):
    gen = part_alpha > 0.5
    ref = poly_mask(ref_points)
    inter, union = (gen & ref).sum(), (gen | ref).sum()
    xs = np.arange(int(min(p[0] for p in ref_points)) + 2, int(max(p[0] for p in ref_points)) - 1)
    gt, gb = edge_profile(gen, xs); rt, rb = edge_profile(ref, xs)
    def d(a, b):
        diff = np.abs(a - b)
        return [round(float(np.nanmean(diff)), 2), round(float(np.nanmax(diff)), 2)] if np.isfinite(diff).any() else None
    gx = np.where(gen.any(0))[0]; rx = np.where(ref.any(0))[0]
    return {'iou': round(inter / max(union, 1), 3), 'topEdgeMeanMax': d(gt, rt), 'bottomEdgeMeanMax': d(gb, rb),
            'xSpanGen': [int(gx.min()), int(gx.max())] if gx.size else None, 'xSpanRef': [int(rx.min()), int(rx.max())],
            'areaRatio': round(gen.sum() / max(ref.sum(), 1), 3)}


def best_shift(part_alpha, ref_points, search=8):
    ref = poly_mask(ref_points); gen = part_alpha > 0.5
    best = (0, 0, -1.0)
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            g = np.roll(np.roll(gen, dy, 0), dx, 1)
            iou = (g & ref).sum() / max((g | ref).sum(), 1)
            if iou > best[2]:
                best = (dx, dy, float(iou))
    return {'dx': best[0], 'dy': best[1], 'iou': round(best[2], 3)}


def sheet(part_rgba, box, name, ref_points=None, scale=None):
    x, y, w, h = box
    scale = scale or max(1, int(600 / max(w, h)))
    orig = Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGBA')
    crop = orig.crop((x, y, x + w, y + h)).resize((w * scale, h * scale), Image.LANCZOS)
    part = Image.fromarray((part_rgba * 255).astype(np.uint8), 'RGBA').crop((x, y, x + w, y + h)).resize((w * scale, h * scale), Image.LANCZOS)
    gray = Image.new('RGBA', crop.size, (110, 110, 120, 255)); gray.alpha_composite(part)
    over = crop.copy(); over.alpha_composite(part)
    outline = crop.copy(); d = ImageDraw.Draw(outline)
    pa = (np.asarray(part)[..., 3] > 127).astype(np.uint8)
    cs, _ = cv2.findContours(pa, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    for c in cs:
        pts = [tuple(int(v) for v in p[0]) for p in c]
        if len(pts) > 2:
            d.line(pts + [pts[0]], fill=(255, 0, 0, 255), width=2)
    if ref_points:
        rp = [((px - x) * scale, (py - y) * scale) for px, py in ref_points]
        d.line(rp + [rp[0]], fill=(0, 170, 0, 255), width=2)
    W, H = crop.size
    out = Image.new('RGB', (W * 4 + 30, H + 20), 'white')
    for i, t in enumerate([crop, gray, over, outline]):
        out.paste(t.convert('RGB'), (i * (W + 10), 20))
    ImageDraw.Draw(out).text((4, 4), f'{name}: original | part | part over original | red=part outline, green=measured opening', fill=(0, 0, 0))
    SCRATCH.mkdir(parents=True, exist_ok=True)
    p = SCRATCH / f'{name}.png'
    out.save(p)
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('part'); ap.add_argument('version', type=int)
    ap.add_argument('--dx', type=float, default=0); ap.add_argument('--dy', type=float, default=0); ap.add_argument('--scale', type=float, default=1)
    ap.add_argument('--box', type=int, nargs=4)
    args = ap.parse_args()
    parts, zooms, meas = load(ROOT / 'authoring/parts.json'), load(ROOT / 'authoring/zooms.json'), load(ROOT / 'authoring/measure.json')
    spec = parts[args.part]
    img = Image.open(ROOT / 'parts' / args.part / f'{args.part}-v{args.version}.png')
    M = placement(spec, zooms, img.size, args.dx, args.dy, args.scale)
    placed = warp_rgba(img, M)
    result = {'part': args.part, 'version': args.version, 'outSize': list(img.size), 'matrix': M.round(4).tolist()}
    ref = None
    if args.part.startswith('eyeWhite'):
        ref = meas['eyeOpening' + args.part[-1]]
        result['metrics'] = eye_metrics(placed[..., 3], ref)
        result['bestShift'] = best_shift(placed[..., 3], ref)
    box = args.box or (zooms[spec['zoom']]['box'] if spec.get('zoom') else [0, 0, *CANVAS])
    result['sheet'] = str(sheet(placed, box, f'{args.part}-v{args.version}', ref))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
