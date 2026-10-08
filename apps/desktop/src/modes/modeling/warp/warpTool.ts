// ワープ編集ツール（カード29）。選択中のグループのワープの格子を変形後の位置に描き、
// 制御点のドラッグを KeyEditor の pointsEdit（{kind: 'warp'}）で基準状態かキーに記録する。
// グループを選ぶまでは、枠が案内の帯とクリックでの選択を受け持つ（target）
import type { Model, Part, Vec2, Warp } from '@app/schema';
import type { DeformedModel, TargetDeltas, ViewTransform } from '@app/contracts';
import { isUsableWarp, pointsToModelSpace } from '@app/core';
import type { CanvasPointerEvent, CanvasTool } from '../../../shell/api';
import { drawCanvasBanner, drawPickOutline } from '../../../shell/canvas/banner';
import { canvasToScreen } from '../../../shell/canvas/view';
import type { EnvSlot, ToolEnv } from '../canvas/env';
import { applyLinear, distance, invert, type Affine } from '../canvas/geometry';
import { isPreviewOffBase } from '../../../services/keyEditor/common';
import { PREVIEW_OFF_BASE_MESSAGE, startKeyedDrag, type KeyedDrag } from '../canvas/liveEdit';
import { ancestorsOf, imagePartAt, paramValuesOf, partById } from '../canvas/parts';
import { nearestVertex, verticesInRect } from '../mesh/meshTool';
import { groupPart, pickWarpGroup, warpOfPart } from './warpOps';
import { WARP_PICK_PROMPT, warpGuide } from './warpGuide';

export const WARP_TOOL_ID = 'modeling.warp';

const DRAG_THRESHOLD = 3; // 画面のピクセル
export const GRID_SEGMENTS = 4; // 格子の1辺を何本の線分で描くか（祖先のワープで曲がるため）

// ---- 対象と表示の位置（純粋関数） ----

export interface WarpTarget {
  part: Part; // ワープの付いたグループ
  warp: Warp;
}

// 選択中のパーツのうち、ワープの付いた最初のグループ
export function warpTarget(model: Model, selectedIds: string[]): WarpTarget | null {
  for (const id of selectedIds) {
    const part = partById(model, id);
    if (part?.kind !== 'group') continue;
    const warp = warpOfPart(model, part.id);
    if (warp && isUsableWarp(warp)) return { part, warp };
  }
  return null;
}

// 制御点（基準 + 差分）。グループの空間（グループの変形を掛ける前）の位置
export function controlPoints(warp: Warp, deltas: TargetDeltas): Vec2[] {
  const d = Object.hasOwn(deltas.warpPoints, warp.id) ? deltas.warpPoints[warp.id] : undefined;
  if (!d || d.length !== warp.points.length * 2) return warp.points;
  return warp.points.map((p, k) => ({ x: p.x + d[k * 2]!, y: p.y + d[k * 2 + 1]! }));
}

// 制御点の見えている位置（グループの変形と、祖先のワープ・変形を掛けたキャンバス上の位置）
export function displayControlPoints(model: Model, deltas: TargetDeltas, target: WarpTarget): Vec2[] {
  return pointsToModelSpace(model, deltas, target.part.id, controlPoints(target.warp, deltas));
}

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// 格子の線（見えている位置の折れ線）。横の線（上から）のあとに縦の線（左から）。
// グループの空間では制御点の間はまっすぐなので、各辺を segments 本に分けてから祖先のワープ・変形を掛ける
export function gridPolylines(
  model: Model,
  deltas: TargetDeltas,
  target: WarpTarget,
  segments = GRID_SEGMENTS,
): Vec2[][] {
  const { warp } = target;
  const local = controlPoints(warp, deltas);
  const stride = warp.columns + 1;
  const at = (i: number, j: number) => local[j * stride + i]!;
  const line = (count: number, point: (k: number) => Vec2) => {
    const out: Vec2[] = [];
    for (let k = 0; k < count; k++) {
      const a = point(k);
      const b = point(k + 1);
      for (let s = 0; s < segments; s++) out.push(lerp(a, b, s / segments));
    }
    out.push(point(count));
    return out;
  };
  const lines: Vec2[][] = [];
  for (let j = 0; j <= warp.rows; j++) lines.push(line(warp.columns, (i) => at(i, j)));
  for (let i = 0; i <= warp.columns; i++) lines.push(line(warp.rows, (j) => at(i, j)));
  const mapped = pointsToModelSpace(model, deltas, target.part.id, lines.flat());
  let n = 0;
  return lines.map((l) => l.map(() => mapped[n++]!));
}

// キャンバス上の移動量を、制御点の空間（グループの変形を掛ける前）の移動量にする行列（制御点ごと）。
// 見えている位置への写像（グループの変形・祖先のワープと変形）の微分を差分で求めて逆にする。逆にできなければ null
export function canvasToWarpLinear(
  model: Model,
  deltas: TargetDeltas,
  target: WarpTarget,
  indices: number[],
): (Affine | null)[] {
  const local = controlPoints(target.warp, deltas);
  const { width, height } = target.warp.bounds;
  const h = Math.max(width, height, 1) * 1e-3;
  const probes: Vec2[] = [];
  for (const i of indices) {
    const p = local[i] ?? { x: 0, y: 0 };
    probes.push(p, { x: p.x + h, y: p.y }, { x: p.x, y: p.y + h });
  }
  const mapped = pointsToModelSpace(model, deltas, target.part.id, probes);
  return indices.map((_, n) => {
    const o = mapped[n * 3]!;
    const ex = mapped[n * 3 + 1]!;
    const ey = mapped[n * 3 + 2]!;
    return invert({ a: (ex.x - o.x) / h, b: (ex.y - o.y) / h, c: (ey.x - o.x) / h, d: (ey.y - o.y) / h, e: 0, f: 0 });
  });
}

// グループを選んでいる（1つだけ）、または格子の付いたグループを選んでいる。対象を選ぶ段かを決める
export function hasWarpGroup(model: Model, selectedIds: string[]): boolean {
  return (
    warpTarget(model, selectedIds) !== null || (selectedIds.length === 1 && groupPart(model, selectedIds[0]) !== null)
  );
}

// 選んでいるグループの子孫の画像の、変形後の外接矩形（画面座標）
function groupOutline(
  model: Model,
  deformed: DeformedModel | null,
  view: ViewTransform,
  groupId: string,
): { min: Vec2; max: Vec2 } | null {
  if (!deformed) return null;
  let min = { x: Infinity, y: Infinity };
  let max = { x: -Infinity, y: -Infinity };
  for (const item of deformed.items) {
    if (item.partId !== groupId && !ancestorsOf(model, item.partId).some((p) => p.id === groupId)) continue;
    for (let k = 0; k + 1 < item.positions.length; k += 2) {
      const p = canvasToScreen(view, { x: item.positions[k]!, y: item.positions[k + 1]! });
      min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y) };
      max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y) };
    }
  }
  return min.x <= max.x ? { min, max } : null;
}

// ---- 制御点の選択 ----

export interface PointSelection {
  warpId: string | null;
  indices: number[];
}

function createSelectionStore() {
  let state: PointSelection = { warpId: null, indices: [] };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: PointSelection) {
      state = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ---- ツール ----

type Move = { index: number; d: Vec2 };

type Drag =
  | {
      kind: 'points';
      start: Vec2;
      screenStart: Vec2;
      started: boolean;
      indices: number[];
      inverses: (Affine | null)[];
      keyed: KeyedDrag<Move[]>;
      blocked: boolean; // プレビューが基準状態と違う間は動かさない（I-046）
    }
  | { kind: 'rect'; start: Vec2; current: Vec2; screenStart: Vec2; moved: boolean; shift: boolean };

export interface WarpEditor {
  tool: CanvasTool;
  selection: { get(): PointSelection; subscribe(listener: () => void): () => void };
  clearSelection(): void;
  settled(): Promise<void>; // 確認の流れが終わるまで待つ（テスト用）
}

export function createWarpEditor(slot: EnvSlot): WarpEditor {
  const selection = createSelectionStore();
  let drag: Drag | null = null;
  let cache: { model: unknown; values: unknown; deltas: TargetDeltas } | null = null;

  const snapshot = (env: ToolEnv) => {
    const project = env.services.store.get();
    const editor = env.services.editor.get();
    if (!cache || cache.model !== project.model || cache.values !== editor.editorParamValues) {
      const params = paramValuesOf(project.model, editor.editorParamValues);
      cache = {
        model: project.model,
        values: editor.editorParamValues,
        deltas: env.services.evaluator.evaluate(project.model, params),
      };
    }
    const deltas = cache.deltas;
    const target = warpTarget(project.model, editor.selectedPartIds);
    const points = target ? displayControlPoints(project.model, deltas, target) : null;
    return { project, editor, deltas, target, points };
  };

  // 選択はいまのワープのものだけ（範囲外の番号は捨てる）
  const selectedOf = (warp: Warp | null) => {
    const s = selection.get();
    return warp && s.warpId === warp.id ? s.indices.filter((i) => i < warp.points.length) : [];
  };
  const select = (warpId: string | null, indices: number[]) => selection.set({ warpId, indices });

  const startPointDrag = (
    env: ToolEnv,
    snap: ReturnType<typeof snapshot>,
    e: CanvasPointerEvent,
    indices: number[],
  ) => {
    const { target, project, editor, deltas } = snap;
    if (!target) return;
    const { keyEditor, store } = env.services;
    const pointsTarget = { kind: 'warp' as const, warpId: target.warp.id };
    drag = {
      kind: 'points',
      start: e.canvasPoint,
      screenStart: e.screenPoint,
      started: false,
      indices,
      inverses: canvasToWarpLinear(project.model, deltas, target, indices),
      keyed: startKeyedDrag<Move[]>({
        store,
        dialogs: env.dialogs,
        label: '制御点の移動',
        edit: (p, moves) => {
          if (moves.every((m) => m.d.x === 0 && m.d.y === 0)) return null;
          return keyEditor.pointsEdit(p, editor, pointsTarget, moves);
        },
        addKeys: (p) => keyEditor.addKeyAtCurrentValue(p, editor, pointsTarget),
        onChange: () => env.requestRedraw(),
      }),
      blocked: isPreviewOffBase(project.model, editor),
    };
  };

  // 制御点とグループの選択を外し、グループを選ぶ段に戻る
  const deselectGroup = (env: ToolEnv) => {
    select(null, []);
    if (env.services.editor.get().selectedPartIds.length > 0) env.services.editor.set({ selectedPartIds: [] });
  };

  const tool: CanvasTool = {
    id: WARP_TOOL_ID,
    label: 'ワープ編集',
    level: 'detail', // ワープのパレットと同じく詳細でだけ出す（I-008）
    cursor: 'crosshair',
    target: {
      prompt: WARP_PICK_PROMPT,
      has: (project, editor) => hasWarpGroup(project.model, editor.selectedPartIds),
      pick: (project, deformed, p) => {
        const hit = imagePartAt(project.model, deformed, p);
        return hit ? pickWarpGroup(project.model, hit) : null;
      },
    },

    onPointerDown(e) {
      if (e.button !== 0) return;
      const env = slot.get();
      if (!env || (drag?.kind === 'points' && drag.keyed.active())) return;
      drag = null;
      const snap = snapshot(env);
      const { target, points } = snap;
      const hit = points ? nearestVertex(points, e.screenPoint, env.view()) : null;
      if (target && hit !== null) {
        const current = selectedOf(target.warp);
        if (e.shiftKey && current.includes(hit)) {
          select(
            target.warp.id,
            current.filter((i) => i !== hit),
          );
          return;
        }
        const indices = current.includes(hit) ? current : e.shiftKey ? [...current, hit] : [hit];
        select(target.warp.id, indices);
        startPointDrag(env, snap, e, indices);
        return;
      }
      drag = {
        kind: 'rect',
        start: e.canvasPoint,
        current: e.canvasPoint,
        screenStart: e.screenPoint,
        moved: false,
        shift: e.shiftKey,
      };
    },

    onPointerMove(e) {
      if (!drag) return;
      if (drag.kind === 'rect') {
        drag.current = e.canvasPoint;
        if (distance(e.screenPoint, drag.screenStart) >= DRAG_THRESHOLD) drag.moved = true;
        return;
      }
      if (!drag.keyed.active()) return;
      if (!drag.started) {
        if (distance(e.screenPoint, drag.screenStart) < DRAG_THRESHOLD) return;
        drag.started = true;
        // 表情を作っている途中などは、見えている形と違う基準状態を変えてしまうので動かさずに知らせる
        if (drag.blocked) slot.get()?.dialogs.notify(PREVIEW_OFF_BASE_MESSAGE);
      }
      if (drag.blocked) return;
      const delta = { x: e.canvasPoint.x - drag.start.x, y: e.canvasPoint.y - drag.start.y };
      const inverses = drag.inverses;
      drag.keyed.move(
        drag.indices.map((index, n) => {
          const inv = inverses[n];
          return { index, d: inv ? applyLinear(inv, delta) : delta };
        }),
      );
    },

    onPointerUp(e) {
      const env = slot.get();
      const current = drag;
      if (!current) return;
      if (current.kind === 'points') {
        current.keyed.release();
        if (!current.keyed.active()) drag = null;
        return;
      }
      drag = null;
      if (!env) return;
      const { project, editor, target, points } = snapshot(env);
      if (current.moved) {
        if (!target || !points) return;
        const inside = verticesInRect(points, current.start, e.canvasPoint);
        const base = current.shift ? selectedOf(target.warp) : [];
        select(target.warp.id, [...new Set([...base, ...inside])]);
        return;
      }
      if (current.shift) return;
      // クリック: 制御点の選択を外す。選んでいるグループの外のパーツを押したら、そのグループに切り替える
      const hadPoints = target ? selectedOf(target.warp).length > 0 : false;
      select(target?.warp.id ?? null, []);
      const model = project.model;
      const deformed = env.lastDeformed();
      const hit = deformed ? imagePartAt(model, deformed, e.canvasPoint) : null;
      const groupId = target?.part.id ?? (editor.selectedPartIds.length === 1 ? editor.selectedPartIds[0] : undefined);
      if (hit) {
        const inside = groupId !== undefined && ancestorsOf(model, hit).some((p) => p.id === groupId);
        const next = pickWarpGroup(model, hit);
        if (!inside && next !== groupId) {
          env.services.editor.set({ selectedPartIds: [next] });
          select(null, []);
        }
        return;
      }
      // 何も無い所: 1回目は制御点の選択だけを外し、制御点を選んでいなければグループの選択も外す
      if (!hadPoints) deselectGroup(env);
    },

    onContextClick() {
      const env = slot.get();
      if (!env || (drag?.kind === 'points' && drag.keyed.active())) return;
      drag = null;
      deselectGroup(env);
    },

    onKeyDown(e) {
      if (e.key !== 'Escape') return;
      const env = slot.get();
      // 1回目は制御点の選択を外し、制御点を選んでいなければグループの選択を外す
      if (drag?.kind === 'points' && drag.keyed.active()) drag.keyed.cancel();
      else if (selection.get().indices.length > 0) select(selection.get().warpId, []);
      else if (env) deselectGroup(env);
      drag = null;
    },

    drawOverlay(ctx, view) {
      const env = slot.get();
      if (!env) return;
      const snap = snapshot(env);
      const { target, points } = snap;
      const accent = cssVar('--accent', '#5b8def');
      const guide = warpGuide(snap.project, snap.editor);
      // 格子がまだ無いグループは、どのグループかが分かるように範囲を点線で囲む
      const ids = snap.editor.selectedPartIds;
      const group = !target && ids.length === 1 ? groupPart(snap.project.model, ids[0]) : null;
      const outline = group ? groupOutline(snap.project.model, env.lastDeformed(), view, group.id) : null;
      if (outline) drawPickOutline(ctx, outline.min, outline.max);
      if (guide) drawCanvasBanner(ctx, guide);
      if (target && points) {
        const toScreen = (p: Vec2) => canvasToScreen(view, p);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const line of gridPolylines(snap.project.model, snap.deltas, target)) {
          line.map(toScreen).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        const selected = new Set(selectedOf(target.warp));
        points.map(toScreen).forEach((p, i) => {
          const on = selected.has(i);
          const r = on ? 4.5 : 3.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = on ? accent : '#ffffff';
          ctx.fill();
          ctx.strokeStyle = on ? '#ffffff' : accent;
          ctx.stroke();
        });
      }
      if (drag?.kind === 'rect' && drag.moved) {
        const a = canvasToScreen(view, drag.start);
        const b = canvasToScreen(view, drag.current);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = accent;
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.setLineDash([]);
      }
    },
  };

  return {
    tool,
    selection: { get: selection.get, subscribe: selection.subscribe },
    clearSelection: () => select(null, []),
    settled: async () => {
      if (drag?.kind === 'points') await drag.keyed.settled();
    },
  };
}

function cssVar(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}
