"""Accept part versions with their stored placement: write parts-aligned/<part>.png (1024x1536) and mark selected.
Usage: python -I tools/model-authoring/accept.py part:ver ...   (use part:ver:plain to ignore the stored placement)
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check

ROOT = check.ROOT


def main():
    parts, zooms = check.load(ROOT / 'authoring/parts.json'), check.load(ROOT / 'authoring/zooms.json')
    for item in sys.argv[1:]:
        bits = item.split(':')
        part, ver = bits[0], int(bits[1])
        rp = ROOT / 'records' / f'{part}.json'
        rec = json.loads(rp.read_text(encoding='utf8'))
        v = next(v for v in rec['versions'] if v['version'] == ver)
        if len(bits) == 5:  # part:ver:scale:dx:dy
            pl = {'scale': float(bits[2]), 'dx': float(bits[3]), 'dy': float(bits[4])}
        elif len(bits) > 2 and bits[2] == 'plain':
            pl = {'scale': 1, 'dx': 0, 'dy': 0}
        else:
            pl = v.get('placement', {'scale': 1, 'dx': 0, 'dy': 0})
        img = Image.open(ROOT / 'parts' / part / f'{part}-v{ver}.png')
        spec = dict(parts[part])
        zu = v.get('placement', {}).get('zoomUsed', 'unset') if len(bits) != 5 else v.get('zoomUsed', 'unset')
        if zu != 'unset':  # versions generated with an older crop
            spec.pop('zoom', None)
            if zu:
                spec['zoom'] = zu
            v['zoomUsed'] = zu
        M = check.placement(spec, zooms, img.size, pl['dx'], pl['dy'], pl['scale'])
        out = check.warp_rgba(img, M)
        (ROOT / 'parts-aligned').mkdir(exist_ok=True)
        Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(ROOT / 'parts-aligned' / f'{part}.png')
        v['acceptedPlacement'] = {k: pl[k] for k in ('scale', 'dx', 'dy')}
        v['acceptedMatrix'] = M.round(5).tolist()
        rec['selected'] = ver
        rp.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
        print('accepted', part, ver, v['acceptedPlacement'])


if __name__ == '__main__':
    main()
