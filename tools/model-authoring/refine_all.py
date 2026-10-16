"""Refine the placement of several edit-style parts (small window) and store it in records/<part>.json.
Usage: python -I tools/model-authoring/refine_all.py [--search 8] [--scales 0.95 1.05] part:ver ...
Does not accept anything; review the overview sheet first, then accept with accept.py.
"""
import argparse, json, sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import align, check
from PIL import Image

ROOT = check.ROOT
KEEP = {'face': 0.45, 'neck': 0.5}


def one(args):
    item, search, scales = args
    part, ver = item.split(':'); ver = int(ver)
    parts, zooms = check.load(ROOT / 'authoring/parts.json'), check.load(ROOT / 'authoring/zooms.json')
    img = Image.open(ROOT / 'parts' / part / f'{part}-v{ver}.png')
    win = check.load(ROOT / 'authoring/measure.json').get('outlineWindows', {}).get(part)
    res = align.align_boundary(img, parts[part], zooms, search, scales, KEEP.get(part, 0.7 if win else 0.5), windows=win)
    return part, ver, res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--search', type=int, default=10)
    ap.add_argument('--scales', type=float, nargs=2, default=[0.94, 1.06])
    ap.add_argument('items', nargs='+')
    a = ap.parse_args()
    with ProcessPoolExecutor(4) as ex:
        for part, ver, res in ex.map(one, [(i, a.search, tuple(a.scales)) for i in a.items]):
            rp = ROOT / 'records' / f'{part}.json'
            rec = json.loads(rp.read_text(encoding='utf8'))
            for v in rec['versions']:
                if v['version'] == ver:
                    v['placement'] = res
            rp.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
            edge = abs(res['centreShift'][0]) >= a.search or abs(res['centreShift'][1]) >= a.search or abs(res['k'] - a.scales[0]) < 1e-6 or abs(res['k'] - a.scales[1]) < 1e-6
            print(f"{part} v{ver}: scale {res['scale']} shift {res['centreShift']} outline {res['plainBoundary']} -> {res['boundary']}{'  (at search edge)' if edge else ''}", flush=True)


if __name__ == '__main__':
    main()
