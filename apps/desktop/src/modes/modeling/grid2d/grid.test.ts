// カード30 2パラメータの格子の計算（マスの選び方・状態・[自動に戻す]）。本物の KeyEditor と評価で確かめる
import { describe, expect, it } from 'vitest';
import { validateProject, type Model, type Parameter, type Project, type TransformDelta } from '@app/schema';
import type { EditorState } from '@app/contracts';
import { createBindingEvaluator, defaultEditorState } from '@app/core';
import { createKeyEditor } from '../../../services/keyEditor';
import {
  activePair,
  crossSection,
  cellKind,
  cellPatch,
  cellStatus,
  correctionKeyCount,
  defaultPair,
  DIRECTION_PAIR,
  directionValues,
  isCurrentCell,
  isIdentityKey,
  keyPositions,
  pairBindings,
  pairParameters,
  resetCell,
  resetCellCommand,
} from './grid';
import { cellStatusText, combinationName, directionName } from './labels';
import { gridTestProject, td } from './testModel';

const param = (model: Model, id: string): Parameter => model.parameters.find((p) => p.id === id)!;
const editorWith = (patch: Partial<EditorState>): EditorState => ({ ...defaultEditorState(), ...patch });
const keyEditor = createKeyEditor();

// 押したマスの状態でパーツを動かす（キャンバスの操作と同じ KeyEditor）
function moveFace(project: Project, editor: EditorState, dx: number, dy: number): Project {
  const command = keyEditor.transformEdit(project, editor, ['face'], { dPosition: { x: dx, y: dy } });
  if (command === 'needsKey') throw new Error('キーがあるはず');
  return command.apply(project);
}

function faceAt(model: Model, params: Record<string, number>): TransformDelta {
  return createBindingEvaluator().evaluate(model, params).transforms.face!;
}

describe('方向グリッドのマス', () => {
  const model = gridTestProject().model;
  const [fx, fy] = pairParameters(model, DIRECTION_PAIR)!;

  it('−30 / 0 / 30 の 3×3。範囲が狭ければ丸める', () => {
    expect(directionValues(fx)).toEqual([-30, 0, 30]);
    expect(directionValues({ ...fx, min: -20, max: 10 })).toEqual([-20, 0, 10]);
  });

  it('マスの種類と名前（中央は正面、上下左右は1方向、斜めは組み合わせ）', () => {
    expect(cellKind(fx, fy, { a: 0, b: 0 })).toBe('center');
    expect(cellKind(fx, fy, { a: 30, b: 0 })).toBe('axis');
    expect(cellKind(fx, fy, { a: 0, b: -30 })).toBe('axis');
    expect(cellKind(fx, fy, { a: -30, b: 30 })).toBe('combined');
    expect(directionName(fx, fy, { a: -30, b: 30 })).toBe('左上');
    expect(directionName(fx, fy, { a: 30, b: -30 })).toBe('右下');
    expect(directionName(fx, fy, { a: 30, b: 0 })).toBe('右');
    expect(directionName(fx, fy, { a: 0, b: 30 })).toBe('上');
    expect(directionName(fx, fy, { a: 0, b: 0 })).toBe('正面');
    expect(cellStatusText(fx, fy, { a: 30, b: 0 }, 'auto')).toBe('顔 左右だけ');
    expect(cellStatusText(fx, fy, { a: 30, b: 30 }, 'corrected')).toBe('修正済み');
  });

  it('斜めと中央は2パラメータ、上下左右は動く方だけの1パラメータを編集中にする', () => {
    expect(cellPatch(fx, fy, { a: 30, b: 30 })).toEqual({
      activeParameterIds: ['FaceAngleX', 'FaceAngleY'],
      editorParamValues: { FaceAngleX: 30, FaceAngleY: 30 },
    });
    expect(cellPatch(fx, fy, { a: 0, b: 0 })).toEqual({
      activeParameterIds: ['FaceAngleX', 'FaceAngleY'],
      editorParamValues: { FaceAngleX: 0, FaceAngleY: 0 },
    });
    expect(cellPatch(fx, fy, { a: -30, b: 0 })).toEqual({
      activeParameterIds: ['FaceAngleX'],
      editorParamValues: { FaceAngleX: -30 },
    });
    expect(cellPatch(fx, fy, { a: 0, b: 30 })).toEqual({
      activeParameterIds: ['FaceAngleY'],
      editorParamValues: { FaceAngleY: 30 },
    });
  });

  it('いまのマスは、押したときと同じ編集中の状態のときだけ', () => {
    const at = editorWith(cellPatch(fx, fy, { a: 30, b: -30 }));
    expect(isCurrentCell(fx, fy, { a: 30, b: -30 }, at)).toBe(true);
    expect(isCurrentCell(fx, fy, { a: 30, b: 30 }, at)).toBe(false);
    // 順が逆でも同じ組
    expect(isCurrentCell(fx, fy, { a: 30, b: -30 }, { ...at, activeParameterIds: ['FaceAngleY', 'FaceAngleX'] })).toBe(
      true,
    );
    // 右（1パラメータ）は FaceAngleX だけが編集中のとき
    const right = editorWith(cellPatch(fx, fy, { a: 30, b: 0 }));
    expect(isCurrentCell(fx, fy, { a: 30, b: 0 }, right)).toBe(true);
    expect(isCurrentCell(fx, fy, { a: 30, b: 0 }, { ...right, activeParameterIds: ['FaceAngleX', 'FaceAngleY'] })).toBe(
      false,
    );
    // 何も編集していなければどのマスでもない
    expect(isCurrentCell(fx, fy, { a: 0, b: 0 }, editorWith({}))).toBe(false);
  });
});

describe('斜めのマスの見た目と補正のキー', () => {
  it('補正前は上下と左右の差分の和で動く', () => {
    const model = gridTestProject().model;
    const evaluator = createBindingEvaluator();
    const both = evaluator.evaluate(model, { FaceAngleX: 30, FaceAngleY: -30 });
    const onlyX = evaluator.evaluate(model, { FaceAngleX: 30 });
    const onlyY = evaluator.evaluate(model, { FaceAngleY: -30 });
    // 位置・回転は加算、拡縮は乗算
    expect(both.transforms.face).toEqual({
      position: { x: onlyX.transforms.face!.position.x, y: onlyY.transforms.face!.position.y },
      rotation: onlyX.transforms.face!.rotation + onlyY.transforms.face!.rotation,
      scale: { x: 1, y: onlyY.transforms.face!.scale.y },
      opacity: 1,
    });
    expect([...both.vertices['m-face']!]).toEqual(
      [...onlyX.vertices['m-face']!].map((v, i) => v + onlyY.vertices['m-face']![i]!),
    );
  });

  it('斜めのマスで直すと補正のキーができ（かんたんではロック）、ほかのマスは和のまま', () => {
    const project = gridTestProject();
    const model = project.model;
    const [fx, fy] = pairParameters(model, DIRECTION_PAIR)!;
    const cell = { a: 30, b: 30 };
    expect(cellStatus(model, DIRECTION_PAIR, cell)).toBe('auto');

    const editor = editorWith(cellPatch(fx, fy, cell));
    const edited = moveFace(project, editor, 2, 3).model;
    const [pairBinding] = pairBindings(edited, DIRECTION_PAIR);
    expect(pairBinding!.target).toEqual({ type: 'part', id: 'face' });
    const correction = pairBinding!.keys.find((k) => k.coords[0] === 30 && k.coords[1] === 30)!;
    expect(correction).toMatchObject({ source: 'manual', locked: true, delta: td(2, 3) });
    expect(cellStatus(edited, DIRECTION_PAIR, cell)).toBe('corrected');
    expect(correctionKeyCount(edited, DIRECTION_PAIR, cell)).toBe(1);
    expect(cellStatus(edited, DIRECTION_PAIR, { a: -30, b: 30 })).toBe('auto');

    // 見た目は和 + 補正。ほかの斜めは和のまま
    const sum = faceAt(model, { FaceAngleX: 30, FaceAngleY: 30 });
    const corrected = faceAt(edited, { FaceAngleX: 30, FaceAngleY: 30 });
    expect(corrected.position).toEqual({ x: sum.position.x + 2, y: sum.position.y + 3 });
    expect(faceAt(edited, { FaceAngleX: -30, FaceAngleY: 30 })).toEqual(
      faceAt(model, { FaceAngleX: -30, FaceAngleY: 30 }),
    );
    // 保存しても読み直せる形
    expect(() => validateProject(JSON.parse(JSON.stringify({ ...project, model: edited })))).not.toThrow();
  });

  it('[自動に戻す] でそのマスの補正のキーだけを消し、補正が残らないバインディングは消す', () => {
    const project = gridTestProject();
    const [fx, fy] = pairParameters(project.model, DIRECTION_PAIR)!;
    const upRight = { a: 30, b: 30 };
    const upLeft = { a: -30, b: 30 };
    let p = moveFace(project, editorWith(cellPatch(fx, fy, upRight)), 2, 3);
    // 2つ目も格子上なら確認なしで補正を作る（I-017）
    const left = editorWith(cellPatch(fx, fy, upLeft));
    p = moveFace(p, left, -1, 0);
    expect(cellStatus(p.model, DIRECTION_PAIR, upLeft)).toBe('corrected');

    const reset = resetCell(p.model, DIRECTION_PAIR, upRight);
    expect(cellStatus(reset, DIRECTION_PAIR, upRight)).toBe('auto');
    expect(cellStatus(reset, DIRECTION_PAIR, upLeft)).toBe('corrected');
    // 右上は和に戻り、左上の補正は残る
    expect(faceAt(reset, { FaceAngleX: 30, FaceAngleY: 30 })).toEqual(
      faceAt(project.model, { FaceAngleX: 30, FaceAngleY: 30 }),
    );
    expect(faceAt(reset, { FaceAngleX: -30, FaceAngleY: 30 })).toEqual(
      faceAt(p.model, { FaceAngleX: -30, FaceAngleY: 30 }),
    );
    // keyValues は残す
    expect(pairBindings(reset, DIRECTION_PAIR)[0]!.keyValues).toEqual(
      pairBindings(p.model, DIRECTION_PAIR)[0]!.keyValues,
    );

    // 左上も戻すと補正のバインディングは無くなり、ほかのバインディングはそのまま
    const all = resetCell(reset, DIRECTION_PAIR, upLeft);
    expect(pairBindings(all, DIRECTION_PAIR)).toEqual([]);
    expect(all.bindings).toEqual(project.model.bindings);
    expect(all.bindings.every((b, i) => b === p.model.bindings[i])).toBe(true);
  });

  it('組み合わせでないマスや、補正の無いマスでは何もしない', () => {
    const project = gridTestProject();
    const [fx, fy] = pairParameters(project.model, DIRECTION_PAIR)!;
    const p = moveFace(project, editorWith(cellPatch(fx, fy, { a: 30, b: 30 })), 2, 3);
    expect(resetCell(p.model, DIRECTION_PAIR, { a: 0, b: 0 })).toBe(p.model);
    expect(resetCell(p.model, DIRECTION_PAIR, { a: 30, b: 0 })).toBe(p.model);
    expect(resetCell(p.model, DIRECTION_PAIR, { a: -30, b: -30 })).toBe(p.model);
    expect(resetCellCommand(DIRECTION_PAIR, { a: -30, b: -30 }).apply(p)).toBe(p);
    expect(resetCellCommand(DIRECTION_PAIR, { a: 30, b: 30 }).label).toBe('自動に戻す');
  });

  it('差分 0 のキーでも、組み合わせのマスのキーは状態に出るので残す', () => {
    const project = gridTestProject();
    const [fx, fy] = pairParameters(project.model, DIRECTION_PAIR)!;
    let p = moveFace(project, editorWith(cellPatch(fx, fy, { a: 30, b: 30 })), 2, 3);
    const left = editorWith(cellPatch(fx, fy, { a: -30, b: -30 }));
    p = keyEditor.addKeyAtCurrentValue(p, left, { partId: 'face' }).apply(p);
    const zeroKey = pairBindings(p.model, DIRECTION_PAIR)[0]!.keys.find((k) => k.coords[0] === -30)!;
    expect(isIdentityKey(zeroKey)).toBe(true);
    const reset = resetCell(p.model, DIRECTION_PAIR, { a: 30, b: 30 });
    expect(cellStatus(reset, DIRECTION_PAIR, { a: -30, b: -30 })).toBe('corrected');
  });

  it.each(['auto', 'generated', 'combined'] as const)(
    '自動の補正（%s）はロックされていても修正済みに数えない（I-037）',
    (source) => {
      const project = gridTestProject();
      const [fx, fy] = pairParameters(project.model, DIRECTION_PAIR)!;
      const cell = { a: 30, b: 30 };
      const p = moveFace(project, editorWith(cellPatch(fx, fy, cell)), 2, 3);
      const b = pairBindings(p.model, DIRECTION_PAIR)[0]!;
      b.keys = b.keys.map((k) => ({ ...k, source, locked: true }));
      const before = structuredClone(p.model);
      expect(cellStatus(p.model, DIRECTION_PAIR, cell)).toBe('auto');
      expect(correctionKeyCount(p.model, DIRECTION_PAIR, cell)).toBe(0);
      expect(p.model).toEqual(before);
      // 手で直したマスだけ修正済みになり、パラメータの順が逆でも同じ
      const edited = moveFace(p, editorWith(cellPatch(fx, fy, cell)), 1, 0);
      expect(cellStatus(edited.model, { a: 'FaceAngleY', b: 'FaceAngleX' }, cell)).toBe('corrected');
      expect(correctionKeyCount(edited.model, DIRECTION_PAIR, cell)).toBe(1);
    },
  );
});

describe('組み合わせの補正の格子', () => {
  it('各パラメータのキー位置（どのバインディングのものも）とデフォルト値', () => {
    const model = gridTestProject().model;
    expect(keyPositions(model, param(model, 'FaceAngleX'))).toEqual([-30, 0, 30]);
    expect(keyPositions(model, param(model, 'FaceAngleY'))).toEqual([-30, 0, 30]);
    expect(keyPositions(model, param(model, 'EyeOpenL'))).toEqual([0, 1]);
    expect(keyPositions(model, param(model, 'EyeSmileL'))).toEqual([0, 1]);
    // キーの無いパラメータはデフォルト値だけ
    expect(keyPositions(model, param(model, 'MouthOpen'))).toEqual([0]);
  });

  it('組の選び方（編集中の2つ → 顔の向き → 先頭の2つ）', () => {
    const model = gridTestProject().model;
    expect(activePair(model, editorWith({ activeParameterIds: ['EyeOpenL', 'EyeSmileL'] }))).toEqual({
      a: 'EyeOpenL',
      b: 'EyeSmileL',
    });
    expect(activePair(model, editorWith({ activeParameterIds: ['EyeOpenL'] }))).toBeNull();
    expect(activePair(model, editorWith({ activeParameterIds: ['EyeOpenL', 'Nope'] }))).toBeNull();
    expect(defaultPair(model)).toEqual(DIRECTION_PAIR);
    const noFace = { ...model, parameters: model.parameters.filter((p) => p.id !== 'FaceAngleY') };
    expect(defaultPair(noFace)).toEqual({ a: 'FaceAngleX', b: 'FaceAngleZ' });
    expect(defaultPair({ ...model, parameters: model.parameters.slice(0, 1) })).toBeNull();
    expect(pairParameters(model, { a: 'EyeOpenL', b: 'EyeOpenL' })).toBeNull();
  });

  it('任意の2パラメータの組み合わせのマスを直すと補正のキーができ、[自動に戻す] で消える（順は問わない）', () => {
    const project = gridTestProject();
    const model = project.model;
    const pair = { a: 'EyeSmileL', b: 'EyeOpenL' };
    const [smile, open] = pairParameters(model, pair)!;
    const cell = { a: 1, b: 0 }; // 笑顔 1・閉じる
    expect(cellKind(smile, open, cell)).toBe('combined');
    expect(combinationName(smile, open, cell)).toBe('目 笑顔 L 1・目 開閉 L 0');
    // 詳細では補正のキーはロックしない
    const editor = editorWith({
      ...cellPatch(smile, open, cell),
    });
    const command = keyEditor.pointsEdit(project, editor, { kind: 'mesh', meshId: 'm-eye' }, [
      { index: 0, d: { x: 0, y: -2 } },
    ]);
    if (command === 'needsKey') throw new Error('キーがあるはず');
    const edited = command.apply(project).model;
    const [b] = pairBindings(edited, pair);
    expect(b!.parameterIds).toEqual(['EyeSmileL', 'EyeOpenL']);
    expect(b!.keys.find((k) => k.coords[0] === 1 && k.coords[1] === 0)).toMatchObject({
      source: 'manual',
      locked: true,
    });
    expect(cellStatus(edited, pair, cell)).toBe('corrected');
    // 逆の組でも同じバインディングを見る
    expect(cellStatus(edited, { a: 'EyeOpenL', b: 'EyeSmileL' }, { a: 0, b: 1 })).toBe('corrected');

    const evaluator = createBindingEvaluator();
    const eye = (m: Model) => [...evaluator.evaluate(m, { EyeSmileL: 1, EyeOpenL: 0 }).vertices['m-eye']!];
    expect(eye(edited)).toEqual(eye(model).map((v, i) => (i === 1 ? v - 2 : v)));
    const reset = resetCell(edited, { a: 'EyeOpenL', b: 'EyeSmileL' }, { a: 0, b: 1 });
    expect(pairBindings(reset, pair)).toEqual([]);
    expect(eye(reset)).toEqual(eye(model));
  });
});

describe('2軸断面（I-028）', () => {
  const three = ['FaceAngleX', 'FaceAngleY', 'EyeOpenL'];
  const at = { FaceAngleX: 30, FaceAngleY: 30, EyeOpenL: 0 };

  it('ほかに編集中のパラメータ（デフォルト値でない）があれば、その値での断面にする', () => {
    const p = gridTestProject();
    const editor = editorWith({ activeParameterIds: three, editorParamValues: at });
    const pair = crossSection(p.model, editor, DIRECTION_PAIR);
    expect(pair.fixed).toEqual([{ id: 'EyeOpenL', value: 0 }]);
    // デフォルト値のものは断面にしない
    const atDefault = editorWith({ activeParameterIds: three, editorParamValues: { FaceAngleX: 30, EyeOpenL: 1 } });
    expect(crossSection(p.model, atDefault, DIRECTION_PAIR).fixed).toBeUndefined();

    const [pa, pb] = pairParameters(p.model, pair)!;
    expect(cellPatch(pa, pb, { a: 30, b: 0 }, pair.fixed)).toEqual({
      activeParameterIds: three,
      editorParamValues: { FaceAngleX: 30, FaceAngleY: 0, EyeOpenL: 0 },
    });
    expect(isCurrentCell(pa, pb, { a: 30, b: 30 }, editor, pair.fixed)).toBe(true);
    expect(isCurrentCell(pa, pb, { a: 30, b: 30 }, editor)).toBe(false);
  });

  it('断面のマスで直すと3つの組のバインディングに補正のキーができ、その断面だけが修正済みになる', () => {
    const p = gridTestProject();
    const editor = editorWith({ activeParameterIds: three, editorParamValues: at });
    const pair = crossSection(p.model, editor, DIRECTION_PAIR);
    const cell = { a: 30, b: 30 };
    expect(cellStatus(p.model, pair, cell)).toBe('auto');
    const moved = moveFace(p, editor, 5, 0);
    const bindings = pairBindings(moved.model, pair);
    expect(bindings).toHaveLength(1);
    expect([...bindings[0]!.parameterIds].sort()).toEqual([...three].sort());
    expect(cellStatus(moved.model, pair, cell)).toBe('corrected');
    expect(correctionKeyCount(moved.model, pair, cell)).toBe(1);
    // 目を開けた（EyeOpenL がデフォルト値の）格子は変わらない
    expect(cellStatus(moved.model, DIRECTION_PAIR, cell)).toBe('auto');
    expect(faceAt(moved.model, at).position.x - faceAt(p.model, at).position.x).toBeCloseTo(5);
    const open = { FaceAngleX: 30, FaceAngleY: 30 };
    expect(faceAt(moved.model, open).position.x).toBeCloseTo(faceAt(p.model, open).position.x);
    // [自動に戻す] で断面の補正のキーを消す
    const reset = resetCell(moved.model, pair, cell);
    expect(cellStatus(reset, pair, cell)).toBe('auto');
    expect(faceAt(reset, at).position.x).toBeCloseTo(faceAt(p.model, at).position.x);
    expect(() => validateProject({ ...moved, model: reset })).not.toThrow();
  });
});
