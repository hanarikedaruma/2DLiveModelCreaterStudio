import { newId, type CurveGuide, type Vec2 } from '@app/schema';
import type { CurveGuideResult } from '@app/contracts';
import { createDeformPipeline, curveMeshSignature, evaluateCurveGuide, meshPointsToDisplay } from '@app/core';
import type { CanvasTool } from '../../../shell/api';
import { canvasToScreen } from '../../../shell/canvas/view';
import type { EnvSlot, ToolEnv } from '../canvas/env';
import { beginLiveEdit, startKeyedDrag, type LiveEdit } from '../canvas/liveEdit';
import { distance, itemPoints } from '../canvas/geometry';
import { isLockedDeep, paramValuesOf } from '../canvas/parts';
import { createMeshTargetMapper, createPointTargetMapper } from '../mesh/meshDrag';
import { meshTarget } from '../mesh/meshTool';
import {
  activeParams,
  coordsOf,
  findBinding,
  isBaseState,
  isPreviewOffBase,
  keyIndexAt,
} from '../../../services/keyEditor/common';
import { editableGuide, guideOfPart, patchGuideCommand, setGuideCommand } from './commands';

export const CURVE_TOOL_ID = 'modeling.curveGuide';
const INVERSE_ERROR = 'この位置へは滑らかに変形できません。影響幅を広げるか、曲げる量を小さくしてください。';
const labels = ['根元', '中間', '毛先'];

export function createCurveEditor(slot: EnvSlot) {
  const pipeline = createDeformPipeline();
  let drawing = false;
  let clickStart: Vec2 | null = null;
  let stroke: Vec2[] | null = null;
  let drawOwner: { project: object; partId: string; values: object } | null = null;
  let drag: {
    live: LiveEdit;
    base: ReturnType<typeof snapshot>;
    index: number;
    solve: (targets: Vec2[]) => Vec2[] | null;
    expected: object;
    warned: boolean;
  } | null = null;
  let options: { live: LiveEdit; guideId: string; expected: object } | null = null;
  let pending: Promise<void> = Promise.resolve();
  let cancelBake: (() => void) | null = null;

  function snapshot(env: ToolEnv) {
    const project = env.services.store.get();
    const editor = env.services.editor.get();
    const deltas = env.services.evaluator.evaluate(
      project.model,
      paramValuesOf(project.model, editor.editorParamValues),
    );
    const target = meshTarget(project.model, editor.selectedPartIds);
    const guide = target ? guideOfPart(project.model, target.part.id) : undefined;
    const raw = target?.mesh
      ? pipeline.deform({ ...project.model, curveGuides: [] }, deltas).byPartId[target.part.id]
      : undefined;
    const evaluated =
      guide && target?.mesh && raw
        ? evaluateCurveGuide(project.model, deltas, guide, target.mesh, raw.positions)
        : null;
    return { project, editor, deltas, target, guide, raw, evaluated };
  }

  function clear() {
    drag?.live.cancel();
    options?.live.cancel();
    cancelBake?.();
    cancelBake = null;
    drag = null;
    options = null;
    stroke = null;
    clickStart = null;
    drawOwner = null;
    slot.get()?.requestRedraw();
  }
  const allowed = (snap: ReturnType<typeof snapshot>) =>
    !!snap.target?.mesh &&
    !!snap.raw &&
    !isLockedDeep(snap.project.model, snap.target.part.id) &&
    !snap.project.model.parts.some((p) => p.parentId === snap.target!.part.id);
  const drawingValid = (snap: ReturnType<typeof snapshot>) =>
    drawOwner?.project === snap.project &&
    drawOwner.partId === snap.target?.part.id &&
    drawOwner.values === snap.editor.editorParamValues;
  const draggingValid = (env: ToolEnv) =>
    !!drag &&
    env.services.store.get() === drag.expected &&
    env.services.editor.get().selectedPartIds[0] === drag.base.target!.part.id &&
    env.services.editor.get().editorParamValues === drag.base.editor.editorParamValues;

  function finishStroke(env: ToolEnv, points: Vec2[]) {
    const snap = snapshot(env);
    if (
      !allowed(snap) ||
      !snap.target?.mesh ||
      !snap.raw ||
      points.length < 2 ||
      distance(points[0]!, points.at(-1)!) < 5 / env.view().scale
    )
      return;
    if (!drawingValid(snap)) return;
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + distance(points[i - 1]!, points[i]!));
    const half = lengths.at(-1)! / 2;
    let middle = points[0]!;
    for (let i = 1; i < points.length; i++)
      if (lengths[i]! >= half) {
        const t = (half - lengths[i - 1]!) / Math.max(1e-8, lengths[i]! - lengths[i - 1]!);
        middle = {
          x: points[i - 1]!.x + (points[i]!.x - points[i - 1]!.x) * t,
          y: points[i - 1]!.y + (points[i]!.y - points[i - 1]!.y) * t,
        };
        break;
      }
    const nearby = points.filter((_, i) => Math.abs(lengths[i]! - half) <= lengths.at(-1)! * 0.08);
    if (nearby.length > 2)
      middle = nearby.reduce((p, q) => ({ x: p.x + q.x / nearby.length, y: p.y + q.y / nearby.length }), {
        x: 0,
        y: 0,
      });
    const visible = [points[0]!, middle, points.at(-1)!];
    const mesh = snap.target.mesh;
    const rawPoints = itemPoints(snap.raw);
    const initial = visible.map(
      (p) =>
        mesh.vertices[
          rawPoints.reduce((best, q, i) => (distance(q, p) < distance(rawPoints[best]!, p) ? i : best), 0)
        ]!,
    );
    const local = createPointTargetMapper((p) => meshPointsToDisplay(mesh, snap.raw!.positions, p), initial)(visible);
    if (!local) {
      env.dialogs.notify(INVERSE_ERROR);
      return;
    }
    const reference = local as CurveGuide['reference'];
    const length = reference.slice(1).reduce((sum, p, i) => sum + distance(reference[i]!, p), 0);
    const guide: CurveGuide = {
      id: snap.guide?.id ?? newId(),
      partId: snap.target.part.id,
      meshId: mesh.id,
      meshSignature: curveMeshSignature(mesh),
      reference,
      points: reference.map((p) => ({ ...p })) as CurveGuide['points'],
      radius: Math.max(10, length * 0.35),
      rootFraction: 0.15,
      gravity: false,
      enabled: true,
    };
    env.services.store.dispatch(setGuideCommand(guide));
    drawing = false;
    clickStart = null;
    env.requestRedraw();
  }

  const tool: CanvasTool = {
    id: CURVE_TOOL_ID,
    label: '線で曲げる',
    cursor: 'crosshair',
    onPointerDown(e) {
      const env = slot.get();
      if (!env || e.button !== 0) return;
      const snap = snapshot(env);
      if (!allowed(snap)) {
        env.dialogs.notify(
          'メッシュのある、ロックされていない画像パーツを選んでください。子パーツを持つ画像は対象にできません。',
        );
        return;
      }
      if (!drawing && snap.guide && snap.evaluated && editableGuide(snap.project.model, snap.guide)) {
        const handle = snap.evaluated.result.handles.findIndex(
          (p) => distance(canvasToScreen(env.view(), p), e.screenPoint) <= 12,
        );
        if (handle === 0) {
          env.dialogs.notify('根元は頭に追従します。付け根の位置を変えるには、流れ線を描き直してください。');
          return;
        }
        if (handle > 0) {
          const guide = snap.guide;
          const forward = (points: Vec2[]) =>
            points.map((point) => {
              const edited = guide.points.map((p) => ({ ...p })) as CurveGuide['points'];
              edited[handle] = point;
              return evaluateCurveGuide(
                snap.project.model,
                snap.deltas,
                { ...guide, points: edited, enabled: true },
                snap.target!.mesh!,
                snap.raw!.positions,
              ).result.handles[handle]!;
            });
          drag = {
            live: beginLiveEdit(env.services.store, '流れ線を曲げる'),
            base: snap,
            index: handle,
            solve: createPointTargetMapper(forward, [guide.points[handle]!]),
            expected: snap.project,
            warned: false,
          };
        }
        return;
      }
      if (clickStart && !drawingValid(snap)) {
        clear();
        return;
      }
      drawOwner = { project: snap.project, partId: snap.target!.part.id, values: snap.editor.editorParamValues };
      stroke = clickStart ? [clickStart, e.canvasPoint] : [e.canvasPoint];
      env.requestRedraw();
    },
    onPointerMove(e) {
      const env = slot.get();
      if (!env) return;
      if (drag) {
        if (!draggingValid(env)) {
          clear();
          return;
        }
        const solved = drag.solve([e.canvasPoint]);
        if (!solved) {
          if (!drag.warned) env.dialogs.notify(INVERSE_ERROR);
          drag.warned = true;
          return;
        }
        const guide = drag.base.guide!;
        const points = guide.points.map((p) => ({ ...p })) as CurveGuide['points'];
        points[drag.index] = solved[0]!;
        drag.live.update(() => patchGuideCommand(guide.id, { points, enabled: true }));
        drag.expected = env.services.store.get();
        env.requestRedraw();
      } else if (stroke) {
        const snap = snapshot(env);
        if (!drawingValid(snap)) {
          clear();
          return;
        }
        if (distance(stroke.at(-1)!, e.canvasPoint) > 2 / env.view().scale) stroke.push(e.canvasPoint);
        env.requestRedraw();
      }
    },
    onPointerUp(e) {
      const env = slot.get();
      if (!env) return;
      if (drag) {
        if (!draggingValid(env)) {
          clear();
          return;
        }
        drag.live.commit();
        drag = null;
        return;
      }
      if (!stroke) return;
      if (!drawingValid(snapshot(env))) {
        clear();
        return;
      }
      if (stroke.length === 1 && !clickStart) {
        clickStart = stroke[0]!;
        stroke = null;
        env.requestRedraw();
        return;
      }
      const points = [...stroke, e.canvasPoint];
      stroke = null;
      finishStroke(env, points);
    },
    onKeyDown(e) {
      if (e.key === 'Escape') {
        clear();
        drawing = false;
        e.preventDefault();
      }
    },
    drawOverlay(ctx, view) {
      const env = slot.get();
      if (!env) return;
      const snap = snapshot(env);
      const result: CurveGuideResult | undefined = snap.evaluated?.result;
      const line = stroke ?? (clickStart ? [clickStart] : result?.curve);
      if (!line?.length) return;
      const screen = line.map((p) => canvasToScreen(view, p));
      const color = (name: string, fallback: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
      const accent = color('--accent', '#5b8def');
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (snap.guide && !stroke) {
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.1;
        ctx.lineWidth = snap.guide.radius * view.scale * 2;
        ctx.beginPath();
        screen.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = result?.status === 'stale' ? color('--danger', '#e5484d') : accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      screen.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      if (!stroke && result)
        result.handles.forEach((p, i) => {
          const at = canvasToScreen(view, p);
          ctx.beginPath();
          ctx.arc(at.x, at.y, i === 0 ? 4 : 6, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 ? color('--text-dim', '#9a9ea8') : accent;
          ctx.fill();
          ctx.fillStyle = color('--text', '#e6e7ea');
          ctx.font = '12px sans-serif';
          ctx.fillText(labels[i]!, at.x + 10, at.y - 9);
        });
      ctx.restore();
    },
  };

  function beginOptions() {
    const env = slot.get();
    if (!env || options) return;
    const snap = snapshot(env);
    if (!snap.guide || !editableGuide(snap.project.model, snap.guide)) return;
    options = {
      live: beginLiveEdit(env.services.store, '流れ線の影響範囲'),
      guideId: snap.guide.id,
      expected: snap.project,
    };
  }
  function endOptions() {
    options?.live.commit();
    options = null;
  }
  function setOption(patch: Partial<Pick<CurveGuide, 'radius' | 'rootFraction'>>) {
    beginOptions();
    const env = slot.get();
    if (!env || !options) return;
    if (env.services.store.get() !== options.expected) {
      options = null;
      return;
    }
    options.live.update(() => patchGuideCommand(options!.guideId, patch));
    options.expected = env.services.store.get();
    env.requestRedraw();
  }

  function bake() {
    const env = slot.get();
    if (!env) return Promise.resolve();
    const snap = snapshot(env);
    const guide = snap.guide;
    if (
      !guide?.enabled ||
      !snap.target?.mesh ||
      !snap.raw ||
      !snap.evaluated ||
      !editableGuide(snap.project.model, guide)
    )
      return Promise.resolve();
    const params = activeParams(snap.project.model, snap.editor);
    if (isBaseState(params) || isPreviewOffBase(snap.project.model, snap.editor)) {
      env.dialogs.notify(
        '編集するパラメータを選んで基準値以外の姿勢にしてください。プレビュー中の別の値は戻すか、編集対象に加えてください。',
      );
      return Promise.resolve();
    }
    const binding = findBinding(
      snap.project.model,
      { type: 'mesh', id: snap.target.mesh.id, channel: 'vertices' },
      params,
    );
    if (binding?.keys[keyIndexAt(binding, coordsOf(binding, params, 'value'))]?.locked) {
      env.dialogs.notify('現在の頂点キーはロックされています。記録する前にロックを解除してください。');
      return Promise.resolve();
    }
    const stillCurrent = () =>
      env.services.store.get() === snap.project &&
      env.services.editor.get().editorParamValues === snap.editor.editorParamValues &&
      env.services.editor.get().activeParameterIds === snap.editor.activeParameterIds &&
      env.services.editor.get().selectedPartIds[0] === guide.partId;
    const mesh = snap.target.mesh;
    const targets = itemPoints({ ...snap.raw, positions: snap.evaluated.positions });
    const moves = createMeshTargetMapper(
      snap.project.model,
      snap.deltas,
      guide.partId,
      mesh,
      mesh.vertices.map((_, i) => i),
    )(targets);
    if (!moves) {
      env.dialogs.notify(INVERSE_ERROR);
      return Promise.resolve();
    }
    if (moves.every((m) => Math.hypot(m.d.x, m.d.y) < 1e-6)) {
      env.dialogs.notify('この姿勢では記録する形の変更がありません。');
      return Promise.resolve();
    }
    const pointsTarget = { kind: 'mesh' as const, meshId: mesh.id };
    cancelBake?.();
    const keyed = startKeyedDrag({
      store: env.services.store,
      dialogs: {
        notify: env.dialogs.notify,
        confirm: async (message) => (await env.dialogs.confirm(message)) && stillCurrent(),
      },
      label: '流れ線の形をキーに記録',
      edit(project, changes: typeof moves) {
        if (!changes || project.id !== snap.project.id || !editableGuide(project.model, guide)) return null;
        const edit = env.services.keyEditor.pointsEdit(project, snap.editor, pointsTarget, changes);
        if (edit === 'needsKey') return edit;
        return {
          label: '流れ線の形をキーに記録',
          apply: (p) => {
            const edited = edit.apply(p);
            return edited === p
              ? p
              : patchGuideCommand(guide.id, {
                  enabled: false,
                  gravity: false,
                  points: guide.reference.map((q) => ({ ...q })) as CurveGuide['points'],
                }).apply(edited);
          },
        };
      },
      addKeys: (p) => env.services.keyEditor.addKeyAtCurrentValue(p, snap.editor, pointsTarget),
      onChange: () => env.requestRedraw(),
    });
    cancelBake = keyed.cancel;
    keyed.move(moves);
    keyed.release();
    pending = keyed.settled().finally(() => {
      if (cancelBake === keyed.cancel) cancelBake = null;
    });
    return pending;
  }

  return {
    tool,
    clear,
    snapshot: () => {
      const env = slot.get();
      return env ? snapshot(env) : null;
    },
    drawNew() {
      clear();
      drawing = true;
      slot.get()?.requestRedraw();
    },
    beginOptions,
    endOptions,
    setOption,
    bake,
    settled: () => pending,
  };
}

export type CurveEditor = ReturnType<typeof createCurveEditor>;
