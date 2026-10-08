import type { ParamValues } from '@app/contracts';
import type { Project } from '@app/schema';
import { createBindingEvaluator } from '../eval/evaluator';
import { bounceFrame, bounceReason, chestDeformBindingIds, limitChestOutput, safeBounceScale } from './bounce';
import { chestEquilibrium } from './chestSession';

// 静止した編集姿勢の重力だけを評価する。Bustの手編集・お試しの値は上書きしない。
export function chestStaticParams(
  project: Project,
  params: ParamValues,
  explicitIds: readonly string[] = [],
): ParamValues {
  const items = project.physics.filter((p) => p.deform === 'bounce');
  if (!items.length) return params;
  const owned = chestDeformBindingIds(project, items);
  const deltas = createBindingEvaluator().evaluate(
    { ...project.model, bindings: project.model.bindings.filter((b) => !owned.has(b.id)) },
    params,
  );
  const out = { ...params };
  for (const item of items) {
    if (
      explicitIds.includes(item.outputParameterId) ||
      (item.verticalOutputParameterId && explicitIds.includes(item.verticalOutputParameterId))
    )
      continue;
    const b = item.bounce!,
      frame = bounceReason(project, item) ? null : bounceFrame(project, item, deltas);
    let q = frame ? chestEquilibrium(b, frame.basis) : { x: 0, y: 0 };
    if (frame) {
      const range = Math.max(0, Math.min(1, item.range));
      q.x =
        item.direction === 'vertical' ? 0 : Math.max(-b.amplitudes.x * range, Math.min(b.amplitudes.x * range, q.x));
      q.y =
        item.direction === 'horizontal' ? 0 : Math.max(-b.amplitudes.y * range, Math.min(b.amplitudes.y * range, q.y));
      const s = safeBounceScale(frame.mesh, frame.positions, b.weights, q);
      q.x *= s;
      q.y *= s;
      q = limitChestOutput(project, item, frame, out, q);
    }
    out[item.outputParameterId] = b ? q.x / b.amplitudes.x : 0;
    if (item.verticalOutputParameterId) out[item.verticalOutputParameterId] = b ? q.y / b.amplitudes.y : 0;
  }
  return out;
}
