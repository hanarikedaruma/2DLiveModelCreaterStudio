import { describe, expect, it } from 'vitest';
import { armPoseAllowed, inspectArmRigs, partAffine, transformVec, type ArmPose } from '@app/schema';
import { createBindingEvaluator } from '../../eval';
import { createDeformPipeline } from '../../deform';
import { makeArmFixture } from './testing';
import { evaluateArmRigs } from './evaluate';
import { forwardArmInModel } from '../math';

const evaluate = createBindingEvaluator(),
  pipeline = createDeformPipeline();
const poseParams = (p: ArmPose) => ({
  ArmShoulderL: p.shoulder,
  ArmElbowL: p.elbow,
  HandAngleL: p.wrist,
  ArmShoulderR: p.shoulder,
  ArmElbowR: p.elbow,
  HandAngleR: p.wrist,
});
const center = (positions: Float32Array, a: number, b: number) => ({
  x: (positions[a * 2]! + positions[b * 2]!) / 2,
  y: (positions[a * 2 + 1]! + positions[b * 2 + 1]!) / 2,
});

describe('AT-08 実装者の共通評価確認', () => {
  it.each([
    { shoulder: 0, elbow: 0, wrist: 0 },
    { shoulder: 25, elbow: 65, wrist: 10 },
  ])('基準画像が曲がっていても関節を同じ場所へ接続する（%o）', (reference) => {
    const p = makeArmFixture(reference);
    expect(inspectArmRigs(p.model).filter((i) => i.severity === 'error')).toEqual([]);
    for (const pose of [
      { shoulder: 90, elbow: 0, wrist: 0 },
      { shoulder: 110, elbow: 130, wrist: -30 },
      { shoulder: 65, elbow: 100, wrist: 25 },
    ]) {
      const out = pipeline.deform(p.model, evaluate.evaluate(p.model, poseParams(pose)));
      for (const rig of p.model.armRigs!) {
        const fk = forwardArmInModel(rig, pose),
          side = rig.side;
        const upper = out.byPartId[`upper-${side}`]!.positions,
          lower = out.byPartId[`lower-${side}`]!.positions;
        const e = center(upper, 1, 2),
          w = center(lower, 1, 2),
          attachment = center(out.byPartId[`open-${side}`]!.positions, 0, 1);
        for (const [actual, expected] of [
          [e, fk.elbow],
          [w, fk.wrist],
          [attachment, fk.wrist],
        ]) {
          expect(actual!.x).toBeCloseTo(expected!.x, 3);
          expect(actual!.y).toBeCloseTo(expected!.y, 3);
        }
      }
    }
  });
  it('親の回転・等倍率・呼吸の平行移動を1回だけ受ける', () => {
    const p = makeArmFixture(),
      parent = p.model.parts[0]!;
    parent.rotation = 12;
    parent.scale = { x: 0.85, y: 0.85 };
    parent.position.y = -6;
    const pose = { shoulder: 110, elbow: 130, wrist: -30 },
      values = poseParams(pose);
    const deltas = evaluate.evaluate(p.model, values),
      out = pipeline.deform(p.model, deltas);
    const expected = transformVec(partAffine(parent, undefined), forwardArmInModel(p.model.armRigs![0]!, pose).wrist);
    const actual = center(out.byPartId['open-L']!.positions, 0, 1);
    expect(actual.x).toBeCloseTo(expected.x, 3);
    expect(actual.y).toBeCloseTo(expected.y, 3);
    expect(pipeline.deform(p.model, deltas)).toEqual(out);
  });
  it('表情・アニメーションが極端な値を上書きしても合成角を制約する', () => {
    const p = makeArmFixture(),
      values = poseParams({ shoulder: 1000, elbow: -100, wrist: 1000 });
    const out = evaluate.evaluate(p.model, values);
    for (const rig of p.model.armRigs!) expect(armPoseAllowed(rig, out.arms!.poses[rig.side]!)).toBe(true);
  });
  it('手形の最大・同点・全0・非有限値と既存opacity/visibleを守る', () => {
    const p = makeArmFixture(),
      saved = JSON.stringify(p);
    const select = (values: Record<string, number>) => evaluateArmRigs(p.model, values).opacityGates;
    expect(select({ HandFistL: 1, HandPeaceL: 1 })['fist-L']).toBe(1);
    expect(select({ HandFistL: 1, HandPeaceL: 1 })['peace-L']).toBe(0);
    expect(select({ HandOpenL: 0, HandPeaceL: NaN })['open-L']).toBe(1);
    expect(JSON.stringify(p)).toBe(saved);
    p.model.parts.find((x) => x.id === 'fist-L')!.opacity = 0.3;
    let out = pipeline.deform(p.model, evaluate.evaluate(p.model, { HandFistL: 1 }));
    expect(out.byPartId['fist-L']!.opacity).toBe(0.3);
    expect(out.byPartId['open-L']!.opacity).toBe(0);
    p.model.parts.find((x) => x.id === 'fist-L')!.visible = false;
    out = pipeline.deform(p.model, evaluate.evaluate(p.model, { HandFistL: 1 }));
    expect(out.byPartId['fist-L']).toBeUndefined();
  });
  it('欠損・負倍率・循環のある片腕だけを描かず、顔と反対側は続く', () => {
    for (const mode of ['missing', 'flip', 'cycle']) {
      const p = makeArmFixture(),
        rig = p.model.armRigs![0]!;
      if (mode === 'missing') rig.hands.open!.partIds = ['gone'];
      if (mode === 'flip') p.model.parts.find((x) => x.id === rig.groups.shoulder)!.scale.x = -1;
      if (mode === 'cycle') p.model.parts.find((x) => x.id === rig.groups.elbow)!.parentId = rig.groups.wrist;
      const out = pipeline.deform(p.model, evaluate.evaluate(p.model, {}));
      expect(out.byPartId['open-L']?.opacity ?? 0).toBe(0);
      expect(out.byPartId['open-R']!.opacity).toBe(1);
      expect(out.byPartId.face!.opacity).toBe(1);
    }
  });
  it('リグ無しモデルに腕の差分を追加しない', () => {
    const p = makeArmFixture();
    delete p.model.armRigs;
    expect(evaluate.evaluate(p.model, {})).not.toHaveProperty('arms');
  });
});
