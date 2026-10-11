// 選択・変形ツール（既定のツール）。クリックで選び、ドラッグで移動・回転・拡縮・ピボット移動をする
import type { Model, Project, Vec2 } from '@app/schema';
import type { Command, EditorState, KeyEditor, TransformChange, ViewTransform } from '@app/contracts';
import type { CanvasPointerEvent, CanvasTool } from '../../../shell/api';
import { canvasToScreen } from '../../../shell/canvas/view';
import { isPreviewOffBase } from '../../../services/keyEditor/common';
import type { EnvSlot, ToolEnv } from './env';
import {
  angleBetween,
  applyAffine,
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
import { PREVIEW_OFF_BASE_MESSAGE, startKeyedDrag, type KeyedDrag } from './liveEdit';
import { RANGE_MARGIN, drawSwitchHint, nearPolygon } from './targetRange';
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

export const HANDLE_RADIUS = 7; // 画面のピクセル。小さい枠の判定の基準
// 回転・拡縮のハンドルと◎をつかめる範囲（画面のピクセル）。描いた印より広くする（I-049。◎も I-069 で同じにした）
export const HANDLE_GRAB_RADIUS = 11;
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

export function hitHandle(h: Handles, screen: Vec2): HandleHit | null {
  if (h.rotate && distance(h.rotate, screen) <= HANDLE_GRAB_RADIUS) return { kind: 'rotate' };
  if (h.compact) return null;
  if (h.pivotMovable && h.pivot && distance(h.pivot, screen) <= HANDLE_GRAB_RADIUS) return { kind: 'pivot' };
  let best: { handle: ScaleHandle; d: number } | null = null;
  for (const s of h.scale) {
    const d = distance(s.at, screen);
    if (d <= HANDLE_GRAB_RADIUS && (!best || d < best.d)) best = { handle: s.handle, d };
  }
  return best ? { kind: 'scale', handle: best.handle } : null;
}

// 選んでいるものの操作範囲（枠・◎・回転のハンドル）と、そのまわりの余白の中か（I-069）。
// この中を押したときは、手前や後ろに別のパーツがあっても切り替えず、選んでいるものを操作する
export function inOperationRange(h: Handles, screen: Vec2, margin = RANGE_MARGIN): boolean {
  if (h.outline && nearPolygon(h.outline, screen, margin)) return true;
  if (h.rotate && distance(h.rotate, screen) <= HANDLE_GRAB_RADIUS) return true;
  if (h.pivot && distance(h.pivot, screen) <= margin) return true;
  return h.otherPivots.some((p) => distance(p, screen) <= margin);
}

// 拡縮のハンドルの上のマウスの形。枠の中心からハンドルへの向き（画面）に合わせる
export function scaleCursor(h: Handles, handle: ScaleHandle): string {
  const at = h.scale.find((s) => s.handle === handle)?.at;
  if (!at || !h.outline) return 'move';
  const c = {
    x: h.outline.reduce((sum, q) => sum + q.x, 0) / h.outline.length,
    y: h.outline.reduce((sum, q) => sum + q.y, 0) / h.outline.length,
  };
  const angle = ((((Math.atan2(at.y - c.y, at.x - c.x) * 180) / Math.PI) % 180) + 180) % 180;
  if (angle < 22.5 || angle >= 157.5) return 'ew-resize';
  if (angle < 67.5) return 'nwse-resize';
  if (angle < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

const sameHandle = (a: HandleHit | null, kind: HandleHit['kind'], handle?: ScaleHandle) =>
  a?.kind === kind && (a.kind !== 'scale' || a.handle === handle);

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

// hot は、いまつかめる（マウスが乗っている・ドラッグしている）ハンドル。少し大きく、塗りの色を変えて描く（I-049）
export function drawHandles(ctx: CanvasRenderingContext2D, h: Handles, hot: HandleHit | null = null): void {
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
    const isHot = sameHandle(hot, 'rotate');
    ctx.beginPath();
    ctx.moveTo(h.topCenter.x, h.topCenter.y);
    ctx.lineTo(h.rotate.x, h.rotate.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(h.rotate.x, h.rotate.y, isHot ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = isHot ? accent : fill;
    ctx.fill();
    ctx.stroke();
  }
  for (const { handle, at } of h.scale) {
    const isHot = sameHandle(hot, 'scale', handle);
    const s = isHot ? 6 : 4;
    ctx.fillStyle = isHot ? accent : fill;
    ctx.fillRect(at.x - s, at.y - s, s * 2, s * 2);
    ctx.strokeRect(at.x - s, at.y - s, s * 2, s * 2);
  }
  for (const p of h.otherPivots) drawPivot(ctx, p, 5, accent, 0.6);
  // 動かせないとき（パラメータ編集中・値だけがデフォルト値でない間）は薄く出す
  if (h.pivot) drawPivot(ctx, h.pivot, sameHandle(hot, 'pivot') ? 9 : 7, '#ff9f1c', h.pivotMovable ? 1 : 0.45);
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
  blocked: boolean; // 基準状態と見た目が違うので動かさない（I-029）。クリックでの選択はする
  cursor: string; // ドラッグ中のマウスの形
}

export interface SelectTool {
  tool: CanvasTool;
  settled(): Promise<void>; // 確認の流れが終わるまで待つ（テスト用）
}

export function createSelectTool(slot: EnvSlot): SelectTool {
  let drag: Drag | null = null;
  let hover: Vec2 | null = null; // 最後のマウスの位置（画面座標）。つかめるハンドルを強調して描くため
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

  // ピボットの移動は、編集中のパラメータが無く、1つだけ選んでいるときだけ（値だけがデフォルト値でない間も動かせない）
  const pivotMovable = (model: Model, editor: EditorState, info: SelectionInfo) =>
    editor.activeParameterIds.length === 0 && info.targets.length === 1 && !isPreviewOffBase(model, editor);

  // 強調するハンドル: ドラッグ中はつかんだもの、そうでなければマウスの下でつかめるもの
  const hotHandle = (handles: Handles): HandleHit | null => {
    if (drag?.keyed.active()) {
      if (drag.kind === 'scale' && drag.handle) return { kind: 'scale', handle: drag.handle };
      return drag.kind === 'rotate' || drag.kind === 'pivot' ? { kind: drag.kind } : null;
    }
    return hover ? hitHandle(handles, hover) : null;
  };

  const startDrag = (
    env: ToolEnv,
    kind: DragKind,
    handle: ScaleHandle | null,
    e: CanvasPointerEvent,
    info: SelectionInfo,
    editor: EditorState,
    cursor = kind === 'move' ? 'move' : 'grabbing',
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
      blocked: isPreviewOffBase(store.get().model, editor),
      cursor,
    };
    drag = next;
    return next;
  };

  // 押した所が、選んでいるパーツか、選んでいるグループの中のパーツか
  const inSelection = (model: Model, selected: readonly string[], id: string) =>
    selected.includes(id) || ancestorsOf(model, id).some((p) => selected.includes(p.id));

  const tool: CanvasTool = {
    id: SELECT_TOOL_ID,
    label: '選択・変形',
    cursor: 'default',

    onPointerDown(e) {
      hover = e.screenPoint;
      if (e.button !== 0) return;
      const env = slot.get();
      if (!env || drag?.keyed.active()) return; // 確認の途中は受け付けない
      drag = null;
      const { project, editor, info } = snapshot(env);
      const handles = computeHandles(info, env.view(), pivotMovable(project.model, editor, info));
      const hit = handles && !e.ctrlKey ? hitHandle(handles, e.screenPoint) : null;
      if (hit) {
        const cursor = hit.kind === 'scale' && handles ? scaleCursor(handles, hit.handle) : 'grabbing';
        startDrag(env, hit.kind, hit.kind === 'scale' ? hit.handle : null, e, info, editor, cursor);
        return;
      }

      const model = project.model;
      const deformed = env.lastDeformed();
      const hitId = deformed ? hitTestItems(deformed, e.canvasPoint, (id) => !isLockedDeep(model, id)) : null;
      const selected = editor.selectedPartIds;
      const select = (ids: string[]) => env.services.editor.set({ selectedPartIds: ids });
      // Ctrl+クリック: 操作範囲の中でも、押した所のパーツへ切り替える。選ぶだけで動かさない（I-069）
      if (e.ctrlKey) {
        select(hitId ? [hitId] : []);
        return;
      }
      // 操作範囲（枠・◎・回転のハンドル）と余白の中は、選んでいるものの操作。
      // 手前や後ろに別のパーツがあっても切り替えない（I-069）
      const inRange = info.targets.length > 0 && handles !== null && inOperationRange(handles, e.screenPoint);
      if (hitId) {
        if (e.shiftKey && selected.includes(hitId)) {
          select(selected.filter((id) => id !== hitId));
          return;
        }
        // 余白より外の別のパーツは、そのパーツへ切り替える（Shift は範囲の中でも足す）
        if (!inSelection(model, selected, hitId) && (e.shiftKey || !inRange)) {
          select(e.shiftKey ? [...selected, hitId] : [hitId]);
          // 選んでいる状態から別のパーツを選んだ最初の操作は、選ぶだけにする（I-050）
          if (selected.length > 0) return;
          const next = snapshot(env);
          startDrag(env, 'move', null, e, next.info, next.editor);
          return;
        }
      }
      // 範囲の中・選んでいるパーツ（グループなら中のパーツ）の上: 選んでいるものを動かす
      if (inRange || (hitId !== null && inSelection(model, selected, hitId))) {
        const started = startDrag(env, 'move', null, e, info, editor);
        // 複数を選んでいるときに、そのうちの1つをクリックしただけなら、それだけを選ぶ
        if (started && hitId && !e.shiftKey && selected.includes(hitId) && selected.length > 1)
          started.clickSelect = [hitId];
        return;
      }
      if (!e.shiftKey && selected.length > 0) select([]);
    },

    // マウスの形（I-069）: 範囲の中は移動、拡縮のハンドルは向きに合った矢印、回転のハンドルと◎はつかむ形、外は既定
    cursorAt(e) {
      const env = slot.get();
      if (!env) return null;
      if (drag?.keyed.active() && !drag.blocked) return drag.cursor;
      if (e.ctrlKey) return null;
      const { project, editor, info } = snapshot(env);
      if (info.targets.length === 0) return null;
      const handles = computeHandles(info, env.view(), pivotMovable(project.model, editor, info));
      if (!handles) return null;
      const hit = hitHandle(handles, e.screenPoint);
      if (hit?.kind === 'scale') return scaleCursor(handles, hit.handle);
      if (hit) return 'grab';
      return inOperationRange(handles, e.screenPoint) ? 'move' : null;
    },

    onPointerMove(e) {
      hover = e.screenPoint;
      if (!drag || !drag.keyed.active()) return;
      if (!drag.started) {
        if (distance(e.screenPoint, drag.screenStart) < DRAG_THRESHOLD) return;
        drag.started = true;
        // 表情を作っている途中などは、見えている形と違う基準状態を変えてしまうので動かさずに知らせる
        if (drag.blocked) slot.get()?.dialogs.notify(PREVIEW_OFF_BASE_MESSAGE);
      }
      if (drag.blocked) return;
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
      const { project, editor, info } = snapshot(env);
      const handles = computeHandles(info, view, pivotMovable(project.model, editor, info));
      if (handles) drawHandles(ctx, handles, hotHandle(handles));
      // 余白より外で別のパーツの上にマウスがあるとき、押すと切り替わる先を点線と名前で出す（I-069）
      if (!drag?.keyed.active() && hover && handles && info.targets.length > 0 && !inOperationRange(handles, hover)) {
        const model = project.model;
        const deformed = env.lastDeformed();
        const at = { x: (hover.x - view.offset.x) / view.scale, y: (hover.y - view.offset.y) / view.scale };
        const other = deformed ? hitTestItems(deformed, at, (id) => !isLockedDeep(model, id)) : null;
        if (other && !inSelection(model, editor.selectedPartIds, other))
          drawSwitchHint(ctx, model, deformed, view, other);
      }
      // 動かせない中心にも説明を出す。ドラッグの判定や中心の移動量は変えない。
      if (!drag?.keyed.active() && handles?.pivot && hover && distance(handles.pivot, hover) <= HANDLE_GRAB_RADIUS) {
        const message = isPreviewOffBase(project.model, editor)
          ? '回転中心（プレビュー中は移せない。値をすべて戻す）'
          : editor.activeParameterIds.length > 0
            ? '回転中心（パラメータ編集中は移せない）'
            : info.targets.length !== 1
              ? '回転中心（1つのパーツを選ぶと移せる）'
              : handles.compact
                ? '回転中心（拡大するとつかめる）'
                : '回転中心（ドラッグで移す）';
        ctx.save();
        ctx.font = '12px sans-serif';
        ctx.textBaseline = 'middle';
        const canvasWidth = ctx.canvas?.clientWidth || ctx.canvas?.width || Infinity;
        const canvasHeight = ctx.canvas?.clientHeight || ctx.canvas?.height || Infinity;
        const maxTextWidth = Math.max(12, canvasWidth - 24);
        const lines: string[] = [];
        let line = '';
        for (const char of message) {
          if (line && ctx.measureText(line + char).width > maxTextWidth) {
            lines.push(line);
            line = '';
          }
          line += char;
        }
        if (line) lines.push(line);
        const width = Math.max(...lines.map((text) => ctx.measureText(text).width)) + 16;
        const height = lines.length * 18 + 8;
        const x = Math.max(4, Math.min(hover.x + 14, canvasWidth - width - 4));
        const y = Math.max(4, Math.min(hover.y + 14, canvasHeight - height - 4));
        ctx.fillStyle = cssVar('--bg-raised', '#303238');
        ctx.fillRect(x, y, width, height);
        ctx.fillStyle = cssVar('--text', '#eeeeee');
        lines.forEach((text, i) => ctx.fillText(text, x + 8, y + 13 + i * 18));
        ctx.restore();
      }
    },
  };

  return { tool, settled: () => drag?.keyed.settled() ?? Promise.resolve() };
}
