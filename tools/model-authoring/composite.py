"""Composite parts-aligned/*.png in model draw order (authoring/composite.json: order, clip, hiddenAtRest, opacity)
and put it next to the original. Usage: python -I tools/model-authoring/composite.py [out.png] [--box x y w h]
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check

ROOT = check.ROOT
# 描く順・切り抜き・休みの姿勢で隠すパーツ・不透明度は、モデルごとに authoring/composite.json に書く
# {"order": [下から上へ], "clip": {"irisL": "eyeWhiteL"}, "hiddenAtRest": ["mouthInside"], "opacity": {"browL": 0.6}}
_CFG = json.loads((ROOT / 'authoring' / 'composite.json').read_text(encoding='utf8'))
ORDER = _CFG['order']
CLIP = _CFG.get('clip', {})
HIDDEN = set(_CFG.get('hiddenAtRest', []))  # 休みの姿勢（口を閉じている）で見えないパーツ
OPACITY = _CFG.get('opacity', {})


def composite(hide=HIDDEN, opacity=None, skip=()):
    opacity = {**OPACITY, **(opacity or {})}
    canvas = np.ones((1536, 1024, 3), np.float32)
    layers = {}
    for name in ORDER:
        p = ROOT / 'parts-aligned' / f'{name}.png'
        if not p.exists():
            continue
        layers[name] = np.asarray(Image.open(p).convert('RGBA')).astype(np.float32) / 255
    for name in ORDER:
        if name not in layers or name in hide or name in skip:
            continue
        L = layers[name]
        a = L[..., 3:4] * opacity.get(name, 1.0)
        if name in CLIP and CLIP[name] in layers:
            a = a * layers[CLIP[name]][..., 3:4]
        canvas = canvas * (1 - a) + L[..., :3] * a
    return canvas, sorted(layers)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out', nargs='?', default='composite.png')
    ap.add_argument('--box', type=int, nargs=4)
    a = ap.parse_args()
    comp, present = composite()
    orig = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB')).astype(np.float32) / 255
    x, y, w, h = a.box or (0, 0, 1024, 1536)
    A = Image.fromarray((orig[y:y + h, x:x + w] * 255).astype(np.uint8))
    B = Image.fromarray((np.clip(comp[y:y + h, x:x + w], 0, 1) * 255).astype(np.uint8))
    s = min(1.0, 900 / h) if not a.box else max(1, int(700 / max(w, h)))
    A = A.resize((int(w * s), int(h * s)), Image.LANCZOS); B = B.resize((int(w * s), int(h * s)), Image.LANCZOS)
    out = Image.new('RGB', (A.width * 2 + 10, A.height + 18), 'white')
    out.paste(A, (0, 18)); out.paste(B, (A.width + 10, 18))
    ImageDraw.Draw(out).text((3, 3), f'original | composite of {len(present)} generated parts', fill=(0, 0, 0))
    p = check.SCRATCH / a.out
    out.save(p)
    Image.fromarray((np.clip(comp, 0, 1) * 255).astype(np.uint8)).save(check.SCRATCH / ('full-' + a.out))
    print(p, len(present))


if __name__ == '__main__':
    main()
