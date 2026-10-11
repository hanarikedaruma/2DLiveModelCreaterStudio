import { describe, expect, it, vi } from 'vitest';
import { attachPoint, attachedPoint, createBindingEvaluator, createDeformPipeline } from '@app/core';
import type { ProjectStoreWithHistory } from '@app/core';
import type { ContourLine, Mesh, Project, Vec2 } from '@app/schema';
import { repairProject } from '@app/io';
import { createFakeServices } from '../../../services';
import { createKeyEditor } from '../../../services/keyEditor';
import { canvasToScreen } from '../../../shell/canvas/view';
import { createEnvSlot } from '../canvas/env';
import { NEEDS_KEY_MESSAGE, PREVIEW_OFF_BASE_MESSAGE } from '../canvas/liveEdit';
import { TRANSFER_CONFIRM_MESSAGE } from '../mesh/remesh';
import { copyParts, deleteParts } from '../structure/commands';
import { mirrorCopy } from '../structure/mirrorCopy';
import { makeAsset, makeBinding, makePart, makeProject } from '../structure/testing';
import { addLineCommand } from './commands';
import { LIMIT_MESSAGE, createContourEditor, fitStroke, lineView } from './contourTool';
import { verticesAlongLine } from './densify';

// (100,100) から 200×200 の格子（20px のマス）。素材も同じ位置・大きさ
function gridMesh(id: string): Mesh {
  const vertices: Vec2[] = [];
  const uvs: Vec2[] = [];
  for (let r = 0; r <= 10; r++)
    for (let c = 0; c <= 10; c++) {
      vertices.push({ x: 100 + c * 20, y: 100 + r * 20 });
      uvs.push({ x: c / 10, y: r / 10 });
    }
  const triangles: Mesh['triangles'] = [];
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 10; c++) {
      const a = r * 11 + c;
      triangles.push([a, a + 1, a + 11], [a + 1, a + 12, a + 11]);
    }
  return { id, vertices, uvs, triangles, density: 'custom', edited: false };
}

const asset = (id: string) => makeAsset(id, { width: 200, height: 200, offset: { x: 100, y: 100 } });

function faceProject(): Project {
  return makeProject({
    assets: [asset('face'), asset('art')],
    parts: [
      makePart('face', { assetId: 'face', meshId: 'm-face', name: '顔' }),
      makePart('art', { assetId: 'art', meshId: 'm-art', name: '輪郭の線画' }),
    ],
    meshes: [gridMesh('m-face'), gridMesh('m-art')],
  });
}

// x = 150 の縦の線（キャンバスの y 120〜280）。点は 40px ごとの5つ
const LINE: ContourLine = {
  id: 'line',
  partId: 'face',
  name: '線 1',
  points: [0.1, 0.3, 0.5, 0.7, 0.9].map((y) => ({ x: 0.25, y })),
  radius: 40,
  withPartIds: [],
};

function setup(project: Project = faceProject(), initial: ContourLine | null = LINE) {
  const base = createFakeServices();
  const services = {
    ...base,
    evaluator: createBindingEvaluator(),
    pipeline: createDeformPipeline(),
    keyEditor: createKeyEditor(),
  };
  services.store.load(project);
  if (initial) services.store.dispatch(addLineCommand(initial));
  services.editor.set({ selectedPartIds: ['face'] });
  const slot = createEnvSlot();
  const notify = vi.fn();
  const confirm = vi.fn(async () => true);
  const view = { scale: 1, offset: { x: 0, y: 0 } };
  slot.set({
    services,
    dialogs: { notify, confirm },
    view: () => view,
    lastDeformed: () => null,
    requestRedraw: vi.fn(),
  });
  let clock = 0;
  const editor = createContourEditor(slot, { now: () => clock });
  const tick = (ms = 1000) => (clock += ms);
  const ev = (p: Vec2, extra: { altKey?: boolean; shiftKey?: boolean } = {}) => ({
    canvasPoint: p,
    screenPoint: canvasToScreen(view, p),
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    ...extra,
  });
  const tool = editor.tool;
  const drag = (from: Vec2, to: Vec2, extra: { altKey?: boolean; shiftKey?: boolean } = {}, through: Vec2[] = []) => {
    tick();
    tool.onPointerDown!(ev(from, extra));
    let prev = from;
    for (const target of [...through, to]) {
      for (let i = 1; i <= 4; i++) {
        const t = i / 4;
        tool.onPointerMove!(ev({ x: prev.x + (target.x - prev.x) * t, y: prev.y + (target.y - prev.y) * t }, extra));
      }
      prev = target;
    }
    tool.onPointerUp!(ev(to, extra));
  };
  const click = (p: Vec2) => {
    tool.onPointerDown!(ev(p));
    tool.onPointerUp!(ev(p));
  };
  const key = (k: string) => tool.onKeyDown!(new KeyboardEvent('keydown', { key: k }));
  const store = services.store as ProjectStoreWithHistory;
  const mesh = (id = 'm-face') => store.get().model.meshes.find((m) => m.id === id)!;
  const line = () => store.get().model.contourLines?.find((l) => l.partId === 'face') ?? null;
  return { services, store, editor, notify, confirm, drag, click, key, tick, mesh, line };
}

const at = (m: Mesh, x: number, y: number) => m.vertices.findIndex((v) => v.x === x && v.y === y);

describe('I-068: 輪郭線を引く', () => {
  it('なぞると線ができ、点は絵の上の位置（UV）で保存される。影響幅は長さの 1/4', () => {
    const s = setup(faceProject(), null);
    s.editor.drawNew();
    expect(s.editor.state.get().drawing).toBe(true);
    s.drag({ x: 150, y: 120 }, { x: 150, y: 280 }, {}, [{ x: 150, y: 200 }]);
    const line = s.line()!;
    expect(line.points.length).toBeGreaterThanOrEqual(3);
    for (const p of line.points) expect(p.x).toBeCloseTo(0.25, 6);
    expect(line.points[0]!.y).toBeCloseTo(0.1, 6);
    expect(line.points.at(-1)!.y).toBeCloseTo(0.9, 6);
    expect(line.radius).toBe(40);
    expect(line.name).toBe('線 1');
    expect(s.editor.state.get()).toMatchObject({ drawing: false, lineId: line.id });
    expect(s.store.undoLabel()).toBe('輪郭線を引く');
  });

  it('点を順にクリックし、ダブルクリックで引き終える。Esc でやめる', () => {
    const s = setup(faceProject(), null);
    s.editor.drawNew();
    s.tick();
    s.click({ x: 130, y: 130 });
    s.tick();
    s.click({ x: 170, y: 200 });
    s.tick();
    s.click({ x: 130, y: 270 });
    s.tick(100);
    s.click({ x: 130, y: 270 });
    expect(s.line()!.points).toHaveLength(3);
    s.editor.drawNew();
    s.tick();
    s.click({ x: 200, y: 150 });
    s.key('Escape');
    expect(s.editor.state.get().drawing).toBe(false);
    expect(s.store.get().model.contourLines).toHaveLength(1);
  });

  it('流れ線を使っているパーツには引けない', () => {
    const p = faceProject();
    p.model.curveGuides = [
      {
        id: 'g',
        partId: 'face',
        meshId: 'm-face',
        meshSignature: 'x',
        reference: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: 2 },
        ],
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: 2 },
        ],
        radius: 10,
        rootFraction: 0.1,
        gravity: false,
        enabled: true,
      },
    ];
    const s = setup(p, null);
    s.editor.drawNew();
    s.drag({ x: 150, y: 120 }, { x: 150, y: 280 });
    expect(s.store.get().model.contourLines ?? []).toHaveLength(0);
    expect(s.notify).toHaveBeenCalledWith(expect.stringMatching(/流れ線/));
  });

  it('なぞった線から点を選ぶ: 曲線がなぞった線から外れない数だけ置く', () => {
    const arc = Array.from({ length: 120 }, (_, i) => {
      const a = (Math.PI * i) / 119;
      return { x: 200 + 100 * Math.cos(a) + (i % 2 ? 0.3 : -0.3), y: 100 + 100 * Math.sin(a) };
    });
    const points = fitStroke(arc, 1.5);
    expect(points.length).toBeGreaterThanOrEqual(4);
    expect(points.length).toBeLessThanOrEqual(12);
    expect(points[0]!.x).toBeCloseTo(arc[0]!.x, 0);
  });
});

describe('I-068: 点を動かす', () => {
  it('基準状態: 線の近くの頂点が線と一緒に滑らかに動き、遠くは動かない。1回の Undo で戻る', () => {
    const s = setup();
    const before = s.mesh();
    const lineBefore = (() => {
      const snap = s.editor.snapshot()!;
      return lineView(snap, snap.current!)!;
    })();
    s.drag({ x: 150, y: 200 }, { x: 170, y: 200 });
    const lineAfter = (() => {
      const snap = s.editor.snapshot()!;
      return lineView(snap, snap.current!)!;
    })();
    const after = s.mesh();
    expect(after.edited).toBe(true);
    const dx = (x: number, y: number) => after.vertices[at(before, x, y)]!.x - x;
    // 線の両側 10px の頂点は線と同じだけ（つまんだ所で +20）
    expect(dx(140, 200)).toBeCloseTo(20, 0);
    expect(dx(160, 200)).toBeCloseTo(20, 0);
    // 線の端の点（y 120・280）はほとんど動かない（点を通る曲線なので、隣の区間が少しだけ逆へ動く分）
    for (const k of [0, 4]) {
      expect(Math.abs(lineAfter.handles[k]!.x - lineBefore.handles[k]!.x)).toBeLessThan(0.5);
      expect(lineAfter.handles[k]!.y).toBeCloseTo(lineBefore.handles[k]!.y, 6);
    }
    // 線の両側の頂点は、同じ高さの線の動きについていく（点を通る曲線なので、隣の区間は少しだけ逆へ動く）
    const shiftAt = (y: number) => {
      const j = lineBefore.samples.findIndex((q) => q.y >= y - 1e-9);
      return lineAfter.samples[j]!.x - lineBefore.samples[j]!.x;
    };
    for (const y of [120, 140, 160, 180, 200, 220, 240, 260, 280]) {
      expect(Math.abs(dx(140, y) - shiftAt(y))).toBeLessThan(1.5);
      expect(Math.abs(dx(160, y) - shiftAt(y))).toBeLessThan(1.5);
    }
    expect(Math.abs(dx(140, 120))).toBeLessThan(0.5);
    expect(Math.abs(dx(140, 280))).toBeLessThan(0.5);
    // 影響幅（40px）の外は動かない
    expect(dx(200, 200)).toBe(0);
    expect(dx(100, 200)).toBe(0);
    // y は動かない
    expect(after.vertices.every((v, i) => Math.abs(v.y - before.vertices[i]!.y) < 1e-6)).toBe(true);
    expect(s.store.undoLabel()).toBe('輪郭線で整える');
    s.store.undo();
    expect(s.mesh()).toEqual(before);
  });

  it('つまんだ点はマウスの下に来る（絵についた線がその位置を通る）', () => {
    const s = setup();
    s.drag({ x: 150, y: 200 }, { x: 165, y: 205 });
    const snap = s.editor.snapshot()!;
    const v = lineView(snap, snap.current!)!;
    expect(v.handles[2]!.x).toBeCloseTo(165, 0);
    expect(v.handles[2]!.y).toBeCloseTo(205, 0);
  });

  it('キーの値では、そのキーに記録し、基準の頂点は変えない', () => {
    const s = setup();
    s.services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 30 } });
    const base = s.mesh().vertices;
    s.drag({ x: 150, y: 200 }, { x: 170, y: 200 });
    expect(s.mesh().vertices).toBe(base);
    const b = s.store.get().model.bindings.find((x) => x.target.id === 'm-face')!;
    const key = b.keys.find((k) => k.coords[0] === 30)!;
    const delta = key.delta as Vec2[];
    expect(delta[at(s.mesh(), 140, 200)]!.x).toBeCloseTo(20, 0);
    expect(delta[at(s.mesh(), 200, 200)]!.x).toBe(0);
  });

  it('キーが無い値では「この値にキーを追加して編集しますか？」と確かめ、キーを足してから記録する', async () => {
    const p = faceProject();
    const zeros = gridMesh('m-face').vertices.map(() => ({ x: 0, y: 0 }));
    p.model.bindings = [
      makeBinding('b', {
        target: { type: 'mesh', id: 'm-face' },
        channel: 'vertices',
        keyValues: [[0, 10]],
        keys: [
          { coords: [0], delta: zeros, source: 'manual', locked: false },
          { coords: [10], delta: zeros, source: 'manual', locked: false },
        ],
      }),
    ];
    const s = setup(p);
    s.services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 30 } });
    s.drag({ x: 150, y: 200 }, { x: 170, y: 200 });
    expect(s.confirm).toHaveBeenCalledWith(NEEDS_KEY_MESSAGE);
    await s.editor.settled();
    const b = s.store.get().model.bindings[0]!;
    const key = b.keys.find((k) => k.coords[0] === 30)!;
    expect((key.delta as Vec2[])[at(s.mesh(), 140, 200)]!.x).toBeCloseTo(20, 0);
    s.store.undo();
    expect(s.store.get().model.bindings[0]!.keys.some((k) => k.coords[0] === 30)).toBe(false);
  });

  it('プレビュー中は動かさずに知らせる', () => {
    const s = setup();
    s.services.editor.set({ activeParameterIds: [], editorParamValues: { FaceAngleX: 30 } });
    const before = s.store.get();
    s.drag({ x: 150, y: 200 }, { x: 170, y: 200 });
    expect(s.store.get()).toBe(before);
    expect(s.notify).toHaveBeenCalledWith(PREVIEW_OFF_BASE_MESSAGE);
  });

  it('一緒に動かすパーツも同じだけ動き、線の上でずれない', () => {
    const s = setup(faceProject(), { ...LINE, withPartIds: ['art'] });
    s.drag({ x: 150, y: 200 }, { x: 170, y: 200 });
    const face = s.mesh('m-face');
    const art = s.mesh('m-art');
    face.vertices.forEach((v, i) => {
      expect(Math.abs(v.x - art.vertices[i]!.x)).toBeLessThan(1e-9);
      expect(Math.abs(v.y - art.vertices[i]!.y)).toBeLessThan(1e-9);
    });
    expect(face.vertices[at(gridMesh('x'), 140, 200)]!.x).toBeCloseTo(160, 0);
    s.store.undo();
    expect(s.mesh('m-art')).toEqual(gridMesh('m-art'));
  });

  it('三角形が裏返るほど動かすと、裏返る手前で止めて知らせる', () => {
    const s = setup(faceProject(), { ...LINE, radius: 16 });
    s.drag({ x: 150, y: 200 }, { x: 260, y: 200 });
    expect(s.notify).toHaveBeenCalledWith(LIMIT_MESSAGE);
    const m = s.mesh();
    const area = (t: [number, number, number], v: Vec2[]) =>
      (v[t[1]]!.x - v[t[0]]!.x) * (v[t[2]]!.y - v[t[0]]!.y) - (v[t[1]]!.y - v[t[0]]!.y) * (v[t[2]]!.x - v[t[0]]!.x);
    const original = gridMesh('m');
    m.triangles.forEach((t) => expect(area(t, m.vertices) * area(t, original.vertices)).toBeGreaterThan(0));
    expect(m.vertices[at(original, 140, 200)]!.x).toBeGreaterThan(141);
  });
});

describe('I-068: 点の追加・削除・位置の直し', () => {
  it('Alt+ドラッグは形を変えず、点の絵の上の位置だけを動かす', () => {
    const s = setup();
    const base = s.mesh();
    s.drag({ x: 150, y: 200 }, { x: 160, y: 210 }, { altKey: true });
    expect(s.mesh()).toBe(base);
    const p = s.line()!.points[2]!;
    expect(p.x).toBeCloseTo(0.3, 6);
    expect(p.y).toBeCloseTo(0.55, 6);
    expect(s.store.undoLabel()).toBe('輪郭線の点の位置');
  });

  it('線のダブルクリックで点を足し、Delete で消す。2点より少なくはできない', () => {
    const s = setup();
    s.tick();
    s.click({ x: 150, y: 180 });
    s.tick(100);
    s.click({ x: 150, y: 180 });
    expect(s.line()!.points).toHaveLength(6);
    expect(s.line()!.points[2]!.y).toBeCloseTo(0.4, 3);
    expect(s.editor.state.get().handles).toEqual([2]);
    s.key('Delete');
    expect(s.line()!.points).toHaveLength(5);
    // 4つ選んで消そうとすると残りが1つになるので消さない
    s.services.store.dispatch(addLineCommand({ ...LINE, id: 'two', name: '線 2', points: LINE.points.slice(0, 2) }));
    s.editor.selectLine('two');
    s.tick();
    s.click({ x: 150, y: 120 });
    s.key('Delete');
    expect(s.store.get().model.contourLines!.find((l) => l.id === 'two')!.points).toHaveLength(2);
    expect(s.notify).toHaveBeenCalledWith(expect.stringMatching(/2つより少なく/));
  });

  it('線の上をつまんで動かすと、そこに点を足して動かす。点の追加と変形で1回の Undo', () => {
    const s = setup();
    const before = s.store.get();
    s.drag({ x: 150, y: 180 }, { x: 165, y: 180 });
    expect(s.line()!.points).toHaveLength(6);
    expect(s.mesh().vertices[at(gridMesh('m'), 140, 180)]!.x).toBeGreaterThan(150);
    s.store.undo();
    expect(s.store.get().model.contourLines).toEqual(before.model.contourLines);
    expect(s.mesh()).toEqual(before.model.meshes[0]);
  });
});

describe('I-068: パレットの操作', () => {
  it('線に合わせて整える: 頂点で動かしてできた段々を、点を通る滑らかな形にそろえる', async () => {
    const p = faceProject();
    // 線のそばの頂点を1つだけ動かして、絵についた線に段を作る
    const m = p.model.meshes[0]!;
    const i = at(m, 160, 200);
    p.model.meshes[0] = { ...m, vertices: m.vertices.map((v, k) => (k === i ? { x: v.x + 8, y: v.y } : v)) };
    const s = setup(p);
    const deviation = () => {
      const snap = s.editor.snapshot()!;
      const v = lineView(snap, snap.current!)!;
      const target = v.on.basis.weights.map((w) =>
        v.handles.reduce((acc, h, k) => ({ x: acc.x + w[k]! * h.x, y: acc.y + w[k]! * h.y }), { x: 0, y: 0 }),
      );
      return Math.max(...v.samples.map((q, j) => Math.hypot(q.x - target[j]!.x, q.y - target[j]!.y)));
    };
    const before = deviation();
    expect(before).toBeGreaterThan(1);
    // 今のメッシュ（20px のマス）のままでも差は減るが、マスより細かい曲がりは出せない
    await s.editor.smooth();
    const coarse = deviation();
    expect(coarse).toBeLessThan(before * 0.7);
    expect(s.store.undoLabel()).toBe('線に合わせて整える');
    // 線に沿って頂点を足してから整えると、線の形にほぼそろう
    s.store.undo();
    await s.editor.densify();
    expect(deviation()).toBeCloseTo(before, 0); // 頂点を足しただけでは、絵（と絵についた線）は変わらない
    await s.editor.smooth();
    expect(s.notify).not.toHaveBeenCalled();
    expect(deviation()).toBeLessThan(0.5);
  });

  it('線に沿って頂点を足す: 絵は変わらず、キーは新しい頂点へ移る', async () => {
    const p = faceProject();
    const delta = gridMesh('m').vertices.map((v) => ({ x: (v.y - 100) / 20, y: 0 }));
    p.model.bindings = [
      makeBinding('b', {
        target: { type: 'mesh', id: 'm-face' },
        channel: 'vertices',
        keyValues: [[0, 30]],
        keys: [
          { coords: [0], delta: delta.map(() => ({ x: 0, y: 0 })), source: 'manual', locked: false },
          { coords: [30], delta, source: 'manual', locked: false },
        ],
      }),
    ];
    const s = setup(p);
    const old = s.mesh();
    await s.editor.densify();
    expect(s.confirm).toHaveBeenCalledWith(TRANSFER_CONFIRM_MESSAGE);
    const next = s.mesh();
    expect(next.vertices.length).toBeGreaterThan(old.vertices.length + 20);
    expect(next.edited).toBe(true);
    // 足した頂点は線（x = 150）の上（内側の辺のすぐそばなら辺の上へ寄せる）にあり、
    // UV は元のメッシュのその位置と同じ（絵が変わらない）
    const added = next.vertices.slice(old.vertices.length);
    for (const [k, v] of added.entries()) {
      expect(Math.abs(v.x - 150)).toBeLessThanOrEqual(1.5);
      const a = attachPoint(old.vertices, old.triangles, v)!;
      const uv = attachedPoint(a, old.uvs);
      expect(next.uvs[old.vertices.length + k]!.x).toBeCloseTo(uv.x, 9);
      expect(next.uvs[old.vertices.length + k]!.y).toBeCloseTo(uv.y, 9);
    }
    // キーも新しい頂点の数になり、足した頂点の差分は元の補間（y に比例）
    const key = s.store.get().model.bindings[0]!.keys.find((k) => k.coords[0] === 30)!;
    const d = key.delta as Vec2[];
    expect(d).toHaveLength(next.vertices.length);
    added.forEach((v, k) => expect(d[old.vertices.length + k]!.x).toBeCloseTo((v.y - 100) / 20, 6));
    expect(s.editor.spacing()!.spacing).toBeLessThan(10);
    expect(s.store.undoLabel()).toBe('線に沿って頂点を足す');
  });

  it('影響幅と一緒に動かすパーツを変えられ、候補は影響幅にかかるパーツ', () => {
    const s = setup();
    expect(s.editor.candidates().map((p) => p.id)).toEqual(['art']);
    s.editor.setWithPart('art', true);
    expect(s.line()!.withPartIds).toEqual(['art']);
    s.editor.beginRadius();
    s.editor.setRadius(60);
    s.editor.setRadius(80);
    s.editor.endRadius();
    expect(s.line()!.radius).toBe(80);
    expect(s.store.undoLabel()).toBe('輪郭線の影響幅');
    s.store.undo();
    expect(s.line()!.radius).toBe(40);
    s.editor.removeLine();
    expect(s.line()).toBeNull();
  });
});

describe('I-068: パーツの削除・複製・左右反転・読み込みの修復', () => {
  it('削除で線を消し、複製で写し、左右反転で絵の上の位置を反転する', () => {
    const s = setup(faceProject(), { ...LINE, withPartIds: ['art'] });
    let n = 0;
    const ids = () => `id${++n}`;
    s.store.dispatch(copyParts(['face'], { newId: ids }));
    const lines = s.store.get().model.contourLines!;
    expect(lines).toHaveLength(2);
    const copy = lines.find((l) => l.partId !== 'face')!;
    expect(copy.points).toEqual(LINE.points);
    expect(copy.withPartIds).toEqual([]); // 一緒に複製していないパーツは外す
    s.store.dispatch(mirrorCopy(['face'], { centerX: 200, assets: [], assetMap: {} }, { newId: ids }));
    const mirrored = s.store.get().model.contourLines!.at(-1)!;
    expect(mirrored.points[0]!.x).toBeCloseTo(0.75, 9);
    expect(mirrored.points[0]!.y).toBeCloseTo(0.1, 9);
    s.store.dispatch(deleteParts(['art']));
    expect(s.store.get().model.contourLines!.find((l) => l.id === LINE.id)!.withPartIds).toEqual([]);
    s.store.dispatch(deleteParts(['face']));
    expect(s.store.get().model.contourLines!.some((l) => l.partId === 'face')).toBe(false);
  });

  it('読み込みで、対象の無い線と、無い一緒に動かすパーツを外す', () => {
    const p = faceProject();
    p.model.contourLines = [
      { ...LINE, withPartIds: ['art', 'gone'] },
      { ...LINE, id: 'lost', partId: 'missing' },
    ];
    const { project, repairs } = repairProject(p);
    expect(project.model.contourLines).toEqual([{ ...LINE, withPartIds: ['art'] }]);
    expect(repairs).toHaveLength(2);
  });

  it('線に沿った頂点は外周の頂点を残す', () => {
    const m = gridMesh('m');
    // 外周の上（x = 100）の線: 外周の頂点の近くには置かず、外周は残る
    const result = verticesAlongLine(m, [
      { x: 101, y: 100 },
      { x: 101, y: 300 },
    ]);
    if (result.ok) {
      for (const v of m.vertices.filter((v) => v.x === 100 || v.y === 100 || v.x === 300 || v.y === 300))
        expect(result.shape.vertices.some((q) => q.x === v.x && q.y === v.y)).toBe(true);
    } else expect(result.error).toMatch(/足せる頂点がありません/);
  });
});
