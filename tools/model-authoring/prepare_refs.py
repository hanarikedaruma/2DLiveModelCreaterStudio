"""Build the reference images attached to every generation request.

reference/original-ref.png: the user's original with fully transparent pixels set to white RGB
(alpha unchanged), so it reads the same whether a viewer honours alpha or not.
reference/zoom-<name>.png: crops of the original on white, enlarged (reference only, never used as part pixels).
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT as root  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
src = Image.open(root / 'reference' / 'original.png').convert('RGBA')
a = np.asarray(src).copy()
a[a[..., 3] == 0, :3] = 255
Image.fromarray(a).save(root / 'reference' / 'original-ref.png')
white = Image.new('RGBA', src.size, (255, 255, 255, 255))
white.alpha_composite(src)
flat = white.convert('RGB')
flat.save(root / 'reference' / 'original-on-white.png')
zooms = json.loads((root / 'authoring' / 'zooms.json').read_text(encoding='utf8'))
for name, z in zooms.items():
    if name.startswith('_'):
        continue
    x, y, w, h = z['box']; ow, oh = z['out']
    assert abs(ow / w - oh / h) < 1e-6, (name, ow / w, oh / h)
    # crops may extend past the canvas: pad with white
    tile = Image.new('RGB', (w, h), (255, 255, 255))
    tile.paste(flat.crop((max(0, x), max(0, y), min(flat.width, x + w), min(flat.height, y + h))), (max(0, -x), max(0, -y)))
    tile.resize((ow, oh), Image.LANCZOS).save(root / 'reference' / f'zoom-{name}.png')
    print(name, z['box'], '->', z['out'], f'x{ow / w:.2f}')
