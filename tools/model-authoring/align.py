"""Find where a generated part sits on the original: uniform scale + shift only (no stretching).

mode 'edges'  : match the part's edges to the original's edges (chamfer distance) - for parts that are visible in the original.
mode 'opening': maximise the overlap with the measured eye opening - for eye whites, which are mostly hidden.
The original is only a measuring stick here; its pixels never enter the part.
Usage: python -I tools/model-authoring/align.py <partId> <version> [--mode edges|opening] [--search 12] [--scales 0.92 1.08]
Writes placement into records/<partId>.json (the version's 'placement') and parts-aligned/<partId>.png when --accept.
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))  # run with python -I, so add our own folder explicitly
import check

ROOT = check.ROOT


def edges_of(rgb_u8, mask=None):
    g = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2GRAY)
    g = cv2.GaussianBlur(g, (3, 3), 0)
    e = cv2.Canny(g, 25, 70)
    if mask is not None:
        e[~mask] = 0
    return e


def placed_with(img, spec, zooms, s, dx, dy):
    M = check.placement(spec, zooms, img.size, dx, dy, s)
    return check.warp_rgba(img, M), M


def align_edges(img, spec, zooms, search, scales, step):
    orig = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB'))
    base, _ = placed_with(img, spec, zooms, 1.0, 0, 0)
    ys, xs = np.where(base[..., 3] > 0.5)
    r = int(search)
    pad = r + 16
    x0, x1 = max(0, int(xs.min()) - pad), min(check.CANVAS[0], int(xs.max()) + pad)
    y0, y1 = max(0, int(ys.min()) - pad), min(check.CANVAS[1], int(ys.max()) + pad)
    oe = edges_of(orig[y0:y1, x0:x1])
    D = cv2.distanceTransform((oe == 0).astype(np.uint8), cv2.DIST_L2, 3)
    D = np.minimum(D, 8).astype(np.float32)
    Dp = cv2.copyMakeBorder(D, r, r, r, r, cv2.BORDER_CONSTANT, value=8)
    best = None
    for s in np.arange(scales[0], scales[1] + 1e-9, 0.01):
        part, _ = placed_with(img, spec, zooms, float(s), 0, 0)
        p = part[y0:y1, x0:x1]
        bg = np.full_like(p[..., :3], 0.5)
        rgb = (p[..., :3] * p[..., 3:4] + bg * (1 - p[..., 3:4])) * 255
        inside = cv2.dilate((p[..., 3] > 0.5).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        pe = edges_of(rgb.astype(np.uint8), inside)
        n = int((pe > 0).sum())
        if n < 20:
            continue
        # all integer shifts at once: correlate the part's edge map with the distance map (score = mean distance)
        kernel = (pe > 0).astype(np.float32)
        res = cv2.matchTemplate(Dp, kernel, cv2.TM_CCORR) / n
        iy, ix = np.unravel_index(np.argmin(res), res.shape)
        score = float(res[iy, ix])
        if best is None or score < best[0]:
            best = (score, float(s), float(ix - r), float(iy - r), n)
    return {'score': round(best[0], 3), 'scale': round(best[1], 3), 'dx': round(best[2], 2), 'dy': round(best[3], 2), 'edgePixels': best[4]}


def align_opening(img, spec, zooms, ref_points, search, scales, step, ref_mask=None):
    ref = check.poly_mask(ref_points) if ref_mask is None else ref_mask
    ys, xs = np.where(ref)
    pad = int(search) + 30
    y0, y1, x0, x1 = ys.min() - pad, ys.max() + pad, xs.min() - pad, xs.max() + pad
    r = ref[y0:y1, x0:x1]
    best = None
    for s in np.arange(scales[0], scales[1] + 1e-9, 0.01):
        part, _ = placed_with(img, spec, zooms, float(s), 0, 0)
        g0 = part[y0:y1, x0:x1, 3] > 0.5
        for dy in range(-int(search), int(search) + 1):
            for dx in range(-int(search), int(search) + 1):
                g = np.roll(np.roll(g0, dy, 0), dx, 1)
                iou = (g & r).sum() / max((g | r).sum(), 1)
                if best is None or iou > best[0]:
                    best = (float(iou), float(s), float(dx), float(dy))
    return {'iou': round(best[0], 3), 'scale': round(best[1], 3), 'dx': round(best[2], 2), 'dy': round(best[3], 2)}


def align_features(img, spec, zooms, expect=None, min_inliers=12):
    """Coarse placement for big scale differences: SIFT matches between the part (on white) and the original,
    RANSAC similarity (uniform scale + shift + rotation), then convert to scale/dx/dy about the placement centre."""
    orig = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB'))
    a = np.asarray(img.convert('RGBA')).astype(np.float32) / 255
    rgb = (a[..., :3] * a[..., 3:4] + (1 - a[..., 3:4])) * 255
    gray_p = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2GRAY)
    mask_p = (cv2.erode((a[..., 3] > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8)) * 255)
    gray_o = cv2.cvtColor(orig, cv2.COLOR_RGB2GRAY)
    mask_o = None
    if expect:
        mask_o = np.zeros(gray_o.shape, np.uint8)
        x0, y0, x1, y1 = expect
        mask_o[max(0, y0):y1, max(0, x0):x1] = 255
    sift = cv2.SIFT_create(nfeatures=4000)
    kp1, d1 = sift.detectAndCompute(gray_p, mask_p)
    kp2, d2 = sift.detectAndCompute(gray_o, mask_o)
    if d1 is None or d2 is None or len(kp1) < 4:
        return None
    matches = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [m for m, n in (mm for mm in matches if len(mm) == 2) if m.distance < 0.8 * n.distance]
    if len(good) < 6:
        return {'inliers': len(good), 'ok': False}
    src = np.float32([kp1[m.queryIdx].pt for m in good]); dst = np.float32([kp2[m.trainIdx].pt for m in good])
    A, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4, maxIters=5000, confidence=0.995)
    if A is None:
        return {'inliers': 0, 'ok': False}
    n_in = int(inl.sum())
    s_abs = float(np.hypot(A[0, 0], A[1, 0])); rot = float(np.degrees(np.arctan2(A[1, 0], A[0, 0])))
    # express as our uniform placement: canvas = M_base(scale) * p + shift
    M0 = check.placement(spec, zooms, img.size, 0, 0, 1.0)
    scale = s_abs / M0[0, 0]
    M1 = check.placement(spec, zooms, img.size, 0, 0, scale)
    # shift so that the part centre lands where the similarity puts it
    cy, cx = np.argwhere(a[..., 3] > 0.5).mean(0)
    tgt = A @ np.array([cx, cy, 1.0]); cur = M1 @ np.array([cx, cy, 1.0])
    return {'ok': n_in >= min_inliers and abs(rot) < 4, 'inliers': n_in, 'matches': len(good), 'rotation': round(rot, 2),
            'scale': round(float(scale), 4), 'dx': round(float(tgt[0] - cur[0]), 2), 'dy': round(float(tgt[1] - cur[1]), 2)}


def refine_edges(img, spec, zooms, scale, dx, dy, search=6, span=0.03):
    """Edge chamfer search around a coarse placement."""
    orig = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB'))
    base, _ = placed_with(img, spec, zooms, scale, dx, dy)
    ys, xs = np.where(base[..., 3] > 0.5)
    r = int(search); pad = r + 16
    x0, x1 = max(0, int(xs.min()) - pad), min(check.CANVAS[0], int(xs.max()) + pad)
    y0, y1 = max(0, int(ys.min()) - pad), min(check.CANVAS[1], int(ys.max()) + pad)
    D = cv2.distanceTransform((edges_of(orig[y0:y1, x0:x1]) == 0).astype(np.uint8), cv2.DIST_L2, 3)
    Dp = cv2.copyMakeBorder(np.minimum(D, 8).astype(np.float32), r, r, r, r, cv2.BORDER_CONSTANT, value=8)
    best = None
    for k in np.linspace(1 - span, 1 + span, 7):
        s = scale * k
        # keep the part centre fixed while scaling around the placement centre
        c0 = np.array([xs.mean(), ys.mean()])
        part, M = placed_with(img, spec, zooms, s, dx, dy)
        Mi = check.placement(spec, zooms, img.size, dx, dy, scale)
        src_c = np.linalg.solve(Mi[:, :2], c0 - Mi[:, 2]); moved = M @ np.append(src_c, 1)
        ddx, ddy = dx + c0[0] - moved[0], dy + c0[1] - moved[1]
        part, _ = placed_with(img, spec, zooms, s, ddx, ddy)
        p = part[y0:y1, x0:x1]
        rgb = (p[..., :3] * p[..., 3:4] + 0.5 * (1 - p[..., 3:4])) * 255
        inside = cv2.dilate((p[..., 3] > 0.5).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        pe = edges_of(rgb.astype(np.uint8), inside); n = int((pe > 0).sum())
        if n < 20:
            continue
        res = cv2.matchTemplate(Dp, (pe > 0).astype(np.float32), cv2.TM_CCORR) / n
        iy, ix = np.unravel_index(np.argmin(res), res.shape)
        if best is None or res[iy, ix] < best[0]:
            best = (float(res[iy, ix]), float(s), float(ddx + ix - r), float(ddy + iy - r))
    return {'score': round(best[0], 3), 'scale': round(best[1], 4), 'dx': round(best[2], 2), 'dy': round(best[3], 2)}


def _robust_score(gen_pm, gen_a, orig, Dmap, S, T, roi, tau=0.12, w_edge=0.5):
    """Warp the part with canvas = S*p + T into roi; truncated colour difference over the part + edge chamfer."""
    x0, y0, x1, y1 = roi
    M = np.float32([[S, 0, T[0] - x0], [0, S, T[1] - y0]])
    size = (x1 - x0, y1 - y0)
    pm = cv2.warpAffine(gen_pm, M, size, flags=cv2.INTER_LINEAR, borderValue=0)
    a = pm[..., 3]
    m = a > 0.5
    n = int(m.sum())
    if n < 50:
        return 9.0, None
    rgb = pm[..., :3] / np.maximum(a[..., None], 1e-4)
    o = orig[y0:y1, x0:x1]
    diff = np.minimum(np.linalg.norm(rgb - o, axis=-1) / np.sqrt(3), tau)
    photo = float(diff[m].mean() / tau)
    comp = (rgb * a[..., None] + 0.5 * (1 - a[..., None])) * 255
    inside = cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    pe = edges_of(comp.astype(np.uint8), inside) > 0
    edge = float(Dmap[y0:y1, x0:x1][pe].mean() / 8) if pe.sum() > 10 else 1.0
    return photo + w_edge * edge, (photo, edge, n)


def align_robust(img, spec, zooms, expect, span=0.3, trans=0.18):
    """Placement for parts that the generator drew at a different scale: start from the expected box on the original,
    grid-search uniform scale + shift (coarse then fine) on truncated colour difference + edge distance."""
    orig_u8 = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB'))
    orig = orig_u8.astype(np.float32) / 255
    Dmap = np.minimum(cv2.distanceTransform((edges_of(orig_u8) == 0).astype(np.uint8), cv2.DIST_L2, 3), 8).astype(np.float32)
    a = np.asarray(img.convert('RGBA')).astype(np.float32) / 255
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    ys, xs = np.where(a[..., 3] > 0.5)
    gx0, gx1, gy0, gy1 = xs.min(), xs.max(), ys.min(), ys.max()
    ex0, ey0, ex1, ey1 = expect
    S0 = float(np.sqrt(((ex1 - ex0) * (ey1 - ey0)) / ((gx1 - gx0) * (gy1 - gy0))))
    gc = np.array([(gx0 + gx1) / 2, (gy0 + gy1) / 2]); ec = np.array([(ex0 + ex1) / 2, (ey0 + ey1) / 2])
    W, H = check.CANVAS
    pad = 40
    roi = (max(0, ex0 - int(trans * (ex1 - ex0)) - pad), max(0, ey0 - int(trans * (ey1 - ey0)) - pad),
           min(W, ex1 + int(trans * (ex1 - ex0)) + pad), min(H, ey1 + int(trans * (ey1 - ey0)) + pad))
    best = None
    # coarse: scales around S0, centre shifts on a grid
    tx_r, ty_r = trans * (ex1 - ex0), trans * (ey1 - ey0)
    step = max(2.0, min(tx_r, ty_r) / 12)
    for S in S0 * np.exp(np.linspace(np.log(1 - span), np.log(1 + span), 25)):
        for oy in np.arange(-ty_r, ty_r + 1e-9, step):
            for ox in np.arange(-tx_r, tx_r + 1e-9, step):
                T = ec + np.array([ox, oy]) - S * gc
                sc, info = _robust_score(pm, a, orig, Dmap, float(S), T, roi)
                if best is None or sc < best[0]:
                    best = (sc, float(S), T.copy(), info)
    # fine
    _, S1, T1, _ = best
    for S in S1 * np.linspace(0.985, 1.015, 7):
        c_now = S1 * gc + T1
        for oy in np.arange(-step, step + 1e-9, 1.0):
            for ox in np.arange(-step, step + 1e-9, 1.0):
                T = c_now + np.array([ox, oy]) - S * gc
                sc, info = _robust_score(pm, a, orig, Dmap, float(S), T, roi)
                if sc < best[0]:
                    best = (sc, float(S), T.copy(), info)
    sc, S, T, info = best
    return {'score': round(sc, 4), 'photo': round(info[0], 4), 'edge': round(info[1], 4), 'pixels': info[2],
            'S': round(S, 5), 'T': [round(float(T[0]), 2), round(float(T[1]), 2)], 'S0': round(S0, 4)}


def align_refine(img, spec, zooms, search=6, scales=(0.97, 1.03)):
    """Small correction around the plain crop mapping (for edit-style outputs that already keep the framing):
    truncated colour difference + edge distance, uniform scale about the part centre + shift."""
    orig_u8 = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB'))
    orig = orig_u8.astype(np.float32) / 255
    Dmap = np.minimum(cv2.distanceTransform((edges_of(orig_u8) == 0).astype(np.uint8), cv2.DIST_L2, 3), 8).astype(np.float32)
    a = np.asarray(img.convert('RGBA')).astype(np.float32) / 255
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    M0 = check.placement(spec, zooms, img.size, 0, 0, 1.0)
    S0, T0 = M0[0, 0], M0[:, 2]
    ys, xs = np.where(a[..., 3] > 0.5)
    gc = np.array([xs.mean(), ys.mean()])
    c0 = S0 * gc + T0
    W, H = check.CANVAS
    bx = S0 * np.array([xs.min(), xs.max()]) + T0[0]; by = S0 * np.array([ys.min(), ys.max()]) + T0[1]
    pad = int(search) + 12
    roi = (max(0, int(bx[0]) - pad), max(0, int(by[0]) - pad), min(W, int(bx[1]) + pad), min(H, int(by[1]) + pad))
    best = None
    for k in np.arange(scales[0], scales[1] + 1e-9, 0.01):
        S = S0 * k
        for oy in range(-int(search), int(search) + 1):
            for ox in range(-int(search), int(search) + 1):
                T = c0 + np.array([ox, oy]) - S * gc
                sc, info = _robust_score(pm, a, orig, Dmap, float(S), T, roi)
                if best is None or sc < best[0]:
                    best = (sc, float(k), T.copy(), info, ox, oy)
    base, _, _, _, _, _ = best
    # the score at the plain mapping, for comparison
    s_plain, _ = _robust_score(pm, a, orig, Dmap, float(S0), T0, roi)
    sc, k, T, info, ox, oy = best
    S = S0 * k
    Ms = check.placement(spec, zooms, img.size, 0, 0, k)
    return {'score': round(sc, 4), 'plainScore': round(float(s_plain), 4), 'photo': round(info[0], 4), 'edge': round(info[1], 4),
            'scale': round(k, 4), 'dx': round(float(T[0] - Ms[0, 2]), 2), 'dy': round(float(T[1] - Ms[1, 2]), 2), 'centreShift': [ox, oy]}


_DMAP = None


def original_edge_distance():
    global _DMAP
    if _DMAP is None:
        o = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB'))
        g = cv2.GaussianBlur(cv2.cvtColor(o, cv2.COLOR_RGB2GRAY), (3, 3), 0)
        e = cv2.Canny(g, 20, 60)
        _DMAP = np.minimum(cv2.distanceTransform((e == 0).astype(np.uint8), cv2.DIST_L2, 3), 12).astype(np.float32)
    return _DMAP


_SIL = None


def silhouette_distance():
    """Distance to the character's outer silhouette (the original has a transparent background)."""
    global _SIL
    if _SIL is None:
        a = np.asarray(Image.open(ROOT / 'reference' / 'original.png').convert('RGBA'))[..., 3]
        m = (a > 128).astype(np.uint8)
        edge = cv2.morphologyEx(m, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
        _SIL = np.minimum(cv2.distanceTransform((edge == 0).astype(np.uint8), cv2.DIST_L2, 3), 12).astype(np.float32)
    return _SIL


def curve_distance(points):
    """Distance to a measured polyline on the original (e.g. the jaw line)."""
    m = np.zeros((check.CANVAS[1], check.CANVAS[0]), np.uint8)
    cv2.polylines(m, [np.round(np.array(points)).astype(np.int32)], False, 255, 1)
    return np.minimum(cv2.distanceTransform((m == 0).astype(np.uint8), cv2.DIST_L2, 3), 12).astype(np.float32)


def align_boundary(img, spec, zooms, search=10, scales=(0.94, 1.06), keep=0.5, base=None, windows=None, dmap=None):
    """Fit the part's outline to the original's lines: the visible parts of the outline lie on line art or colour
    edges of the original; hidden parts do not. `windows` (canvas boxes) limit scoring to where the outline is
    visible in the original; within them only the best `keep` fraction of outline points is scored."""
    D = original_edge_distance() if dmap is None else dmap
    a = np.asarray(img.convert('RGBA'))[..., 3]
    cs, _ = cv2.findContours((a > 127).astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    pts = np.concatenate([c[:, 0, :] for c in cs if len(c) > 20], 0).astype(np.float64)
    base = base or {'scale': 1.0, 'dx': 0.0, 'dy': 0.0}
    M0 = check.placement(spec, zooms, img.size, base['dx'], base['dy'], base['scale'])
    S0, T0 = M0[0, 0], M0[:, 2]
    P = pts * S0 + T0
    # thin the outline to ~1 point per canvas pixel
    step = max(1, int(round(1 / S0)))
    P = P[::step]
    c_all = P.mean(0)
    if windows:
        sel = np.zeros(len(P), bool)
        for x0, y0, x1, y1 in windows:
            sel |= (P[:, 0] >= x0) & (P[:, 0] <= x1) & (P[:, 1] >= y0) & (P[:, 1] <= y1)
        if sel.sum() >= 30:
            P_all = P
            P = P[sel]
    # scale about the centre of the whole outline, so a window does not change the meaning of the scale
    c_fixed = c_all
    c = c_fixed
    H, W = D.shape
    best = None
    for k in np.arange(scales[0], scales[1] + 1e-9, 0.005):
        Q = c + (P - c) * k
        for oy in range(-search, search + 1):
            for ox in range(-search, search + 1):
                R = Q + (ox, oy)
                xi = np.clip(np.round(R[:, 0]).astype(int), 0, W - 1); yi = np.clip(np.round(R[:, 1]).astype(int), 0, H - 1)
                d = np.sort(D[yi, xi])
                score = float(d[:max(1, int(len(d) * keep))].mean())
                if best is None or score < best[0]:
                    best = (score, float(k), ox, oy)
    sc, k, ox, oy = best
    # back to the placement parametrisation: canvas = S*p + T with S = S0*k, T chosen so the outline centre moves by (ox, oy)
    S = S0 * k
    T = c + np.array([ox, oy]) - k * (c - T0) - S0 * 0  # c = S0*pc + T0 -> new = c + k*(S0*p + T0 - c) + o
    T = (1 - k) * c + k * T0 + np.array([ox, oy])
    Ms = check.placement(spec, zooms, img.size, 0, 0, base['scale'] * k)
    plain = np.sort(D[np.clip(np.round(P[:, 1]).astype(int), 0, H - 1), np.clip(np.round(P[:, 0]).astype(int), 0, W - 1)])
    return {'boundary': round(sc, 3), 'plainBoundary': round(float(plain[:max(1, int(len(plain) * keep))].mean()), 3),
            'scale': round(base['scale'] * k, 4), 'dx': round(float(T[0] - Ms[0, 2]), 2), 'dy': round(float(T[1] - Ms[1, 2]), 2),
            'centreShift': [ox, oy], 'k': round(k, 4), 'points': int(len(P))}


def grad_mag(rgb_u8):
    g = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2GRAY).astype(np.float32)
    g = cv2.GaussianBlur(g, (3, 3), 0)
    return cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))


def align_gradncc(img, spec, zooms, expect, smin=0.25, smax=1.4, steps=60, pad=40):
    """Multi-scale masked normalised correlation of gradient images (line art, outlines).
    Hidden areas of the part are mostly flat colour, so they add little; works for big scale differences."""
    orig_u8 = np.asarray(Image.open(ROOT / 'reference' / 'original-on-white.png').convert('RGB'))
    W, H = check.CANVAS
    x0, y0, x1, y1 = max(0, expect[0] - pad), max(0, expect[1] - pad), min(W, expect[2] + pad), min(H, expect[3] + pad)
    Go = grad_mag(orig_u8[y0:y1, x0:x1])
    a = np.asarray(img.convert('RGBA')).astype(np.float32) / 255
    ys, xs = np.where(a[..., 3] > 0.3)
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    a = a[by0:by1, bx0:bx1]
    comp = ((a[..., :3] * a[..., 3:4] + 0.5 * (1 - a[..., 3:4])) * 255).astype(np.uint8)
    Gs_full = grad_mag(comp)
    mask_full = cv2.dilate((a[..., 3] > 0.3).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
    best = None
    ew, eh = expect[2] - expect[0], expect[3] - expect[1]
    # scale = canvas px per output px; search around the size that would fit the expected box
    s_fit = np.sqrt((ew * eh) / ((bx1 - bx0) * (by1 - by0)))
    for s in s_fit * np.exp(np.linspace(np.log(smin), np.log(smax), steps)):
        tw, th = int(round((bx1 - bx0) * s)), int(round((by1 - by0) * s))
        if tw < 8 or th < 8 or tw >= Go.shape[1] or th >= Go.shape[0]:
            continue
        Gs = (cv2.resize(Gs_full, (tw, th), interpolation=cv2.INTER_AREA) * float(s)).astype(np.float32)
        mk = cv2.resize(mask_full, (tw, th), interpolation=cv2.INTER_NEAREST)
        if Gs.std() < 1e-3:
            continue
        res = cv2.matchTemplate(Go, Gs, cv2.TM_CCORR_NORMED, mask=mk)
        res = np.nan_to_num(res, nan=-1, posinf=-1, neginf=-1)
        iy, ix = np.unravel_index(np.argmax(res), res.shape)
        if best is None or res[iy, ix] > best[0]:
            best = (float(res[iy, ix]), float(s), x0 + ix, y0 + iy)
    sc, s, px, py = best
    # canvas = s * (p - [bx0, by0]) + [px, py]  ->  S = s, T = [px - s*bx0, py - s*by0]
    return {'ncc': round(sc, 4), 'S': round(s, 5), 'T': [round(px - s * bx0, 2), round(py - s * by0, 2)]}


def align_points(img, spec, zooms, targets, scales):
    """Small separate marks (eye highlights): match mark centroids to measured spots (scale about the crop centre + shift)."""
    base, M = placed_with(img, spec, zooms, 1.0, 0, 0)
    n, lab, st, cen = cv2.connectedComponentsWithStats((base[..., 3] > 0.35).astype(np.uint8))
    gen = np.array([cen[i] for i in range(1, n) if st[i, 4] >= 2], float)
    tgt = np.array([t[:2] for t in targets], float)
    if spec.get('zoom'):
        x, y, w, h = zooms[spec['zoom']]['box']; c = np.array([x + w / 2, y + h / 2])
    else:
        c = np.array([check.CANVAS[0] / 2, check.CANVAS[1] / 2])
    best = None
    for s in np.arange(scales[0], scales[1] + 1e-9, 0.01):
        g = c + (gen - c) * s
        t = tgt.mean(0) - g.mean(0)
        for _ in range(20):
            d = np.linalg.norm((g + t)[:, None] - tgt[None], axis=-1)
            nn = d.argmin(1)
            t = (tgt[nn] - g).mean(0)
        d = np.linalg.norm((g + t)[:, None] - tgt[None], axis=-1)
        score = (d.min(1).mean() + d.min(0).mean()) / 2
        if best is None or score < best[0]:
            best = (float(score), float(s), float(t[0]), float(t[1]), int(len(gen)))
    return {'meanDistance': round(best[0], 2), 'scale': round(best[1], 3), 'dx': round(best[2], 2), 'dy': round(best[3], 2), 'marks': best[4]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('part'); ap.add_argument('version', type=int)
    ap.add_argument('--mode', default='edges', choices=['edges', 'opening', 'mask', 'points', 'features', 'robust', 'gradncc', 'refine'])
    ap.add_argument('--span', type=float, default=0.3)
    ap.add_argument('--trans', type=float, default=0.18)
    ap.add_argument('--expect', type=int, nargs=4, help='for --mode features: x0 y0 x1 y1 region of the original where the part is')
    ap.add_argument('--mask', help="for --mode mask: measured mask (.npy, canvas size) in authoring/")
    ap.add_argument('--search', type=float, default=12)
    ap.add_argument('--step', type=float, default=1)
    ap.add_argument('--scales', type=float, nargs=2, default=[0.94, 1.06])
    ap.add_argument('--accept', action='store_true', help='write parts-aligned/<part>.png and mark the version selected')
    ap.add_argument('--use', type=float, nargs=3, metavar=('SCALE', 'DX', 'DY'), help='skip the search and use this placement')
    args = ap.parse_args()
    parts, zooms, meas = check.load(ROOT / 'authoring/parts.json'), check.load(ROOT / 'authoring/zooms.json'), check.load(ROOT / 'authoring/measure.json')
    spec = parts[args.part]
    img = Image.open(ROOT / 'parts' / args.part / f'{args.part}-v{args.version}.png')
    if args.use:
        res = {'scale': args.use[0], 'dx': args.use[1], 'dy': args.use[2], 'manual': True}
    elif args.mode == 'opening':
        res = align_opening(img, spec, zooms, meas['eyeOpening' + args.part[-1]], args.search, args.scales, args.step)
    elif args.mode == 'mask':
        res = align_opening(img, spec, zooms, None, args.search, args.scales, args.step, np.load(ROOT / 'authoring' / args.mask))
    elif args.mode == 'points':
        res = align_points(img, spec, zooms, meas['highlights' + args.part[-1]], args.scales)
    elif args.mode == 'features':
        coarse = align_features(img, spec, zooms, args.expect)
        print('coarse', json.dumps(coarse))
        if not coarse or not coarse.get('ok'):
            raise SystemExit('feature alignment failed')
        res = refine_edges(img, spec, zooms, coarse['scale'], coarse['dx'], coarse['dy'], search=args.search, span=0.03)
        res['coarse'] = coarse
    elif args.mode == 'refine':
        res = align_refine(img, spec, zooms, args.search, tuple(args.scales) if args.scales != [0.94, 1.06] else (0.97, 1.03))
    elif args.mode in ('robust', 'gradncc'):
        expect = args.expect or meas['expect'][args.part]
        res = align_robust(img, spec, zooms, expect, args.span, args.trans) if args.mode == 'robust' else align_gradncc(img, spec, zooms, expect)
        # express canvas = S*p + T in the placement parametrisation (scale about the crop centre + shift)
        M0 = check.placement(spec, zooms, img.size, 0, 0, 1.0)
        base = M0[0, 0]
        Ms = check.placement(spec, zooms, img.size, 0, 0, res['S'] / base)
        res.update(scale=round(res['S'] / base, 5), dx=round(res['T'][0] - Ms[0, 2], 2), dy=round(res['T'][1] - Ms[1, 2], 2))
    else:
        res = align_edges(img, spec, zooms, args.search, args.scales, args.step)
    part, M = placed_with(img, spec, zooms, res['scale'], res['dx'], res['dy'])
    res['matrix'] = M.round(5).tolist()
    if args.part.startswith('eyeWhite'):
        res['eyeMetrics'] = check.eye_metrics(part[..., 3], meas['eyeOpening' + args.part[-1]])
    box = zooms[spec['zoom']]['box'] if spec.get('zoom') else [0, 0, *check.CANVAS]
    ref = meas.get('eyeOpening' + args.part[-1]) if args.part.startswith('eyeWhite') else None
    res['sheet'] = str(check.sheet(part, box if not spec.get('zoom') else [box[0] + 30, box[1] + 38, 100, 75] if spec['zoom'] in ('eyeL', 'eyeR') else box, f'{args.part}-v{args.version}-aligned', ref))
    rec_path = ROOT / 'records' / f'{args.part}.json'
    rec = json.loads(rec_path.read_text(encoding='utf8'))
    for v in rec['versions']:
        if v['version'] == args.version:
            v['placement'] = {k: res[k] for k in res if k not in ('sheet',)}
    if args.accept:
        out = ROOT / 'parts-aligned' / f'{args.part}.png'
        out.parent.mkdir(exist_ok=True)
        Image.fromarray((np.clip(part, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(out)
        rec['selected'] = args.version
    rec_path.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps(res, ensure_ascii=False))


if __name__ == '__main__':
    main()
