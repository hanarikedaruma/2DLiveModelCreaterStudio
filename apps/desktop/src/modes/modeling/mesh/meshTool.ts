// メッシュ編集ツール。選択中の画像パーツのワイヤーフレームを描き、頂点の移動・矩形選択・追加・削除・自動生成をする
import type { Mesh, Model, Part, Project, Vec2 } from '@app/schema';
import type { DeformedModel, TargetDeltas, ViewTransform } from '@app/contracts';
import { pointsToModelSpace } from '@app/core';
import type { CanvasPointerEvent, CanvasTool } from '../../../shell/api';
import { canvasToScreen } from '../../../shell/canvas/view';
import type { EnvSlot, ToolEnv } from '../canvas/env';
import { applyAffine, distance, hitTestItems, invert, itemPoints, pointInTriangle } from '../canvas/geometry';
import { isPreviewOffBase } from '../../../services/keyEditor/common';
import { meshKeySpace } from '../../../services/keyEditor/points';
import { PREVIEW_OFF_BASE_MESSAGE, startKeyedDrag, type KeyedDrag } from '../canvas/liveEdit';
import { imagePartAt, isLockedDeep, paramValuesOf, partById, partMatrix } from '../canvas/parts';
import { addVertex, markEditedIfChanged, remeshCommand, removeVertices } from './meshOps';
import { densityOf, generateShape, regenerateOutcome, reshapeWithTransfer, type ReshapeOutcome } from './remesh';
import { createMeshDragMapper, meshLocalPositions, type MeshMove } from './meshDrag';

export const MESH_TOOL_ID = 'modeling.mesh';
export const MESH_PICK_PROMPT = 'メッシュを編集する画像パーツを、キャンバスでクリックして選ぶ';

export const VERTEX_RADIUS = 7; // 画面のピクセル
export const SOFT_RADIUS_MAX = 200; // 「まわりも動かす」幅の上限（キャンバスの px）
export const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_DISTANCE = 6;
const DRAG_THRESHOLD = 3;
const INVERSE_FAILED_MESSAGE =
  '変形を逆算できないため、頂点を移動できません。ワープの潰れやパーツの拡縮を確認してください。';

// ---- 対象と表示の位置（純粋関数） ----

export interface MeshTarget {
  part: Part;
  mesh: Mesh | null;
}

// 選択中の最初の画像パーツ
export function meshTarget(model: Model, selectedIds: string[]): MeshTarget | null {
  for (const id of selectedIds) {
    const part = partById(model, id);
    if (part?.kind !== 'image') continue;
    return { part, mesh: (part.meshId && model.meshes.find((m) => m.id === part.meshId)) || null };
  }
  return null;
}

// 頂点の見えている位置。変形の結果（lastDeformed）の頂点がメッシュと同じ数ならそれを使う。
// 合わないときは、頂点の差分と自身・親の変形・ワープから求める
export function displayPositions(
  model: Model,
  deltas: TargetDeltas,
  deformed: DeformedModel | null,
  part: Part,
  mesh: Mesh,
): Vec2[] {
  const item = deformed?.byPartId[part.id];
  if (item && item.positions.length === mesh.vertices.length * 2) return itemPoints(item);
  const global = deltas.modelVertices?.[mesh.id];
  return pointsToModelSpace(model, deltas, part.id, meshLocalPositions(mesh, deltas)).map((p, i) => ({
    x: p.x + (global?.[i * 2] ?? 0),
    y: p.y + (global?.[i * 2 + 1] ?? 0),
  }));
}

// 画面上でいちばん近い頂点（radius の内側だけ）
export function nearestVertex(
  points: Vec2[],
  screen: Vec2,
  view: ViewTransform,
  radius = VERTEX_RADIUS,
): number | null {
  let best: number | null = null;
  let bestDistance = radius;
  for (let i = 0; i < points.length; i++) {
    const d = distance(canvasToScreen(view, points[i]!), screen);
    if (d <= bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return best;
}

export function verticesInRect(points: Vec2[], a: Vec2, b: Vec2): number[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const out: number[] = [];
  points.forEach((p, i) => {
    if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) out.push(i);
  });
  return out;
}

function meshContains(points: Vec2[], mesh: Mesh, p: Vec2): boolean {
  return mesh.triangles.some(([a, b, c]) => pointInTriangle(p, points[a]!, points[b]!, points[c]!));
}

// ---- 頂点の選択 ----

export interface VertexSelection {
  meshId: string | null;
  indices: number[];
}

// 選んだ頂点からの距離 d での「まわりも動かす」割合（幅 radius で 0、滑らかに下がる）
export function softWeight(d: number, radius: number): number {
  if (!(radius > 0) || d >= radius) return 0;
  const t = d / radius;
  return 1 - t * t * (3 - 2 * t);
}

// 選んだ頂点と、幅 radius の内側のまわりの頂点。割合は選んだ頂点が 1、まわりは softWeight
export function softSelection(
  points: readonly Vec2[],
  indices: readonly number[],
  radius: number,
): { indices: number[]; weights: number[] } {
  const chosen = new Set(indices);
  const all = [...indices];
  const weights = indices.map(() => 1);
  if (radius > 0) {
    points.forEach((p, i) => {
      if (chosen.has(i)) return;
      let d = Infinity;
      for (const j of indices) d = Math.min(d, distance(p, points[j]!));
      const w = softWeight(d, radius);
      if (w > 1e-6) {
        all.push(i);
        weights.push(w);
      }
    });
  }
  return { indices: all, weights };
}

function createNumberStore(initial: number) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: number) {
      if (next === value) return;
      value = next;
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

function createSelectionStore() {
  let state: VertexSelection = { meshId: null, indices: [] };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: VertexSelection) {
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

type Move = MeshMove;

type Drag =
  | {
      kind: 'vertices';
      start: Vec2;
      screenStart: Vec2;
      started: boolean;
      moves: (delta: Vec2) => Move[] | null;
      inverseErrorNotified: boolean;
      keyed: KeyedDrag<Move[]>;
      blocked: boolean; // プレビューが基準状態と違う間は動かさない（I-046）
    }
  | { kind: 'rect'; start: Vec2; current: Vec2; screenStart: Vec2; moved: boolean; shift: boolean };

export interface MeshEditor {
  tool: CanvasTool;
  selection: { get(): VertexSelection; subscribe(listener: () => void): () => void };
  // 頂点を動かすとき、まわりの頂点も滑らかについてくる幅（キャンバスの px。0 は選んだ頂点だけ）
  softRadius: { get(): number; set(radius: number): void; subscribe(listener: () => void): () => void };
  clearSelection(): void;
  generate(): Promise<void>;
  deleteSelected(): Promise<void>;
  settled(): Promise<void>; // 確認の流れが終わるまで待つ（テスト用）
}

export function createMeshEditor(slot: EnvSlot, options: { now?: () => number } = {}): MeshEditor {
  const now = options.now ?? (() => performance.now());
  const selection = createSelectionStore();
  const softRadius = createNumberStore(0);
  let drag: Drag | null = null;
  let lastClick: { time: number; screen: Vec2 } | null = null;
  let pending: Promise<unknown> = Promise.resolve();
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
    const target = meshTarget(project.model, editor.selectedPartIds);
    const mesh = target?.mesh ?? null;
    const points =
      target && mesh ? displayPositions(project.model, deltas, env.lastDeformed(), target.part, mesh) : null;
    return { project, editor, deltas, target, mesh, points };
  };

  // 選択はいまのメッシュのものだけ（範囲外の番号は捨てる）
  const selectedOf = (mesh: Mesh | null) => {
    const s = selection.get();
    return mesh && s.meshId === mesh.id ? s.indices.filter((i) => i < mesh.vertices.length) : [];
  };
  const select = (meshId: string | null, indices: number[]) => selection.set({ meshId, indices });

  // 形を変える。vertices バインディングにキーがあれば「変形を新しいメッシュへ移します」と確認し、
  // キーを新しいメッシュへ転写する（1つの transaction。カード28で MVP のリセットを置き換えた）
  const reshape = async (env: ToolEnv, label: string, build: (project: Project) => ReshapeOutcome) => {
    if (await reshapeWithTransfer(env.services.store, env.dialogs, label, build)) env.requestRedraw();
  };

  const run = (task: Promise<void>) => {
    pending = task;
    return task;
  };

  const addVertexAt = (env: ToolEnv, p: Vec2) =>
    run(
      reshape(env, '頂点の追加', (project) => {
        const editor = env.services.editor.get();
        const target = meshTarget(project.model, editor.selectedPartIds);
        const mesh = target?.mesh;
        if (!target || !mesh) return { ok: false, error: 'メッシュが無い。[自動生成] で作る' };
        const deltas = snapshot(env).deltas;
        const inv = invert(partMatrix(project.model, deltas.transforms, target.part.id));
        if (!inv) return { ok: false, error: 'パーツの拡縮が 0 なので頂点を足せない' };
        const result = addVertex(mesh, applyAffine(inv, p));
        if (!result.ok) return result;
        const added = result.added ?? -1;
        return {
          ok: true,
          meshId: mesh.id,
          command: remeshCommand('頂点の追加', mesh.id, result.shape, { edited: true }),
          after: () => select(mesh.id, added >= 0 ? [added] : []),
        };
      }),
    );

  const deleteSelected = () => {
    const env = slot.get();
    if (!env) return Promise.resolve();
    return run(
      reshape(env, '頂点の削除', (project) => {
        const target = meshTarget(project.model, env.services.editor.get().selectedPartIds);
        const mesh = target?.mesh ?? null;
        const indices = selectedOf(mesh);
        if (!mesh || indices.length === 0) return { ok: false, error: '消す頂点を選ぶ' };
        const result = removeVertices(mesh, indices);
        if (!result.ok) return result;
        return {
          ok: true,
          meshId: mesh.id,
          command: remeshCommand('頂点の削除', mesh.id, result.shape, { edited: true }),
          after: () => select(mesh.id, []),
        };
      }),
    );
  };

  // 素材の不透明な所から、いまの細かさ（無ければ標準）で作り直す。手で編集した形は消えるので edited は false に戻す
  const generate = () => {
    const env = slot.get();
    if (!env) return Promise.resolve();
    const { store, editor } = env.services;
    const project = store.get();
    const target = meshTarget(project.model, editor.get().selectedPartIds);
    if (!target) {
      env.dialogs.notify('画像パーツを選ぶ');
      return Promise.resolve();
    }
    const density = densityOf(target.mesh);
    const generated = generateShape(env.services, project, target.part.id, density);
    if (!generated.ok) {
      env.dialogs.notify(generated.error);
      return Promise.resolve();
    }
    const label = 'メッシュの自動生成';
    return run(
      reshape(
        env,
        label,
        regenerateOutcome(target.part.id, generated.shape, density, label, { after: () => select(null, []) }),
      ),
    );
  };

  const startVertexDrag = (
    env: ToolEnv,
    snap: ReturnType<typeof snapshot>,
    e: CanvasPointerEvent,
    indices: number[],
  ) => {
    const { target, mesh, project, editor, deltas, points } = snap;
    if (!target || !mesh) return;
    const { keyEditor, store } = env.services;
    const pointsTarget = { kind: 'mesh' as const, meshId: mesh.id };
    const label = '頂点の移動';
    // 「まわりも動かす」幅があれば、まわりの頂点も距離に応じた割合で動かす
    const soft = points ? softSelection(points, indices, softRadius.get()) : { indices, weights: indices.map(() => 1) };
    drag = {
      kind: 'vertices',
      start: e.canvasPoint,
      screenStart: e.screenPoint,
      started: false,
      moves:
        meshKeySpace(project, editor, mesh.id) === 'model'
          ? (d) =>
              soft.indices.map((index, k) => ({ index, d: { x: d.x * soft.weights[k]!, y: d.y * soft.weights[k]! } }))
          : createMeshDragMapper(project.model, deltas, target.part.id, mesh, soft.indices, soft.weights),
      inverseErrorNotified: false,
      keyed: startKeyedDrag<Move[]>({
        store,
        dialogs: env.dialogs,
        label,
        edit: (p, moves) => {
          if (moves.every((m) => m.d.x === 0 && m.d.y === 0)) return null;
          const command = keyEditor.pointsEdit(p, editor, pointsTarget, moves);
          return command === 'needsKey' ? command : markEditedIfChanged(mesh.id, command);
        },
        addKeys: (p) => keyEditor.addKeyAtCurrentValue(p, editor, pointsTarget),
        onChange: () => env.requestRedraw(),
      }),
      blocked: isPreviewOffBase(project.model, editor),
    };
  };

  // 頂点とパーツの選択を外し、対象を選ぶ段に戻る
  const deselectPart = (env: ToolEnv) => {
    select(null, []);
    if (env.services.editor.get().selectedPartIds.length > 0) env.services.editor.set({ selectedPartIds: [] });
  };

  const tool: CanvasTool = {
    id: MESH_TOOL_ID,
    label: 'メッシュ編集',
    cursor: 'crosshair',
    // 画像パーツを選ぶまでは、枠が案内とクリックでの選択を受け持つ
    target: {
      prompt: MESH_PICK_PROMPT,
      has: (project, editor) => meshTarget(project.model, editor.selectedPartIds) !== null,
      pick: (project, deformed, p) => imagePartAt(project.model, deformed, p),
    },

    onPointerDown(e) {
      if (e.button !== 0) return;
      const env = slot.get();
      if (!env || (drag?.kind === 'vertices' && drag.keyed.active())) return;
      drag = null;
      const snap = snapshot(env);
      const { mesh, points } = snap;
      const view = env.view();
      const t = now();
      const isDouble =
        lastClick !== null &&
        t - lastClick.time <= DOUBLE_CLICK_MS &&
        distance(lastClick.screen, e.screenPoint) <= DOUBLE_CLICK_DISTANCE;

      const hit = points ? nearestVertex(points, e.screenPoint, view) : null;
      if (mesh && hit !== null) {
        lastClick = null;
        const current = selectedOf(mesh);
        if (e.shiftKey && current.includes(hit)) {
          select(
            mesh.id,
            current.filter((i) => i !== hit),
          );
          return;
        }
        const indices = current.includes(hit) ? current : e.shiftKey ? [...current, hit] : [hit];
        select(mesh.id, indices);
        startVertexDrag(env, snap, e, indices);
        return;
      }
      if (mesh && isDouble) {
        lastClick = null;
        void addVertexAt(env, e.canvasPoint);
        return;
      }
      lastClick = { time: t, screen: e.screenPoint };
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
      const moves = drag.moves(delta);
      if (!moves) {
        if (!drag.inverseErrorNotified) slot.get()?.dialogs.notify(INVERSE_FAILED_MESSAGE);
        drag.inverseErrorNotified = true;
        return;
      }
      drag.keyed.move(moves);
    },

    onPointerUp(e) {
      const env = slot.get();
      const current = drag;
      if (!current) return;
      if (current.kind === 'vertices') {
        current.keyed.release();
        if (!current.keyed.active()) drag = null;
        return;
      }
      drag = null;
      if (!env) return;
      const snap = snapshot(env);
      const { mesh, points, target, project } = snap;
      if (current.moved) {
        if (!mesh || !points) return;
        const inside = verticesInRect(points, current.start, e.canvasPoint);
        const base = current.shift ? selectedOf(mesh) : [];
        select(mesh.id, [...new Set([...base, ...inside])]);
        return;
      }
      // クリック: 選択を外す。メッシュの外で別のパーツを押したら、そのパーツに切り替える
      const hadVertices = selectedOf(mesh).length > 0;
      if (!current.shift) select(mesh?.id ?? null, []);
      if (mesh && points && meshContains(points, mesh, e.canvasPoint)) return;
      const deformed = env.lastDeformed();
      const model = project.model;
      const other = deformed ? hitTestItems(deformed, e.canvasPoint, (id) => !isLockedDeep(model, id)) : null;
      if (other && other !== target?.part.id) {
        env.services.editor.set({ selectedPartIds: [other] });
        select(null, []);
        lastClick = null;
        return;
      }
      // 何も無い所: 1回目は頂点の選択だけを外し、頂点を選んでいなければパーツの選択も外す
      if (!other && !current.shift && !hadVertices) {
        deselectPart(env);
        lastClick = null;
      }
    },

    onContextClick() {
      const env = slot.get();
      if (!env || (drag?.kind === 'vertices' && drag.keyed.active())) return;
      drag = null;
      lastClick = null;
      deselectPart(env);
    },

    onKeyDown(e) {
      const env = slot.get();
      if (!env) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        void deleteSelected();
      } else if (e.key === 'Escape') {
        // 1回目は頂点の選択を外し、頂点を選んでいなければパーツの選択を外す
        if (drag?.kind === 'vertices' && drag.keyed.active()) drag.keyed.cancel();
        else if (selectedOf(snapshot(env).mesh).length > 0) select(selection.get().meshId, []);
        else deselectPart(env);
        drag = null;
      }
    },

    drawOverlay(ctx, view) {
      const env = slot.get();
      if (!env) return;
      const { mesh, points } = snapshot(env);
      const accent = cssVar('--accent', '#5b8def');
      if (mesh && points) {
        const toScreen = (p: Vec2) => canvasToScreen(view, p);
        const screen = points.map(toScreen);
        const drawn = new Set<string>();
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b, c] of mesh.triangles) {
          for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
          ] as const) {
            const key = p < q ? `${p},${q}` : `${q},${p}`;
            const sp = screen[p];
            const sq = screen[q];
            if (drawn.has(key) || !sp || !sq) continue;
            drawn.add(key);
            ctx.moveTo(sp.x, sp.y);
            ctx.lineTo(sq.x, sq.y);
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        const selected = new Set(selectedOf(mesh));
        // 「まわりも動かす」幅を、選んだ頂点のまわりに点線の円で出す
        const soft = softRadius.get() * view.scale;
        if (soft > 0 && selected.size > 0) {
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = accent;
          ctx.globalAlpha = 0.5;
          for (const i of selected) {
            const p = screen[i];
            if (!p) continue;
            ctx.beginPath();
            ctx.arc(p.x, p.y, soft, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
        screen.forEach((p, i) => {
          const on = selected.has(i);
          const s = on ? 4 : 3;
          ctx.fillStyle = on ? accent : '#ffffff';
          ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
          ctx.strokeStyle = on ? '#ffffff' : accent;
          ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
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
    softRadius: {
      get: softRadius.get,
      set: (radius) => softRadius.set(Math.min(SOFT_RADIUS_MAX, Math.max(0, Math.round(radius)))),
      subscribe: softRadius.subscribe,
    },
    clearSelection: () => select(null, []),
    generate,
    deleteSelected,
    settled: async () => {
      await pending;
      if (drag?.kind === 'vertices') await drag.keyed.settled();
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
