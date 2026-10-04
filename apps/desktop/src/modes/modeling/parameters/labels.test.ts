import { describe, expect, it } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type Binding, type Parameter, type Project } from '@app/schema';
import type { EditorState } from '@app/contracts';
import { defaultEditorState } from '@app/core';
import { editingLabel, formatValue, resultLabel } from './labels';
import { gridTestProject } from '../grid2d/testModel';

const project = createEmptyProject('テスト');
const param = (id: string) => project.model.parameters.find((p) => p.id === id)!;

function editor(values: Record<string, number>): EditorState {
  return { ...defaultEditorState(), activeParameterIds: Object.keys(values), editorParamValues: values };
}

function withBinding(parameterIds: string[], coords: number[][]): Project {
  const binding: Binding = {
    id: 'b1',
    target: { type: 'part', id: 'p1' },
    channel: 'transform',
    parameterIds,
    keyValues: parameterIds.map((_, i) => [...new Set(coords.map((c) => c[i]!))].sort((a, b) => a - b)),
    keys: coords.map((c) => ({
      coords: c,
      delta: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 },
      source: 'manual',
      locked: false,
    })),
    generation: 'linear',
    divisions: null,
  };
  return { ...project, model: { ...project.model, bindings: [binding] } };
}

describe('結果の言葉', () => {
  it('表のとおり（最小 / デフォルト / 最大）', () => {
    const cases: [string, number, string][] = [
      ['FaceAngleX', -30, '左（-30）'],
      ['FaceAngleX', 0, '正面（0）'],
      ['FaceAngleX', 30, '右（+30）'],
      ['FaceAngleY', -30, '下（-30）'],
      ['FaceAngleY', 0, '正面（0）'],
      ['FaceAngleY', 30, '上（+30）'],
      ['FaceAngleZ', -30, '左へ（-30）'],
      ['FaceAngleZ', 0, 'なし（0）'],
      ['FaceAngleZ', 30, '右へ（+30）'],
      ['EyeOpenL', 0, '閉じる（0）'],
      ['EyeOpenL', 1, '開く（1）'],
      ['EyeOpenR', 0, '閉じる（0）'],
      ['EyeOpenR', 1, '開く（1）'],
      ['EyeBallX', -1, '左（-1）'],
      ['EyeBallX', 0, '中央（0）'],
      ['EyeBallX', 1, '右（+1）'],
      ['EyeBallY', -1, '下（-1）'],
      ['EyeBallY', 0, '中央（0）'],
      ['EyeBallY', 1, '上（+1）'],
      ['MouthOpen', 0, '閉じる（0）'],
      ['MouthOpen', 1, '開く（1）'],
    ];
    for (const [id, value, label] of cases) expect([id, resultLabel(param(id), value)]).toEqual([id, label]);
  });

  it('STEP1 の標準パラメータ（カード34）。体は頭と同じ言葉', () => {
    const step1 = new Map(ensureStandardParameters(project.model, 'step1').parameters.map((p) => [p.id, p]));
    const at = (id: string, value: number) => resultLabel(step1.get(id)!, value);
    const cases: [string, number, string][] = [
      ['EyeSmileL', 0, 'なし（0）'],
      ['EyeSmileR', 1, '笑顔（1）'],
      ['BrowYL', -1, '下げる（-1）'],
      ['BrowYR', 0, '–（0）'],
      ['BrowYL', 1, '上げる（+1）'],
      ['BrowFormL', -1, '困り（-1）'],
      ['BrowFormR', 0, '–（0）'],
      ['BrowFormR', 1, '怒り（+1）'],
      ['MouthForm', -1, 'への字（-1）'],
      ['MouthForm', 0, '–（0）'],
      ['MouthForm', 1, '笑顔（+1）'],
      ['MouthWidth', -1, 'すぼめる（-1）'],
      ['MouthWidth', 0, '–（0）'],
      ['MouthWidth', 1, '横に開く（+1）'],
      ['Cheek', 0, 'なし（0）'],
      ['Cheek', 0.5, '染める（0.5）'],
      ['BodyAngleX', -10, '左（-10）'],
      ['BodyAngleX', 0, '正面（0）'],
      ['BodyAngleX', 10, '右（+10）'],
      ['BodyAngleY', -10, '下（-10）'],
      ['BodyAngleY', 0, '正面（0）'],
      ['BodyAngleY', 10, '上（+10）'],
      ['BodyAngleZ', -10, '左へ（-10）'],
      ['BodyAngleZ', 0, 'なし（0）'],
      ['BodyAngleZ', 10, '右へ（+10）'],
    ];
    for (const [id, value, label] of cases) expect([id, at(id, value)]).toEqual([id, label]);
  });

  it('途中の値はデフォルト値から見た向きの言葉。表に無いパラメータは値だけ', () => {
    expect(resultLabel(param('FaceAngleX'), 12.34)).toBe('右（+12.3）');
    expect(resultLabel(param('EyeOpenL'), 0.5)).toBe('閉じる（0.5）');
    expect(resultLabel(param('MouthOpen'), 0.257)).toBe('開く（0.26）');
    const custom: Parameter = {
      id: 'Tail',
      name: 'しっぽ',
      groupId: 'other',
      min: -1,
      max: 1,
      default: 0,
      standard: false,
    };
    expect(resultLabel(custom, -0.5)).toBe('-0.5');
    expect(formatValue(param('FaceAngleX'), -0.01)).toBe('0');
  });
});

describe('編集中の表示', () => {
  it('補正前の格子上の斜めはキーなしでなく自動の合成、格子の間はキーなし（I-018）', () => {
    const p = gridTestProject();
    const label = editingLabel(p, editor({ FaceAngleX: -30, FaceAngleY: 30 }));
    expect(label).toBe('編集中: 顔 左右 ＝ 左（-30）、顔 上下 ＝ 上（+30）　自動（左右と上下の和）');
    expect(editingLabel(p, editor({ FaceAngleY: 30, FaceAngleX: -30 }))).toContain('自動（左右と上下の和）');
    expect(editingLabel(p, editor({ FaceAngleX: -15, FaceAngleY: 30 }))).toContain('キーなし');
    expect(editingLabel(p, editor({ EyeOpenL: 0, EyeSmileL: 1 }))).toContain('自動（2つのパラメータの合成）');
    expect(editingLabel(p, editor({ FaceAngleX: 30, FaceAngleY: 0 }))).not.toContain('自動');
  });

  it('編集中でなければ出さない', () => {
    expect(editingLabel(project, editor({}))).toBeNull();
  });

  it('「編集中: 顔 左右 ＝ 右（+30）」。キーの無い値なら「キーなし」を添える', () => {
    const p = withBinding(['FaceAngleX'], [[0], [30]]);
    expect(editingLabel(p, editor({ FaceAngleX: 30 }))).toBe('編集中: 顔 左右 ＝ 右（+30）');
    expect(editingLabel(p, editor({ FaceAngleX: 20 }))).toBe('編集中: 顔 左右 ＝ 右（+20）　キーなし');
    // デフォルト値は基準状態なのでキーなしにしない
    expect(editingLabel(project, editor({ FaceAngleX: 0 }))).toBe('編集中: 顔 左右 ＝ 正面（0）');
    // バインディングがまだ無い値もキーなし
    expect(editingLabel(project, editor({ MouthOpen: 1 }))).toBe('編集中: 口 開閉 ＝ 開く（1）　キーなし');
  });

  it('2つのパラメータは並べて出し、同じ組のバインディングのキーを見る', () => {
    const p = withBinding(
      ['FaceAngleY', 'FaceAngleX'],
      [
        [0, 0],
        [30, 30],
      ],
    );
    expect(editingLabel(p, editor({ FaceAngleX: 30, FaceAngleY: 30 }))).toBe(
      '編集中: 顔 左右 ＝ 右（+30）、顔 上下 ＝ 上（+30）',
    );
    // 1つだけの編集では2つの組のキーは数えない
    expect(editingLabel(p, editor({ FaceAngleX: 30 }))).toBe('編集中: 顔 左右 ＝ 右（+30）　キーなし');
  });
});
