import sample from '@app/fixtures/sample-model/project.json';
import {
  STANDARD_DRAW_ORDER,
  ensureStandardParameters,
  validateProject,
  type Asset,
  type Binding,
  type Part,
  type Project,
  type StandardPartType,
  type TransformDelta,
  type Vec2,
} from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createKeyGenerator } from '../generate';
import { AUTO_SETUP_LABEL, createAutoSetup, runAutoSetup } from './autoSetup';

const base = (): Project => validateProject(structuredClone(sample));
const autoSetup = createAutoSetup();

function run(project: Project) {
  const { command, warnings } = autoSetup.plan(project);
  return { project: command.apply(project), warnings, command };
}

const byType = (p: Project, type: StandardPartType): Part => {
  const found = p.model.parts.find((q) => q.standardType === type);
  if (!found) throw new Error(`${type} が無い`);
  return found;
};
const assetOf = (p: Project, part: Part): Asset => p.assets.find((a) => a.id === part.assetId)!;
const bindingOf = (p: Project, type: StandardPartType, parameterId: string): Binding | undefined => {
  const part = byType(p, type);
  return p.model.bindings.find(
    (b) => b.target.id === part.id && b.parameterIds.length === 1 && b.parameterIds[0] === parameterId,
  );
};
const deltaAt = (b: Binding | undefined, coord: number): TransformDelta => {
  const k = b?.keys.find((q) => q.coords[0] === coord);
  if (!k) throw new Error(`キー ${coord} が無い`);
  return k.delta as TransformDelta;
};
const ZERO: TransformDelta = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };

// 素材を足した画像パーツ（自由パーツや一枚絵の目・口の確認用）
function withImage(p: Project, id: string, type: StandardPartType | null, rect: [number, number, number, number]) {
  const [x, y, width, height] = rect;
  const asset: Asset = {
    ...p.assets[0]!,
    id: `asset-${id}`,
    path: `assets/asset-${id}.png`,
    width,
    height,
    offset: { x, y },
  };
  const part: Part = {
    ...byType(p, 'face'),
    id,
    name: id,
    standardType: type,
    assetId: asset.id,
    depth: 0,
    parentId: null,
  };
  return {
    ...p,
    assets: [...p.assets, asset],
    model: { ...p.model, parts: [...p.model.parts, part], drawOrder: [...p.model.drawOrder, id] },
  };
}
function without(p: Project, ...types: StandardPartType[]): Project {
  const parts = p.model.parts.filter((q) => !q.standardType || !types.includes(q.standardType));
  const ids = new Set(parts.map((q) => q.id));
  return { ...p, model: { ...p.model, parts, drawOrder: p.model.drawOrder.filter((id) => ids.has(id)) } };
}

// 参照が切れていないか（validateProject は参照を見ないのでここで確かめる）
function expectConsistent(p: Project) {
  expect(() => validateProject(structuredClone(p))).not.toThrow();
  const ids = new Set(p.model.parts.map((q) => q.id));
  for (const part of p.model.parts) {
    if (part.parentId !== null) expect(ids.has(part.parentId), part.id).toBe(true);
    for (const s of part.mask?.sourcePartIds ?? []) expect(ids.has(s)).toBe(true);
    // 循環しない
    const seen = new Set<string>();
    let at: string | null = part.id;
    while (at !== null) {
      expect(seen.has(at)).toBe(false);
      seen.add(at);
      at = p.model.parts.find((q) => q.id === at)!.parentId;
    }
  }
  const images = p.model.parts.filter((q) => q.kind === 'image').map((q) => q.id);
  expect([...p.model.drawOrder].sort()).toEqual([...images].sort());
  for (const b of p.model.bindings) {
    const targets =
      b.target.type === 'part' ? p.model.parts : b.target.type === 'mesh' ? p.model.meshes : p.model.warps;
    expect(targets.some((target) => target.id === b.target.id)).toBe(true);
    // keyValues はパラメータごとのキーの位置（昇順・重なりなし）。2パラメータは斜め方向の合成（カード42）
    expect(b.keys.every((k) => k.coords.length === b.parameterIds.length)).toBe(true);
    b.keyValues.forEach((values, i) => {
      expect(values).toEqual([...new Set(b.keys.map((k) => k.coords[i]!))].sort((x, y) => x - y));
    });
  }
}

// 階層の木での親（無ければ根）
const EXPECTED_PARENT: Partial<Record<StandardPartType, StandardPartType | null>> = {
  bodyRoot: null,
  torso: 'bodyRoot',
  armRootL: 'bodyRoot',
  armL: 'armRootL',
  armRootR: 'bodyRoot',
  armR: 'armRootR',
  neckRoot: 'bodyRoot',
  neck: 'neckRoot',
  headRoot: 'neckRoot',
  backHair: 'headRoot',
  faceGroup: 'headRoot',
  face: 'faceGroup',
  eyeGroupL: 'faceGroup',
  eyeWhiteL: 'eyeGroupL',
  irisL: 'eyeGroupL',
  highlightL: 'eyeGroupL',
  upperLidL: 'eyeGroupL',
  lowerLidL: 'eyeGroupL',
  eyeGroupR: 'faceGroup',
  eyeWhiteR: 'eyeGroupR',
  irisR: 'eyeGroupR',
  highlightR: 'eyeGroupR',
  upperLidR: 'eyeGroupR',
  lowerLidR: 'eyeGroupR',
  browL: 'faceGroup',
  browR: 'faceGroup',
  mouthGroup: 'faceGroup',
  mouthInside: 'mouthGroup',
  teeth: 'mouthGroup',
  tongue: 'mouthGroup',
  upperLip: 'mouthGroup',
  lowerLip: 'mouthGroup',
  earL: 'headRoot',
  earR: 'headRoot',
  sideHairL: 'headRoot',
  sideHairR: 'headRoot',
  frontHair: 'headRoot',
};

describe('かんたんセットアップ（fixtures の sample-model）', () => {
  it('ラベルと警告。推奨パーツがそろっていれば警告は無い', () => {
    const { warnings, command } = autoSetup.plan(base());
    expect(command.label).toBe(AUTO_SETUP_LABEL);
    expect(warnings).toEqual([]);
  });

  it('階層が木のとおり（変形グループを9つ作る）', () => {
    const { project } = run(base());
    const groups = project.model.parts.filter((p) => p.kind === 'group');
    expect(groups.map((g) => g.standardType).sort()).toEqual(
      [
        'bodyRoot',
        'armRootL',
        'armRootR',
        'neckRoot',
        'headRoot',
        'faceGroup',
        'eyeGroupL',
        'eyeGroupR',
        'mouthGroup',
      ].sort(),
    );
    for (const part of project.model.parts) {
      const parent = project.model.parts.find((q) => q.id === part.parentId);
      expect(parent?.standardType ?? null, part.standardType!).toBe(EXPECTED_PARENT[part.standardType!]);
    }
    expect(Object.keys(EXPECTED_PARENT)).toHaveLength(project.model.parts.length);
    expectConsistent(project);
  });

  it('ピボットが表のとおり', () => {
    const p0 = base();
    const { project } = run(p0);
    const pivot = (t: StandardPartType) => byType(project, t).pivot;
    // 変形グループ
    expect(pivot('bodyRoot')).toEqual({ x: 500, y: 1500 }); // 胴体の下端中央
    expect(pivot('armRootL')).toEqual({ x: 782.5, y: 890 }); // 腕の上端中央
    expect(pivot('armRootR')).toEqual({ x: 217.5, y: 890 });
    expect(pivot('neckRoot')).toEqual({ x: 500, y: 870 }); // 首の下端中央
    expect(pivot('headRoot')).toEqual({ x: 500, y: 640 }); // 首の上端中央
    expect(pivot('faceGroup')).toEqual({ x: 500, y: 450 }); // 子の外接矩形の中心
    expect(pivot('eyeGroupL')).toEqual({ x: 595, y: 473 });
    expect(pivot('eyeGroupR')).toEqual({ x: 405, y: 473 });
    expect(pivot('mouthGroup')).toEqual({ x: 500, y: 611.5 });
    // 画像パーツ: 髪 = 上端中央、白目 = 下端中央、その他 = 中心
    const HAIR: StandardPartType[] = ['frontHair', 'sideHairL', 'sideHairR', 'backHair'];
    for (const part of project.model.parts.filter((q) => q.kind === 'image')) {
      const a = assetOf(project, part);
      const t = part.standardType!;
      const x = a.offset.x + a.width / 2;
      const expected: Vec2 = HAIR.includes(t)
        ? { x, y: a.offset.y }
        : t === 'eyeWhiteL' || t === 'eyeWhiteR'
          ? { x, y: a.offset.y + a.height }
          : { x, y: a.offset.y + a.height / 2 };
      expect(part.pivot, t).toEqual(expected);
    }
    expect(pivot('frontHair')).toEqual({ x: 500, y: 150 });
    expect(pivot('eyeWhiteL')).toEqual({ x: 595, y: 510 });
  });

  it('描画順が STANDARD_DRAW_ORDER のとおり', () => {
    const { project } = run(base());
    const order = project.model.drawOrder.map((id) => project.model.parts.find((p) => p.id === id)!.standardType);
    expect(order).toEqual(STANDARD_DRAW_ORDER.filter((t) => order.includes(t)));
    expect(order).toHaveLength(28);
  });

  it('マスクが表のとおり（瞳・ハイライト → 同じ側の白目、歯・舌 → 口の中）', () => {
    const { project } = run(base());
    const maskOf = (t: StandardPartType) => byType(project, t).mask;
    const by = (t: StandardPartType) => ({ sourcePartIds: [byType(project, t).id], inverted: false });
    expect(maskOf('irisL')).toEqual(by('eyeWhiteL'));
    expect(maskOf('highlightL')).toEqual(by('eyeWhiteL'));
    expect(maskOf('irisR')).toEqual(by('eyeWhiteR'));
    expect(maskOf('highlightR')).toEqual(by('eyeWhiteR'));
    expect(maskOf('teeth')).toEqual(by('mouthInside'));
    expect(maskOf('tongue')).toEqual(by('mouthInside'));
    const masked = project.model.parts.filter((p) => p.mask !== null).map((p) => p.standardType);
    expect(masked.sort()).toEqual(['highlightL', 'highlightR', 'irisL', 'irisR', 'teeth', 'tongue']);
  });

  it('MVP の transform キーも source auto・未ロックで、位置は表の値とデフォルト値', () => {
    const { project } = run(base());
    const positions: Record<string, number[]> = {
      EyeBallX: [-1, 0, 1],
      EyeBallY: [-1, 0, 1],
      FaceAngleZ: [-30, 0, 30],
      FaceAngleX: [-30, 0, 30],
      FaceAngleY: [-30, 0, 30],
      EyeOpenL: [0, 1],
      EyeOpenR: [0, 1],
      MouthOpen: [0, 1],
    };
    const bindings = project.model.bindings.filter((b) => b.channel === 'transform' && b.parameterIds[0]! in positions);
    // 視線 8・顔の傾き 2・顔の向き 24×2・まばたき 6・口 3
    expect(bindings).toHaveLength(67);
    for (const b of bindings) {
      expect(b.channel).toBe('transform');
      expect(b.target.type).toBe('part');
      expect(b.parameterIds).toHaveLength(1);
      expect(b.keyValues).toEqual([positions[b.parameterIds[0]!]]);
      expect(b.keys.every((k) => k.source === 'auto' && !k.locked)).toBe(true);
      expect(b.generation).toBe(
        b.parameterIds[0]!.startsWith('FaceAngle') && b.parameterIds[0] !== 'FaceAngleZ' ? 'depth' : 'linear',
      );
      // デフォルト値のキーは差分 0
      const def = { EyeOpenL: 1, EyeOpenR: 1 }[b.parameterIds[0] as 'EyeOpenL'] ?? 0;
      expect(deltaAt(b, def)).toEqual(ZERO);
    }
    const count = (id: string) => bindings.filter((b) => b.parameterIds[0] === id).length;
    expect([
      count('EyeBallX'),
      count('EyeBallY'),
      count('FaceAngleZ'),
      count('FaceAngleX'),
      count('FaceAngleY'),
    ]).toEqual([4, 4, 2, 24, 24]);
    expect([count('EyeOpenL'), count('EyeOpenR'), count('MouthOpen')]).toEqual([3, 3, 3]);
  });

  it('視線: 値 1 で白目の幅×0.25 右へ、高さ×0.2 上へ。−1 で逆', () => {
    const { project } = run(base());
    for (const t of ['irisL', 'highlightL', 'irisR', 'highlightR'] as const) {
      const white = assetOf(project, byType(project, t.endsWith('L') ? 'eyeWhiteL' : 'eyeWhiteR'));
      expect(white.width).toBe(116);
      const x = bindingOf(project, t, 'EyeBallX');
      expect(deltaAt(x, 1)).toEqual({ ...ZERO, position: { x: 29, y: 0 } });
      expect(deltaAt(x, -1)).toEqual({ ...ZERO, position: { x: -29, y: 0 } });
      const y = bindingOf(project, t, 'EyeBallY');
      expect(deltaAt(y, 1)).toEqual({ ...ZERO, position: { x: 0, y: -16 } });
      expect(deltaAt(y, -1)).toEqual({ ...ZERO, position: { x: 0, y: 16 } });
    }
  });

  it('顔の傾き: 30 で首 9 度・頭 21 度、−30 で逆', () => {
    const { project } = run(base());
    const neck = bindingOf(project, 'neckRoot', 'FaceAngleZ');
    const head = bindingOf(project, 'headRoot', 'FaceAngleZ');
    expect(deltaAt(neck, 30)).toEqual({ ...ZERO, rotation: 9 });
    expect(deltaAt(neck, -30)).toEqual({ ...ZERO, rotation: -9 });
    expect(deltaAt(head, 30)).toEqual({ ...ZERO, rotation: 21 });
    expect(deltaAt(head, -30)).toEqual({ ...ZERO, rotation: -21 });
  });

  it('顔の向き: 奥行き × 顔の幅で動き、顔の輪郭は横に縮む', () => {
    const { project } = run(base());
    // 顔の素材の幅 460 × 0.08 = 36.8（奥行き 1）
    const x30 = (t: StandardPartType) => deltaAt(bindingOf(project, t, 'FaceAngleX'), 30);
    const y30 = (t: StandardPartType) => deltaAt(bindingOf(project, t, 'FaceAngleY'), 30);
    expect(x30('frontHair').position.x).toBeCloseTo(36.8);
    expect(x30('backHair').position.x).toBeCloseTo(-36.8);
    expect(x30('earL').position.x).toBeCloseTo(-18.4);
    expect(x30('irisL').position.x).toBeCloseTo(18.4);
    expect(x30('face').position.x).toBeCloseTo(7.36);
    expect(x30('face').scale.x).toBeCloseTo(0.96);
    expect(deltaAt(bindingOf(project, 'face', 'FaceAngleX'), -30).scale.x).toBeCloseTo(0.96);
    expect(x30('frontHair').scale.x).toBe(1);
    // 上を向くと手前のパーツは上へ（y は負）
    expect(y30('frontHair').position).toEqual({ x: 0, y: expect.closeTo(-36.8) });
    expect(y30('backHair').position.y).toBeCloseTo(36.8);
    expect(y30('face').scale).toEqual({ x: 1, y: 1 });
    // 頭の外のパーツには付けない
    expect(bindingOf(project, 'torso', 'FaceAngleX')).toBeUndefined();
    expect(bindingOf(project, 'neck', 'FaceAngleY')).toBeUndefined();
  });

  it('まばたき: 値 0 で上まぶたが白目の下端まで下がり、白目が縦に縮み、下まぶたが少し上がる', () => {
    const { project } = run(base());
    // 白目 L: y 430〜510（高さ 80）、上まぶた L の下端 458
    expect(deltaAt(bindingOf(project, 'upperLidL', 'EyeOpenL'), 0)).toEqual({ ...ZERO, position: { x: 0, y: 52 } });
    expect(deltaAt(bindingOf(project, 'eyeWhiteL', 'EyeOpenL'), 0)).toEqual({ ...ZERO, scale: { x: 1, y: 0.08 } });
    expect(deltaAt(bindingOf(project, 'lowerLidL', 'EyeOpenL'), 0)).toEqual({ ...ZERO, position: { x: 0, y: -8 } });
    expect(deltaAt(bindingOf(project, 'upperLidR', 'EyeOpenR'), 0).position.y).toBe(52);
    expect(bindingOf(project, 'upperLidL', 'EyeOpenR')).toBeUndefined();
    expect(bindingOf(project, 'irisL', 'EyeOpenL')).toBeUndefined();
  });

  it('口の開閉: 値 1 で下唇と舌が口の中の高さ×0.6、口の中が×0.3 下がる', () => {
    const { project } = run(base());
    // 口の中の高さ 24
    expect(deltaAt(bindingOf(project, 'lowerLip', 'MouthOpen'), 1).position).toEqual({ x: 0, y: expect.closeTo(14.4) });
    expect(deltaAt(bindingOf(project, 'tongue', 'MouthOpen'), 1).position.y).toBeCloseTo(14.4);
    expect(deltaAt(bindingOf(project, 'mouthInside', 'MouthOpen'), 1).position.y).toBeCloseTo(7.2);
    expect(bindingOf(project, 'upperLip', 'MouthOpen')).toBeUndefined();
    expect(bindingOf(project, 'teeth', 'MouthOpen')).toBeUndefined();
  });

  it('再実行で manual と locked のキーが残り、それ以外は作り直す', () => {
    const first = run(base()).project;
    const manual = {
      coords: [1],
      delta: { ...ZERO, position: { x: 50, y: 0 } },
      source: 'manual' as const,
      locked: false,
    };
    const locked = {
      coords: [0],
      delta: { ...ZERO, position: { x: 0, y: 40 } },
      source: 'auto' as const,
      locked: true,
    };
    const extra = { coords: [0.5], delta: ZERO, source: 'generated' as const, locked: false };
    const iris = bindingOf(first, 'irisL', 'EyeBallX')!;
    const lid = bindingOf(first, 'upperLidL', 'EyeOpenL')!;
    const white = bindingOf(first, 'eyeWhiteL', 'EyeOpenL')!;
    const edited: Project = {
      ...first,
      // 白目 L の幅を 200 にする（自動のキーは作り直される）
      assets: first.assets.map((a) => (a.id === byType(first, 'eyeWhiteL').assetId ? { ...a, width: 200 } : a)),
      model: {
        ...first.model,
        bindings: first.model.bindings.map((b) => {
          if (b === iris) return { ...b, keys: [b.keys[0]!, b.keys[1]!, manual] };
          if (b === lid) return { ...b, keys: [locked, b.keys[1]!] };
          if (b === white) return { ...b, keyValues: [[0, 0.5, 1]], keys: [b.keys[0]!, extra, b.keys[1]!] };
          return b;
        }),
      },
    };
    const second = run(edited).project;
    const iris2 = bindingOf(second, 'irisL', 'EyeBallX')!;
    expect(iris2.id).toBe(iris.id);
    expect(deltaAt(iris2, 1)).toEqual(manual.delta);
    expect(iris2.keys[2]).toEqual(manual);
    expect(deltaAt(iris2, -1).position.x).toBe(-50); // 200 × 0.25
    const lid2 = bindingOf(second, 'upperLidL', 'EyeOpenL')!;
    expect(lid2.keys[0]).toEqual(locked);
    const white2 = bindingOf(second, 'eyeWhiteL', 'EyeOpenL')!;
    expect(white2.keyValues).toEqual([[0, 1]]);
    expect(white2.keys.map((k) => k.source)).toEqual(['auto', 'auto']);
    expect(second.model.bindings.map((b) => b.id)).toEqual(first.model.bindings.map((b) => b.id));
    expectConsistent(second);
  });

  it('何度実行してもよい（同じ入力には同じ結果、結果に再実行しても変わらない）', () => {
    const p = base();
    const { command } = autoSetup.plan(p);
    const once = command.apply(p);
    expect(command.apply(p)).toEqual(once);
    expect(command.apply(once)).toBe(once);
    expect(autoSetup.plan(once).command.apply(once)).toBe(once);
  });

  it('顔の向きはカード08の depthParallax と同じキーになる', () => {
    const { project } = run(base());
    const generator = createKeyGenerator({ assets: () => project.assets });
    for (const parameterId of ['FaceAngleX', 'FaceAngleY'] as const) {
      const rebuilt = generator.depthParallax(project.model, parameterId);
      expect(rebuilt).toHaveLength(24);
      for (const b of rebuilt) expect(project.model.bindings).toContain(b);
    }
  });

  it('入力のプロジェクトを書き換えない', () => {
    const p = base();
    const before = structuredClone(p);
    run(p);
    expect(p).toEqual(before);
  });

  it('奥行きは 0 のパーツだけ既定値を入れ、足りない STEP1 の標準パラメータを足す', () => {
    const p = base();
    const edited: Project = {
      ...p,
      model: {
        ...p.model,
        parts: p.model.parts.map((q) =>
          q.standardType === 'face' ? { ...q, depth: 0 } : q.standardType === 'frontHair' ? { ...q, depth: 0.7 } : q,
        ),
        parameters: p.model.parameters.filter((q) => q.id !== 'MouthOpen' && q.id !== 'EyeBallY'),
      },
    };
    const out = run(edited).project;
    expect(byType(out, 'face').depth).toBe(0.2);
    expect(byType(out, 'frontHair').depth).toBe(0.7);
    expect(out.model.parameters).toEqual(ensureStandardParameters(edited.model, 'step1').parameters);
  });

  it('親の無い自由パーツは headRoot の子になり、頭の最前面に描かれ、顔の向きのバインディングが付く', () => {
    const p = withImage(base(), 'ribbon', null, [400, 100, 200, 60]);
    const out = run(p).project;
    const ribbon = out.model.parts.find((q) => q.id === 'ribbon')!;
    expect(out.model.parts.find((q) => q.id === ribbon.parentId)!.standardType).toBe('headRoot');
    expect(out.model.drawOrder.slice(-2)).toEqual([byType(out, 'frontHair').id, 'ribbon']);
    expect(ribbon.pivot).toEqual(byType(p, 'face').pivot); // 自由パーツのピボットはそのまま
    expect(out.model.bindings.filter((b) => b.target.id === 'ribbon').map((b) => b.parameterIds[0])).toEqual([
      'FaceAngleX',
      'FaceAngleY',
    ]);
    expectConsistent(out);
  });
});

describe('かんたんセットアップ（推奨パーツが足りないとき）', () => {
  it('上まぶたが無ければ警告を出し、目の変形グループを縦に縮める方式にする', () => {
    const { project, warnings } = run(without(base(), 'upperLidL'));
    expect(warnings).toEqual(['上まぶた L がないため、まばたきは目全体を縦に縮める方式になります']);
    const blinks = project.model.bindings.filter((b) => b.parameterIds[0] === 'EyeOpenL');
    expect(blinks.map((b) => b.target.id)).toEqual([byType(project, 'eyeGroupL').id]);
    expect(deltaAt(blinks[0], 0)).toEqual({ ...ZERO, scale: { x: 1, y: 0.1 } });
    expect(deltaAt(blinks[0], 1)).toEqual(ZERO);
    // 反対側はまぶたの方式のまま
    expect(project.model.bindings.filter((b) => b.parameterIds[0] === 'EyeOpenR')).toHaveLength(3);
    expectConsistent(project);
  });

  it('あとから方式が変わったら、使わなくなった自動のバインディングは消える', () => {
    const first = run(base()).project;
    const second = run(without(first, 'upperLidL')).project;
    const blinks = second.model.bindings.filter((b) => b.parameterIds[0] === 'EyeOpenL');
    expect(blinks.map((b) => b.target.id)).toEqual([byType(second, 'eyeGroupL').id]);
    expectConsistent(second);
  });

  it('白目が無ければ瞳を切り抜かず、まばたきは目全体を縮め、瞳の幅で動く量を決める', () => {
    const { project, warnings } = run(without(base(), 'eyeWhiteL'));
    expect(warnings).toEqual([
      '白目 L がないため、まばたきは目全体を縦に縮める方式になります',
      '白目 L がないため、瞳 L は白目の形で切り抜かれず、動く幅は瞳 L の大きさで決めます',
    ]);
    expect(byType(project, 'irisL').mask).toBeNull();
    // 瞳 L の幅 60 × 0.25 = 15
    expect(deltaAt(bindingOf(project, 'irisL', 'EyeBallX'), 1).position.x).toBe(15);
    const blinks = project.model.bindings.filter((b) => b.parameterIds[0] === 'EyeOpenL');
    expect(blinks.map((b) => b.target.id)).toEqual([byType(project, 'eyeGroupL').id]);
  });

  it('目を1枚（目全体）で割り当てたら、目全体を縦に縮め（ピボットは中心）、視線は作らない', () => {
    const eyeL: StandardPartType[] = ['eyeWhiteL', 'irisL', 'highlightL', 'upperLidL', 'lowerLidL'];
    const p = withImage(without(base(), ...eyeL), 'eyeWholeL', 'eyeWholeL', [525, 422, 140, 102]);
    const { project, warnings } = run(p);
    expect(warnings).toEqual([
      '白目 L・上まぶた L がないため、まばたきは目全体を縦に縮める方式になります',
      '瞳 L がないため、視線の動き（EyeBallX・EyeBallY）は作られません',
    ]);
    const whole = byType(project, 'eyeWholeL');
    expect(whole.pivot).toEqual({ x: 595, y: 473 });
    expect(whole.depth).toBe(0.5);
    const blink = bindingOf(project, 'eyeWholeL', 'EyeOpenL');
    expect(deltaAt(blink, 0)).toEqual({ ...ZERO, scale: { x: 1, y: 0.1 } });
    expect(project.model.bindings.filter((b) => b.parameterIds[0] === 'EyeOpenL')).toHaveLength(1);
    expect(project.model.bindings.filter((b) => b.parameterIds[0] === 'EyeBallX')).toHaveLength(2); // R だけ
    expect(project.model.parts.find((q) => q.id === whole.parentId)!.standardType).toBe('eyeGroupL');
    expectConsistent(project);
  });

  it('目のパーツが無い側は、まばたきと視線を作らない（目の変形グループも作らない）', () => {
    const eyeR: StandardPartType[] = ['eyeWhiteR', 'irisR', 'highlightR', 'upperLidR', 'lowerLidR'];
    const { project, warnings } = run(without(base(), ...eyeR));
    expect(warnings).toEqual(['白目 R・瞳 R・上まぶた R がないため、目 R のまばたきと視線の動きは作られません']);
    expect(project.model.parts.some((q) => q.standardType === 'eyeGroupR')).toBe(false);
    expect(project.model.bindings.some((b) => b.parameterIds[0] === 'EyeOpenR')).toBe(false);
    expectConsistent(project);
  });

  it('口の中が無ければ、口の変形グループを縦に伸ばす方式にし、歯・舌は切り抜かない', () => {
    const { project, warnings } = run(without(base(), 'mouthInside'));
    expect(warnings).toEqual([
      '口の中がないため、口の開閉は口全体を縦に伸ばす方式になります',
      '口の中がないため、歯・舌は口の中の形で切り抜かれません',
    ]);
    const opens = project.model.bindings.filter((b) => b.parameterIds[0] === 'MouthOpen');
    expect(opens.map((b) => b.target.id)).toEqual([byType(project, 'mouthGroup').id]);
    expect(deltaAt(opens[0], 1)).toEqual({ ...ZERO, scale: { x: 1, y: 1.6 } });
    expect(deltaAt(opens[0], 0)).toEqual(ZERO);
    expect(byType(project, 'teeth').mask).toBeNull();
  });

  it('口を1枚（口全体）で割り当てたら、口全体を縦に 1.6 倍に伸ばす', () => {
    const mouth: StandardPartType[] = ['upperLip', 'lowerLip', 'mouthInside', 'teeth', 'tongue'];
    const p = withImage(without(base(), ...mouth), 'mouthWhole', 'mouthWhole', [456, 596, 88, 31]);
    const { project, warnings } = run(p);
    expect(warnings).toEqual([
      '下唇・口の中がないため、口の開閉は口全体を縦に伸ばす方式になります',
      '上唇がないため、口を開けたときに口の上側の輪郭が出ません',
    ]);
    const open = bindingOf(project, 'mouthWhole', 'MouthOpen');
    expect(deltaAt(open, 1)).toEqual({ ...ZERO, scale: { x: 1, y: 1.6 } });
    expect(byType(project, 'mouthWhole').pivot).toEqual({ x: 500, y: 611.5 });
    expect(project.model.bindings.filter((b) => b.parameterIds[0] === 'MouthOpen')).toHaveLength(1);
  });

  it('上唇が無いだけなら、唇の方式のまま警告だけ出す', () => {
    const { project, warnings } = run(without(base(), 'upperLip'));
    expect(warnings).toEqual(['上唇がないため、口を開けたときに口の上側の輪郭が出ません']);
    expect(project.model.bindings.filter((b) => b.parameterIds[0] === 'MouthOpen')).toHaveLength(3);
  });

  it('首と胴体が無くても、頭と体のピボットが決まる', () => {
    const { project } = run(without(base(), 'neck', 'torso'));
    const face = assetOf(project, byType(project, 'face'));
    const faceBottom = { x: face.offset.x + face.width / 2, y: face.offset.y + face.height };
    expect(byType(project, 'neckRoot').pivot).toEqual(faceBottom);
    expect(byType(project, 'headRoot').pivot).toEqual(faceBottom);
    expect(byType(project, 'bodyRoot').pivot).toEqual({ x: 500, y: 1500 }); // キャンバスの下端中央
  });

  it('runAutoSetup は渡した id を順に使う', () => {
    let n = 0;
    const out = runAutoSetup(base(), () => `id${++n}`);
    expect(byType(out, 'bodyRoot').id).toBe('id1');
    expect(byType(out, 'mouthGroup').id).toBe('id9');
    expect(out.model.warps[0]!.id).toBe('id10');
    expect(out.model.bindings[0]!.id).toBe('id11');
  });
});
