"""Accept a part with a similarity transform (uniform scale + small rotation + shift) from two point pairs
(generated px -> original canvas px). Usage:
python -I tools/model-authoring/accept_similarity.py part ver gx1 gy1 ox1 oy1 gx2 gy2 ox2 oy2 [--max-rot 20] [--dry]
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check

ROOT = check.ROOT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('part'); ap.add_argument('version', type=int)
    ap.add_argument('pts', type=float, nargs=8)
    ap.add_argument('--max-rot', type=float, default=20)
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    g1, o1, g2, o2 = (np.array(a.pts[i:i + 2]) for i in (0, 2, 4, 6))
    vg, vo = g2 - g1, o2 - o1
    s = np.linalg.norm(vo) / np.linalg.norm(vg)
    th = np.arctan2(vo[1], vo[0]) - np.arctan2(vg[1], vg[0])
    deg = float(np.degrees((th + np.pi) % (2 * np.pi) - np.pi))
    if abs(deg) > a.max_rot:
        raise SystemExit(f'rotation {deg:.1f} deg is larger than allowed')
    c, sn = s * np.cos(np.radians(deg)), s * np.sin(np.radians(deg))
    R = np.array([[c, -sn], [sn, c]])
    T = o1 - R @ g1
    M = np.hstack([R, T[:, None]])
    print(json.dumps({'part': a.part, 'scale': round(float(s), 5), 'rotationDeg': round(deg, 2), 'T': T.round(2).tolist()}))
    if a.dry:
        return
    img = Image.open(ROOT / 'parts' / a.part / f'{a.part}-v{a.version}.png')
    out = check.warp_rgba(img, M)
    Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(ROOT / 'parts-aligned' / f'{a.part}.png')
    rp = ROOT / 'records' / f'{a.part}.json'
    rec = json.loads(rp.read_text(encoding='utf8'))
    v = next(v for v in rec['versions'] if v['version'] == a.version)
    v['acceptedMatrix'] = M.round(6).tolist()
    v['acceptedPlacement'] = {'similarity': True, 'scale': round(float(s), 5), 'rotationDeg': round(deg, 2),
                              'pairs': {'generated': [g1.tolist(), g2.tolist()], 'original': [o1.tolist(), o2.tolist()]}}
    rec['selected'] = a.version
    rp.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print('accepted', a.part, a.version)


if __name__ == '__main__':
    main()
