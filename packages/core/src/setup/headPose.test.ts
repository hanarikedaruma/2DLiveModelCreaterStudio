// I-039・I-067 頭の向き（共通の姿勢から顔・目鼻口・髪・耳を規則で動かす）。fixtures の基準モデルで確かめる
import reference from '@app/fixtures/reference-model/project.json';
import { loadProjectJson, validateProject, type Project, type StandardPartType } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createBindingEvaluator } from '../eval';
import { createDeformPipeline } from '../deform';
import { createProjectStore } from '../store';
import { createAutoSetup } from './autoSetup';
import { headWarpOf } from './faceTurn';
import { FEATURE_YAW, HEAD_LIMIT, LAYER_YAW, planHeadPose } from './headPose';
import { faceTurnBindings } from './headTurn';

const base = () => loadProjectJson(JSON.stringify(reference));
const pose = createAutoSetup({ faceTurn: 'head-pose' });
const run = (p: Project) => pose.plan(p).command.apply(p);

function deform(p: Project, x = 0, y = 0) {
  const values = Object.fromEntries(p.model.parameters.map((v) => [v.id, v.default]));
  return createDeformPipeline().deform(
    p.model,
    createBindingEvaluator().evaluate(p.model, { ...values, FaceAngleX: x, FaceAngleY: y }),
  );
}
const partOf = (p: Project, type: StandardPartType) => p.model.parts.find((v) => v.standardType === type)!;
function stats(positions: Float32Array) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    sx += x;
    sy += y;
  }
  const n = positions.length / 2;
  return { minX, maxX, minY, maxY, cx: sx / n, cy: sy / n, width: maxX - minX, height: maxY - minY };
}
const at = (p: Project, type: StandardPartType, x = 0, y = 0) =>
  stats(deform(p, x, y).byPartId[partOf(p, type).id]!.positions);
const FACE_ANGLES = ['FaceAngleX', 'FaceAngleY'];

describe('I-039・I-067 共通の姿勢の頭の向き', () => {
  const p = run(base());
  const face = at(p, 'face');
  const faceWidth = face.width;
  // 画面の右にある目・眉・耳（右を向くと遠い側）
  const right = <T extends StandardPartType>(a: T, b: T): [T, T] => (at(p, a).cx > at(p, b).cx ? [a, b] : [b, a]);
  const [eyeRight, eyeLeft] = right('eyeWhiteL', 'eyeWhiteR');
  const [browRight, browLeft] = right('browL', 'browR');
  const [earRight, earLeft] = right('earL', 'earR');
  const ratio = (type: StandardPartType, x: number) => at(p, type, x).width / at(p, type).width;
  const shift = (type: StandardPartType, x: number, y = 0) => at(p, type, x, y).cx - at(p, type).cx;

  it('頭のパーツの頂点・首の頂点・目と口のグループに、左右・上下・斜めのキーを 0 と ±30 で作る（基準の姿勢は変わらない）', () => {
    expect(faceTurnBindings(p.model, true)).toHaveLength(0);
    expect(headWarpOf(p.model)).toBeNull();
    // 位置のキー（transform）は、目・口のグループの左右だけ（奥行きの移動の旧方式のキーは作らない）
    const turns = p.model.bindings.filter(
      (b) => b.channel === 'transform' && b.parameterIds.some((id) => FACE_ANGLES.includes(id)),
    );
    expect(turns.map((b) => p.model.parts.find((q) => q.id === b.target.id)!.standardType).sort()).toEqual([
      'eyeGroupL',
      'eyeGroupR',
      'mouthGroup',
    ]);
    expect(turns.every((b) => b.parameterIds.join() === 'FaceAngleX')).toBe(true);
    const faceMesh = partOf(p, 'face').meshId;
    const faceBindings = p.model.bindings.filter((b) => b.channel === 'vertices' && b.target.id === faceMesh);
    expect(faceBindings.map((b) => b.parameterIds.join('×'))).toEqual(
      expect.arrayContaining(['FaceAngleX', 'FaceAngleY', 'FaceAngleX×FaceAngleY']),
    );
    // キーは 0 と ±30 だけ（中間のキーは作らない）
    for (const b of p.model.bindings.filter((b) => b.parameterIds.some((id) => FACE_ANGLES.includes(id)))) {
      for (const values of b.keyValues) expect(values.every((v) => [-30, 0, 30].includes(v))).toBe(true);
    }
    // 首には左右（あごの影）だけ、胴体には掛けない
    const neckMesh = partOf(p, 'neck').meshId;
    expect(
      p.model.bindings.filter((b) => b.target.id === neckMesh && b.parameterIds.some((id) => FACE_ANGLES.includes(id))),
    ).toHaveLength(1);
    const torsoMesh = partOf(p, 'torso').meshId;
    expect(p.model.bindings.some((b) => b.target.id === torsoMesh && b.parameterIds.includes('FaceAngleX'))).toBe(
      false,
    );
    const before = deform(base());
    const neutral = deform(p);
    for (const item of neutral.items) {
      const old = before.byPartId[item.partId]!.positions;
      expect(item.positions.every((v, i) => Math.abs(v - old[i]!) < 0.001)).toBe(true);
    }
    expect(() => validateProject(p)).not.toThrow();
  });

  it('横を向くと、輪郭の縁とあご先も向きへ動き（顔の幅の 3〜8%）、目鼻口はもっと大きく動く', () => {
    for (const sign of [1, -1]) {
      const turned = at(p, 'face', 30 * sign);
      for (const edge of [turned.minX - face.minX, turned.maxX - face.maxX]) {
        expect(edge * sign).toBeGreaterThan(faceWidth * 0.03);
        expect(edge * sign).toBeLessThan(faceWidth * 0.08);
      }
      for (const type of ['irisL', 'irisR', 'upperLip', 'browL', 'browR'] as const) {
        expect(shift(type, 30 * sign) * sign).toBeGreaterThan(faceWidth * 0.06);
      }
    }
  });

  it('遠い側の目（目のグループのワープ）と眉は細く、近い側は細くならない。口は少し細くなる', () => {
    expect(ratio(eyeRight, 30)).toBeCloseTo(FEATURE_YAW.eyeFar, 1);
    expect(ratio(eyeLeft, -30)).toBeCloseTo(FEATURE_YAW.eyeFar, 1);
    expect(ratio(eyeLeft, 30)).toBeGreaterThan(0.97);
    expect(ratio(eyeRight, -30)).toBeGreaterThan(0.97);
    // 瞳も目のグループと一緒に詰まる
    const [irisRight] = right('irisL', 'irisR');
    expect(ratio(irisRight, 30)).toBeLessThan(0.86);
    expect(ratio(browRight, 30)).toBeCloseTo(FEATURE_YAW.browFar, 1);
    expect(ratio(browLeft, 30)).toBeGreaterThan(0.97);
    expect(ratio('upperLip', 30)).toBeCloseTo(FEATURE_YAW.mouth, 1);
    // 目のグループにワープを足し、遠い側の ±30 だけで詰める
    for (const type of ['eyeGroupL', 'eyeGroupR'] as const) {
      const group = partOf(p, type);
      const warps = p.model.warps.filter((w) => w.partId === group.id);
      expect(warps).toHaveLength(1);
      const binding = p.model.bindings.find((b) => b.target.id === warps[0]!.id)!;
      expect(binding.parameterIds).toEqual(['FaceAngleX']);
      const moved = binding.keys.filter((k) => (k.delta as { x: number }[]).some((d) => Math.abs(d.x) > 0.01));
      expect(moved).toHaveLength(1);
    }
  });

  it('耳は見える側が大きく、隠れる側が小さく、向きへ少し動く。後ろ髪は向きと逆へ、前髪は顔より少なく、少し上へ', () => {
    // 右を向くと、画面の左の耳が見える側
    expect(ratio(earLeft, 30)).toBeCloseTo(LAYER_YAW.earVisible.x, 1);
    expect(ratio(earRight, 30)).toBeCloseTo(LAYER_YAW.earHidden, 1);
    expect(ratio(earRight, -30)).toBeCloseTo(LAYER_YAW.earVisible.x, 1);
    for (const sign of [1, -1]) {
      for (const type of ['earL', 'earR'] as const) {
        expect(shift(type, 30 * sign) * sign).toBeGreaterThan(faceWidth * 0.02);
      }
      expect(shift('backHair', 30 * sign) * sign).toBeLessThan(-faceWidth * 0.02);
      const hair = shift('frontHair', 30 * sign) * sign;
      expect(hair).toBeGreaterThan(faceWidth * 0.02);
      expect(hair).toBeLessThan(shift('irisL', 30 * sign) * sign);
      expect(at(p, 'frontHair', 30 * sign).cy).toBeLessThan(at(p, 'frontHair').cy - 1);
    }
  });

  it('首は、上部の内側（あごの影）だけがあごと一緒に動き、首の縁は動かない', () => {
    const neck = at(p, 'neck');
    for (const sign of [1, -1]) {
      const turned = at(p, 'neck', 30 * sign);
      expect(Math.abs(turned.minX - neck.minX)).toBeLessThan(0.5);
      expect(Math.abs(turned.maxX - neck.maxX)).toBeLessThan(0.5);
      expect((turned.cx - neck.cx) * sign).toBeGreaterThan(0);
    }
  });

  it('上下を向いても、あご（顔の下端）は動かず首とつながったまま。目鼻口は向きへ動く', () => {
    for (const sign of [1, -1]) {
      expect(Math.abs(at(p, 'face', 0, 30 * sign).maxY - face.maxY)).toBeLessThan(1);
      for (const type of ['irisL', 'upperLip'] as const) {
        // 上（+）を向くと上（y が小さい方）へ
        expect((at(p, type, 0, 30 * sign).cy - at(p, type).cy) * sign).toBeLessThan(-faceWidth * 0.02);
      }
    }
  });

  it('上下の角度の上限はモデルの目・眉・口の位置から決め、目安の範囲に収める', () => {
    const plan = planHeadPose(p.model);
    expect(plan.limits!.pitch).toBeGreaterThanOrEqual(HEAD_LIMIT.minPitch);
    expect(plan.limits!.pitch).toBeLessThanOrEqual(HEAD_LIMIT.maxPitch);
    // 目・眉・口を顔の上下の縁へ寄せたモデルでは、上下の上限が小さくなる
    const spread = base();
    const cy = (face.minY + face.maxY) / 2;
    for (const part of spread.model.parts) {
      if (!(
        part.kind === 'image' &&
        /^(eye|iris|highlight|upperLid|lowerLid|brow|upperLip|lowerLip|mouthInside|teeth|tongue)/.test(
          part.standardType ?? '',
        )
      ))
        continue;
      const mesh = spread.model.meshes.find((m) => m.id === part.meshId)!;
      mesh.vertices = mesh.vertices.map((v) => ({ x: v.x, y: cy + (v.y - cy) * 1.3 }));
    }
    expect(planHeadPose(run(spread).model).limits!.pitch).toBeLessThan(plan.limits!.pitch);
  });

  it('斜めは目鼻口が四隅へ寄りすぎない（顔の輪郭の中に収まる）', () => {
    for (const [x, y] of [
      [30, 30],
      [-30, -30],
      [30, -30],
      [-30, 30],
    ]) {
      const f = at(p, 'face', x, y);
      for (const type of ['irisL', 'irisR', 'upperLip', 'lowerLip'] as const) {
        const s = at(p, type, x, y);
        expect(s.minX).toBeGreaterThan(f.minX);
        expect(s.maxX).toBeLessThan(f.maxX);
        expect(s.maxY).toBeLessThan(f.maxY);
      }
    }
  });

  it('やり直しても同じ。手で直したキーとロックしたキーは残り、Undo で前に戻る', () => {
    expect(run(p)).toBe(p);
    const mesh = partOf(p, 'frontHair').meshId;
    const binding = p.model.bindings.find(
      (b) => b.channel === 'vertices' && b.target.id === mesh && b.parameterIds.join() === 'FaceAngleX',
    )!;
    const eyeWarp = p.model.warps.find((w) => w.partId === partOf(p, 'eyeGroupL').id)!;
    const warpBinding = p.model.bindings.find((b) => b.target.id === eyeWarp.id)!;
    const manual = <T extends { coords: number[] }>(k: T, delta: unknown) =>
      k.coords[0] === 30 ? { ...k, source: 'manual' as const, delta } : k;
    const edited: Project = {
      ...p,
      model: {
        ...p.model,
        bindings: p.model.bindings.map((b) =>
          b === binding
            ? {
                ...b,
                keys: b.keys.map((k) =>
                  manual(
                    k,
                    (k.delta as unknown[]).map(() => ({ x: 7, y: 0 })),
                  ),
                ),
              }
            : b === warpBinding
              ? {
                  ...b,
                  keys: b.keys.map((k) =>
                    manual(
                      k,
                      (k.delta as unknown[]).map(() => ({ x: 0, y: 3 })),
                    ),
                  ),
                }
              : b,
        ) as Project['model']['bindings'],
      },
    };
    const again = run(edited);
    const kept = again.model.bindings.find((b) => b.id === binding.id)!;
    expect(kept.keys.find((k) => k.coords[0] === 30)!.source).toBe('manual');
    expect((kept.keys.find((k) => k.coords[0] === 30)!.delta as { x: number }[])[0]!.x).toBe(7);
    // 目のワープは足し直さず、手で直したキーも残る
    expect(again.model.warps.filter((w) => w.partId === eyeWarp.partId)).toHaveLength(1);
    const keptWarp = again.model.bindings.find((b) => b.id === warpBinding.id)!;
    expect((keptWarp.keys.find((k) => k.coords[0] === 30)!.delta as { y: number }[])[0]!.y).toBe(3);

    const store = createProjectStore(base());
    store.dispatch(pose.plan(store.get()).command);
    store.undo();
    expect(store.get()).toEqual(base());
  });

  it('前の方式（頭全体の曲面・顔だけの曲面・奥行き）からも切り替わり、二重に掛けない', () => {
    for (const faceTurn of ['head-surface', 'surface', 'depth'] as const) {
      const before = createAutoSetup({ faceTurn }).plan(base()).command.apply(base());
      const after = run(before);
      expect(faceTurnBindings(after.model, true)).toHaveLength(0);
      // 位置のキーは目・口のグループだけ
      expect(
        after.model.bindings.some(
          (b) =>
            b.channel === 'transform' &&
            b.parameterIds.some((id) => FACE_ANGLES.includes(id)) &&
            !['eyeGroupL', 'eyeGroupR', 'mouthGroup'].includes(
              after.model.parts.find((q) => q.id === b.target.id)!.standardType ?? '',
            ),
        ),
      ).toBe(false);
      const turned = at(after, 'irisL', 30).cx - at(after, 'irisL').cx;
      expect(turned).toBeCloseTo(at(p, 'irisL', 30).cx - at(p, 'irisL').cx, 3);
    }
  });

  it('顔・頭のワープの顔の向きに手で直したキーがあれば、切り替えずに警告する', () => {
    const before = createAutoSetup({ faceTurn: 'surface' }).plan(base()).command.apply(base());
    const turn = faceTurnBindings(before.model)[0]!;
    const manual: Project = {
      ...before,
      model: {
        ...before.model,
        bindings: before.model.bindings.map((b) =>
          b === turn ? { ...b, keys: b.keys.map((k, i) => (i === 0 ? { ...k, source: 'manual' as const } : k)) } : b,
        ),
      },
    };
    const plan = pose.plan(manual);
    expect(plan.warnings.join()).toMatch(/個別に動かす方式には切り替えず/);
    const after = plan.command.apply(manual);
    expect(faceTurnBindings(after.model).length).toBe(faceTurnBindings(manual.model).length);
    const faceMesh = partOf(after, 'face').meshId;
    expect(after.model.bindings.some((b) => b.target.id === faceMesh && b.parameterIds.includes('FaceAngleX'))).toBe(
      false,
    );
    // 目のワープも足さない
    expect(after.model.warps.some((w) => w.partId === partOf(after, 'eyeGroupL').id)).toBe(false);
  });
});
