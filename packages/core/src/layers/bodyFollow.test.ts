import { describe, expect, it } from 'vitest';
import { createEmptyProject, standardParametersFor, type Project } from '@app/schema';
import type { FrameContext, Layer, ParamValues } from '@app/contracts';
import { createParameterMixer } from '../mix';
import { BODY_FOLLOW_RATES, createBodyFollowProducer } from './bodyFollow';

// STEP1 の標準パラメータ（BodyAngleX・Y・Z を含む）を持つプロジェクト
function step1Project(): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: { ...p.model, parameters: standardParametersFor('step1').map((x) => ({ ...x })) } };
}

function withoutParams(project: Project, ids: string[]): Project {
  return {
    ...project,
    model: { ...project.model, parameters: project.model.parameters.filter((p) => !ids.includes(p.id)) },
  };
}

function ctx(project: Project, mixedSoFar: ParamValues): FrameContext {
  return { now: 0, dt: 16, project, mixedSoFar, flags: { lipSyncWeight: 1, physicsActive: true } };
}

describe('createBodyFollowProducer', () => {
  it('id は bodyFollow、weight 1、override（blend を付けない）。初期値は標準（率 0.3）', () => {
    const body = createBodyFollowProducer();
    expect(body.id).toBe('bodyFollow');
    const layer = body.produce(ctx(step1Project(), { FaceAngleX: 20, FaceAngleZ: -10, FaceAngleY: 15 }));
    expect(layer).toEqual({ id: 'bodyFollow', weight: 1, values: { BodyAngleX: 6, BodyAngleZ: -3 } });
    expect(layer?.blend).toBeUndefined();
  });

  it('率は 控えめ 0.15・標準 0.3・大きめ 0.45', () => {
    expect(BODY_FOLLOW_RATES).toEqual({ low: 0.15, standard: 0.3, high: 0.45 });
    const body = createBodyFollowProducer();
    const values = () => body.produce(ctx(step1Project(), { FaceAngleX: 20, FaceAngleZ: -10 }))!.values;
    body.setStrength('low');
    expect(values().BodyAngleX).toBeCloseTo(3, 10);
    expect(values().BodyAngleZ).toBeCloseTo(-1.5, 10);
    body.setStrength('high');
    expect(values().BodyAngleX).toBeCloseTo(9, 10);
    expect(values().BodyAngleZ).toBeCloseTo(-4.5, 10);
    body.setStrength('standard');
    expect(values().BodyAngleX).toBeCloseTo(6, 10);
    expect(values().BodyAngleZ).toBeCloseTo(-3, 10);
  });

  it('知らない強さは無視する（前の率のまま）', () => {
    const body = createBodyFollowProducer();
    body.setStrength('high');
    body.setStrength('huge' as 'high');
    expect(body.produce(ctx(step1Project(), { FaceAngleX: 20, FaceAngleZ: 0 }))!.values.BodyAngleX).toBeCloseTo(9, 10);
  });

  it('顔の向きが変わると毎フレームそれに合わせる', () => {
    const body = createBodyFollowProducer();
    const project = step1Project();
    expect(body.produce(ctx(project, { FaceAngleX: 0, FaceAngleZ: 0 }))!.values).toEqual({
      BodyAngleX: 0,
      BodyAngleZ: 0,
    });
    expect(body.produce(ctx(project, { FaceAngleX: -30, FaceAngleZ: 30 }))!.values).toEqual({
      BodyAngleX: -9,
      BodyAngleZ: 9,
    });
  });

  it('プロジェクトに体のパラメータが無ければ、そのパラメータは出さない（足さない）。1つも無ければ null', () => {
    const body = createBodyFollowProducer();
    const face = { FaceAngleX: 20, FaceAngleZ: -10 };
    expect(body.produce(ctx(withoutParams(step1Project(), ['BodyAngleX']), face))!.values).toEqual({ BodyAngleZ: -3 });
    expect(body.produce(ctx(withoutParams(step1Project(), ['BodyAngleZ']), face))!.values).toEqual({ BodyAngleX: 6 });
    // MVP のプロジェクト（体のパラメータが無い）
    expect(body.produce(ctx(createEmptyProject('MVP'), face))).toBeNull();
  });

  it('顔のパラメータの値が無いか数でなければ、その体のパラメータは出さない', () => {
    const body = createBodyFollowProducer();
    const project = step1Project();
    expect(body.produce(ctx(project, { FaceAngleX: 10 }))!.values).toEqual({ BodyAngleX: 3 });
    expect(body.produce(ctx(project, { FaceAngleX: Number.NaN, FaceAngleZ: 10 }))!.values).toEqual({ BodyAngleZ: 3 });
    expect(body.produce(ctx(project, {}))).toBeNull();
  });

  it('合成すると前のレイヤーの体の値を上書きし、範囲（±10）に丸められる', () => {
    const mixer = createParameterMixer();
    const project = step1Project();
    const { parameters } = project.model;
    const body = createBodyFollowProducer();
    const tracking: Layer = { id: 'tracking', weight: 1, values: { FaceAngleX: 30, FaceAngleZ: -20, BodyAngleX: 5 } };
    const mixedSoFar = mixer.mix(parameters, [tracking]);
    const out = mixer.mix(parameters, [tracking, body.produce(ctx(project, mixedSoFar))!]);
    expect(out.BodyAngleX).toBeCloseTo(9, 10);
    expect(out.BodyAngleZ).toBeCloseTo(-6, 10);
    expect(out.BodyAngleY).toBe(0); // 上下は追従しない
    body.setStrength('high'); // 30 × 0.45 = 13.5 → 10
    const high = mixer.mix(parameters, [tracking, body.produce(ctx(project, mixedSoFar))!]);
    expect(high.BodyAngleX).toBe(10);
    expect(high.BodyAngleZ).toBeCloseTo(-9, 10);
  });

  it('入力を書き換えない', () => {
    const body = createBodyFollowProducer();
    const project = step1Project();
    const mixedSoFar = { FaceAngleX: 20, FaceAngleZ: -10 };
    const before = structuredClone({ project, mixedSoFar });
    body.produce(ctx(project, mixedSoFar));
    expect({ project, mixedSoFar }).toEqual(before);
  });
});
