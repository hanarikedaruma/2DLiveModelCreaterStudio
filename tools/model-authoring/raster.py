"""Software rasterizer for the evaluated close-up poses (validation/closeup-poses.json, written by build.ts).
Draws each item's triangles with its texture (bilinear, premultiplied alpha), applies opacity and masks like the
renderer, and runs the blink / mouth checks. Usage:
  python -I tools/model-authoring/raster.py eyes     -> blink checks + sheets
  python -I tools/model-authoring/raster.py mouth    -> mouth checks + sheets
  python -I tools/model-authoring/raster.py round    -> round-mouth checks + sheets (2026-10-12, authoring/round_mouth.ts)
Set RASTER_ROOT to check a copy written by round_mouth.ts --out.
"""
import json, os, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth
import mauth  # noqa: E402
ROOT = Path(os.environ['RASTER_ROOT']) if os.environ.get('RASTER_ROOT') else mauth.ROOT  # RASTER_ROOT: round_mouth.ts --out の写しを確かめるとき
OUT = mauth.SCRATCH
PROJECT = json.loads((ROOT / 'project.json').read_text(encoding='utf8'))
TEX = {}


def texture(asset_id):
    if asset_id not in TEX:
        a = next(a for a in PROJECT['assets'] if a['id'] == asset_id)
        im = np.asarray(Image.open(ROOT / a['path']).convert('RGBA')).astype(np.float32) / 255
        im[..., :3] *= im[..., 3:4]
        TEX[asset_id] = im
    return TEX[asset_id]


def sample(tex, u, v):
    h, w = tex.shape[:2]
    x = np.clip(u * w - 0.5, 0, w - 1); y = np.clip(v * h - 0.5, 0, h - 1)
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1)
    fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    return (tex[y0, x0] * (1 - fx) * (1 - fy) + tex[y0, x1] * fx * (1 - fy) + tex[y1, x0] * (1 - fx) * fy + tex[y1, x1] * fx * fy)


def draw_item(item, box, ss=3):
    """Premultiplied RGBA of one item inside box (x0, y0, x1, y1), supersampled ss x ss, before opacity."""
    x0, y0, x1, y1 = box
    W, H = (x1 - x0) * ss, (y1 - y0) * ss
    out = np.zeros((H, W, 4), np.float32)
    P = np.array(item['positions'], np.float64).reshape(-1, 2)
    UV = np.array(item['uvs'], np.float64).reshape(-1, 2)
    I = np.array(item['indices'], int).reshape(-1, 3)
    tex = texture(item['assetId'])
    for a, b, c in I:
        pa, pb, pc = P[a], P[b], P[c]
        bx0 = max(int(np.floor(min(pa[0], pb[0], pc[0]))), x0); bx1 = min(int(np.ceil(max(pa[0], pb[0], pc[0]))), x1)
        by0 = max(int(np.floor(min(pa[1], pb[1], pc[1]))), y0); by1 = min(int(np.ceil(max(pa[1], pb[1], pc[1]))), y1)
        if bx1 <= bx0 or by1 <= by0:
            continue
        xs = (np.arange((bx0 - x0) * ss, (bx1 - x0) * ss) + 0.5) / ss + x0
        ys = (np.arange((by0 - y0) * ss, (by1 - y0) * ss) + 0.5) / ss + y0
        gx, gy = np.meshgrid(xs, ys)
        d = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1])
        if abs(d) < 1e-12:
            continue
        l1 = ((pb[1] - pc[1]) * (gx - pc[0]) + (pc[0] - pb[0]) * (gy - pc[1])) / d
        l2 = ((pc[1] - pa[1]) * (gx - pc[0]) + (pa[0] - pc[0]) * (gy - pc[1])) / d
        l3 = 1 - l1 - l2
        m = (l1 >= -1e-9) & (l2 >= -1e-9) & (l3 >= -1e-9)
        if not m.any():
            continue
        u = l1[m] * UV[a, 0] + l2[m] * UV[b, 0] + l3[m] * UV[c, 0]
        v = l1[m] * UV[a, 1] + l2[m] * UV[b, 1] + l3[m] * UV[c, 1]
        col = sample(tex, u, v)
        iy = ((gy[m] - y0) * ss - 0.5).round().astype(int); ix = ((gx[m] - x0) * ss - 0.5).round().astype(int)
        cur = out[iy, ix]
        out[iy, ix] = col + cur * (1 - col[:, 3:4])
    return out


def downsample(a, ss):
    H, W = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(H, ss, W, ss, -1).mean((1, 3))


def render(pose, box, ss=3, only=None):
    """Composite of the pose's items in draw order over opaque white; also returns per-part premultiplied layers."""
    layers = {}
    for item in pose['items']:
        pid = item['partId'][5:]
        if only and pid not in only:
            continue
        layers[pid] = (item, draw_item(item, box, ss))
    comp = np.ones(((box[3] - box[1]) * ss, (box[2] - box[0]) * ss, 3), np.float32)
    for pid, (item, L) in layers.items():
        a = L[..., 3:4] * item['opacity']
        rgb = L[..., :3] * item['opacity']
        if item.get('mask'):
            mm = np.zeros_like(a)
            for src in item['mask']['sourcePartIds']:
                if src[5:] in layers:
                    mm = np.maximum(mm, layers[src[5:]][1][..., 3:4] * layers[src[5:]][0]['opacity'])
            if item['mask'].get('inverted'):
                mm = 1 - mm
            a = a * mm; rgb = rgb * mm
        comp = comp * (1 - a) + rgb
    return downsample(comp, ss), {k: downsample(v[1], ss) * v[0]['opacity'] for k, v in layers.items()}


def save_sheet(images, labels, name, z=4):
    tiles = [Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8)).resize((im.shape[1] * z, im.shape[0] * z), Image.NEAREST) for im in images]
    cols = min(len(tiles), 7)
    w, h = tiles[0].size
    sheet = Image.new('RGB', (cols * (w + 4), ((len(tiles) + cols - 1) // cols) * (h + 14)), 'white')
    for i, (t, lb) in enumerate(zip(tiles, labels)):
        x, y = (i % cols) * (w + 4), (i // cols) * (h + 14)
        sheet.paste(t, (x, y + 14)); ImageDraw.Draw(sheet).text((x + 2, y + 1), lb, fill=(0, 0, 0))
    sheet.save(OUT / name)
    return OUT / name


EYE_BOX = {'L': (536, 248, 632, 318), 'R': (388, 278, 488, 352)}


def eye_metrics(layers, side):
    white = layers['eyeWhite' + side][..., 3]
    lid = layers['upperLid' + side][..., 3]
    low = layers.get('lowerLid' + side, np.zeros((1, 1, 4)))[..., 3] if ('lowerLid' + side) in layers else np.zeros_like(white)
    visible = white * (1 - lid) * (1 - low)
    above = 0; gap_cols = 0
    for x in range(white.shape[1]):
        ly = np.where(lid[:, x] > 0.5)[0]
        if not len(ly):
            continue
        # white that shows above the lid band (lid lower edge region), not covered by the lid
        above += float(visible[:ly.min(), x][visible[:ly.min(), x] > 0.25].sum())
    return {'visibleWhite': round(float((visible > 0.25).sum()), 1), 'whiteAboveLid': round(above, 2), 'whitePixels': round(float((white > 0.25).sum()), 1)}


def eyes():
    poses = json.loads((ROOT / 'validation' / 'closeup-poses.json').read_text(encoding='utf8'))
    report = {}
    for side in 'LR':
        box = EYE_BOX[side]
        for s in (0, 1):
            ims, labs = [], []
            for i in range(20, -1, -2 if s == 0 else -4):
                name = f'eye_t{i}_s{s}'
                comp, layers = render(poses[name], box, 3)
                report[f'{side}:{name}'] = eye_metrics(layers, side)
                ims.append(comp); labs.append(f't={i / 20:.2f}' + (' smile' if s else ''))
            save_sheet(ims, labs, f'blink-{side}-s{s}.png', 3)
        for fx in (-30, 30):
            ims, labs = [], []
            for t in (10, 5, 0):
                comp, layers = render(poses[f'eyeturn_x{fx}_t{t}'], box, 3)
                report[f'{side}:eyeturn_x{fx}_t{t}'] = eye_metrics(layers, side)
                ims.append(comp); labs.append(f'x={fx} t={t / 10}')
            save_sheet(ims, labs, f'blinkturn-{side}-x{fx}.png', 3)
    (ROOT / 'validation' / 'blink-check.json').write_text(json.dumps(report, indent=1), encoding='utf8')
    closed = {k: v for k, v in report.items() if '_t0_' in k or k.endswith('_t0')}
    print('closed poses (visible white px should be 0):', json.dumps(closed))
    worst = max(report.items(), key=lambda kv: kv[1]['whiteAboveLid'])
    print('largest white-above-lid:', worst)


MOUTH_BOX = (494, 360, 552, 400)


def mouth():
    poses = json.loads((ROOT / 'validation' / 'closeup-poses.json').read_text(encoding='utf8'))
    report = {}
    base, _ = render(poses['mouth_t0_f0'], MOUTH_BOX, 3)
    for f in (-1, 0, 1):
        ims, labs = [], []
        for i in (0, 1, 2, 3, 4, 6, 8, 10, 14, 20):
            name = f'mouth_t{i}_f{f}'
            comp, layers = render(poses[name], MOUTH_BOX, 3)
            line = layers['upperLip'][..., 3]; inner = layers.get('mouthInside', np.zeros_like(layers['upperLip']))[..., 3]
            poke = 0.0; gaps = 0
            for x in range(line.shape[1]):
                ly = np.where(line[:, x] > 0.4)[0]
                iy = np.where(inner[:, x] > 0.4)[0]
                if len(ly) and len(iy):
                    poke += float((inner[:ly.min(), x] * (1 - line[:ly.min(), x])).sum())
                    if iy.min() > ly.max() + 1:
                        gaps += 1
            report[name] = {'interiorAboveLine': round(poke, 2), 'gapColumns': gaps, 'diffFromClosed': round(float(np.abs(comp - base).max()), 3) if i == 0 else None}
            ims.append(comp); labs.append(f'open {i / 20:.2f} form {f}')
        save_sheet(ims, labs, f'mouth-f{f}.png', 5)
    ims, labs = [], []
    for w in (-1, 1):
        for t in (0, 5, 10):
            comp, _ = render(poses[f'mouth_w{w}_t{t}'], MOUTH_BOX, 3); ims.append(comp); labs.append(f'width {w} open {t / 10}')
    save_sheet(ims, labs, 'mouth-width.png', 5)
    ims, labs = [], []
    for fx in (-30, 30):
        for t in (0, 5, 10):
            comp, _ = render(poses[f'mouthturn_x{fx}_t{t}'], (470, 340, 580, 410), 3); ims.append(comp); labs.append(f'x={fx} open {t / 10}')
    save_sheet(ims, labs, 'mouth-turn.png', 4)
    (ROOT / 'validation' / 'mouth-check.json').write_text(json.dumps(report, indent=1), encoding='utf8')
    print(json.dumps({k: v for k, v in report.items()}, indent=None)[:3000])


def round_mouth():
    """丸い口: 線の残り（閉じた線が消えたか）・口の中が縁の外へはみ出す量・見本との一致率"""
    import cv2
    poses = json.loads((ROOT / 'validation' / 'closeup-poses.json').read_text(encoding='utf8'))
    report = {}
    box = (494, 352, 556, 404)
    for f in (-1, 0, 1):
        ims, labs = [], []
        for i in range(0, 21):
            name = f'mouth_t{i}_f{f}'
            comp, layers = render(poses[name], box, 3)
            line = layers['upperLip'][..., 3]
            rim = layers.get('mouthRim', np.zeros_like(line))[..., 3]
            inner = layers.get('mouthInside', np.zeros_like(line))[..., 3]
            outside = 0.0
            if rim.max() > 0.5:
                pts = np.argwhere(rim > 0.25)[:, ::-1].astype(np.int32)
                hull = np.zeros(rim.shape, np.uint8)
                cv2.fillConvexPoly(hull, cv2.convexHull(pts), 1)
                hull = cv2.dilate(hull, np.ones((3, 3), np.uint8))
                outside = float((inner * (1 - hull)).sum())
            report[name] = {'lineAlpha': round(float(line.max()), 3), 'rimAlpha': round(float(rim.max()), 3), 'interiorOutsideRim': round(outside, 2)}
            if i in (0, 1, 2, 3, 4, 6, 8, 10, 14, 20):
                ims.append(comp); labs.append(f'open {i / 20:.2f} form {f}')
        save_sheet(ims, labs, f'round-f{f}.png', 5)
    # 見本との比べ: 開き 1・形 0
    cmp_box = (480, 345, 570, 415)
    comp, _ = render(poses.get('cmpNeutral') or poses['mouth_t20_f0'], cmp_box, 3)
    target = np.asarray(Image.open(mauth.ROOT / 'reference' / 'open-mouth-target.png').convert('RGB').crop(cmp_box)).astype(np.float32) / 255
    skin = np.median(target[:8, :8].reshape(-1, 3), axis=0)
    def mask(im):
        return np.sqrt(((im - skin) ** 2).sum(axis=2)) > 0.16
    a, b = mask(comp), mask(target)
    # 顎の線など口の外を除くため、口のまわりだけで比べる
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    near = (xx - 44.5) ** 2 / 26 ** 2 + (yy - 34) ** 2 / 24 ** 2 < 1
    a &= near; b &= near
    report['targetIoU'] = round(float((a & b).sum() / max(1, (a | b).sum())), 3)
    save_sheet([target, comp, np.abs(comp - target) * 3], ['target', 'model open 1 form 0', 'diff x3'], 'round-target.png', 6)
    ims, labs = [], []
    for w in (-1, 1):
        for t in (0, 5, 10):
            c, _ = render(poses[f'mouth_w{w}_t{t}'], box, 3); ims.append(c); labs.append(f'width {w} open {t / 10}')
    for v in ('a', 'i', 'u', 'e', 'o', 'surprise', 'happy'):
        c, _ = render(poses[f'vowel_{v}'], box, 3); ims.append(c); labs.append(v)
    save_sheet(ims, labs, 'round-width-vowels.png', 5)
    ims, labs = [], []
    for k in ('x-30', 'x30', 'y-30', 'y30'):
        for t in (0, 5, 10):
            c, _ = render(poses[f'mouthturn_{k[0]}{k[1:]}_t{t}'], (470, 335, 580, 415), 3); ims.append(c); labs.append(f'{k} open {t / 10}')
    save_sheet(ims, labs, 'round-turn.png', 4)
    (ROOT / 'validation' / 'mouth-round-check.json').write_text(json.dumps(report, indent=1), encoding='utf8')
    worst = {k: max(v[k] for n, v in report.items() if isinstance(v, dict) and n.startswith('mouth_t') and int(n.split('_t')[1].split('_')[0]) >= 4) for k in ('lineAlpha', 'interiorOutsideRim')}
    print(json.dumps({'targetIoU': report['targetIoU'], 'worstFromOpen0.2': worst}))


if __name__ == '__main__':
    {'eyes': eyes, 'mouth': mouth, 'round': round_mouth}[sys.argv[1]]()
