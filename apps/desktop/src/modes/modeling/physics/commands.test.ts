import { describe, expect, it } from 'vitest';
import { STANDARD_PARAMETERS, validateProject, type Binding, type Physics, type Project, type Vec2 } from '@app/schema';
import { createBindingEvaluator, createDeformPipeline, createProjectStore } from '@app/core';
import {
  disablePhysicsCommand,
  enablePhysicsCommand,
  isParameterUsed,
  partHeight,
  patchPhysics,
  physicsOfPart,
  rebuildSwayCommand,
  swayParameterIdFor,
  updatePhysicsCommand,
} from './commands';
import { PHYSICS_PRESETS, applyPhysicsPreset, physicsPresetState } from './presets';
import { physicsProject } from './testModel';

const ids = (n: string) => ({ physics: `ph-${n}`, transform: `bt-${n}`, vertices: `bv-${n}` });
const enable = (project: Project, partId: string) => enablePhysicsCommand(partId, ids(partId)).apply(project);
const part = (project: Project, id: string) => project.model.parts.find((p) => p.id === id)!;
const param = (project: Project, id: string) => project.model.parameters.find((p) => p.id === id);
const bindingsOf = (project: Project, parameterId: string) =>
  project.model.bindings.filter((b) => b.parameterIds.includes(parameterId));

describe('プリセット', () => {
  it('種類ごとの値がカードの表のとおり', () => {
    expect(PHYSICS_PRESETS).toEqual({
      hair: { spring: 30, damping: 4, gravity: 0.5, inertia: 1.0, range: 1.0 },
      cloth: { spring: 20, damping: 3, gravity: 0.8, inertia: 0.8, range: 0.8 },
      ribbon: { spring: 15, damping: 2, gravity: 0.6, inertia: 1.2, range: 1.2 },
      accessory: { spring: 40, damping: 5, gravity: 1.0, inertia: 0.6, range: 0.6 },
    });
  });
});

describe('オンにする', () => {
  it('揺れパラメータ・Physics・バインディングがそろう（自由パーツは Sway_<partId>）', () => {
    const before = physicsProject();
    const after = enable(before, 'hair');

    expect(param(after, 'Sway_hair')).toEqual({
      id: 'Sway_hair',
      name: '揺れ しっぽ',
      groupId: 'sway',
      min: -1,
      max: 1,
      default: 0,
      standard: false,
    });
    const item: Physics = {
      id: 'ph-hair',
      partId: 'hair',
      preset: 'hair',
      strength: 0.5,
      direction: 'horizontal',
      length: 200,
      spring: 30,
      damping: 4,
      gravity: 0.5,
      inertia: 1,
      range: 1,
      inputs: [],
      outputParameterId: 'Sway_hair',
    };
    expect(after.physics).toEqual([item]);
    expect(part(after, 'hair').physicsId).toBe('ph-hair');
    expect(physicsOfPart(after, 'hair')).toEqual(item);

    const bindings = bindingsOf(after, 'Sway_hair');
    expect(bindings.map((b) => [b.id, b.channel, b.target.type, b.target.id])).toEqual([
      ['bt-hair', 'transform', 'part', 'hair'],
      ['bv-hair', 'vertices', 'mesh', 'mesh-hair'],
    ]);
    expect(bindings.every((b) => b.keys.every((k) => k.source === 'auto' || k.source === 'generated'))).toBe(true);
    // 保存できる形
    expect(() => validateProject(JSON.parse(JSON.stringify(after)))).not.toThrow();
    // 元のプロジェクトは変えない
    expect(before.physics).toEqual([]);
    expect(before.model.bindings).toEqual([]);
  });

  it('標準の髪の部位は HairFront・HairSide・HairBack を使う（無ければ標準の表から足し、重ねて足さない）', () => {
    let p = physicsProject();
    expect(param(p, 'HairFront')).toBeUndefined();
    p = enable(p, 'front');
    expect(param(p, 'HairFront')).toEqual(STANDARD_PARAMETERS.find((q) => q.id === 'HairFront'));
    expect(param(p, 'Sway_front')).toBeUndefined();
    p = enable(p, 'side');
    p = enable(p, 'back');
    expect(p.physics.map((ph) => ph.outputParameterId)).toEqual(['HairFront', 'HairSide', 'HairBack']);
    expect(p.model.parameters.filter((q) => q.id.startsWith('Hair')).length).toBe(3);
    expect(swayParameterIdFor({ id: 'x', standardType: 'sideHairR' })).toBe('HairSide');
    expect(swayParameterIdFor({ id: 'x', standardType: 'face' })).toBe('Sway_x');
    // 素材だけのパーツ（メッシュ無し）は transform だけ。長さは素材の高さ
    expect(bindingsOf(p, 'HairFront').map((b) => b.channel)).toEqual(['transform']);
    expect(p.physics[0]!.length).toBe(80);
  });

  it('グループは transform だけで、長さは子孫の画像パーツをまとめた高さ', () => {
    const p = enable(physicsProject(), 'g');
    expect(bindingsOf(p, 'Sway_g').map((b) => [b.channel, b.target.id])).toEqual([['transform', 'g']]);
    // しっぽ 0..200、リボン 100..220
    expect(p.physics[0]!.length).toBe(220);
    expect(partHeight(p, part(p, 'plain'))).toBe(120);
  });

  it('揺れパラメータの名前がほかと重なれば番号を付け、グループ sway が無ければ足す', () => {
    const base = physicsProject();
    const p: Project = {
      ...base,
      model: {
        ...base.model,
        parameters: [
          ...base.model.parameters,
          { id: 'u', name: '揺れ しっぽ', groupId: 'other', min: 0, max: 1, default: 0, standard: false },
        ],
        parameterGroups: base.model.parameterGroups.filter((g) => g.id !== 'sway'),
      },
    };
    const after = enable(p, 'hair');
    expect(param(after, 'Sway_hair')?.name).toBe('揺れ しっぽ 2');
    expect(after.model.parameterGroups.some((g) => g.id === 'sway')).toBe(true);
  });

  it('すでに物理があるパーツ・無いパーツには何もしない', () => {
    const once = enable(physicsProject(), 'hair');
    expect(enablePhysicsCommand('hair', ids('again')).apply(once)).toBe(once);
    expect(enablePhysicsCommand('nothing', ids('x')).apply(once)).toBe(once);
  });

  it('手で作った同じパラメータのバインディングがあれば残し、自動では作らない', () => {
    const base = physicsProject();
    const manual: Binding = {
      id: 'mine',
      target: { type: 'part', id: 'front' },
      channel: 'transform',
      parameterIds: ['HairFront'],
      keyValues: [[0, 1]],
      keys: [
        {
          coords: [1],
          delta: { position: { x: 5, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 },
          source: 'manual',
          locked: false,
        },
      ],
      generation: 'linear',
      divisions: null,
    };
    const p = enable({ ...base, model: { ...base.model, bindings: [manual] } }, 'front');
    expect(p.model.bindings).toEqual([manual]);
    // オフにしても手で作ったものは残る
    expect(disablePhysicsCommand('front').apply(p).model.bindings).toEqual([manual]);
  });
});

describe('先端ほど大きく曲がる（本物の評価器と変形パイプライン）', () => {
  it('揺れパラメータ 1 で、パーツ全体の 12° の回転に加えて、根元は曲がらず先端ほど大きく曲がる', () => {
    const p = enable(physicsProject(), 'hair');
    const evaluator = createBindingEvaluator();
    const pipeline = createDeformPipeline();
    const drawn = (value: number): Vec2[] => {
      const params = Object.fromEntries(p.model.parameters.map((q) => [q.id, q.default]));
      params['Sway_hair'] = value;
      const item = pipeline.deform(p.model, evaluator.evaluate(p.model, params)).byPartId['hair']!;
      return Array.from({ length: item.positions.length / 2 }, (_, i) => ({
        x: item.positions[i * 2]!,
        y: item.positions[i * 2 + 1]!,
      }));
    };
    const rest = drawn(0);
    const swung = drawn(1);
    // パーツ全体をピボット (100,0) のまわりに 12° 回しただけの位置からの、曲げによるずれ
    const rad = (12 * Math.PI) / 180;
    const rigid = rest.map((q) => ({
      x: 100 + Math.cos(rad) * (q.x - 100) - Math.sin(rad) * q.y,
      y: Math.sin(rad) * (q.x - 100) + Math.cos(rad) * q.y,
    }));
    const bend = swung.map((q, i) => Math.hypot(q.x - rigid[i]!.x, q.y - rigid[i]!.y));
    const rows = [0, 1, 2, 3, 4].map((r) => bend[r * 2]!);
    expect(rows[0]).toBeLessThan(1e-3);
    for (let r = 1; r < rows.length; r++) expect(rows[r]!).toBeGreaterThan(rows[r - 1]!);
    expect(rows[4]! / rows[2]!).toBeGreaterThan(4);
    // 先端の中心の角度（ピボット (100,0) から）: 12°（回転）＋ 12°（曲げ）= 24°
    const tipRest = { x: (rest[8]!.x + rest[9]!.x) / 2, y: (rest[8]!.y + rest[9]!.y) / 2 };
    const tipSwung = { x: (swung[8]!.x + swung[9]!.x) / 2, y: (swung[8]!.y + swung[9]!.y) / 2 };
    const angle = (q: Vec2) => (Math.atan2(q.y - 0, q.x - 100) * 180) / Math.PI;
    expect(angle(tipSwung) - angle(tipRest)).toBeCloseTo(24, 1);
    // 真ん中の段（重み 0.25）は 12 + 3 = 15°
    const midRest = { x: (rest[4]!.x + rest[5]!.x) / 2, y: (rest[4]!.y + rest[5]!.y) / 2 };
    const midSwung = { x: (swung[4]!.x + swung[5]!.x) / 2, y: (swung[4]!.y + swung[5]!.y) / 2 };
    expect(angle(midSwung) - angle(midRest)).toBeCloseTo(15, 1);
  });
});

describe('オフにする', () => {
  it('Physics・自動で作ったバインディング・揺れパラメータが消え、ほかはそのまま', () => {
    const base = physicsProject();
    const other = enable(base, 'plain');
    const on = enable(other, 'hair');
    const off = disablePhysicsCommand('hair').apply(on);
    expect(off.physics.map((ph) => ph.id)).toEqual(['ph-plain']);
    expect(part(off, 'hair').physicsId).toBeNull();
    expect(param(off, 'Sway_hair')).toBeUndefined();
    expect(bindingsOf(off, 'Sway_hair')).toEqual([]);
    expect(off).toEqual(other);
  });

  it('揺れパラメータをほかで使っていれば残す（表情・物理の入力・アニメーション）', () => {
    const on = enable(physicsProject(), 'hair');
    const used: Project = {
      ...on,
      expressions: [
        { id: 'e', name: '風', entries: [{ parameterId: 'Sway_hair', value: 1, blend: 'add' }], fadeIn: 0, fadeOut: 0 },
      ],
    };
    const off = disablePhysicsCommand('hair').apply(used);
    expect(param(off, 'Sway_hair')).toBeDefined();
    expect(off.physics).toEqual([]);
    expect(bindingsOf(off, 'Sway_hair')).toEqual([]);
    expect(isParameterUsed(off, 'Sway_hair')).toBe(true);
    expect(isParameterUsed(disablePhysicsCommand('hair').apply(on), 'Sway_hair')).toBe(false);
  });

  it('手で直したキーのあるバインディングは残し、そのときは揺れパラメータも残る', () => {
    const on = enable(physicsProject(), 'hair');
    const bindings = on.model.bindings.map((b) =>
      b.channel === 'vertices'
        ? { ...b, keys: b.keys.map((k, i) => (i === 0 ? { ...k, source: 'manual' as const } : k)) }
        : b,
    );
    const off = disablePhysicsCommand('hair').apply({ ...on, model: { ...on.model, bindings } });
    expect(off.model.bindings.map((b) => b.id)).toEqual(['bv-hair']);
    expect(param(off, 'Sway_hair')).toBeDefined();
  });

  it('標準の髪の揺れパラメータは消さない。物理の無いパーツには何もしない', () => {
    const on = enable(physicsProject(), 'front');
    const off = disablePhysicsCommand('front').apply(on);
    expect(param(off, 'HairFront')).toBeDefined();
    expect(off.physics).toEqual([]);
    expect(bindingsOf(off, 'HairFront')).toEqual([]);
    expect(disablePhysicsCommand('front').apply(off)).toBe(off);
  });
});

describe('Undo', () => {
  it('オン・オフ・値の変更がそれぞれ1回の Undo で戻り、Redo でやり直せる', () => {
    const initial = physicsProject();
    const store = createProjectStore(initial);
    store.dispatch(enablePhysicsCommand('hair', ids('hair')));
    const on = store.get();
    expect(store.undoLabel()).toBe('揺らす');
    expect(on.physics).toHaveLength(1);

    store.dispatch(updatePhysicsCommand('揺れの種類を変える', 'ph-hair', (it) => applyPhysicsPreset(it, 'cloth')));
    expect(store.get().physics[0]!.spring).toBe(20);
    store.undo();
    expect(store.get()).toBe(on);

    store.undo();
    expect(store.get()).toBe(initial);
    store.redo();
    expect(store.get()).toBe(on);

    store.dispatch(disablePhysicsCommand('hair'));
    expect(store.undoLabel()).toBe('揺らさない');
    expect(store.get().physics).toEqual([]);
    store.undo();
    expect(store.get()).toBe(on);
  });
});

describe('揺れのキーを作り直す', () => {
  it('ピボットを動かしたあと、今のピボットで vertices を作り直す（id はそのまま）', () => {
    const on = enable(physicsProject(), 'hair');
    const moved: Project = {
      ...on,
      model: {
        ...on.model,
        parts: on.model.parts.map((p) => (p.id === 'hair' ? { ...p, pivot: { x: 100, y: 200 } } : p)),
      },
    };
    const rebuilt = rebuildSwayCommand('hair', { transform: 'n1', vertices: 'n2' }).apply(moved);
    const before = bindingsOf(moved, 'Sway_hair')[1]!;
    const after = bindingsOf(rebuilt, 'Sway_hair')[1]!;
    expect(after.id).toBe('bv-hair');
    expect(after).not.toEqual(before);
    // 根元が下になったので、下の段は動かず上の段が動く
    const d = after.keys.at(-1)!.delta as Vec2[];
    expect(Math.hypot(d[8]!.x, d[8]!.y)).toBeLessThan(1e-9);
    expect(Math.hypot(d[0]!.x, d[0]!.y)).toBeGreaterThan(10);
    // 変わらなければ同じプロジェクト。物理の無いパーツには何もしない
    expect(rebuildSwayCommand('hair', { transform: 'n1', vertices: 'n2' }).apply(on)).toBe(on);
    expect(rebuildSwayCommand('plain', { transform: 'n1', vertices: 'n2' }).apply(on)).toBe(on);
  });
});

describe('値の変更と、プリセットに当たるかの判定', () => {
  const item = enable(physicsProject(), 'hair').physics[0]!;

  it('種類を選ぶと spring〜range がその種類の値になり、揺れ方・方向・入力はそのまま', () => {
    const custom = patchPhysics(item, { strength: 0.8, direction: 'both', inputs: [{ parameterId: 'X', weight: 1 }] });
    const ribbon = applyPhysicsPreset(custom, 'ribbon');
    expect(ribbon).toMatchObject({ preset: 'ribbon', ...PHYSICS_PRESETS.ribbon, strength: 0.8, direction: 'both' });
    expect(ribbon.inputs).toBe(custom.inputs);
    expect(applyPhysicsPreset(item, 'hair')).toBe(item);
  });

  it("個別に調整した値は 'custom'。ほかの種類の値に一致すればその種類", () => {
    expect(physicsPresetState(item)).toBe('hair');
    expect(physicsPresetState(patchPhysics(item, { spring: 31 }))).toBe('custom');
    expect(physicsPresetState({ ...item, ...PHYSICS_PRESETS.cloth })).toBe('cloth');
    // 揺れ方・方向・入力はプリセットの判定に入れない
    expect(physicsPresetState(patchPhysics(item, { strength: 0.1, direction: 'vertical' }))).toBe('hair');
  });

  it('updatePhysicsCommand は変わらなければ何もしない', () => {
    const p = enable(physicsProject(), 'hair');
    expect(updatePhysicsCommand('x', 'ph-hair', (it) => patchPhysics(it, { strength: 0.5 })).apply(p)).toBe(p);
    expect(updatePhysicsCommand('x', 'none', (it) => ({ ...it, strength: 1 })).apply(p)).toBe(p);
  });
});
