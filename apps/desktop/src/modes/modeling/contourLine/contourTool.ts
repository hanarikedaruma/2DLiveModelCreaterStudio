// 輪郭線で整えるツール（I-068）。選んだ画像パーツの絵の上に線を引き、線の点を動かして、線の近くのメッシュを
// 滑らかに変形する。動きは頂点の移動と同じく、基準状態なら基準の頂点、パラメータの編集中ならそのキーに記録する。
// 線は再生中には計算しない（描画・物理・出力は変わらない）
import { newId, type ContourLine, type Mesh, type Part, type Project, type Vec2 } from '@app/schema';
import type { Command, EditorState, TargetDeltas, ViewTransform } from '@app/contracts';
import {
  attachPoint,
  attachedPoint,
  contourBasis,
  contourOnMesh,
  contourSamples,
  contourShapeValid,
  distanceToLine,
  fitLineMotion,
  pointsToModelSpace,
  spreadAlongLine,
  type ContourOnMesh,
} from '@app/core';
import type { CanvasPointerEvent, CanvasTool } from '../../../shell/api';
import { canvasToScreen } from '../../../shell/canvas/view';
import type { EnvSlot, ToolEnv } from '../canvas/env';
import { distance, hitTestItems } from '../canvas/geometry';
import { drawSwitchHint, nearTriangles, toScreen } from '../canvas/targetRange';
import {
  PREVIEW_OFF_BASE_MESSAGE,
  beginLiveEdit,
  startKeyedDrag,
  type KeyedDrag,
  type LiveEdit,
} from '../canvas/liveEdit';
import { imagePartAt, isLockedDeep, paramValuesOf, partById } from '../canvas/parts';
import { isPreviewOffBase } from '../../../services/keyEditor/common';
import { meshKeySpace } from '../../../services/keyEditor/points';
import { createMeshTargetMapper, meshLocalPositions, type MeshMove } from '../mesh/meshDrag';
import { markEditedIfChanged, remeshCommand } from '../mesh/meshOps';
import { displayPositions, meshTarget } from '../mesh/meshTool';
import { reshapeWithTransfer } from '../mesh/remesh';
import {
  addLineCommand,
  contourBlockReason,
  contourLinesOf,
  defaultRadius,
  distinctNeighbours,
  nextLineName,
  patchLineCommand,
  removeLineCommand,
} from './commands';
import { lineLength, resampleLine, verticesAlongLine, verticesNearLine } from './densify';

export const CONTOUR_TOOL_ID = 'modeling.contourLine';
export const CONTOUR_PICK_PROMPT = '輪郭線を引く画像パーツを、キャンバスでクリックして選ぶ';
export const DRAG_LABEL = '輪郭線で整える';
export const SMOOTH_LABEL = '線に合わせて整える';
export const DENSIFY_LABEL = '線に沿って頂点を足す';
export const LIMIT_MESSAGE =
  'これ以上動かすと三角形が裏返るので、ここで止めました。影響幅を広げるか、線に点を足して少しずつ動かしてください。';
const INVERSE_MESSAGE = '変形を逆算できないため、動かせません。ワープの潰れやパーツの拡縮を確認してください。';

const LINE_COLOR = '#f08c2e'; // メッシュの線（アクセントの色）と見分ける
const HANDLE_RADIUS = 8; // 画面のピクセル
const SMOOTH_ROUNDS = 2; // ［線に合わせて整える］のくり返しの数
const FIT_NEAR = 3; // 線が目標に届くように直す頂点は、線からこの距離（キャンバスの px）までのもの
const nearLine = (p: Vec2, samples: readonly Vec2[]) => distanceToLine(p, samples) <= FIT_NEAR;
const LINE_HIT = 6;
const DRAG_THRESHOLD = 3;
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_DISTANCE = 6;

// ---- 状態（パレットと共有する） ----

export interface ContourState {
  lineId: string | null; // パレットで選んでいる線（無ければパーツの最初の線）
  handles: number[]; // 選んだ点
  drawing: boolean; // ［線を引く］を押してから引き終えるまで
}

function createStateStore() {
  let state: ContourState = { lineId: null, handles: [], drawing: false };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<ContourState>) {
      state = { ...state, ...patch };
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

// ---- 表示の位置（純粋関数） ----

export interface ContourSnapshot {
  project: Project;
  editor: EditorState;
  deltas: TargetDeltas;
  part: Part | null;
  mesh: Mesh | null;
  size: { width: number; height: number } | null;
  positions: Vec2[] | null; // 線を引いたパーツの頂点の見えている位置
  lines: ContourLine[];
  current: ContourLine | null;
}

export interface LineView {
  line: ContourLine;
  on: ContourOnMesh;
  samples: Vec2[]; // 絵についた線（見えている位置）
  handles: Vec2[]; // 点（見えている位置）
}

export function lineView(snap: ContourSnapshot, line: ContourLine): LineView | null {
  if (!snap.mesh || !snap.positions || !snap.size) return null;
  const on = contourOnMesh(snap.mesh, line.points, snap.size);
  if (!on) return null;
  const positions = snap.positions;
  return {
    line,
    on,
    samples: on.samples.map((a) => attachedPoint(a, positions)),
    handles: on.handles.map((a) => attachedPoint(a, positions)),
  };
}

// 見えている位置の点 p を、その姿勢のメッシュの UV にする
export function uvAtDisplay(mesh: Mesh, positions: readonly Vec2[], p: Vec2): Vec2 | null {
  const a = attachPoint(positions, mesh.triangles, p);
  if (!a) return null;
  return attachedPoint(a, mesh.uvs);
}

// なぞった点の列から線の点を選ぶ。長さに沿って等間隔に置き、その点を通る曲線となぞった線のずれが tolerance 以下に
// なるまで点を増やす（最大 40）。点の数の目安は 50px ごと、最低 3（短い線は 2）
export function fitStroke(stroke: readonly Vec2[], tolerance: number): Vec2[] {
  const smooth = stroke.map((p, i) => {
    if (i === 0 || i === stroke.length - 1) return p;
    const around = stroke.slice(Math.max(0, i - 2), Math.min(stroke.length, i + 3));
    return {
      x: around.reduce((s, q) => s + q.x, 0) / around.length,
      y: around.reduce((s, q) => s + q.y, 0) / around.length,
    };
  });
  const total = lineLength(smooth);
  if (total < 1e-6) return [];
  const check = resampleLine(smooth, Math.max(1, total / 200));
  let points: Vec2[] = [];
  for (let n = Math.max(total < 30 ? 2 : 3, Math.round(total / 50) + 1); n <= 40; n++) {
    points = resampleLine(smooth, total / (n - 1));
    if (points.length < 2) return points;
    const curve = contourSamples(contourBasis(points), points);
    if (check.every((p) => distanceToLine(p, curve) <= tolerance)) break;
  }
  return points;
}

// ---- メッシュごとの準備（ドラッグの最初に1回） ----

interface Prepared {
  meshId: string;
  partId: string;
  triangles: Mesh['triangles'];
  before: Vec2[]; // 見えている位置（全頂点）
  indices: number[]; // 動かす頂点
  visible: Vec2[]; // 動かす頂点の、逆算に使う位置（キャンバス座標）
  map: ((targets: Vec2[]) => MeshMove[] | null) | null; // null はモデル座標のキー（見た目の差をそのまま使う）
}

export interface ContourEditor {
  tool: CanvasTool;
  state: { get(): ContourState; subscribe(listener: () => void): () => void };
  snapshot(): ContourSnapshot | null;
  view(line: ContourLine): LineView | null;
  selectLine(id: string | null): void;
  drawNew(): void;
  clear(): void;
  removeLine(): void;
  smooth(): Promise<void>;
  densify(): Promise<void>;
  beginRadius(): void;
  setRadius(radius: number): void;
  endRadius(): void;
  setWithPart(partId: string, on: boolean): void;
  candidates(): Part[]; // 一緒に動かすパーツの候補（影響幅にかかる画像パーツ）
  spacing(): { count: number; spacing: number } | null; // 線の上の頂点の数と間隔
  settled(): Promise<void>;
}

export function createContourEditor(slot: EnvSlot, options: { now?: () => number } = {}): ContourEditor {
  const now = options.now ?? (() => performance.now());
  const state = createStateStore();
  let cache: { model: unknown; values: unknown; deltas: TargetDeltas } | null = null;
  let drag: Drag | null = null;
  let stroke: { points: Vec2[]; screenStart: Vec2; screenLength: number; last: Vec2 } | null = null;
  let clicks: Vec2[] = [];
  let hover: Vec2 | null = null;
  let pointer: Vec2 | null = null; // マウスの位置（画面座標）。切り替わる先の予告に使う（I-069）
  let lastClick: { time: number; screen: Vec2 } | null = null;
  let radiusEdit: { live: LiveEdit; lineId: string } | null = null;
  let pending: Promise<unknown> = Promise.resolve();

  type Drag =
    | {
        kind: 'handles';
        screenStart: Vec2;
        start: Vec2;
        started: boolean;
        blocked: boolean;
        moves: (delta: Vec2) => Map<string, MeshMove[]> | null;
        keyed: KeyedDrag<Map<string, MeshMove[]>>;
        warnedInverse: boolean;
      }
    | { kind: 'reposition'; screenStart: Vec2; started: boolean; live: LiveEdit; line: ContourLine; index: number }
    | { kind: 'line'; screenStart: Vec2; start: Vec2; lineId: string; sample: number }
    | { kind: 'empty'; screenStart: Vec2; start: Vec2 };

  const snapshot = (env: ToolEnv): ContourSnapshot => {
    const project = env.services.store.get();
    const editor = env.services.editor.get();
    if (!cache || cache.model !== project.model || cache.values !== editor.editorParamValues) {
      cache = {
        model: project.model,
        values: editor.editorParamValues,
        deltas: env.services.evaluator.evaluate(project.model, paramValuesOf(project.model, editor.editorParamValues)),
      };
    }
    const deltas = cache.deltas;
    const target = meshTarget(project.model, editor.selectedPartIds);
    const part = target?.part ?? null;
    const mesh = target?.mesh ?? null;
    const asset = part ? project.assets.find((a) => a.id === part.assetId) : undefined;
    const positions = part && mesh ? displayPositions(project.model, deltas, env.lastDeformed(), part, mesh) : null;
    const lines = part ? contourLinesOf(project.model, part.id) : [];
    const chosen = state.get().lineId;
    const current = lines.find((l) => l.id === chosen) ?? lines[0] ?? null;
    return {
      project,
      editor,
      deltas,
      part,
      mesh,
      size: asset ? { width: asset.width, height: asset.height } : null,
      positions,
      lines,
      current,
    };
  };

  const notify = (message: string) => slot.get()?.dialogs.notify(message);
  const redraw = () => slot.get()?.requestRedraw();

  // その姿勢の、パーツの頂点の見えている位置
  const positionsOf = (snap: ContourSnapshot, env: ToolEnv, partId: string) => {
    const part = partById(snap.project.model, partId);
    const mesh = part?.meshId ? snap.project.model.meshes.find((m) => m.id === part.meshId) : undefined;
    if (!part || part.kind !== 'image' || !mesh) return null;
    return { part, mesh, positions: displayPositions(snap.project.model, snap.deltas, env.lastDeformed(), part, mesh) };
  };

  // 動かすメッシュ（線を引いたパーツと、一緒に動かすパーツ）ごとに、見た目の動き → キーの差分の逆算を用意する
  const prepare = (
    env: ToolEnv,
    snap: ContourSnapshot,
    line: ContourLine,
    weightsOf: (partId: string, positions: Vec2[]) => Float64Array,
    dims: 1 | 2,
  ): { prepared: Prepared[]; factors: Float64Array[] } => {
    const prepared: Prepared[] = [];
    const factors: Float64Array[] = [];
    for (const partId of [line.partId, ...line.withPartIds]) {
      if (isLockedDeep(snap.project.model, partId)) continue;
      const got = positionsOf(snap, env, partId);
      if (!got) continue;
      const values = weightsOf(partId, got.positions);
      const indices: number[] = [];
      got.positions.forEach((_, i) => {
        const moving =
          dims === 1
            ? Math.abs(values[i]!) > 1e-9
            : Math.abs(values[i * 2]!) > 1e-9 || Math.abs(values[i * 2 + 1]!) > 1e-9;
        if (moving) indices.push(i);
      });
      if (indices.length === 0) continue;
      const own = new Float64Array(indices.length * dims);
      indices.forEach((index, k) => {
        for (let d = 0; d < dims; d++) own[k * dims + d] = values[index * dims + d]!;
      });
      const model = snap.project.model;
      const local = meshLocalPositions(got.mesh, snap.deltas);
      const visible = pointsToModelSpace(
        model,
        snap.deltas,
        partId,
        indices.map((i) => local[i]!),
      );
      prepared.push({
        meshId: got.mesh.id,
        partId,
        triangles: got.mesh.triangles,
        before: got.positions,
        indices,
        visible,
        map:
          meshKeySpace(snap.project, snap.editor, got.mesh.id) === 'model'
            ? null
            : createMeshTargetMapper(model, snap.deltas, partId, got.mesh, indices),
      });
      factors.push(own);
    }
    return { prepared, factors };
  };

  // 見た目の動き（頂点ごと）を、メッシュごとのキーの差分にする。逆算できなければ null
  const toMoves = (prepared: Prepared[], displacement: (m: number, k: number) => Vec2) => {
    const out = new Map<string, MeshMove[]>();
    for (let m = 0; m < prepared.length; m++) {
      const p = prepared[m]!;
      const ds = p.indices.map((_, k) => displacement(m, k));
      const moves = p.map
        ? p.map(p.visible.map((v, k) => ({ x: v.x + ds[k]!.x, y: v.y + ds[k]!.y })))
        : p.indices.map((index, k) => ({ index, d: ds[k]! }));
      if (!moves) return null;
      out.set(p.meshId, moves);
    }
    return out;
  };

  const validShape = (prepared: Prepared[], displacement: (m: number, k: number) => Vec2) =>
    prepared.every((p, m) => {
      const after = p.before.slice();
      p.indices.forEach((index, k) => {
        const d = displacement(m, k);
        after[index] = { x: p.before[index]!.x + d.x, y: p.before[index]!.y + d.y };
      });
      return contourShapeValid(p.triangles, p.before, after);
    });

  // メッシュごとのキーの編集を1つのコマンドにまとめる（1回の Undo）。prefix は線そのものの変更（点の追加など）
  const keyEdit = (
    env: ToolEnv,
    editor: EditorState,
    label: string,
    prefix: Command | null,
  ): ((project: Project, moves: Map<string, MeshMove[]>) => Command | 'needsKey' | null) => {
    return (project, moves) => {
      const commands: Command[] = prefix ? [prefix] : [];
      for (const [meshId, list] of moves) {
        if (list.every((m) => Math.abs(m.d.x) < 1e-9 && Math.abs(m.d.y) < 1e-9)) continue;
        const edit = env.services.keyEditor.pointsEdit(project, editor, { kind: 'mesh', meshId }, list);
        if (edit === 'needsKey') return 'needsKey';
        commands.push(markEditedIfChanged(meshId, edit));
      }
      if (commands.length === 0) return null;
      return { label, apply: (p) => commands.reduce((acc, c) => c.apply(acc), p) };
    };
  };

  const addKeys =
    (env: ToolEnv, editor: EditorState, label: string) =>
    (project: Project, moves: Map<string, MeshMove[]>): Command => {
      const commands = [...moves.keys()].map((meshId) =>
        env.services.keyEditor.addKeyAtCurrentValue(project, editor, { kind: 'mesh', meshId }),
      );
      return { label, apply: (p) => commands.reduce((acc, c) => c.apply(acc), p) };
    };

  // 選んだ点のドラッグを始める。prefix は線の変更（線の上をつまんで点を足したとき）
  const startHandleDrag = (
    env: ToolEnv,
    snap: ContourSnapshot,
    line: ContourLine,
    selected: number[],
    grabbed: number,
    e: CanvasPointerEvent,
    prefix: Command | null,
  ) => {
    const view = lineView(snap, line);
    if (!view) return;
    const basis = view.on.basis;
    const strength = basis.weights.map((w) => selected.reduce((s, k) => s + (w[k] ?? 0), 0));
    const { prepared, factors } = prepare(
      env,
      snap,
      line,
      // 線を引いたパーツは、線のすぐそばの頂点を直して、線が目標の動きに届くようにする
      (partId, positions) => {
        const spread = spreadAlongLine(positions, view.samples, strength, 1, line.radius);
        if (partId !== line.partId) return spread;
        return fitLineMotion(view.on.samples, strength, spread, 1, (i) => nearLine(positions[i]!, view.samples));
      },
      1,
    );
    // つまんだ点がマウスの下に来るように、動かす量を合わせる
    const main = prepared.find((p) => p.partId === line.partId);
    let gain = 1;
    if (main) {
      const factor = new Float64Array(main.before.length);
      main.indices.forEach((index, k) => (factor[index] = factors[prepared.indexOf(main)]![k]!));
      const a = view.on.handles[grabbed]!;
      const at = a.indices.reduce((s, index, k) => s + factor[index]! * a.weights[k]!, 0);
      if (at > 0.2) gain = 1 / at;
    }
    let limited = false;
    const moves = (delta: Vec2) => {
      const shift = (scale: number) => (m: number, k: number) => ({
        x: factors[m]![k]! * delta.x * gain * scale,
        y: factors[m]![k]! * delta.y * gain * scale,
      });
      let scale = 1;
      if (!validShape(prepared, shift(1))) {
        let lo = 0,
          hi = 1;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (validShape(prepared, shift(mid))) lo = mid;
          else hi = mid;
        }
        scale = lo;
        if (!limited) notify(LIMIT_MESSAGE);
        limited = true;
      }
      return toMoves(prepared, shift(scale));
    };
    drag = {
      kind: 'handles',
      screenStart: e.screenPoint,
      start: e.canvasPoint,
      started: false,
      blocked: isPreviewOffBase(snap.project.model, snap.editor),
      moves,
      keyed: startKeyedDrag<Map<string, MeshMove[]>>({
        store: env.services.store,
        dialogs: env.dialogs,
        label: DRAG_LABEL,
        edit: keyEdit(env, snap.editor, DRAG_LABEL, prefix),
        addKeys: addKeys(env, snap.editor, DRAG_LABEL),
        onChange: () => env.requestRedraw(),
      }),
      warnedInverse: false,
    };
  };

  // ---- 線を引く ----

  const createLine = (env: ToolEnv, canvasPoints: Vec2[]) => {
    const snap = snapshot(env);
    if (!snap.part || !snap.mesh || !snap.positions) return;
    const reason = contourBlockReason(snap.project.model, snap.part.id);
    if (reason) {
      notify(reason);
      return;
    }
    const uvs: Vec2[] = [];
    for (const p of canvasPoints) {
      const uv = uvAtDisplay(snap.mesh, snap.positions, p);
      if (!uv) return;
      if (uvs.length === 0 || Math.hypot(uv.x - uvs.at(-1)!.x, uv.y - uvs.at(-1)!.y) > 1e-6) uvs.push(uv);
    }
    if (uvs.length < 2 || !distinctNeighbours(uvs)) {
      notify('線が短すぎます。輪郭に沿って、もう少し長くなぞってください。');
      return;
    }
    const line: ContourLine = {
      id: newId(),
      partId: snap.part.id,
      name: nextLineName(snap.project.model, snap.part.id),
      points: uvs,
      radius: defaultRadius(lineLength(canvasPoints)),
      withPartIds: [],
    };
    env.services.store.dispatch(addLineCommand(line));
    state.set({ lineId: line.id, handles: [], drawing: false });
    clicks = [];
    stroke = null;
    env.requestRedraw();
  };

  const finishStroke = (env: ToolEnv, points: Vec2[]) => {
    const tolerance = Math.max(1.5, 3 / env.view().scale);
    createLine(env, fitStroke(points, tolerance));
  };

  // ---- 当たり判定 ----

  const hitHandle = (snap: ContourSnapshot, screen: Vec2, view: ViewTransform) => {
    const ordered = snap.current ? [snap.current, ...snap.lines.filter((l) => l !== snap.current)] : snap.lines;
    for (const line of ordered) {
      const v = lineView(snap, line);
      if (!v) continue;
      let best = -1,
        bestDistance = HANDLE_RADIUS;
      v.handles.forEach((p, i) => {
        const d = distance(canvasToScreen(view, p), screen);
        if (d <= bestDistance) {
          best = i;
          bestDistance = d;
        }
      });
      if (best >= 0) return { line, index: best };
    }
    return null;
  };

  const hitLine = (snap: ContourSnapshot, screen: Vec2, view: ViewTransform) => {
    for (const line of snap.lines) {
      const v = lineView(snap, line);
      if (!v) continue;
      let best = -1,
        bestDistance = LINE_HIT;
      v.samples.forEach((p, j) => {
        const d = distance(canvasToScreen(view, p), screen);
        if (d <= bestDistance) {
          best = j;
          bestDistance = d;
        }
      });
      if (best >= 0) return { line, sample: best, view: v };
    }
    return null;
  };

  // 線のサンプル j の位置に点を足した点の列と、その点の番号。すでに点があればその点
  const withPointAt = (v: LineView, j: number): { points: Vec2[]; index: number } => {
    const s = v.on.basis.segments[j]!;
    const uv = v.on.sampleUvs[j]!;
    const points = v.line.points;
    const same = (p: Vec2) => Math.hypot(p.x - uv.x, p.y - uv.y) < 1e-6;
    if (same(points[s]!)) return { points, index: s };
    if (same(points[s + 1]!)) return { points, index: s + 1 };
    return { points: [...points.slice(0, s + 1), uv, ...points.slice(s + 1)], index: s + 1 };
  };

  // 対象のメッシュと、そのまわりの余白の中か（I-069）。ここを押しても別のパーツへ切り替えない
  const inTargetRange = (snap: ContourSnapshot, view: ViewTransform, screen: Vec2) =>
    !!snap.mesh && !!snap.positions && nearTriangles(toScreen(view, snap.positions), snap.mesh.triangles, screen);

  const deselectPart = (env: ToolEnv) => {
    state.set({ handles: [], drawing: false });
    if (env.services.editor.get().selectedPartIds.length > 0) env.services.editor.set({ selectedPartIds: [] });
  };

  const cancelDrag = () => {
    if (drag?.kind === 'handles' && drag.keyed.active()) drag.keyed.cancel();
    if (drag?.kind === 'reposition') drag.live.cancel();
    drag = null;
  };

  const clear = () => {
    cancelDrag();
    radiusEdit?.live.commit();
    radiusEdit = null;
    stroke = null;
    clicks = [];
    hover = null;
    lastClick = null;
    state.set({ handles: [], drawing: false });
    redraw();
  };

  const tool: CanvasTool = {
    id: CONTOUR_TOOL_ID,
    label: '輪郭線で整える',
    cursor: 'crosshair',
    target: {
      prompt: CONTOUR_PICK_PROMPT,
      has: (project, editor) => meshTarget(project.model, editor.selectedPartIds) !== null,
      pick: (project, deformed, p) => imagePartAt(project.model, deformed, p),
    },

    onPointerDown(e) {
      if (e.button !== 0) return;
      const env = slot.get();
      if (!env || (drag?.kind === 'handles' && drag.keyed.active())) return;
      drag = null;
      const snap = snapshot(env);
      if (!snap.part || !snap.mesh) return;
      const view = env.view();
      if (state.get().drawing) {
        stroke = { points: [e.canvasPoint], screenStart: e.screenPoint, screenLength: 0, last: e.screenPoint };
        return;
      }
      const reason = contourBlockReason(snap.project.model, snap.part.id);
      const handle = hitHandle(snap, e.screenPoint, view);
      if (handle) {
        if (reason) {
          notify(reason);
          return;
        }
        lastClick = null;
        const current = state.get();
        const same = current.lineId === handle.line.id || (!current.lineId && snap.current === handle.line);
        const selected = same ? current.handles : [];
        if (e.altKey) {
          state.set({ lineId: handle.line.id, handles: [handle.index] });
          drag = {
            kind: 'reposition',
            screenStart: e.screenPoint,
            started: false,
            live: beginLiveEdit(env.services.store, '輪郭線の点の位置'),
            line: handle.line,
            index: handle.index,
          };
          return;
        }
        if (e.shiftKey && selected.includes(handle.index)) {
          state.set({ lineId: handle.line.id, handles: selected.filter((i) => i !== handle.index) });
          return;
        }
        const handles = selected.includes(handle.index)
          ? selected
          : e.shiftKey
            ? [...selected, handle.index]
            : [handle.index];
        state.set({ lineId: handle.line.id, handles });
        startHandleDrag(env, snap, handle.line, handles, handle.index, e, null);
        return;
      }
      const onLine = hitLine(snap, e.screenPoint, view);
      if (onLine) {
        const t = now();
        const isDouble =
          lastClick !== null &&
          t - lastClick.time <= DOUBLE_CLICK_MS &&
          distance(lastClick.screen, e.screenPoint) <= DOUBLE_CLICK_DISTANCE;
        if (isDouble && !reason) {
          lastClick = null;
          const { points, index } = withPointAt(onLine.view, onLine.sample);
          if (points !== onLine.line.points)
            env.services.store.dispatch(patchLineCommand(onLine.line.id, { points }, '輪郭線に点を足す'));
          state.set({ lineId: onLine.line.id, handles: [index] });
          return;
        }
        lastClick = { time: t, screen: e.screenPoint };
        drag = {
          kind: 'line',
          screenStart: e.screenPoint,
          start: e.canvasPoint,
          lineId: onLine.line.id,
          sample: onLine.sample,
        };
        return;
      }
      lastClick = null;
      drag = { kind: 'empty', screenStart: e.screenPoint, start: e.canvasPoint };
    },

    onPointerMove(e) {
      pointer = e.screenPoint;
      const env = slot.get();
      if (!env) return;
      if (state.get().drawing && !stroke) {
        hover = e.canvasPoint;
        if (clicks.length > 0) env.requestRedraw();
        return;
      }
      if (stroke) {
        const step = distance(stroke.last, e.screenPoint);
        if (step >= 2) {
          stroke.points.push(e.canvasPoint);
          stroke.screenLength += step;
          stroke.last = e.screenPoint;
          env.requestRedraw();
        }
        return;
      }
      if (!drag) return;
      if (drag.kind === 'line') {
        if (distance(e.screenPoint, drag.screenStart) < DRAG_THRESHOLD) return;
        // 線の上をつまんで動かした: そこに点を足してから動かす（点の追加とキーの編集で1回の Undo）
        const snap = snapshot(env);
        const line = snap.lines.find((l) => l.id === (drag as { lineId: string }).lineId);
        const v = line ? lineView(snap, line) : null;
        const reason = snap.part ? contourBlockReason(snap.project.model, snap.part.id) : 'no part';
        const start = drag.start;
        const startScreen = drag.screenStart;
        const sample = drag.sample;
        drag = null;
        lastClick = null;
        if (!line || !v || reason) {
          if (reason && snap.part) notify(reason);
          return;
        }
        const { points, index } = withPointAt(v, Math.min(sample, v.samples.length - 1));
        const inserted = points === line.points ? line : { ...line, points };
        const prefix = points === line.points ? null : patchLineCommand(line.id, { points }, DRAG_LABEL);
        state.set({ lineId: line.id, handles: [index] });
        startHandleDrag(
          env,
          snap,
          inserted,
          [index],
          index,
          { ...e, canvasPoint: start, screenPoint: startScreen },
          prefix,
        );
        moveHandles(env, e);
        return;
      }
      if (drag.kind === 'reposition') {
        if (!drag.started && distance(e.screenPoint, drag.screenStart) < DRAG_THRESHOLD) return;
        drag.started = true;
        const snap = snapshot(env);
        if (!snap.mesh || !snap.positions) return;
        const uv = uvAtDisplay(snap.mesh, snap.positions, e.canvasPoint);
        if (!uv) return;
        const index = drag.index;
        const points = drag.line.points.map((p, i) => (i === index ? uv : p));
        if (!distinctNeighbours(points)) return;
        const id = drag.line.id;
        drag.live.update(() => patchLineCommand(id, { points }, '輪郭線の点の位置'));
        env.requestRedraw();
        return;
      }
      if (drag.kind === 'handles') moveHandles(env, e);
    },

    onPointerUp(e) {
      const env = slot.get();
      if (!env) return;
      if (stroke) {
        const current = stroke;
        stroke = null;
        if (current.screenLength >= 6) {
          clicks = [];
          finishStroke(env, [...current.points, e.canvasPoint]);
          return;
        }
        // クリック: 点を順に置く。ダブルクリックで引き終える
        const t = now();
        const isDouble =
          lastClick !== null &&
          t - lastClick.time <= DOUBLE_CLICK_MS &&
          distance(lastClick.screen, e.screenPoint) <= DOUBLE_CLICK_DISTANCE;
        if (isDouble) {
          lastClick = null;
          if (clicks.length >= 2) createLine(env, clicks);
          else notify('点を2つ以上置いてから、ダブルクリックか Enter で引き終えてください。');
          return;
        }
        lastClick = { time: t, screen: e.screenPoint };
        clicks.push(e.canvasPoint);
        env.requestRedraw();
        return;
      }
      const current = drag;
      if (!current) return;
      if (current.kind === 'handles') {
        current.keyed.release();
        if (!current.keyed.active()) drag = null;
        return;
      }
      if (current.kind === 'reposition') {
        current.live.commit();
        drag = null;
        return;
      }
      drag = null;
      const snap = snapshot(env);
      if (current.kind === 'line') {
        // 線のクリック: その線を選ぶ
        state.set({ lineId: current.lineId, handles: [] });
        env.requestRedraw();
        return;
      }
      // 何も無い所のクリック: 1回目は点の選択を外し、2回目でパーツの選択を外す。メッシュの外で別のパーツを押したら切り替える
      if (distance(e.screenPoint, current.screenStart) >= DRAG_THRESHOLD) return;
      const hadHandles = state.get().handles.length > 0;
      state.set({ handles: [] });
      if (inTargetRange(snap, env.view(), e.screenPoint)) return;
      const deformed = env.lastDeformed();
      const model = snap.project.model;
      const other = deformed ? hitTestItems(deformed, e.canvasPoint, (id) => !isLockedDeep(model, id)) : null;
      if (other && other !== snap.part?.id && partById(model, other)?.kind === 'image') {
        env.services.editor.set({ selectedPartIds: [other] });
        state.set({ lineId: null });
        return;
      }
      if (!other && !hadHandles) deselectPart(env);
    },

    onContextClick() {
      const env = slot.get();
      if (!env) return;
      cancelDrag();
      stroke = null;
      clicks = [];
      deselectPart(env);
    },

    onKeyDown(e) {
      const env = slot.get();
      if (!env) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (drag) {
          cancelDrag();
        } else if (state.get().drawing) {
          stroke = null;
          clicks = [];
          state.set({ drawing: false });
        } else if (state.get().handles.length > 0) state.set({ handles: [] });
        else deselectPart(env);
        env.requestRedraw();
      } else if (e.key === 'Enter' && state.get().drawing && clicks.length >= 2) {
        e.preventDefault();
        createLine(env, clicks);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.get().handles.length > 0) {
        e.preventDefault();
        const snap = snapshot(env);
        const line = snap.current;
        if (!line) return;
        const remove = new Set(state.get().handles);
        const points = line.points.filter((_, i) => !remove.has(i));
        if (points.length < 2) {
          notify('線の点は2つより少なくできません。線をなくすときは［消す］を押してください。');
          return;
        }
        if (!distinctNeighbours(points)) return;
        env.services.store.dispatch(patchLineCommand(line.id, { points }, '輪郭線の点を消す'));
        state.set({ handles: [] });
      }
    },

    drawOverlay(ctx, view) {
      const env = slot.get();
      if (!env) return;
      const snap = snapshot(env);
      const accent = cssVar('--accent', '#5b8def');
      const line = LINE_COLOR;
      const toScreen = (p: Vec2) => canvasToScreen(view, p);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const { handles: chosen } = state.get();
      for (const l of snap.lines) {
        const v = lineView(snap, l);
        if (!v) continue;
        const selected = l === snap.current;
        const pts = v.samples.map(toScreen);
        const path = () => {
          ctx.beginPath();
          pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        };
        if (selected) {
          ctx.strokeStyle = line;
          ctx.globalAlpha = 0.12;
          ctx.lineWidth = l.radius * view.scale * 2;
          path();
          ctx.stroke();
        }
        ctx.globalAlpha = selected ? 1 : 0.7;
        ctx.strokeStyle = line;
        ctx.lineWidth = selected ? 2.5 : 1.25;
        path();
        ctx.stroke();
        ctx.globalAlpha = 1;
        v.handles.map(toScreen).forEach((p, i) => {
          const on = selected && chosen.includes(i);
          ctx.beginPath();
          ctx.arc(p.x, p.y, selected ? 5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = on ? line : '#ffffff';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = line;
          ctx.stroke();
        });
      }
      // メッシュと余白の外で別のパーツの上にマウスがあるとき、押すと切り替わる先を出す（I-069）
      if (!drag && !stroke && !state.get().drawing && pointer && snap.part && !inTargetRange(snap, view, pointer)) {
        const model = snap.project.model;
        const deformed = env.lastDeformed();
        const at = { x: (pointer.x - view.offset.x) / view.scale, y: (pointer.y - view.offset.y) / view.scale };
        const other = deformed ? hitTestItems(deformed, at, (id) => !isLockedDeep(model, id)) : null;
        if (other && other !== snap.part.id && partById(model, other)?.kind === 'image')
          drawSwitchHint(ctx, model, deformed, view, other);
      }
      // 引いている途中の線
      const preview = stroke ? stroke.points : clicks.length > 0 ? [...clicks, ...(hover ? [hover] : [])] : null;
      if (preview && preview.length > 0) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        preview.map(toScreen).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        for (const p of clicks.map(toScreen)) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = accent;
          ctx.fill();
        }
      }
      ctx.restore();
    },
  };

  function moveHandles(env: ToolEnv, e: CanvasPointerEvent) {
    if (drag?.kind !== 'handles' || !drag.keyed.active()) return;
    if (!drag.started) {
      if (distance(e.screenPoint, drag.screenStart) < DRAG_THRESHOLD) return;
      drag.started = true;
      if (drag.blocked) notify(PREVIEW_OFF_BASE_MESSAGE);
    }
    if (drag.blocked) return;
    const moves = drag.moves({ x: e.canvasPoint.x - drag.start.x, y: e.canvasPoint.y - drag.start.y });
    if (!moves) {
      if (!drag.warnedInverse) notify(INVERSE_MESSAGE);
      drag.warnedInverse = true;
      return;
    }
    drag.keyed.move(moves);
  }

  // ---- パレットからの操作 ----

  const currentOf = (env: ToolEnv) => {
    const snap = snapshot(env);
    return snap.current ? { snap, line: snap.current } : null;
  };

  function smooth(): Promise<void> {
    const env = slot.get();
    const found = env ? currentOf(env) : null;
    if (!env || !found) return Promise.resolve();
    const { snap, line } = found;
    const reason = contourBlockReason(snap.project.model, line.partId);
    if (reason) {
      notify(reason);
      return Promise.resolve();
    }
    if (isPreviewOffBase(snap.project.model, snap.editor)) {
      notify(PREVIEW_OFF_BASE_MESSAGE);
      return Promise.resolve();
    }
    const v = lineView(snap, line);
    if (!v) return Promise.resolve();
    // 目標は、今の点（絵についた位置）を通る滑らかな曲線。頂点を動かすと点も一緒に動くので、目標は最初に決めて固定し、
    // 「目標と今の線の差を広げて動かす」を数回くり返して近づける
    const target = contourSamples(v.on.basis, v.handles);
    const residual = (samples: Vec2[]) => {
      const out = new Float64Array(samples.length * 2);
      let largest = 0;
      samples.forEach((p, j) => {
        out[j * 2] = target[j]!.x - p.x;
        out[j * 2 + 1] = target[j]!.y - p.y;
        largest = Math.max(largest, Math.hypot(out[j * 2]!, out[j * 2 + 1]!));
      });
      return { out, largest };
    };
    if (residual(v.samples).largest < 0.01) {
      notify('この姿勢では、輪郭はすでに線の形にそろっています。');
      return Promise.resolve();
    }
    const parts = [line.partId, ...line.withPartIds].flatMap((id) => {
      const got = isLockedDeep(snap.project.model, id) ? null : positionsOf(snap, env, id);
      return got ? [{ id, start: got.positions, now: got.positions.map((q) => ({ ...q })) }] : [];
    });
    const main = parts.find((q) => q.id === line.partId);
    if (!main) return Promise.resolve();
    for (let round = 0; round < SMOOTH_ROUNDS; round++) {
      const samples = v.on.samples.map((a) => attachedPoint(a, main.now));
      const { out, largest } = residual(samples);
      if (largest < 0.01) break;
      for (const part of parts) {
        const spread = spreadAlongLine(part.now, samples, out, 2, line.radius);
        const d =
          part === main ? fitLineMotion(v.on.samples, out, spread, 2, (i) => nearLine(main.now[i]!, samples)) : spread;
        part.now = part.now.map((q, i) => ({ x: q.x + d[i * 2]!, y: q.y + d[i * 2 + 1]! }));
      }
    }
    const totals = new Map(
      parts.map((part) => [
        part.id,
        Float64Array.from(part.now.flatMap((q, i) => [q.x - part.start[i]!.x, q.y - part.start[i]!.y])),
      ]),
    );
    const { prepared, factors } = prepare(env, snap, line, (id) => totals.get(id)!, 2);
    const shiftBy = (scale: number) => (m: number, k: number) => ({
      x: factors[m]![k * 2]! * scale,
      y: factors[m]![k * 2 + 1]! * scale,
    });
    // 三角形が裏返るなら、裏返らない所まで弱めて知らせる（ドラッグと同じ）
    let scale = 1;
    if (!validShape(prepared, shiftBy(1))) {
      let lo = 0,
        hi = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (validShape(prepared, shiftBy(mid))) lo = mid;
        else hi = mid;
      }
      scale = lo;
      notify(LIMIT_MESSAGE);
      if (scale < 1e-3) return Promise.resolve();
    }
    const moves = toMoves(prepared, shiftBy(scale));
    if (!moves) {
      notify(INVERSE_MESSAGE);
      return Promise.resolve();
    }
    const keyed = startKeyedDrag<Map<string, MeshMove[]>>({
      store: env.services.store,
      dialogs: env.dialogs,
      label: SMOOTH_LABEL,
      edit: keyEdit(env, snap.editor, SMOOTH_LABEL, null),
      addKeys: addKeys(env, snap.editor, SMOOTH_LABEL),
      onChange: () => env.requestRedraw(),
    });
    keyed.move(moves);
    keyed.release();
    pending = keyed.settled();
    return keyed.settled();
  }

  function densify(): Promise<void> {
    const env = slot.get();
    const found = env ? currentOf(env) : null;
    if (!env || !found || !found.snap.mesh || !found.snap.size) return Promise.resolve();
    const { snap, line } = found;
    const reason = contourBlockReason(snap.project.model, line.partId);
    if (reason) {
      notify(reason);
      return Promise.resolve();
    }
    const mesh = snap.mesh!;
    const on = contourOnMesh(mesh, line.points, snap.size!);
    if (!on) return Promise.resolve();
    // 基準状態の頂点の位置で線を置き直す
    const base = on.samples.map((a) => attachedPoint(a, mesh.vertices));
    const result = verticesAlongLine(mesh, base);
    if (!result.ok) {
      notify(result.error);
      return Promise.resolve();
    }
    const task = reshapeWithTransfer(env.services.store, env.dialogs, DENSIFY_LABEL, (project) => {
      const now = project.model.meshes.find((m) => m.id === mesh.id);
      if (now !== mesh) return { ok: false, error: 'メッシュが変わったので、もう一度押してください' };
      return {
        ok: true,
        meshId: mesh.id,
        command: remeshCommand(DENSIFY_LABEL, mesh.id, result.shape, { edited: true }),
      };
    }).then((changed) => {
      if (changed) env.requestRedraw();
    });
    pending = task;
    return task;
  }

  return {
    tool,
    state: { get: state.get, subscribe: state.subscribe },
    snapshot: () => {
      const env = slot.get();
      return env ? snapshot(env) : null;
    },
    view: (line) => {
      const env = slot.get();
      return env ? lineView(snapshot(env), line) : null;
    },
    selectLine(id) {
      state.set({ lineId: id, handles: [] });
      redraw();
    },
    drawNew() {
      cancelDrag();
      stroke = null;
      clicks = [];
      state.set({ drawing: true, handles: [] });
      redraw();
    },
    clear,
    removeLine() {
      const env = slot.get();
      const found = env ? currentOf(env) : null;
      if (!env || !found) return;
      env.services.store.dispatch(removeLineCommand(found.line.id));
      state.set({ lineId: null, handles: [] });
      env.requestRedraw();
    },
    smooth,
    densify,
    beginRadius() {
      const env = slot.get();
      const found = env ? currentOf(env) : null;
      if (!env || !found || radiusEdit) return;
      radiusEdit = { live: beginLiveEdit(env.services.store, '輪郭線の影響幅'), lineId: found.line.id };
    },
    setRadius(radius) {
      const env = slot.get();
      if (!env) return;
      if (!radiusEdit) {
        const found = currentOf(env);
        if (!found) return;
        radiusEdit = { live: beginLiveEdit(env.services.store, '輪郭線の影響幅'), lineId: found.line.id };
      }
      const id = radiusEdit.lineId;
      radiusEdit.live.update(() => patchLineCommand(id, { radius }, '輪郭線の影響幅'));
      env.requestRedraw();
    },
    endRadius() {
      radiusEdit?.live.commit();
      radiusEdit = null;
    },
    setWithPart(partId, on) {
      const env = slot.get();
      const found = env ? currentOf(env) : null;
      if (!env || !found) return;
      const ids = found.line.withPartIds.filter((id) => id !== partId);
      env.services.store.dispatch(
        patchLineCommand(found.line.id, { withPartIds: on ? [...ids, partId] : ids }, '一緒に動かすパーツ'),
      );
    },
    candidates() {
      const env = slot.get();
      const found = env ? currentOf(env) : null;
      if (!env || !found) return [];
      const { snap, line } = found;
      const v = lineView(snap, line);
      if (!v) return [];
      return snap.project.model.parts.filter((p) => {
        if (p.kind !== 'image' || p.id === line.partId || !p.meshId || isLockedDeep(snap.project.model, p.id))
          return false;
        if (line.withPartIds.includes(p.id)) return true;
        const got = positionsOf(snap, env, p.id);
        return !!got && got.positions.some((q) => distanceToLine(q, v.samples) < line.radius);
      });
    },
    spacing() {
      const env = slot.get();
      const found = env ? currentOf(env) : null;
      if (!env || !found || !found.snap.mesh || !found.snap.size) return null;
      const on = contourOnMesh(found.snap.mesh, found.line.points, found.snap.size);
      if (!on) return null;
      const base = on.samples.map((a) => attachedPoint(a, found.snap.mesh!.vertices));
      const count = verticesNearLine(found.snap.mesh.vertices, base);
      return { count, spacing: count > 0 ? lineLength(base) / count : Infinity };
    },
    settled: async () => {
      await pending;
      if (drag?.kind === 'handles') await drag.keyed.settled();
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
