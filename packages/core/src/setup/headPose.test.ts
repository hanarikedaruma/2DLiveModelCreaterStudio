// I-039 頭の向き（共通の姿勢から顔・髪・耳を個別に変形する）。fixtures の基準モデルで確かめる
import reference from '@app/fixtures/reference-model/project.json';
import { loadProjectJson, validateProject, type Project, type StandardPartType } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createBindingEvaluator } from '../eval';
import { createDeformPipeline } from '../deform';
import { createProjectStore } from '../store';
import { createAutoSetup } from './autoSetup';
import { headWarpOf } from './faceTurn';
import { HEAD_LIMIT, planHeadPose } from './headPose';
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
  return { minX, maxX, minY, maxY, cx: sx / n, cy: sy / n, width: maxX - minX };
}
const at = (p: Project, type: StandardPartType, x = 0, y = 0) =>
  stats(deform(p, x, y).byPartId[partOf(p, type).id]!.positions);

describe('I-039 共通の姿勢の頭の向き', () => {
  const p = run(base());
  const face = at(p, 'face');
  const faceWidth = face.width;

  it('ワープではなく、頭の画像パーツのメッシュの頂点に左右・上下・斜めのキーを作る（基準の姿勢は変わらない）', () => {
    expect(faceTurnBindings(p.model, true)).toHaveLength(0);
    expect(headWarpOf(p.model)).toBeNull();
    // 奥行きの移動（旧方式の transform のキー）も作らない
    expect(
      p.model.bindings.filter(
        (b) => b.channel === 'transform' && b.parameterIds.some((id) => id === 'FaceAngleX' || id === 'FaceAngleY'),
      ),
    ).toHaveLength(0);
    const faceMesh = partOf(p, 'face').meshId;
    const sets = p.model.bindings
      .filter((b) => b.channel === 'vertices' && b.target.id === faceMesh)
      .map((b) => b.parameterIds.join('×'));
    expect(sets).toEqual(expect.arrayContaining(['FaceAngleX', 'FaceAngleY', 'FaceAngleX×FaceAngleY']));
    // 首・体には掛けない
    for (const type of ['neck', 'torso'] as const) {
      const mesh = partOf(p, type).meshId;
      expect(p.model.bindings.some((b) => b.target.id === mesh && b.parameterIds.includes('FaceAngleX'))).toBe(false);
    }
    const before = deform(base());
    const neutral = deform(p);
    for (const item of neutral.items) {
      const old = before.byPartId[item.partId]!.positions;
      expect(item.positions.every((v, i) => Math.abs(v - old[i]!) < 0.001)).toBe(true);
    }
    expect(() => validateProject(p)).not.toThrow();
  });

  it('横を向くと、顔の輪郭はほとんど動かず、目鼻口がその向きへ寄る（向きが形で分かる）', () => {
    for (const sign of [1, -1]) {
      const turned = at(p, 'face', 30 * sign);
      expect(Math.abs(turned.minX - face.minX)).toBeLessThan(faceWidth * 0.03);
      expect(Math.abs(turned.maxX - face.maxX)).toBeLessThan(faceWidth * 0.03);
      for (const type of ['irisL', 'irisR', 'upperLip', 'browL', 'browR'] as const) {
        const shift = at(p, type, 30 * sign).cx - at(p, type).cx;
        expect(shift * sign).toBeGreaterThan(faceWidth * 0.08);
      }
    }
    // 右を向くと、右側（画面の右）の目は細く、左側の目は細くならない。左を向くとその逆
    const [rightSide, leftSide] =
      at(p, 'eyeWhiteL').cx > at(p, 'eyeWhiteR').cx ? ['eyeWhiteL', 'eyeWhiteR'] : ['eyeWhiteR', 'eyeWhiteL'];
    const ratio = (type: StandardPartType, x: number) => at(p, type, x).width / at(p, type).width;
    expect(ratio(rightSide as StandardPartType, 30)).toBeLessThan(0.8);
    expect(ratio(leftSide as StandardPartType, 30)).toBeGreaterThan(0.95);
    expect(ratio(leftSide as StandardPartType, -30)).toBeLessThan(0.8);
  });

  it('後ろ髪と耳は向きと逆へ動き、前髪は顔と同じ向きへ動く（視差）', () => {
    for (const sign of [1, -1]) {
      for (const type of ['backHair', 'earL', 'earR'] as const) {
        expect((at(p, type, 30 * sign).cx - at(p, type).cx) * sign).toBeLessThan(-faceWidth * 0.02);
      }
      expect((at(p, 'frontHair', 30 * sign).cx - at(p, 'frontHair').cx) * sign).toBeGreaterThan(faceWidth * 0.08);
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

  it('角度の上限はモデルの目・眉・口の位置から決め、目安の範囲に収める', () => {
    const plan = planHeadPose(p.model);
    expect(plan.limits!.yaw).toBeGreaterThanOrEqual(HEAD_LIMIT.minYaw);
    expect(plan.limits!.yaw).toBeLessThanOrEqual(HEAD_LIMIT.maxYaw);
    expect(plan.limits!.pitch).toBeGreaterThanOrEqual(HEAD_LIMIT.minPitch);
    expect(plan.limits!.pitch).toBeLessThanOrEqual(HEAD_LIMIT.maxPitch);
    // 目を顔の縁へ寄せたモデルでは、左右の上限が小さくなる
    const wide = base();
    for (const part of wide.model.parts) {
      if (part.standardType !== 'eyeWhiteR' && part.standardType !== 'eyeWhiteL') continue;
      const mesh = wide.model.meshes.find((m) => m.id === part.meshId)!;
      const center = mesh.vertices.reduce((s, v) => s + v.x, 0) / mesh.vertices.length;
      const out = center > face.cx ? 1 : -1;
      mesh.vertices = mesh.vertices.map((v) => ({ x: v.x + out * faceWidth * 0.15, y: v.y }));
    }
    expect(planHeadPose(run(wide).model).limits!.yaw).toBeLessThan(plan.limits!.yaw);
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
    const edited: Project = {
      ...p,
      model: {
        ...p.model,
        bindings: p.model.bindings.map((b) =>
          b === binding
            ? {
                ...b,
                keys: b.keys.map((k) =>
                  k.coords[0] === 30
                    ? {
                        ...k,
                        source: 'manual' as const,
                        delta: (k.delta as { x: number; y: number }[]).map(() => ({ x: 7, y: 0 })),
                      }
                    : k,
                ),
              }
            : b,
        ),
      },
    };
    const again = run(edited);
    const kept = again.model.bindings.find((b) => b.id === binding.id)!;
    expect(kept.keys.find((k) => k.coords[0] === 30)!.source).toBe('manual');
    expect((kept.keys.find((k) => k.coords[0] === 30)!.delta as { x: number }[])[0]!.x).toBe(7);

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
      expect(
        after.model.bindings.some(
          (b) => b.channel === 'transform' && b.parameterIds.some((id) => id === 'FaceAngleX' || id === 'FaceAngleY'),
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
  });
});
