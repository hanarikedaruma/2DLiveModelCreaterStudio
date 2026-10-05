import reference from '@app/fixtures/reference-model/project.json';
import sample from '@app/fixtures/sample-model/project.json';
import {
  validateProject,
  type Binding,
  type Mesh,
  type ParameterKey,
  type Project,
  type StandardPartType,
  type TransformDelta,
  type Vec2,
} from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createDeformPipeline } from '../deform';
import { createBindingEvaluator } from '../eval';
import { createKeyGenerator } from '../generate';
import { generateSurfaceKeys } from '../generate/surface';
import { createProjectStore } from '../store';
import { createAutoSetup } from './autoSetup';
import { closedLineY, meshSpanAt, normalizeClosedLine } from './closedLine';
import { faceTurnCrossTerm, sphereTurn } from './faceTurn';
import { STEP1_MOTION } from './step1';

// fixtures の sample-model に、3×3 の格子のメッシュと頬（顔と同じ素材）を足したもの（値を手で確かめやすい）
function sampleWithMeshes(): Project {
  const p = validateProject(structuredClone(sample));
  const face = p.model.parts.find((q) => q.standardType === 'face')!;
  p.model.parts.push({ ...face, id: 'cheek', name: '頬染め', standardType: 'cheek' });
  p.model.drawOrder.push('cheek');
  p.model.meshes = p.model.parts.map((q): Mesh => {
    const a = p.assets.find((x) => x.id === q.assetId)!;
    q.meshId = `mesh-${q.id}`;
    const uvs = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y })));
    return {
      id: q.meshId,
      vertices: uvs.map((v) => ({ x: a.offset.x + a.width * v.x, y: a.offset.y + a.height * v.y })),
      uvs,
      triangles: [
        [0, 1, 3],
        [1, 4, 3],
        [1, 2, 4],
        [2, 5, 4],
        [3, 4, 6],
        [4, 7, 6],
        [4, 5, 7],
        [5, 8, 7],
      ],
      density: 'custom',
      edited: false,
    };
  });
  return p;
}
// fixtures の reference-model（本物のメッシュ・頬・上まぶたの子のまつげがあり、MVP のかんたんセットアップ済み）
const referenceModel = (): Project => validateProject(structuredClone(reference));

const run = (p: Project) => createAutoSetup().plan(p).command.apply(p);
const part = (p: Project, type: StandardPartType) => p.model.parts.find((q) => q.standardType === type)!;
const asset = (p: Project, type: StandardPartType) => p.assets.find((a) => a.id === part(p, type).assetId)!;
const meshOf = (p: Project, type: StandardPartType) => p.model.meshes.find((m) => m.id === part(p, type).meshId)!;
const faceWarp = (p: Project) => p.model.warps.find((w) => w.partId === part(p, 'faceGroup').id)!;
const ZERO: TransformDelta = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };

// 対象の種類・パラメータの組（順も同じ）・チャンネルでバインディングを探す
function binding(
  p: Project,
  type: StandardPartType,
  parameterIds: string[],
  channel: Binding['channel'] = 'transform',
): Binding | undefined {
  const target = part(p, type);
  const id = channel === 'vertices' ? target.meshId : channel === 'warpPoints' ? faceWarp(p).id : target.id;
  return p.model.bindings.find(
    (b) =>
      b.target.id === id &&
      b.channel === channel &&
      b.parameterIds.length === parameterIds.length &&
      b.parameterIds.every((q, i) => q === parameterIds[i]),
  );
}
const keyAt = (b: Binding | undefined, ...coords: number[]) =>
  b?.keys.find((k) => k.coords.length === coords.length && k.coords.every((c, i) => c === coords[i]));
const transformAt = (b: Binding | undefined, coord: number) => keyAt(b, coord)!.delta as TransformDelta;
const pointsAt = (b: Binding | undefined, ...coords: number[]) => keyAt(b, ...coords)!.delta as Vec2[];

function withLine(p: Project, side: 'L' | 'R', line: Vec2[] | null): Project {
  const key = side === 'L' ? 'closedLineL' : 'closedLineR';
  return { ...p, model: { ...p.model, setupHints: { ...p.model.setupHints, [key]: line } } };
}
function replaceBinding(p: Project, b: Binding): Project {
  return { ...p, model: { ...p.model, bindings: p.model.bindings.map((q) => (q.id === b.id ? b : q)) } };
}

// パラメータの値（指定の無いものはデフォルト値）で変形した結果
function deformAt(p: Project, values: Record<string, number> = {}) {
  const params: Record<string, number> = {};
  for (const q of p.model.parameters) params[q.id] = q.default;
  Object.assign(params, values);
  const deformed = createDeformPipeline().deform(p.model, createBindingEvaluator().evaluate(p.model, params));
  const points = (partId: string): Vec2[] => {
    const positions = deformed.byPartId[partId]!.positions;
    const out: Vec2[] = [];
    for (let i = 0; i < positions.length; i += 2) out.push({ x: positions[i]!, y: positions[i + 1]! });
    return out;
  };
  return Object.assign(points, { opacity: (partId: string) => deformed.byPartId[partId]!.opacity });
}
const center = (points: Vec2[]): Vec2 => ({
  x: points.reduce((s, q) => s + q.x, 0) / points.length,
  y: points.reduce((s, q) => s + q.y, 0) / points.length,
});
const flat = (points: Vec2[]) => points.flatMap((q) => [q.x, q.y]);
const sum = (...lists: Vec2[][]): Vec2[] =>
  lists[0]!.map((_, i) => ({
    x: lists.reduce((s, l) => s + l[i]!.x, 0),
    y: lists.reduce((s, l) => s + l[i]!.y, 0),
  }));
const scaled = (points: Vec2[], k: number): Vec2[] => points.map((q) => ({ x: q.x * k, y: q.y * k }));
const expectClose = (actual: number[], expected: number[], digits = 3) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, digits));
};

// 閉じた目の線（L）。reference-model の目 L（白目 1074〜1306 × 860〜1020）の下のほう
const LINE_L = [
  { x: 1060, y: 985 },
  { x: 1190, y: 1000 },
  { x: 1320, y: 985 },
];
// sample-model の目 L（白目 537〜653 × 430〜510）の下のほう
const SAMPLE_LINE_L = [
  { x: 530, y: 486 },
  { x: 595, y: 496 },
  { x: 660, y: 486 },
];

describe('顔の向き（曲面）', () => {
  it('faceGroup に子の外接矩形 + 5% の 4×4 の規則的な格子を足す（見た目は変わらない）', () => {
    const before = sampleWithMeshes();
    const p = run(before);
    const w = faceWarp(p);
    expect(p.model.warps).toHaveLength(1);
    // 顔 270〜730 × 190〜710 に 23・26 の余白
    expect(w).toMatchObject({ columns: 4, rows: 4, bounds: { x: 247, y: 164, width: 506, height: 572 } });
    expect(w.points).toHaveLength(25);
    expect(w.points[6]).toEqual({ x: 247 + 506 / 4, y: 164 + 572 / 4 });
    expectClose(flat(deformAt(p)('part-face')), flat(deformAt(before)('part-face')));
  });

  it('FaceAngleX・Y の制御点のキーは −30・0・30（auto）と10刻み（generated）で、カード31の曲面と同じ', () => {
    const p = run(sampleWithMeshes());
    const w = faceWarp(p);
    const generator = createKeyGenerator();
    for (const id of ['FaceAngleX', 'FaceAngleY'] as const) {
      const b = binding(p, 'faceGroup', [id], 'warpPoints')!;
      expect(b.generation).toBe('surface');
      expect(b.keyValues).toEqual([[-30, -20, -10, 0, 10, 20, 30]]);
      expect(b.keys.map((k) => k.source)).toEqual([
        'auto',
        'generated',
        'generated',
        'auto',
        'generated',
        'generated',
        'auto',
      ]);
      expect(b.keys.every((k) => !k.locked)).toBe(true);
      expect(b.keys.map((k) => k.delta)).toEqual(generateSurfaceKeys(w, id, b.keyValues[0]!));
      // KeyGenerator.surface で作り直しても同じ
      expect(generator.surface(b, p.model)).toBe(b);
    }
    // 30 で真ん中の制御点は右（X）・上（Y）へ動き、端の点より大きく動く。−30 は裏返し
    const x = binding(p, 'faceGroup', ['FaceAngleX'], 'warpPoints');
    const y30 = pointsAt(binding(p, 'faceGroup', ['FaceAngleY'], 'warpPoints'), 30);
    expect(pointsAt(x, 30)[12]!.x).toBeGreaterThan(100);
    expect(pointsAt(x, 30)[12]!.x).toBeGreaterThan(pointsAt(x, 30)[14]!.x);
    expect(pointsAt(x, -30)[12]!.x).toBeCloseTo(-pointsAt(x, 30)[12]!.x, 9);
    expect(y30[12]!.y).toBeLessThan(-100);
    // 顔の中の瞳も右へ動く
    expect(
      center(deformAt(p, { FaceAngleX: 30 })('part-irisL')).x - center(deformAt(p)('part-irisL')).x,
    ).toBeGreaterThan(50);
  });

  it('斜め方向は2パラメータのバインディングで、斜めの4マスに球の回転の補正を持つ（軸の上は左右と上下の和）', () => {
    const p = run(sampleWithMeshes());
    const w = faceWarp(p);
    const b = binding(p, 'faceGroup', ['FaceAngleX', 'FaceAngleY'], 'warpPoints')!;
    expect(b.generation).toBe('linear');
    expect(b.keyValues).toEqual([
      [-30, 0, 30],
      [-30, 0, 30],
    ]);
    expect(b.keys.map((k) => k.coords)).toEqual([
      [-30, -30],
      [-30, 30],
      [0, 0],
      [30, -30],
      [30, 30],
    ]);
    expect(b.keys.every((k) => k.source === 'auto' && !k.locked)).toBe(true);
    expect(pointsAt(b, 0, 0).every((d) => d.x === 0 && d.y === 0)).toBe(true);
    for (const [cx, cy] of [
      [-30, -30],
      [-30, 30],
      [30, -30],
      [30, 30],
    ] as const) {
      expect(pointsAt(b, cx, cy)).toEqual(faceTurnCrossTerm(w, cx, cy));
    }

    const evaluator = createBindingEvaluator();
    const at = (fx: number, fy: number) => [
      ...evaluator.evaluate(p.model, { FaceAngleX: fx, FaceAngleY: fy }).warpPoints[w.id]!,
    ];
    const surface = (id: 'FaceAngleX' | 'FaceAngleY', v: number) => generateSurfaceKeys(w, id, [v])[0]!;
    // 軸の上は補正なし
    expectClose(at(30, 0), flat(surface('FaceAngleX', 30)));
    expectClose(at(0, -30), flat(surface('FaceAngleY', -30)));
    // 斜めは和 + 補正。真ん中の制御点は球を斜めに回した位置（左右・上下の和より少し小さい）
    expectClose(
      at(30, 30),
      flat(sum(surface('FaceAngleX', 30), surface('FaceAngleY', 30), faceTurnCrossTerm(w, 30, 30))),
    );
    const r = 0.6 * 572;
    const phi = Math.hypot(20, 20) * (Math.PI / 180);
    const turned = at(30, 30);
    expect(turned[24]).toBeCloseTo((r * Math.sin(phi)) / Math.SQRT2, 2);
    expect(turned[25]).toBeCloseTo((-r * Math.sin(phi)) / Math.SQRT2, 2);
    expect(turned[24]).toBeLessThan(surface('FaceAngleX', 30)[12]!.x);
    // 途中は双線形（15, 15 で補正の 1/4。左右・上下は 10 と 20 のキーの間）
    const mid = (id: 'FaceAngleX' | 'FaceAngleY') => scaled(sum(surface(id, 10), surface(id, 20)), 0.5);
    expectClose(
      at(15, 15),
      flat(sum(mid('FaceAngleX'), mid('FaceAngleY'), scaled(faceTurnCrossTerm(w, 30, 30), 0.25))),
    );
  });

  it('既にある faceGroup のワープはそのまま使い、使えない形なら曲面を作らずに警告する', () => {
    const first = run(sampleWithMeshes());
    const w = faceWarp(first);
    const moved = { ...w, points: w.points.map((q, i) => (i === 0 ? { x: q.x - 5, y: q.y } : q)) };
    const out = run({ ...first, model: { ...first.model, warps: [moved] } });
    expect(out.model.warps).toEqual([moved]);
    expect(pointsAt(binding(out, 'faceGroup', ['FaceAngleX'], 'warpPoints'), 30)).toEqual(
      generateSurfaceKeys(moved, 'FaceAngleX', [30])[0],
    );

    const broken = { ...first, model: { ...first.model, warps: [{ ...w, points: w.points.slice(1) }] } };
    const { command, warnings } = createAutoSetup().plan(broken);
    expect(warnings).toEqual(['顔の変形のワープが使えない形のため、曲面の顔の向きは作られません']);
    expect(command.apply(broken).model.bindings.some((b) => b.channel === 'warpPoints')).toBe(false);
  });
});

describe('目 笑顔・眉・口 横幅・体の追従・頬染め（transform）', () => {
  it('キーの向きと値が表のとおり（source auto・未ロック）', () => {
    const p = run(sampleWithMeshes());
    for (const side of ['L', 'R'] as const) {
      const white = asset(p, `eyeWhite${side}`);
      const lid = binding(p, `lowerLid${side}`, [`EyeSmile${side}`]);
      expect(transformAt(lid, 0)).toEqual(ZERO);
      expect(transformAt(lid, 1)).toEqual({ ...ZERO, position: { x: 0, y: -white.height * 0.25 } });
      expect(transformAt(binding(p, `eyeWhite${side}`, [`EyeSmile${side}`]), 1)).toEqual({
        ...ZERO,
        scale: { x: 1, y: 0.6 },
      });
      expect(part(p, `eyeWhite${side}`).pivot.y).toBe(white.offset.y + white.height); // ピボットは下端
      const brow = asset(p, `brow${side}`);
      for (const coord of [-1, 1]) {
        expect(transformAt(binding(p, `brow${side}`, [`BrowY${side}`]), coord).position.y).toBeCloseTo(
          -coord * brow.height * 0.8,
          9,
        );
        expect(transformAt(binding(p, `brow${side}`, [`BrowForm${side}`]), coord).rotation).toBe(
          coord * (side === 'L' ? -12 : 12),
        );
      }
    }
    for (const type of ['upperLip', 'lowerLip', 'mouthInside'] as const) {
      expect(transformAt(binding(p, type, ['MouthWidth']), -1).scale).toEqual({ x: 0.75, y: 1 });
      expect(transformAt(binding(p, type, ['MouthWidth']), 1).scale).toEqual({ x: 1.2, y: 1 });
    }
    expect(binding(p, 'teeth', ['MouthWidth'])).toBeUndefined();
    const torso = asset(p, 'torso');
    for (const coord of [-10, 10]) {
      expect(transformAt(binding(p, 'bodyRoot', ['BodyAngleZ']), coord).rotation).toBe((coord / 10) * 4);
      expect(transformAt(binding(p, 'bodyRoot', ['BodyAngleX']), coord).position.x).toBeCloseTo(
        (coord / 10) * torso.width * 0.03,
        9,
      );
    }
    expect(binding(p, 'bodyRoot', ['BodyAngleY'])).toBeUndefined();
    // 頬染め: 値 0 で消える（0 ではなく、あとからキーで上げ直せる 0.001）、値 1 で差分なし
    const cheek = binding(p, 'cheek', ['Cheek']);
    expect(STEP1_MOTION.cheekHidden).toBe(0.001);
    expect(transformAt(cheek, 0)).toEqual({ ...ZERO, opacity: 0.001 });
    expect(transformAt(cheek, 1)).toEqual(ZERO);

    const step1 = new Set([
      'EyeSmileL',
      'EyeSmileR',
      'BrowYL',
      'BrowYR',
      'BrowFormL',
      'BrowFormR',
      'MouthWidth',
      'BodyAngleX',
      'BodyAngleZ',
      'Cheek',
    ]);
    const made = p.model.bindings.filter((b) => step1.has(b.parameterIds[0]!));
    // 目 笑顔 2×2・眉 2×2・口 横幅 3・体 2・頬 1
    expect(made).toHaveLength(14);
    for (const b of made) {
      expect(b.channel).toBe('transform');
      expect(b.generation).toBe('linear');
      expect(b.keys.every((k) => k.source === 'auto' && !k.locked)).toBe(true);
    }
  });

  it('変形した見た目の向き（笑顔・怒り・眉の上下・体・口の横幅・頬）', () => {
    const p = run(sampleWithMeshes());
    const base = deformAt(p);
    const ys = (q: Vec2[]) => q.map((v) => v.y);
    // 目 笑顔 1: 下まぶたが白目の高さ 80 × 0.25 上がり、白目は下端 510 へ 0.6 倍に縮む
    const smile = deformAt(p, { EyeSmileL: 1 });
    expect(center(smile('part-lowerLidL')).y - center(base('part-lowerLidL')).y).toBeCloseTo(-20, 3);
    expect(Math.max(...ys(smile('part-eyeWhiteL')))).toBeCloseTo(510, 3);
    expect(Math.min(...ys(smile('part-eyeWhiteL')))).toBeCloseTo(510 - 80 * 0.6, 3);
    // 眉 形 1（怒り）: L は左端（内側）が下がり右端が上がる。R はその逆（上の行の 0 番が左端、2 番が右端）
    const angry = deformAt(p, { BrowFormL: 1, BrowFormR: 1 });
    for (const [id, inner, outer] of [
      ['part-browL', 0, 2],
      ['part-browR', 2, 0],
    ] as const) {
      expect(angry(id)[inner]!.y).toBeGreaterThan(base(id)[inner]!.y);
      expect(angry(id)[outer]!.y).toBeLessThan(base(id)[outer]!.y);
    }
    // 眉 上下 1: 眉の高さ 23 × 0.8 上がる
    expect(center(deformAt(p, { BrowYR: 1 })('part-browR')).y - center(base('part-browR')).y).toBeCloseTo(-18.4, 3);
    // 体 傾き 10: 胴体の下端中央を中心に時計回り（頭は右へ）。体 左右 10: 胴体の幅 600 × 0.03 右へ
    expect(center(deformAt(p, { BodyAngleZ: 10 })('part-face')).x).toBeGreaterThan(center(base('part-face')).x + 50);
    expect(center(deformAt(p, { BodyAngleX: 10 })('part-torso')).x - center(base('part-torso')).x).toBeCloseTo(18, 3);
    // 口 横幅 1: 唇の幅が 1.2 倍
    const width = (q: Vec2[]) => Math.max(...q.map((v) => v.x)) - Math.min(...q.map((v) => v.x));
    expect(width(deformAt(p, { MouthWidth: 1 })('part-upperLip'))).toBeCloseTo(88 * 1.2, 3);
    expect(width(deformAt(p, { MouthWidth: -1 })('part-upperLip'))).toBeCloseTo(88 * 0.75, 3);
    // 頬染め: デフォルト値 0 で 0.001、1 で元の不透明度
    expect(base.opacity('cheek')).toBeCloseTo(0.001, 9);
    expect(deformAt(p, { Cheek: 1 }).opacity('cheek')).toBe(1);
    expect(deformAt(p, { Cheek: 0.5 }).opacity('cheek')).toBeCloseTo(0.5005, 9);
  });
});

describe('口 形（頂点）', () => {
  it('値 1 で上唇・下唇の両端 20%（口の幅で測る）の頂点が口の幅 × 0.06 上がり、−1 で下がる。中央は動かない', () => {
    const p = run(sampleWithMeshes());
    // 口の幅 = 上唇と下唇の外接矩形 456〜544（88）。両端は 473.6 以下と 526.4 以上
    const lift = 88 * 0.06;
    for (const type of ['upperLip', 'lowerLip'] as const) {
      const b = binding(p, type, ['MouthForm'], 'vertices')!;
      expect(b.keyValues).toEqual([[-1, 0, 1]]);
      expect(b.generation).toBe('linear');
      expect(b.keys.every((k) => k.source === 'auto' && !k.locked)).toBe(true);
      for (const coord of [-1, 0, 1]) {
        expect(pointsAt(b, coord)).toEqual(
          Array.from({ length: 9 }, (_, i) => ({ x: 0, y: i % 3 === 1 ? 0 : -coord * lift + 0 })),
        );
      }
    }
    expect(binding(p, 'mouthInside', ['MouthForm'], 'vertices')).toBeUndefined();
  });

  it('本物のメッシュでも、上唇と下唇の口角が同じだけ動く', () => {
    const p = run(referenceModel());
    // 上唇 912〜1088・下唇 920〜1080 → 口の幅 176
    const width = 176;
    for (const type of ['upperLip', 'lowerLip'] as const) {
      const delta = pointsAt(binding(p, type, ['MouthForm'], 'vertices'), 1);
      meshOf(p, type).vertices.forEach((v, i) => {
        const end = v.x <= 912 + width * 0.2 || v.x >= 1088 - width * 0.2;
        expect(delta[i]).toEqual({ x: 0, y: end ? -width * 0.06 : 0 });
      });
      expect(delta.some((d) => d.y !== 0) && delta.some((d) => d.y === 0)).toBe(true);
    }
  });
});

describe('目 開閉（曲線）', () => {
  it('線が無ければ MVP の閉じ方のまま（MVP のバインディングは変わらず、STEP1 のものは後ろに足される）', () => {
    const ref = referenceModel();
    const p = run(ref);
    for (const side of ['L', 'R'] as const) {
      expect(binding(p, `upperLid${side}`, [`EyeOpen${side}`], 'vertices')).toBeUndefined();
      expect(binding(p, `eyeWhite${side}`, [`EyeOpen${side}`], 'vertices')).toBeUndefined();
    }
    expect(p.model.bindings.slice(0, ref.model.bindings.length)).toEqual(ref.model.bindings);
    expect(run(p)).toBe(p);
  });

  it('線があれば、値 0 で上まぶたが線の上の一定の厚みの帯になり（下端が線に乗る）、白目は線へ閉じる', () => {
    const p = run(withLine(referenceModel(), 'L', LINE_L));
    const line = normalizeClosedLine(LINE_L)!;
    const lidMesh = meshOf(p, 'upperLidL');
    const closed = deformAt(p, { EyeOpenL: 0 });
    // 上まぶた 1050〜1330 の真ん中（1190）の厚み 846〜約876
    const middle = meshSpanAt(lidMesh, 1190)!;
    const thickness = middle.bottom - middle.top;
    expect(thickness).toBeGreaterThan(29);
    let bottoms = 0;
    let tops = 0;
    closed(part(p, 'upperLidL').id).forEach((v, i) => {
      const b = lidMesh.vertices[i]!;
      const span = meshSpanAt(lidMesh, b.x)!;
      const to = closedLineY(line, b.x);
      expect(v.x).toBeCloseTo(b.x, 3);
      expect(v.y).toBeCloseTo(to - thickness + ((b.y - span.top) / (span.bottom - span.top)) * thickness, 2);
      // 下端の頂点は線の上、上端の頂点は線から厚みだけ上
      if (Math.abs(b.y - span.bottom) < 1e-6) {
        expect(v.y).toBeCloseTo(to, 2);
        bottoms++;
      }
      if (Math.abs(b.y - span.top) < 1e-6) {
        expect(v.y).toBeCloseTo(to - thickness, 2);
        tops++;
      }
    });
    expect(bottoms).toBeGreaterThan(3);
    expect(tops).toBeGreaterThan(3);
    // 上まぶたの子（まつげ）は MVP の平行移動（白目の下端 1020 − 上まぶたの下端 916 = 104）だけではなく、
    // 上まぶたの下端と一緒に線に沿う（次のテスト。I-040）
    // 白目: すべての頂点が、線に沿わせた上まぶたの帯の真ん中（線の厚みの半分上）に来る
    // （面積がほぼ 0 になって帯に隠れ、白目で切り抜く瞳・ハイライトも消える）
    const closedWhite = (x: number) => closedLineY(line, x) - thickness / 2;
    closed(part(p, 'eyeWhiteL').id).forEach((v) => expect(v.y).toBeCloseTo(closedWhite(v.x), 2));
    // 半分のときは、もとの形と閉じた形の間
    const half = deformAt(p, { EyeOpenL: 0.5 })(part(p, 'eyeWhiteL').id);
    const whiteBase = meshOf(p, 'eyeWhiteL').vertices;
    half.forEach((v, i) => {
      const b = whiteBase[i]!;
      expect(v.y).toBeCloseTo((b.y + closedWhite(b.x)) / 2, 2);
    });
    // 値 1 は差分 0。白目の MVP の縦の縮みは外し、上まぶた・下まぶたの MVP の平行移動は残す
    for (const type of ['upperLidL', 'eyeWhiteL'] as const) {
      const b = binding(p, type, ['EyeOpenL'], 'vertices')!;
      expect(b.keyValues).toEqual([[0, 1]]);
      expect(pointsAt(b, 1).every((d) => d.x === 0 && d.y === 0)).toBe(true);
      expect(b.keys.every((k) => k.source === 'auto' && !k.locked)).toBe(true);
    }
    expect(binding(p, 'eyeWhiteL', ['EyeOpenL'])).toBeUndefined();
    expect(transformAt(binding(p, 'upperLidL', ['EyeOpenL']), 0).position.y).toBe(104);
    expect(transformAt(binding(p, 'lowerLidL', ['EyeOpenL']), 0).position.y).toBe(-16);
    // 線の無い R は MVP のまま
    expect(binding(p, 'upperLidR', ['EyeOpenR'], 'vertices')).toBeUndefined();
    expect(transformAt(binding(p, 'eyeWhiteR', ['EyeOpenR']), 0).scale.y).toBe(0.08);
    expect(run(p)).toBe(p);
  });

  it('線があれば、上まぶたの子（まつげ）も上まぶたの下端と一緒に線に沿って閉じる（I-040）', () => {
    const p = run(withLine(referenceModel(), 'L', LINE_L));
    const lidId = part(p, 'upperLidL').id;
    const lidMesh = meshOf(p, 'upperLidL');
    const lashMesh = p.model.meshes.find((m) => m.id === 'mesh-lashL')!;
    expect(p.model.parts.find((q) => q.id === 'part-lashL')!.parentId).toBe(lidId);
    // 変形した上まぶたの下端の高さ（x は上まぶたの横の範囲 1050〜1330 に収める。まつげは右端の外にはみ出す）
    const lowerEdge = (lid: Vec2[], x: number) =>
      meshSpanAt({ vertices: lid, triangles: lidMesh.triangles }, Math.min(Math.max(x, 1050), 1330))!.bottom;
    const open = deformAt(p);
    for (const value of [0, 0.5]) {
      const closed = deformAt(p, { EyeOpenL: value });
      const lash = closed('part-lashL');
      expect(lash).toHaveLength(lashMesh.vertices.length);
      lash.forEach((v, i) => {
        const base = open('part-lashL')[i]!;
        expect(v.x).toBeCloseTo(base.x, 3);
        // まつげの頂点と上まぶたの下端の縦の間隔は、開いたときと変わらない
        const gap = v.y - lowerEdge(closed(lidId), v.x);
        expect(Math.abs(gap - (base.y - lowerEdge(open(lidId), base.x)))).toBeLessThan(0.5);
      });
    }
    // 右端（x 1330 より外）の頂点は、上まぶたの右端の下端と同じだけ下がる（916 → 線の 985 で 69。MVP の 104 ではない）
    const closed = deformAt(p, { EyeOpenL: 0 })('part-lashL');
    const outside = lashMesh.vertices.flatMap((v, i) => (v.x >= 1330 ? [i] : []));
    expect(outside.length).toBeGreaterThan(1);
    for (const i of outside) expect(closed[i]!.y - open('part-lashL')[i]!.y).toBeCloseTo(69, 3);
    // まつげの頂点のバインディング: 値 0 で線に沿う残りの分、値 1 は差分 0（auto）
    const b = p.model.bindings.find((q) => q.channel === 'vertices' && q.target.id === lashMesh.id)!;
    expect(b.parameterIds).toEqual(['EyeOpenL']);
    expect(b.keyValues).toEqual([[0, 1]]);
    expect(pointsAt(b, 1).every((d) => d.x === 0 && d.y === 0)).toBe(true);
    expect(b.keys.every((k) => k.source === 'auto' && !k.locked)).toBe(true);
    // 線の無い R のまつげは MVP のまま
    expect(p.model.bindings.some((q) => q.channel === 'vertices' && q.target.id === 'mesh-lashR')).toBe(false);
    expect(run(p)).toBe(p);
  });

  it('3×3 の格子のメッシュでも、上まぶたの下端が線に乗り、白目は線へ閉じる', () => {
    const p = run(withLine(sampleWithMeshes(), 'L', SAMPLE_LINE_L));
    const line = normalizeClosedLine(SAMPLE_LINE_L)!;
    const closed = deformAt(p, { EyeOpenL: 0 });
    // 上まぶた L 525〜665 × 422〜458（厚み 36）: 下の行（6〜8番）が線へ、上の行（0〜2番）は線の 36 上
    const lid = closed('part-upperLidL');
    for (const i of [6, 7, 8]) expect(lid[i]!.y).toBeCloseTo(closedLineY(line, lid[i]!.x), 3);
    for (const i of [0, 1, 2]) expect(lid[i]!.y).toBeCloseTo(closedLineY(line, lid[i]!.x) - 36, 3);
    // 白目 L 537〜653 × 430〜510: すべての頂点が上まぶたの帯の真ん中（線の 18 上）へ
    for (const v of closed('part-eyeWhiteL')) expect(v.y).toBeCloseTo(closedLineY(line, v.x) - 18, 3);
  });

  it('線をどちら向きに引いても同じ。線を消すと頂点のキーを外して MVP の閉じ方に戻る', () => {
    const forward = run(withLine(referenceModel(), 'L', LINE_L));
    const backward = run(withLine(referenceModel(), 'L', [...LINE_L].reverse()));
    for (const type of ['upperLidL', 'eyeWhiteL'] as const) {
      expect(binding(backward, type, ['EyeOpenL'], 'vertices')!.keys).toEqual(
        binding(forward, type, ['EyeOpenL'], 'vertices')!.keys,
      );
    }
    const lashKeys = (p: Project) =>
      p.model.bindings.find((b) => b.channel === 'vertices' && b.target.id === 'mesh-lashL')?.keys;
    expect(lashKeys(backward)).toEqual(lashKeys(forward));
    const cleared = run(withLine(forward, 'L', null));
    expect(binding(cleared, 'upperLidL', ['EyeOpenL'], 'vertices')).toBeUndefined();
    expect(binding(cleared, 'eyeWhiteL', ['EyeOpenL'], 'vertices')).toBeUndefined();
    expect(lashKeys(cleared)).toBeUndefined();
    expect(transformAt(binding(cleared, 'eyeWhiteL', ['EyeOpenL']), 0).scale.y).toBe(0.08);
    expect(cleared.model.bindings).toHaveLength(run(referenceModel()).model.bindings.length);
  });

  it.each([
    { line: [] as Vec2[], warned: false },
    { line: [{ x: 10, y: 20 }], warned: true },
    {
      line: [
        { x: 10, y: 20 },
        { x: 10, y: 30 },
      ],
      warned: true,
    },
  ])('使えない線 $line なら MVP のまま', ({ line, warned }) => {
    const p = withLine(referenceModel(), 'L', line);
    const { command, warnings } = createAutoSetup().plan(p);
    expect(warnings).toEqual(warned ? ['閉じた目の線 L は横の幅が無いため、まばたきは線に沿いません'] : []);
    const out = command.apply(p);
    expect(binding(out, 'upperLidL', ['EyeOpenL'], 'vertices')).toBeUndefined();
    expect(transformAt(binding(out, 'eyeWhiteL', ['EyeOpenL']), 0).scale.y).toBe(0.08);
  });

  it('上まぶたが無い側の線は使わず、警告を出す', () => {
    const ref = referenceModel();
    const parts = ref.model.parts.filter((q) => q.standardType !== 'upperLidL' && q.parentId !== 'part-upperLidL');
    const ids = new Set(parts.map((q) => q.id));
    const drawOrder = ref.model.drawOrder.filter((id) => ids.has(id));
    const p = withLine({ ...ref, model: { ...ref.model, parts, drawOrder } }, 'L', LINE_L);
    const { command, warnings } = createAutoSetup().plan(p);
    expect(warnings).toContain('上まぶた L がないため、閉じた目の線 L は使われません');
    expect(binding(command.apply(p), 'eyeWhiteL', ['EyeOpenL'], 'vertices')).toBeUndefined();
  });

  it('MVP の閉じ方を手で直したパーツには、頂点の閉じ方を重ねない', () => {
    const first = run(referenceModel());
    const lid = binding(first, 'upperLidL', ['EyeOpenL'])!;
    const manual = lid.keys.map((k, i) => (i === 0 ? { ...k, source: 'manual' as const } : k));
    const out = run(withLine(replaceBinding(first, { ...lid, keys: manual }), 'L', LINE_L));
    expect(binding(out, 'upperLidL', ['EyeOpenL'])!.keys).toEqual(manual);
    expect(binding(out, 'upperLidL', ['EyeOpenL'], 'vertices')).toBeUndefined();
    // 上まぶたの子（まつげ）も、手で直した上まぶたの閉じ方についていくだけ
    expect(out.model.bindings.some((b) => b.channel === 'vertices' && b.target.id === 'mesh-lashL')).toBe(false);
    // 白目は線そのものへ閉じる（線に沿わせた上まぶたが無いので）
    const line = normalizeClosedLine(LINE_L)!;
    const white = meshOf(out, 'eyeWhiteL').vertices;
    expect(pointsAt(binding(out, 'eyeWhiteL', ['EyeOpenL'], 'vertices'), 0)).toEqual(
      white.map((v) => ({ x: 0, y: closedLineY(line, v.x) - v.y + 0 })),
    );
  });
});

describe('再実行', () => {
  // 各種のバインディングのキーを1つずつ manual か locked にして、差分も変える
  function edited(start: Project) {
    let p = start;
    const marks: ParameterKey[] = [];
    const mark = (b: Binding | undefined, coords: number[], how: 'manual' | 'locked') => {
      const keys = b!.keys.map((k) => {
        if (!k.coords.every((c, j) => c === coords[j])) return k;
        const delta: ParameterKey['delta'] = Array.isArray(k.delta)
          ? k.delta.map((v) => ({ x: v.x + 3, y: v.y - 2 }))
          : { ...k.delta, position: { x: 7, y: -7 } };
        const next: ParameterKey = how === 'manual' ? { ...k, delta, source: 'manual' } : { ...k, delta, locked: true };
        marks.push(next);
        return next;
      });
      p = replaceBinding(p, { ...b!, keys });
    };
    mark(binding(p, 'faceGroup', ['FaceAngleX'], 'warpPoints'), [-30], 'manual');
    mark(binding(p, 'faceGroup', ['FaceAngleX'], 'warpPoints'), [-20], 'locked');
    mark(binding(p, 'faceGroup', ['FaceAngleX', 'FaceAngleY'], 'warpPoints'), [30, 30], 'manual');
    mark(binding(p, 'upperLidL', ['EyeOpenL'], 'vertices'), [0], 'locked');
    mark(binding(p, 'upperLip', ['MouthForm'], 'vertices'), [1], 'manual');
    mark(binding(p, 'browL', ['BrowYL']), [1], 'locked');
    mark(binding(p, 'cheek', ['Cheek']), [0], 'manual');
    mark(binding(p, 'bodyRoot', ['BodyAngleZ']), [10], 'locked');
    return { project: p, marks };
  }
  const has = (p: Project, key: ParameterKey) => p.model.bindings.some((b) => b.keys.some((k) => k === key));

  it('manual と locked のキーは残り、ほかの自動のキーは作り直す（バインディングの id も同じ）', () => {
    const first = run(withLine(referenceModel(), 'L', LINE_L));
    const { project, marks } = edited(first);
    expect(marks).toHaveLength(8);
    // 自動の中間キーを壊しておく（作り直されることを見る）
    const x0 = binding(project, 'faceGroup', ['FaceAngleX'], 'warpPoints')!;
    const broken = replaceBinding(project, {
      ...x0,
      keys: x0.keys.map((k) =>
        k.coords[0] === 10 ? { ...k, delta: (k.delta as Vec2[]).map(() => ({ x: 99, y: 99 })) } : k,
      ),
    });
    const out = run(broken);
    for (const key of marks) expect(has(out, key)).toBe(true);
    expect(out.model.bindings.map((b) => b.id)).toEqual(first.model.bindings.map((b) => b.id));
    const x = binding(out, 'faceGroup', ['FaceAngleX'], 'warpPoints')!;
    const firstX = binding(first, 'faceGroup', ['FaceAngleX'], 'warpPoints');
    expect(pointsAt(x, 10)).toEqual(pointsAt(firstX, 10));
    // −10 は手で直した −20 と 0 の間の曲面の中間キーとして作り直す（カード31の再補間と同じ結果）
    expect(pointsAt(x, -10)).not.toEqual(pointsAt(firstX, -10));
    expect(createKeyGenerator().regenerate(x, out.model)).toBe(x);
    // 自動のキーは元の値に戻る
    expect(transformAt(binding(out, 'cheek', ['Cheek']), 1)).toEqual(ZERO);
    expect(transformAt(binding(out, 'browL', ['BrowYL']), -1)).toEqual(
      transformAt(binding(first, 'browL', ['BrowYL']), -1),
    );
    expect(run(out)).toBe(out);
  });

  it('線を引き直しても消しても、まばたきの頂点の manual・locked のキーは残る', () => {
    const { project, marks } = edited(run(withLine(referenceModel(), 'L', LINE_L)));
    const lidKey = marks[3]!;
    for (const line of [LINE_L.map((v) => ({ ...v, y: v.y + 10 })), null]) {
      const out = run(withLine(project, 'L', line));
      expect(keyAt(binding(out, 'upperLidL', ['EyeOpenL'], 'vertices'), 0)).toEqual(lidKey);
    }
  });

  it('上まぶたの子（まつげ）の頂点の manual・locked のキーも、線を引き直しても消しても残る', () => {
    const lashOf = (p: Project) =>
      p.model.bindings.find((b) => b.channel === 'vertices' && b.target.id === 'mesh-lashL')!;
    const first = run(withLine(referenceModel(), 'L', LINE_L));
    const lash = lashOf(first);
    const keys = lash.keys.map((k): ParameterKey => {
      const delta = (k.delta as Vec2[]).map((v) => ({ x: v.x + 3, y: v.y - 2 }));
      return k.coords[0] === 0 ? { ...k, delta, locked: true } : { ...k, delta, source: 'manual' };
    });
    const project = replaceBinding(first, { ...lash, keys });
    for (const line of [LINE_L.map((v) => ({ ...v, y: v.y + 10 })), null]) {
      const out = lashOf(run(withLine(project, 'L', line)));
      expect(out.id).toBe(lash.id);
      expect(out.keys).toEqual(keys);
    }
  });

  it('入力を変えず、全体を1回で Undo / Redo でき、再実行は履歴を増やさない', () => {
    const p = withLine(sampleWithMeshes(), 'L', SAMPLE_LINE_L);
    const before = structuredClone(p);
    const store = createProjectStore(p);
    store.dispatch(createAutoSetup().plan(p).command);
    const after = store.get();
    expect(p).toEqual(before);
    expect(() => validateProject(structuredClone(after))).not.toThrow();
    store.dispatch(createAutoSetup().plan(after).command);
    expect(store.get()).toBe(after);
    store.undo();
    expect(store.get()).toBe(p);
    expect(store.canUndo()).toBe(false);
    store.redo();
    expect(store.get()).toBe(after);
  });
});

describe('閉じた目の線と球の回転の計算', () => {
  it('左右どちらから描いても x の昇順になり、同じ x は平均し、数でない点は除く', () => {
    const input = [
      { x: 20, y: 10 },
      { x: 10, y: 30 },
      { x: 10, y: 10 },
      { x: NaN, y: 10 },
    ];
    const before = structuredClone(input);
    expect(normalizeClosedLine(input)).toEqual([
      { x: 10, y: 20 },
      { x: 20, y: 10 },
    ]);
    expect(input).toEqual(before);
    expect(normalizeClosedLine(null)).toBeNull();
    expect(normalizeClosedLine([{ x: 1, y: 1 }])).toBeNull();
  });

  it('点の間を線形に補い、線の外は端の高さ', () => {
    expect(closedLineY(SAMPLE_LINE_L, 562.5)).toBe(491);
    expect(closedLineY(SAMPLE_LINE_L, 100)).toBe(486);
    expect(closedLineY(SAMPLE_LINE_L, 1000)).toBe(486);
  });

  it('メッシュの x での上端・下端（弧の形の上まぶた）', () => {
    const lid = meshOf(referenceModel(), 'upperLidL');
    const middle = meshSpanAt(lid, 1190)!;
    expect(middle.top).toBe(846);
    expect(middle.bottom).toBeGreaterThan(875);
    expect(middle.bottom).toBeLessThan(877.5);
    expect(meshSpanAt(lid, 1050)).toEqual({ top: 890.5, bottom: 916 });
    expect(meshSpanAt(lid, 1000)).toBeNull();
  });

  it('球の回転は、片方だけならカード31の曲面と同じ（真ん中の行・列）で、補正は軸の上で 0', () => {
    const w = faceWarp(run(sampleWithMeshes()));
    const yaw = sphereTurn(w, 30, 0);
    const pitch = sphereTurn(w, 0, -30);
    const [x30] = generateSurfaceKeys(w, 'FaceAngleX', [30]);
    const [yMinus] = generateSurfaceKeys(w, 'FaceAngleY', [-30]);
    for (let i = 0; i < 5; i++) {
      expect(yaw[10 + i]!.x).toBeCloseTo(x30![10 + i]!.x, 9); // 真ん中の行
      expect(yaw[10 + i]!.y).toBeCloseTo(0, 9);
      expect(pitch[i * 5 + 2]!.y).toBeCloseTo(yMinus![i * 5 + 2]!.y, 9); // 真ん中の列
    }
    expect(faceTurnCrossTerm(w, 30, 0).every((d) => d.x === 0 && d.y === 0)).toBe(true);
    expect(faceTurnCrossTerm(w, 0, -30).every((d) => d.x === 0 && d.y === 0)).toBe(true);
    // 右上を向くと、真ん中の行の右端は左右・上下の和より下に、左端は上に来る（横の線が傾く）
    const cross = faceTurnCrossTerm(w, 30, 30);
    expect(cross[14]!.y).toBeGreaterThan(5);
    expect(cross[10]!.y).toBeLessThan(-5);
  });
});
