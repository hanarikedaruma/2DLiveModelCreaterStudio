"""Accept a part with its plain crop mapping, then an extra uniform scale k about an anchor point on the canvas
and an optional shift (for invented parts such as the mouth interior, placed relative to the measured mouth line).
Usage: python -I tools/model-authoring/accept_anchor.py part ver zoomName k ax ay [dx dy]
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check

ROOT = check.ROOT


def main():
    part, ver, zoom = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    k, ax, ay = map(float, sys.argv[4:7])
    dx, dy = (map(float, sys.argv[7:9]) if len(sys.argv) > 8 else (0.0, 0.0))
    zooms = check.load(ROOT / 'authoring/zooms.json')
    spec = {'prompt': ''}
    if zoom != 'none':
        spec['zoom'] = zoom
    img = Image.open(ROOT / 'parts' / part / f'{part}-v{ver}.png')
    M0 = check.placement(spec, zooms, img.size, 0, 0, 1.0)
    A = np.array([[k, 0, ax - k * ax + dx], [0, k, ay - k * ay + dy], [0, 0, 1]])
    M = (A @ np.vstack([M0, [0, 0, 1]]))[:2]
    out = check.warp_rgba(img, M)
    Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(ROOT / 'parts-aligned' / f'{part}.png')
    rp = ROOT / 'records' / f'{part}.json'
    rec = json.loads(rp.read_text(encoding='utf8'))
    v = next(v for v in rec['versions'] if v['version'] == ver)
    v['acceptedMatrix'] = M.round(6).tolist()
    v['acceptedPlacement'] = {'zoomUsed': spec.get('zoom'), 'anchorScale': k, 'anchor': [ax, ay], 'shift': [dx, dy]}
    rec['selected'] = ver
    rp.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print('accepted', part, ver, v['acceptedPlacement'])


if __name__ == '__main__':
    main()
