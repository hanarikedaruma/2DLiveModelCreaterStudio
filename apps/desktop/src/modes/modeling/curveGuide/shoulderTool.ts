import { newId, type ShoulderCollider, type Vec2 } from '@app/schema';
import {
  createDeformPipeline,
  curveMeshSignature,
  evaluateShoulders,
  meshPointsToDisplay,
  shoulderHostReason,
} from '@app/core';
import type { CanvasTool } from '../../../shell/api';
import { canvasToScreen } from '../../../shell/canvas/view';
import type { EnvSlot } from '../canvas/env';
import { beginLiveEdit, type LiveEdit } from '../canvas/liveEdit';
import { distance } from '../canvas/geometry';
import { isLockedDeep, paramValuesOf } from '../canvas/parts';
import { createPointTargetMapper } from '../mesh/meshDrag';
import { editableCollider, patchColliderCommand, setColliderCommand } from './collisionCommands';

export function simplifyShoulder(points: Vec2[]): Vec2[] {
  const unique = points.filter((p, i) => i === 0 || distance(p, points[i - 1]!) > 1e-6);
  if (unique.length <= 2) return unique;
  const simplify = (list: Vec2[]): Vec2[] => {
    const a = list[0]!,
      b = list.at(-1)!;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length2 = dx * dx + dy * dy;
    let maximum = 0,
      index = 0;
    list.slice(1, -1).forEach((p, i) => {
      const t = length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
      const d = distance(p, { x: a.x + dx * t, y: a.y + dy * t });
      if (d > maximum) {
        maximum = d;
        index = i + 1;
      }
    });
    return maximum <= 2 ? [a, b] : [...simplify(list.slice(0, index + 1)).slice(0, -1), ...simplify(list.slice(index))];
  };
  const reduced = simplify(unique);
  if (reduced.length <= 8) return reduced;
  return Array.from({ length: 8 }, (_, i) => reduced[Math.round((i * (reduced.length - 1)) / 7)]!);
}

export function createShoulderEditor(slot: EnvSlot) {
  const pipeline = createDeformPipeline();
  let selected: string | null = null;
  let drawing: { partId: string; guideId: string; colliderId?: string } | null = null;
  let stroke: Vec2[] | null = null,
    start: Vec2 | null = null;
  let owner: { project: object; values: object; selection: object } | null = null;
  let drag: {
    live: LiveEdit;
    id: string;
    index: number;
    points: Vec2[];
    solve: (p: Vec2[]) => Vec2[] | null;
    expected: object;
    values: object;
    selection: object;
  } | null = null;
  function snapshot() {
    const env = slot.get();
    if (!env) return null;
    const project = env.services.store.get(),
      editor = env.services.editor.get();
    const raw = pipeline.deform(
      { ...project.model, curveGuides: [] },
      env.services.evaluator.evaluate(project.model, paramValuesOf(project.model, editor.editorParamValues)),
    );
    const collider = project.model.shoulderColliders?.find((c) => c.id === selected);
    const mesh = project.model.meshes.find(
      (m) => m.id === (collider?.meshId ?? project.model.parts.find((p) => p.id === drawing?.partId)?.meshId),
    );
    const item = raw.byPartId[collider?.partId ?? drawing?.partId ?? ''];
    return { env, project, editor, collider, mesh, item, shoulders: evaluateShoulders(project, raw) };
  }
  function clear() {
    drag?.live.cancel();
    drag = null;
    drawing = null;
    selected = null;
    stroke = start = null;
    owner = null;
    slot.get()?.requestRedraw();
  }
  function ownerValid() {
    const snap = snapshot();
    return (
      !!snap &&
      owner?.project === snap.project &&
      owner.values === snap.editor.editorParamValues &&
      owner.selection === snap.editor.selectedPartIds
    );
  }
  const tool: CanvasTool = {
    id: 'modeling.shoulder.internal',
    label: '肩の線',
    cursor: 'crosshair',
    onPointerDown(e) {
      const snap = snapshot();
      if (!snap || e.button !== 0) return;
      if (drawing) {
        if (
          !snap.mesh ||
          !snap.item ||
          shoulderHostReason(snap.project, drawing.partId) ||
          isLockedDeep(snap.project.model, drawing.partId)
        ) {
          clear();
          return;
        }
        if (start && !ownerValid()) {
          clear();
          return;
        }
        owner = {
          project: snap.project,
          values: snap.editor.editorParamValues,
          selection: snap.editor.selectedPartIds,
        };
        stroke = start ? [start, e.canvasPoint] : [e.canvasPoint];
      } else if (snap.collider && snap.mesh && snap.item && editableCollider(snap.project.model, snap.collider)) {
        const points = meshPointsToDisplay(snap.mesh, snap.item.positions, snap.collider.points);
        const index = points.findIndex((p) => distance(canvasToScreen(snap.env.view(), p), e.screenPoint) <= 12);
        if (index >= 0)
          drag = {
            live: beginLiveEdit(snap.env.services.store, '肩の点を動かす'),
            id: snap.collider.id,
            index,
            points: snap.collider.points.map((p) => ({ ...p })),
            solve: createPointTargetMapper(
              (p) => meshPointsToDisplay(snap.mesh!, snap.item!.positions, p),
              [snap.collider.points[index]!],
            ),
            expected: snap.project,
            values: snap.editor.editorParamValues,
            selection: snap.editor.selectedPartIds,
          };
      }
      snap.env.requestRedraw();
    },
    onPointerMove(e) {
      const snap = snapshot();
      if (!snap) return;
      if (drag) {
        if (
          snap.project !== drag.expected ||
          snap.editor.editorParamValues !== drag.values ||
          snap.editor.selectedPartIds !== drag.selection
        ) {
          clear();
          return;
        }
        const points = drag.solve([e.canvasPoint]);
        if (!points) return;
        const next = drag.points.map((p) => ({ ...p }));
        next[drag.index] = points[0]!;
        drag.live.update(() => patchColliderCommand(drag!.id, { points: next }));
        drag.expected = snap.env.services.store.get();
      } else if (stroke) {
        if (!ownerValid()) {
          clear();
          return;
        }
        if (distance(stroke.at(-1)!, e.canvasPoint) > 2 / snap.env.view().scale) stroke.push(e.canvasPoint);
      }
      snap.env.requestRedraw();
    },
    onPointerUp(e) {
      const snap = snapshot();
      if (!snap) return;
      if (drag) {
        if (
          snap.project !== drag.expected ||
          snap.editor.editorParamValues !== drag.values ||
          snap.editor.selectedPartIds !== drag.selection
        ) {
          clear();
          return;
        }
        drag.live.commit();
        drag = null;
        return;
      }
      if (!drawing || !stroke || !snap.mesh || !snap.item || !ownerValid()) {
        clear();
        return;
      }
      if (stroke.length === 1 && !start) {
        start = stroke[0]!;
        stroke = null;
        return;
      }
      const points = simplifyShoulder([...stroke, e.canvasPoint]);
      if (points.length < 2 || distance(points[0]!, points.at(-1)!) < 5 / snap.env.view().scale) return;
      const initial = points
        .map((p) =>
          snap.mesh!.vertices.reduce(
            (best, v, i) =>
              distance(p, { x: snap.item!.positions[i * 2]!, y: snap.item!.positions[i * 2 + 1]! }) <
              distance(p, { x: snap.item!.positions[best * 2]!, y: snap.item!.positions[best * 2 + 1]! })
                ? i
                : best,
            0,
          ),
        )
        .map((i) => snap.mesh!.vertices[i]!);
      const local = createPointTargetMapper(
        (p) => meshPointsToDisplay(snap.mesh!, snap.item!.positions, p),
        initial,
      )(points);
      if (!local) {
        snap.env.dialogs.notify('肩の取付先がつぶれています。体のキーやメッシュを確認してください。');
        return;
      }
      const previous = snap.project.model.shoulderColliders?.find((c) => c.id === drawing!.colliderId);
      const collider: ShoulderCollider = {
        id: previous?.id ?? newId(),
        name: previous?.name ?? `肩の線 ${(snap.project.model.shoulderColliders?.length ?? 0) + 1}`,
        partId: drawing.partId,
        meshId: snap.mesh.id,
        meshSignature: curveMeshSignature(snap.mesh),
        points: local,
        radius: previous?.radius ?? 5,
        enabled: previous?.enabled ?? true,
      };
      snap.env.services.store.dispatch(setColliderCommand(collider, drawing.guideId));
      selected = collider.id;
      drawing = null;
      stroke = start = null;
      owner = null;
      snap.env.requestRedraw();
    },
    onKeyDown(e) {
      if (e.key === 'Escape') {
        clear();
        e.preventDefault();
      }
    },
    drawOverlay(ctx, view) {
      const snap = snapshot();
      if (!snap) return;
      const contact = selected ? snap.shoulders.active.get(selected) : undefined;
      const line =
        stroke ??
        (start
          ? [start]
          : (contact?.points ??
            (snap.collider && snap.mesh && snap.item
              ? meshPointsToDisplay(snap.mesh, snap.item.positions, snap.collider.points)
              : [])));
      if (!line.length) return;
      const screen = line.map((p) => canvasToScreen(view, p));
      const style = getComputedStyle(document.documentElement);
      const color =
        style.getPropertyValue(selected && snap.shoulders.diagnostics.has(selected) ? '--danger' : '--accent').trim() ||
        '#5b8def';
      ctx.save();
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = (contact?.radius ?? snap.collider?.radius ?? 5) * view.scale * 2;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      screen.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (!stroke)
        screen.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        });
      ctx.restore();
    },
  };
  return {
    tool,
    clear,
    active: () => !!(drawing || selected),
    draw(partId: string, guideId: string, colliderId?: string) {
      clear();
      drawing = { partId, guideId, colliderId };
      slot.get()?.requestRedraw();
    },
    select(id: string | null) {
      clear();
      selected = id;
      slot.get()?.requestRedraw();
    },
  };
}
export type ShoulderEditor = ReturnType<typeof createShoulderEditor>;
