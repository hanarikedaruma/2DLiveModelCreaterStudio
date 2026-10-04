// 選択・変形ツール（既定のツール）。クリックで選び、ドラッグで移動・回転・拡縮・ピボット移動をする
import type { Project, Vec2 } from '@app/schema';
import type { Command, EditorState, KeyEditor, TransformChange, ViewTransform } from '@app/contracts';
import type { CanvasPointerEvent, CanvasTool } from '../../../shell/api';
import { canvasToScreen } from '../../../shell/canvas/view';
import type { EnvSlot, ToolEnv } from './env';
import {
  angleBetween,
  applyAffine,
  boxContains,
  boxCorners,
  determinant,
  distance,
  handlePoint,
  hitTestItems,
  invert,
  isIdentityChange,
  moveDelta,
  pivotChange,
  rotateHandlePoint,
  scaleFactorFor,
  snapAngle,
  sub,
  SCALE_HANDLES,
  type ScaleHandle,
  type SelectionBox,
} from './geometry';
import { startKeyedDrag, type KeyedDrag } from './liveEdit';
import {
  ancestorsOf,
  isLockedDeep,
  paramValuesOf,
  selectionInfo,
  type SelectionInfo,
  type TargetPose,
  type Transforms,
} from './parts';

export const SELECT_TOOL_ID = 'modeling.select';

export const HANDLE_RADIUS = 7; // 画面のピクセル
export const ROTATE_HANDLE_DISTANCE = 24; // 画面のピクセル
const DRAG_THRESHOLD = 3; // これより小さい動きはクリックとみなす

export type DragKind = 'move' | 'rotate' | 'scale' | 'pivot';
export type PartChange = { partId: string; change: TransformChange };

const LABELS: Record<DragKind, string> = {
  move: 'パーツの移動',
  rotate: 'パーツの回転',
  scale: 'パーツの拡縮',
  pivot: 'ピボットの移動',
};

// ---- ハンドル（画面座標） ----

export interface Handles {
  outline: Vec2[] | null; // 枠の四隅
  topCenter: Vec2 | null;
  rotate: Vec2 | null;
  scale: { handle: ScaleHandle; at: Vec2 }[];
  pivot: Vec2 | null; // 主のパーツのピボット
  pivotMovable: boolean;
  otherPivots: Vec2[]; // ほかの選択中のパーツのピボット
  compact: boolean; // 枠が画面上で小さい。中を押したら移動にするため、ピボットと拡縮のハンドルはつかまない
}

export function computeHandles(info: SelectionInfo, view: ViewTransform, pivotMovable: boolean): Handles | null {
  const primary = info.targets[0];
  if (!primary) return null;
  const toScreen = (p: Vec2) => canvasToScreen(view, p);
  const box = info.box;
  const corners = box ? boxCorners(box).map(toScreen) : null;
  // 短い辺がハンドル4つ分より短いと、ハンドルが枠の中をほとんど覆って移動できなくなる（全体表示の瞳など）
  const compact =
    corners !== null &&
    Math.min(distance(corners[0]!, corners[1]!), distance(corners[1]!, corners[2]!)) < 8 * HANDLE_RADIUS;
  return {
    compact,
    outline: corners,
    topCenter: box ? toScreen(applyAffine(box.frame, handlePoint(box, 'n'))) : null,
    rotate: box ? toScreen(rotateHandlePoint(box, ROTATE_HANDLE_DISTANCE / view.scale)) : null,
    scale: box
      ? SCALE_HANDLES.map((handle) => ({ handle, at: toScreen(applyAffine(box.frame, handlePoint(box, handle))) }))
      : [],
    pivot: toScreen(primary.pivot),
    pivotMovable,
    otherPivots: info.targets.slice(1).map((t) => toScreen(t.pivot)),
  };
}

export type HandleHit = { kind: 'pivot' } | { kind: 'rotate' } | { kind: 'scale'; handle: ScaleHandle };

export function hitHandle(h: Handles, screen: Vec2, radius = HANDLE_RADIUS): HandleHit | null {
  if (h.rotate && distance(h.rotate, screen) <= radius) return { kind: 'rotate' };
  if (h.compact) return null;
  if (h.pivotMovable && h.pivot && distance(h.pivot, screen) <= radius) return { kind: 'pivot' };
  let best: { handle: ScaleHandle; d: number } | null = null;
  for (const s of h.scale) {
    const d = distance(s.at, screen);
    if (d <= radius && (!best || d < best.d)) best = { handle: s.handle, d };
  }
  return best ? { kind: 'scale', handle: best.handle } : null;
}

// ---- ドラッグの変更 ----

export interface DragInput {
  kind: DragKind;
  handle: ScaleHandle | null;
  targets: TargetPose[];
  box: SelectionBox | null;
  start: Vec2; // キャンバス座標
  current: Vec2;
  angle: number; // 回転の累計（度）
  keepAspect: boolean;
}

// ドラッグ開始からの変更をパーツごとに求める
export function dragChanges(d: DragInput): PartChange[] {
  const delta = sub(d.current, d.start);
  switch (d.kind) {
    case 'move':
      return d.targets.map((t) => ({ partId: t.partId, change: { dPosition: moveDelta(t.parent, delta) } }));
    case 'rotate':
      // 親が裏返っていると見た目の回転の向きが逆になる
      return d.targets.map((t) => ({
        partId: t.partId,
        change: { dRotation: determinant(t.parent) < 0 ? -d.angle : d.angle },
      }));
    case 'scale': {
      const inv = d.box ? invert(d.box.frame) : null;
      if (!inv || !d.handle) return [];
      const factor = scaleFactorFor(d.handle, applyAffine(inv, d.start), applyAffine(inv, d.current), d.keepAspect);
      return d.targets.map((t) => ({ partId: t.partId, change: { scaleFactor: factor } }));
    }
    case 'pivot': {
      const t = d.targets[0];
      const change = t ? pivotChange(t.parent, t.pose, delta) : null;
      return t && change ? [{ partId: t.partId, change }] : [];
    }
  }
}

// パーツごとに keyEditor.transformEdit を呼び、まとめて1つのコマンドにする
export function transformCommand(
  keyEditor: KeyEditor,
  project: Project,
  editor: EditorState,
  changes: PartChange[],
  label: string,
): Command | 'needsKey' | null {
  let p = project;
  const commands: Command[] = [];
  for (const { partId, change } of changes) {
    if (isIdentityChange(change)) continue;
    const command = keyEditor.transformEdit(p, editor, [partId], change);
    if (command === 'needsKey') return 'needsKey';
    commands.push(command);
    p = command.apply(p);
  }
  if (commands.length === 0) return null;
  return { label, apply: (q) => commands.reduce((acc, c) => c.apply(acc), q) };
}

// 動かすパーツすべてに、いまの値のキーを足す（キーがすでにあるパーツでは何もしない、という KeyEditor の約束）
export function addKeysCommand(
  keyEditor: KeyEditor,
  project: Project,
  editor: EditorState,
  changes: PartChange[],
): Command {
  let p = project;
  const commands: Command[] = [];
  for (const { partId } of changes) {
    const add = keyEditor.addKeyAtCurrentValue(p, editor, { partId });
    commands.push(add);
    p = add.apply(p);
  }
  return { label: 'キーの追加', apply: (q) => commands.reduce((acc, c) => c.apply(acc), q) };
}

// ---- 描画 ----

function cssVar(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

function drawPivot(ctx: CanvasRenderingContext2D, p: Vec2, r: number, color: string, alpha: number) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawHandles(ctx: CanvasRenderingContext2D, h: Handles): void {
  const accent = cssVar('--accent', '#5b8def');
  const fill = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeStyle = accent;
  if (h.outline) {
    ctx.beginPath();
    h.outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
  }
  if (h.topCenter && h.rotate) {
    ctx.beginPath();
    ctx.moveTo(h.topCenter.x, h.topCenter.y);
    ctx.lineTo(h.rotate.x, h.rotate.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(h.rotate.x, h.rotate.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  }
  const s = 4;
  for (const { at } of h.scale) {
    ctx.fillStyle = fill;
    ctx.fillRect(at.x - s, at.y - s, s * 2, s * 2);
    ctx.strokeRect(at.x - s, at.y - s, s * 2, s * 2);
  }
  for (const p of h.otherPivots) drawPivot(ctx, p, 5, accent, 0.6);
  // 動かせないとき（パラメータ編集中）は薄く出す
  if (h.pivot) drawPivot(ctx, h.pivot, 7, '#ff9f1c', h.pivotMovable ? 1 : 0.45);
}

// ---- ツール ----

interface Drag {
  kind: DragKind;
  handle: ScaleHandle | null;
  start: Vec2;
  screenStart: Vec2;
  started: boolean;
  last: Vec2;
  angle: number;
  targets: TargetPose[];
  box: SelectionBox | null;
  keyed: KeyedDrag<PartChange[]>;
  clickSelect: string[] | null; // 動かさずに離したら、この選択にする
}

export interface SelectTool {
  tool: CanvasTool;
  settled(): Promise<void>; // 確認の流れが終わるまで待つ（テスト用）
}

export function createSelectTool(slot: EnvSlot): SelectTool {
  let drag: Drag | null = null;
  let cache: { model: unknown; values: unknown; transforms: Transforms } | null = null;

  const snapshot = (env: ToolEnv) => {
    const project = env.services.store.get();
    const editor = env.services.editor.get();
    if (!cache || cache.model !== project.model || cache.values !== editor.editorParamValues) {
      const params = paramValuesOf(project.model, editor.editorParamValues);
      cache = {
        model: project.model,
        values: editor.editorParamValues,
        transforms: env.services.evaluator.evaluate(project.model, params).transforms,
      };
    }
    const info = selectionInfo(project.model, cache.transforms, env.lastDeformed(), editor.selectedPartIds);
    return { project, editor, info };
  };

  // ピボットの移動は、編集中のパラメータが無く、1つだけ選んでいるときだけ
  const pivotMovable = (editor: EditorState, info: SelectionInfo) =>
    editor.activeParameterIds.length === 0 && info.targets.length === 1;

  const startDrag = (
    env: ToolEnv,
    kind: DragKind,
    handle: ScaleHandle | null,
    e: CanvasPointerEvent,
    info: SelectionInfo,
    editor: EditorState,
  ): Drag | null => {
    if (info.targets.length === 0) return null;
    const { keyEditor, store } = env.services;
    const label = LABELS[kind];
    const next: Drag = {
      kind,
      handle,
      start: e.canvasPoint,
      screenStart: e.screenPoint,
      started: false,
      last: e.canvasPoint,
      angle: 0,
      targets: info.targets,
      box: info.box,
      keyed: startKeyedDrag<PartChange[]>({
        store,
        dialogs: env.dialogs,
        label,
        edit: (project, changes) => transformCommand(keyEditor, project, editor, changes, label),
        addKeys: (project, changes) => addKeysCommand(keyEditor, project, editor, changes),
        onChange: () => env.requestRedraw(),
      }),
      clickSelect: null,
    };
    drag = next;
    return next;
  };

  const tool: CanvasTool = {
    id: SELECT_TOOL_ID,
    label: '選択・変形',
    cursor: 'default',

    onPointerDown(e) {
      if (e.button !== 0) return;
      const env = slot.get();
      if (!env || drag?.keyed.active()) return; // 確認の途中は受け付けない
      drag = null;
      const { project, editor, info } = snapshot(env);
      const handles = computeHandles(info, env.view(), pivotMovable(editor, info));
      const hit = handles ? hitHandle(handles, e.screenPoint) : null;
      if (hit) {
        startDrag(env, hit.kind, hit.kind === 'scale' ? hit.handle : null, e, info, editor);
        return;
      }

      const model = project.model;
      const deformed = env.lastDeformed();
      const hitId = deformed ? hitTestItems(deformed, e.canvasPoint, (id) => !isLockedDeep(model, id)) : null;
      const selected = editor.selectedPartIds;
      const select = (ids: string[]) => env.services.editor.set({ selectedPartIds: ids });
      if (hitId) {
        if (e.shiftKey && selected.includes(hitId)) {
          select(selected.filter((id) => id !== hitId));
          return;
        }
        // 選んでいるグループの中を押したときは、そのグループを動かす
        const inSelection = selected.includes(hitId) || ancestorsOf(model, hitId).some((p) => selected.includes(p.id));
        if (!inSelection) select(e.shiftKey ? [...selected, hitId] : [hitId]);
        const next = snapshot(env);
        const started = startDrag(env, 'move', null, e, next.info, next.editor);
        // 複数を選んでいるときに、そのうちの1つをクリックしただけなら、それだけを選ぶ
        if (started && !e.shiftKey && selected.includes(hitId) && selected.length > 1) started.clickSelect = [hitId];
        return;
      }
      if (info.box && boxContains(info.box, e.canvasPoint)) {
        startDrag(env, 'move', null, e, info, editor);
        return;
      }
      if (!e.shiftKey && selected.length > 0) select([]);
    },

    onPointerMove(e) {
      if (!drag || !drag.keyed.active()) return;
      if (!drag.started) {
        if (distance(e.screenPoint, drag.screenStart) < DRAG_THRESHOLD) return;
        drag.started = true;
      }
      if (drag.kind === 'rotate') {
        const center = drag.targets[0]?.pivot;
        if (center) drag.angle += angleBetween(center, drag.last, e.canvasPoint);
      }
      drag.last = e.canvasPoint;
      drag.keyed.move(
        dragChanges({
          kind: drag.kind,
          handle: drag.handle,
          targets: drag.targets,
          box: drag.box,
          start: drag.start,
          current: e.canvasPoint,
          angle: drag.kind === 'rotate' && e.shiftKey ? snapAngle(drag.angle) : drag.angle,
          keepAspect: e.shiftKey,
        }),
      );
    },

    onPointerUp() {
      if (!drag) return;
      const clicked = !drag.started ? drag.clickSelect : null;
      drag.keyed.release();
      if (!drag.keyed.active()) drag = null;
      if (clicked) slot.get()?.services.editor.set({ selectedPartIds: clicked });
    },

    onKeyDown(e) {
      if (e.key !== 'Escape') return;
      const env = slot.get();
      if (drag?.keyed.active()) {
        drag.keyed.cancel();
        drag = null;
      } else if (env && env.services.editor.get().selectedPartIds.length > 0) {
        env.services.editor.set({ selectedPartIds: [] });
      }
    },

    drawOverlay(ctx, view) {
      const env = slot.get();
      if (!env) return;
      const { editor, info } = snapshot(env);
      const handles = computeHandles(info, view, pivotMovable(editor, info));
      if (handles) drawHandles(ctx, handles);
    },
  };

  return { tool, settled: () => drag?.keyed.settled() ?? Promise.resolve() };
}
