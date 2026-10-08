import type { CurveGuide, Project, Vec2 } from '@app/schema';
import type {
  BindingEvaluator,
  CurveGuideResult,
  DeformPipeline,
  HairFrameEvaluator,
  HairDynamicsSession,
  DeformedModel,
  ParamValues,
  TargetDeltas,
} from '@app/contracts';
import {
  curveMeshSignature,
  curveContactGeometry,
  evaluateCurveGuide,
  transportCurveGuide,
} from '../deform/curveGuide';
import { contactsFit, projectContacts, solveStaticContacts } from './contact';
import { evaluateShoulders, guideContacts, meshContactPenetration, meshContactsFit } from './colliders';

// Producers have already advanced once. Reference evaluation never advances physics.
export function axisOutputsFor(project: Project, partId: string): string[] {
  const ancestors = new Set<string>();
  for (let id: string | null = partId; id && !ancestors.has(id);) {
    ancestors.add(id);
    id = project.model.parts.find((p) => p.id === id)?.parentId ?? null;
  }
  return [...new Set(project.physics.filter((p) => ancestors.has(p.partId)).map((p) => p.outputParameterId))].sort();
}
export function axisNeutralParams(project: Project, partId: string, params: ParamValues): ParamValues {
  return { ...params, ...Object.fromEntries(axisOutputsFor(project, partId).map((id) => [id, 0])) };
}
export function flowSwayReason(project: Pick<Project, 'model'>, guide: CurveGuide): string | undefined {
  if (!guide.enabled) return '流れ線の変形がOFFです。';
  if (!guide.gravity) return '「重力に沿わせる」をONにしてください。';
  const part = project.model.parts.find((p) => p.id === guide.partId);
  if (!part || part.meshId !== guide.meshId) return '対象のメッシュがありません。';
  const mesh = project.model.meshes.find((m) => m.id === guide.meshId);
  if (!mesh || curveMeshSignature(mesh) !== guide.meshSignature)
    return 'メッシュの形が変わりました。流れ線を描き直してください。';
  return undefined;
}
export function createHairFrameEvaluator(evaluator: BindingEvaluator, pipeline: DeformPipeline): HairFrameEvaluator {
  const completed = new WeakMap<
    HairDynamicsSession,
    {
      project: Project;
      params: ParamValues;
      frameId: string | number;
      active: boolean;
      epoch: number;
      model: DeformedModel;
    }
  >();
  return {
    evaluate(project, params, context, session) {
      if (session && context) {
        const cached = completed.get(session);
        if (
          cached &&
          cached.project === project &&
          cached.frameId === context.frameId &&
          cached.active === context.active &&
          cached.epoch === session.epoch &&
          Object.keys(cached.params).length === Object.keys(params).length &&
          Object.entries(params).every(([id, value]) => cached.params[id] === value)
        )
          return cached.model;
      }
      const guides = project.model.curveGuides ?? [];
      if (!guides.length) {
        session?.retain(project.id, []);
        return pipeline.deform(project.model, evaluator.evaluate(project.model, params));
      }
      const rawModel = { ...project.model, curveGuides: [] };
      const actualDeltas = evaluator.evaluate(rawModel, params);
      const actual = pipeline.deform(rawModel, actualDeltas);
      const shoulders = evaluateShoulders(project, actual);
      const references = new Map<string, { deltas: TargetDeltas; model: typeof actual }>();
      const results: Record<string, CurveGuideResult> = {};
      session?.retain(
        project.id,
        guides
          .filter(
            (g) =>
              g.dynamics?.enabled &&
              g.dynamics.strength > 0 &&
              !flowSwayReason(project, g) &&
              actual.byPartId[g.partId],
          )
          .map((g) => g.id),
      );
      for (const guide of guides) {
        const item = actual.byPartId[guide.partId];
        const mesh = project.model.meshes.find((m) => m.id === guide.meshId);
        if (!item || !mesh) continue;
        const axisIds = guide.enabled && guide.gravity ? axisOutputsFor(project, guide.partId) : [];
        let neutral: Vec2[] | null = null;
        let reference: Float32Array | null = null;
        let failure: string | undefined;
        if (axisIds.length) {
          if (
            axisIds.some((id) => {
              const p = project.model.parameters.find((p) => p.id === id);
              return !p || p.min > 0 || p.max < 0;
            })
          ) {
            failure = '軸揺れの中立値0を評価できません。';
          } else {
            const key = axisIds.join('\0');
            let prepared = references.get(key);
            if (!prepared) {
              const deltas = evaluator.evaluate(rawModel, axisNeutralParams(project, guide.partId, params));
              prepared = { deltas, model: pipeline.deform(rawModel, deltas) };
              references.set(key, prepared);
            }
            reference = prepared.model.byPartId[guide.partId]?.positions ?? null;
            if (reference)
              evaluateCurveGuide(rawModel, prepared.deltas, guide, mesh, reference, (target, source) => {
                neutral = target;
                return source;
              });
            if (!neutral) failure = '軸揺れと流れ線の対応を確認してください。';
          }
        }
        let dynamics: CurveGuideResult['dynamics'];
        const geometry = guide.collision?.enabled ? curveContactGeometry(mesh, guide, item.positions) : undefined;
        const contactData = geometry ? guideContacts(guide, shoulders, geometry.width) : undefined;
        const contacts = contactData?.contacts;
        const collisionActive = !!contacts?.colliders.length && !flowSwayReason(project, guide);
        let collision: CurveGuideResult['collision'];
        let contactSolved = true;
        let fixed = 1;
        const adjustment = axisIds.length > 0 || !!guide.dynamics?.enabled || collisionActive;
        let firstCandidate = true,
          correction = 0,
          extraPasses = 0;
        const run = () =>
          evaluateCurveGuide(
            project.model,
            actualDeltas,
            guide,
            mesh,
            item.positions,
            adjustment
              ? (rest, source, along) => {
                  if (axisIds.length && reference && neutral) {
                    const mapped = transportCurveGuide(mesh, guide, reference, item.positions, neutral);
                    if (mapped) rest = mapped;
                    else failure = '軸揺れとの対応がつぶれています。曲がりやキーを確認してください。';
                  }
                  const reason = failure ?? flowSwayReason(project, guide);
                  if (failure) return source;
                  if (guide.dynamics?.enabled) {
                    if (reason || !context || !session || guide.dynamics.strength === 0) {
                      dynamics = { status: reason ? 'frozen' : 'settled', ...(reason ? { reason } : {}) };
                    } else {
                      const next = session.advance(
                        guide.id,
                        rest,
                        along,
                        guide.rootFraction,
                        guide.dynamics,
                        JSON.stringify([
                          guide,
                          (project.model.shoulderColliders ?? []).filter((c) =>
                            guide.collision?.colliderIds.includes(c.id),
                          ),
                        ]),
                        axisIds.join('\0'),
                        context,
                        collisionActive && geometry?.complete ? contacts : undefined,
                      );
                      dynamics = { status: next.status, ...(next.reason ? { reason: next.reason } : {}) };
                      rest = next.curve;
                      if (next.collisionUnresolved) contactSolved = false;
                    }
                  }
                  if (collisionActive && contacts && geometry) {
                    fixed = Math.max(
                      1,
                      along.findIndex((s) => s > guide.rootFraction),
                    );
                    if (!geometry.complete) contactSolved = false;
                    else {
                      const solved = solveStaticContacts(rest, fixed, contacts);
                      contactSolved &&= solved.resolved;
                      rest = solved.curve;
                    }
                  }
                  return rest;
                }
              : undefined,
            collisionActive && contacts && geometry?.complete
              ? (positions, curve) => {
                  const penetration = meshContactPenetration(positions, geometry.triangles, contacts);
                  if (firstCandidate) correction = penetration;
                  firstCandidate = false;
                  return contactsFit(curve, fixed, contacts) && penetration <= 1e-4;
                }
              : undefined,
          );
        let evaluated = run();
        while (contacts && correction > 1e-4 && extraPasses++ < 4) {
          contacts.radius += correction + 0.25;
          correction = 0;
          firstCandidate = true;
          evaluated = run();
        }
        if (collisionActive && contacts && session && context?.active) {
          const previous = session.previousContacts(guide.id);
          if (previous) {
            // Length/mesh feedback can also move the 49-point line. Recheck that
            // completed line against the moving shoulder, beyond the 12-node sweep.
            const projected = projectContacts(
              evaluated.result.curve.map((p) => ({ ...p })),
              fixed,
              { ...contacts, margin: 0 },
              previous,
            );
            if (projected.changed || projected.exhausted) contactSolved = false;
          }
        }
        if (
          guide.dynamics?.enabled &&
          (evaluated.result.status === 'stale' || evaluated.result.status === 'disabled' || failure)
        ) {
          dynamics = {
            status: 'frozen',
            reason:
              failure ??
              (evaluated.result.status === 'stale'
                ? 'メッシュの形が変わりました。流れ線を描き直してください。'
                : '流れ線の変形がOFFです。'),
          };
          session?.discard(guide.id);
        }
        if (adjustment && evaluated.result.strength < 1) session?.reject(guide.id);
        if (guide.collision?.enabled) {
          const reason = failure ?? flowSwayReason(project, guide);
          const valid =
            !reason &&
            (!collisionActive ||
              (!!geometry?.complete &&
                contactSolved &&
                evaluated.result.strength > 0 &&
                !!contacts &&
                contactsFit(evaluated.result.curve, fixed, contacts) &&
                meshContactsFit(evaluated.positions, geometry.triangles, contacts)));
          collision = {
            status: reason
              ? 'disabled'
              : valid
                ? evaluated.result.strength < 1 || extraPasses > 0
                  ? 'limited'
                  : 'ok'
                : 'unresolved',
            ...(!valid
              ? {
                  reason:
                    reason ??
                    (!geometry?.complete
                      ? '影響幅を広げて、毛束全体を線で動かせるようにしてください。'
                      : '肩との接触を解けませんでした。肩の線を離すか、影響幅を広げ、曲がりを緩めてください。'),
                }
              : {}),
            ...(contactData?.diagnostics.length ? { diagnostics: contactData.diagnostics } : {}),
          };
          if (!valid) session?.reject(guide.id);
          else if (collisionActive && geometry && context?.active)
            session?.accept(guide.id, evaluated.result.curve, geometry.along);
        }
        const result = {
          ...evaluated.result,
          ...(guide.dynamics?.enabled ? { dynamics: dynamics ?? { status: 'settled' as const } } : {}),
          ...(collision ? { collision } : {}),
        };
        item.positions = evaluated.positions;
        results[guide.id] = result;
      }
      const model = { ...actual, curveGuides: results };
      if (session && context)
        completed.set(session, {
          project,
          params: { ...params },
          frameId: context.frameId,
          active: context.active,
          epoch: session.epoch,
          model,
        });
      return model;
    },
  };
}
