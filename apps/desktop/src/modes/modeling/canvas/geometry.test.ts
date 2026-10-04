import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@app/schema';
import { transformPoint, type DrawItem } from '@app/contracts';
import {
  angleBetween,
  applyAffine,
  boxContains,
  boxFrame,
  hitTestItems,
  invert,
  isIdentityChange,
  moveDelta,
  multiply,
  pivotChange,
  pointInTriangle,
  poseMatrix,
  rotateHandlePoint,
  rotation,
  scaleFactorFor,
  scaling,
  selectionBox,
  snapAngle,
  type Pose,
} from './geometry';

const near = (a: Vec2, b: Vec2, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

function rectItem(partId: string, x: number, y: number, w: number, h: number): DrawItem {
  return {
    partId,
    assetId: partId,
    positions: new Float32Array([x, y, x + w, y, x + w, y + h, x, y + h]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    opacity: 1,
    blendMode: 'normal',
    mask: null,
  };
}

const pose: Pose = { position: { x: 12, y: -7 }, rotation: 30, scale: { x: 2, y: 0.5 }, pivot: { x: 100, y: 50 } };

describe('行列', () => {
  it('パーツの変形の行列は、仮実装の transformPoint と同じ点に動かす', () => {
    const m = poseMatrix(pose);
    for (const p of [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 250, y: -40 },
    ])
      near(applyAffine(m, p), transformPoint(pose, p));
  });

  it('逆行列を掛けると元に戻る。拡縮が 0 なら逆にできない', () => {
    const m = multiply(poseMatrix(pose), rotation(-75));
    const inv = invert(m)!;
    near(applyAffine(inv, applyAffine(m, { x: 3, y: 4 })), { x: 3, y: 4 });
    expect(invert(scaling({ x: 0, y: 1 }))).toBeNull();
  });

  it('正の角度は y が下向きの画面で時計回り', () => {
    // 右向き (1,0) を 90 度回すと下向き (0,1)
    near(applyAffine(rotation(90), { x: 1, y: 0 }), { x: 0, y: 1 });
  });
});

describe('当たり判定', () => {
  it('三角形の内側と辺の上は当たり、外は当たらない。つぶれた三角形は当たらない', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const c = { x: 0, y: 10 };
    expect(pointInTriangle({ x: 2, y: 2 }, a, b, c)).toBe(true);
    expect(pointInTriangle({ x: 5, y: 0 }, a, b, c)).toBe(true);
    expect(pointInTriangle({ x: 6, y: 6 }, a, b, c)).toBe(false);
    // 向きが逆でも同じ
    expect(pointInTriangle({ x: 2, y: 2 }, a, c, b)).toBe(true);
    expect(pointInTriangle({ x: 1, y: 1 }, a, b, { x: 20, y: 0 })).toBe(false);
  });

  it('手前（items の後ろ）から見て最初に当たるものを返し、選べないものは素通りする', () => {
    const model = { items: [rectItem('back', 0, 0, 100, 100), rectItem('front', 50, 50, 100, 100)], byPartId: {} };
    expect(hitTestItems(model, { x: 60, y: 60 })).toBe('front');
    expect(hitTestItems(model, { x: 10, y: 10 })).toBe('back');
    expect(hitTestItems(model, { x: 60, y: 60 }, (id) => id !== 'front')).toBe('back');
    expect(hitTestItems(model, { x: 200, y: 10 })).toBeNull();
  });
});

describe('選択枠とハンドル', () => {
  it('パーツの向きの枠で囲み、回転ハンドルは枠の上に出る', () => {
    // ピボット (0,0)、90度回したパーツ: 枠の座標の y 軸はキャンバスの -x 向き
    const frame = boxFrame(scaling({ x: 1, y: 1 }), {
      ...pose,
      position: { x: 0, y: 0 },
      pivot: { x: 0, y: 0 },
      rotation: 90,
    });
    const box = selectionBox(frame, [
      { x: -10, y: -20 },
      { x: 10, y: 20 },
    ])!;
    // キャンバスの (x, y) は枠の座標で (y, -x)
    near(box.min, { x: -20, y: -10 });
    near(box.max, { x: 20, y: 10 });
    expect(boxContains(box, { x: 5, y: 5 })).toBe(true);
    expect(boxContains(box, { x: 15, y: 5 })).toBe(false);
    // 上の辺（枠の y = -10）はキャンバスの x = 10。上向きはキャンバスの +x
    near(rotateHandlePoint(box, 5), { x: 15, y: 0 });
  });
});

describe('ドラッグの量', () => {
  it('拡縮: つかんだ点の座標の比。辺は片方の軸だけ、Shift で縦横比を固定する', () => {
    near(scaleFactorFor('se', { x: 100, y: 50 }, { x: 150, y: 100 }, false), { x: 1.5, y: 2 });
    near(scaleFactorFor('e', { x: 100, y: 50 }, { x: 150, y: 100 }, false), { x: 1.5, y: 1 });
    near(scaleFactorFor('n', { x: 0, y: -50 }, { x: 30, y: -25 }, false), { x: 1, y: 0.5 });
    // 角で縦横比を固定すると、つかんだ点の方向への射影で同じ倍率にする
    const f = scaleFactorFor('se', { x: 100, y: 100 }, { x: 200, y: 100 }, true);
    expect(f.x).toBeCloseTo(1.5);
    expect(f.y).toBeCloseTo(1.5);
    near(scaleFactorFor('e', { x: 100, y: 50 }, { x: 150, y: 100 }, true), { x: 1.5, y: 1.5 });
    // 裏返しや 0 にはしない。ピボットの上をつかんだら変えない
    expect(scaleFactorFor('e', { x: 100, y: 0 }, { x: -50, y: 0 }, false).x).toBe(0.01);
    near(scaleFactorFor('e', { x: 0, y: 0 }, { x: 50, y: 0 }, false), { x: 1, y: 1 });
  });

  it('回転: 時計回りが正。15度ずつにそろえられる', () => {
    const c = { x: 10, y: 10 };
    expect(angleBetween(c, { x: 10, y: 0 }, { x: 20, y: 10 })).toBeCloseTo(90);
    expect(angleBetween(c, { x: 20, y: 10 }, { x: 10, y: 0 })).toBeCloseTo(-90);
    expect(angleBetween(c, c, { x: 20, y: 10 })).toBe(0);
    expect(snapAngle(22)).toBe(15);
    expect(snapAngle(23)).toBe(30);
  });

  it('移動: 親が回っていれば、親の座標での差分にする', () => {
    near(moveDelta(rotation(90), { x: 0, y: 10 }), { x: 10, y: 0 });
    near(moveDelta(scaling({ x: 2, y: 2 }), { x: 10, y: 4 }), { x: 5, y: 2 });
  });

  it('ピボット: キャンバス上で d だけ動き、パーツの見た目は動かない', () => {
    const parent = multiply(rotation(20), scaling({ x: 1.5, y: 1.5 }));
    const d = { x: 30, y: -12 };
    const change = pivotChange(parent, pose, d)!;
    const moved: Pose = {
      ...pose,
      position: { x: pose.position.x + change.dPosition!.x, y: pose.position.y + change.dPosition!.y },
      pivot: { x: pose.pivot.x + change.dPivot!.x, y: pose.pivot.y + change.dPivot!.y },
    };
    const before = multiply(parent, poseMatrix(pose));
    const after = multiply(parent, poseMatrix(moved));
    for (const p of [
      { x: 0, y: 0 },
      { x: 300, y: 80 },
    ])
      near(applyAffine(after, p), applyAffine(before, p), 4);
    // 見えているピボット（親の変形の後の position + pivot）は d だけ動く
    const shown = (q: Pose) => applyAffine(parent, { x: q.position.x + q.pivot.x, y: q.position.y + q.pivot.y });
    near(shown(moved), { x: shown(pose).x + d.x, y: shown(pose).y + d.y }, 4);
  });

  it('何も変えない変更を見分ける', () => {
    expect(isIdentityChange({})).toBe(true);
    expect(isIdentityChange({ dPosition: { x: 0, y: 0 }, scaleFactor: { x: 1, y: 1 }, dRotation: 0 })).toBe(true);
    expect(isIdentityChange({ dPosition: { x: 0.5, y: 0 } })).toBe(false);
    expect(isIdentityChange({ opacityFactor: 0.5 })).toBe(false);
  });
});
