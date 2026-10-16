"""Close-up sheets of rendered poses (preview/pose-*.png) for the eyes and the mouth.
Usage: python -I tools/model-authoring/closeups.py eyes|mouth|<x0,y0,x1,y1> pose1 pose2 ... [--out name] [--z 4]
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT, SCRATCH  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
OUT = SCRATCH
BOXES = {'eyes': [(530, 245, 640, 325), (385, 275, 490, 355)], 'mouth': [(482, 345, 562, 405)], 'face': [(360, 180, 680, 450)]}


def load(name):
    im = Image.open(ROOT / 'preview' / f'pose-{name}.png').convert('RGBA')
    bg = Image.new('RGBA', im.size, (255, 236, 228, 255)); bg.alpha_composite(im)
    return bg.convert('RGB')


def main():
    args = sys.argv[1:]
    out = 'closeup.png'; z = None
    if '--out' in args:
        i = args.index('--out'); out = args[i + 1]; del args[i:i + 2]
    if '--z' in args:
        i = args.index('--z'); z = int(args[i + 1]); del args[i:i + 2]
    kind, names = args[0], args[1:]
    boxes = BOXES.get(kind) or [tuple(int(v) for v in kind.split(','))]
    images = {n: load(n) for n in names}
    rows = []
    for box in boxes:
        w, h = box[2] - box[0], box[3] - box[1]
        zz = z or max(1, int(1600 / (w * len(names))))
        tiles = [images[n].crop(box).resize((w * zz, h * zz), Image.LANCZOS) for n in names]
        row = Image.new('RGB', (sum(t.width + 6 for t in tiles), h * zz + 16), 'white')
        x = 0
        for n, t in zip(names, tiles):
            row.paste(t, (x, 16)); ImageDraw.Draw(row).text((x + 3, 2), n, fill=(0, 0, 0)); x += t.width + 6
        rows.append(row)
    sheet = Image.new('RGB', (max(r.width for r in rows), sum(r.height for r in rows)), 'white')
    y = 0
    for r in rows:
        sheet.paste(r, (0, y)); y += r.height
    sheet.save(OUT / out)
    print(OUT / out, sheet.size)


if __name__ == '__main__':
    main()
