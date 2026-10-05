// トラッキングの割り当てのコマンド（I-042）
import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  ensureStandardParameters,
  validateProject,
  type Parameter,
  type Project,
} from '@app/schema';
import {
  addMappingCommand,
  moveMappingCommand,
  newMapping,
  removeMappingCommand,
  resetToStandardCommand,
  setCombineCommand,
  setModeCommand,
  sharedParameters,
  standardMappings,
  updateMappingCommand,
} from './commands';

const TAIL: Parameter = { id: 'tail', name: 'しっぽ', groupId: 'other', min: -1, max: 1, default: 0, standard: false };

function project(): Project {
  const p = createEmptyProject('テスト');
  const model = ensureStandardParameters(p.model, 'step1');
  return { ...p, model: { ...model, parameters: [...model.parameters, TAIL] } };
}

describe('トラッキングの割り当てのコマンド', () => {
  it('はじめは標準。カスタムにすると標準の割り当てから始め、無効・標準にしても一覧は残る', () => {
    const p = project();
    expect(p.trackingSetup.mode).toBe('standard');
    const custom = setModeCommand('custom').apply(p);
    expect(custom.trackingSetup.mode).toBe('custom');
    expect(custom.trackingMappings).toEqual(standardMappings(p));
    expect(custom.trackingMappings.map((m) => m.parameterId)).toContain('MouthForm'); // STEP1 の標準パラメータもある
    const off = setModeCommand('off').apply(custom);
    expect(off.trackingSetup.mode).toBe('off');
    expect(off.trackingMappings).toBe(custom.trackingMappings);
    // 一覧があればカスタムに戻しても作り直さない
    const again = setModeCommand('custom').apply(updateMappingCommand(0, { weight: 2 }).apply(off));
    expect(again.trackingMappings[0]!.weight).toBe(2);
    expect(setModeCommand('custom').apply(again)).toBe(again);
    expect(() => validateProject(again)).not.toThrow();
  });

  it('標準の割り当ては、モデルにあるパラメータへのものだけ', () => {
    const mvp = createEmptyProject('MVP');
    expect(standardMappings(mvp).map((m) => m.parameterId)).not.toContain('MouthForm');
  });

  it('足す割り当ては、ユーザー定義のパラメータへ（出力の範囲はそのパラメータの範囲）', () => {
    const p = addMappingCommand().apply(setModeCommand('custom').apply(project()));
    expect(p.trackingMappings.at(-1)).toEqual(newMapping(p.model.parameters));
    expect(p.trackingMappings.at(-1)).toMatchObject({ input: 'faceYaw', parameterId: 'tail', outputRange: [-1, 1] });
  });

  it('入力を変えると入力の範囲を、パラメータを変えると出力の範囲を合わせる', () => {
    let p = addMappingCommand().apply(setModeCommand('custom').apply(project()));
    const last = p.trackingMappings.length - 1;
    p = updateMappingCommand(last, { input: 'mouthOpen' }).apply(p);
    expect(p.trackingMappings[last]).toMatchObject({ input: 'mouthOpen', inputRange: [0, 1] });
    p = updateMappingCommand(last, { parameterId: 'FaceAngleX' }).apply(p);
    expect(p.trackingMappings[last]).toMatchObject({ parameterId: 'FaceAngleX', outputRange: [-30, 30] });
    p = updateMappingCommand(last, { invert: true, inputRange: [0.2, 0.8] }).apply(p);
    expect(p.trackingMappings[last]).toMatchObject({ invert: true, inputRange: [0.2, 0.8] });
    expect(updateMappingCommand(99, { invert: true }).apply(p)).toBe(p);
  });

  it('並べ替え・削除・標準の一覧に戻す', () => {
    let p = setModeCommand('custom').apply(project());
    const [a, b] = p.trackingMappings;
    p = moveMappingCommand(1, -1).apply(p);
    expect(p.trackingMappings.slice(0, 2)).toEqual([b, a]);
    expect(moveMappingCommand(0, -1).apply(p)).toBe(p);
    p = removeMappingCommand(0).apply(p);
    expect(p.trackingMappings[0]).toEqual(a);
    p = setCombineCommand('FaceAngleX', 'average').apply(p);
    p = resetToStandardCommand().apply(p);
    expect(p.trackingMappings).toEqual(standardMappings(p));
    expect(p.trackingSetup.combine).toEqual([]);
  });

  it('合わせ方は、加算（既定）以外だけを記録する。2つ以上の割り当てがあるパラメータを数える', () => {
    let p = setModeCommand('custom').apply(project());
    expect(sharedParameters(p)).toEqual([]);
    p = addMappingCommand().apply(addMappingCommand().apply(p));
    expect(sharedParameters(p)).toEqual(['tail']);
    p = setCombineCommand('tail', 'priority').apply(p);
    expect(p.trackingSetup.combine).toEqual([{ parameterId: 'tail', method: 'priority' }]);
    p = setCombineCommand('tail', 'average').apply(p);
    expect(p.trackingSetup.combine).toEqual([{ parameterId: 'tail', method: 'average' }]);
    p = setCombineCommand('tail', 'add').apply(p);
    expect(p.trackingSetup.combine).toEqual([]);
  });
});
