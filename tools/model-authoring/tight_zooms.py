"""Give every non-eye part its own tight crop (2:3, 3:2 or 1:1) around where it is on the original, and switch
its prompt to the edit style. The generator keeps the framing much better when the part fills the attached crop
and the request is phrased as erasing everything else (tested on the face, 2026-10-11).
Crops may extend past the canvas; prepare_refs.py pads them with white.
"""
import sys
import json
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
REGIONS = {  # x0, y0, x1, y1 on the original: visible part plus the hidden extent we ask for
    'face': [392, 95, 652, 432], 'earL': [628, 245, 685, 342], 'earR': [385, 295, 432, 385], 'cheek': [415, 305, 628, 372],
    'browL': [530, 200, 650, 262], 'browR': [380, 220, 470, 285],
    'upperLip': [490, 355, 555, 395], 'lowerLip': [490, 355, 555, 395], 'mouthInside': [490, 355, 555, 395],
    'teeth': [490, 355, 555, 395], 'tongue': [490, 355, 555, 395],
    'frontHair': [255, 0, 765, 345], 'sideHairR': [255, 95, 440, 478], 'sideHairL': [592, 150, 662, 345],
    'sideHairBackL': [600, 95, 745, 478], 'backHair': [265, 25, 740, 480], 'strandR': [205, 215, 350, 285],
    'strandL': [670, 150, 820, 210], 'neck': [440, 370, 610, 520], 'torso': [245, 470, 815, 1536],
    'chest': [335, 585, 750, 820], 'armL': [665, 475, 1020, 1495], 'armR': [5, 475, 360, 1495],
    'cardiganBack': [180, 1250, 845, 1480], 'hairOrnament': [592, 128, 712, 242], 'ribbonLong': [658, 205, 700, 378],
    'ribbonShort': [668, 205, 712, 292], 'earringL': [622, 322, 656, 405], 'earringR': [398, 368, 432, 450],
    'sleeveRibbonUpperR': [165, 740, 245, 895], 'sleeveRibbonLowerR': [55, 1025, 145, 1165],
    'sleeveRibbonUpperL': [820, 742, 895, 912], 'sleeveRibbonLowerL': [905, 1025, 965, 1125],
    'waistRibbon': [472, 1018, 606, 1232],
}
MARGIN = 0.10
MAX_ZOOM = 8.0
ASPECTS = {(2, 3): (1024, 1536), (3, 2): (1536, 1024), (1, 1): (1024, 1024)}


def crop_for(region):
    x0, y0, x1, y1 = region
    w, h = (x1 - x0) * (1 + 2 * MARGIN), (y1 - y0) * (1 + 2 * MARGIN)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    best = None
    for (aw, ah), out in ASPECTS.items():
        # smallest box of this aspect that contains w x h
        bw = max(w, h * aw / ah); bh = bw * ah / aw
        waste = bw * bh - w * h
        if best is None or waste < best[0]:
            best = (waste, bw, bh, out)
    _, bw, bh, out = best
    if out[0] / bw > MAX_ZOOM:  # too blurry when enlarged more than this; take more context instead
        bw, bh = out[0] / MAX_ZOOM, out[1] / MAX_ZOOM
    # exact aspect: width a multiple of the aspect's width unit
    unit = {(1024, 1536): 2, (1536, 1024): 3, (1024, 1024): 1}[tuple(out)]
    bw = int(np.ceil(bw / unit)) * unit
    bh = bw * out[1] // out[0]
    return [int(round(cx - bw / 2)), int(round(cy - bh / 2)), bw, bh], list(out)


def main():
    zp, pp = ROOT / 'authoring' / 'zooms.json', ROOT / 'authoring' / 'parts.json'
    zooms, parts = json.loads(zp.read_text(encoding='utf8')), json.loads(pp.read_text(encoding='utf8'))
    for part, region in REGIONS.items():
        box, out = crop_for(region)
        if part == 'face':
            box, out = [382, 53, 280, 420], [1024, 1536]  # the tested crop
        zooms['t_' + part] = {'box': box, 'out': out}
        parts[part]['zoom'] = 't_' + part
        parts[part]['style'] = 'edit'
        print(part, box, out, f"x{out[0] / box[2]:.2f}")
    for k in ('faceEditTest', 'faceDrawTest'):
        parts.pop(k, None)
    zp.write_text(json.dumps(zooms, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    pp.write_text(json.dumps(parts, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    main()
