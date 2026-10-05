// KeyEditor の共通部分のうち、プレビューと基準状態の関係（I-029）
import { describe, expect, it } from 'vitest';
import { ensureStandardParameters, type Model } from '@app/schema';
import { isPreviewOffBase } from './common';
import { editorAt, projectWith } from './testing';

const model = (): Model => ensureStandardParameters(projectWith().model, 'step1');

describe('isPreviewOffBase（基準状態を編集するのに、プレビューが基準状態でない）', () => {
  it('編集中のパラメータが無く、値だけがデフォルト値でない（表情を作っている途中など）なら true', () => {
    expect(isPreviewOffBase(model(), editorAt({ FaceAngleX: 30 }, { activeParameterIds: [] }))).toBe(true);
    expect(isPreviewOffBase(model(), editorAt({ EyeOpenL: 0.6, Cheek: 1 }, { activeParameterIds: [] }))).toBe(true);
  });

  it('編集中のパラメータがデフォルト値で、ほかの値がデフォルト値でないときも true', () => {
    const editor = editorAt({ FaceAngleX: 0, MouthOpen: 1 }, { activeParameterIds: ['FaceAngleX'] });
    expect(isPreviewOffBase(model(), editor)).toBe(true);
  });

  it('すべてデフォルト値、またはキーを編集する状態なら false', () => {
    expect(isPreviewOffBase(model(), editorAt({}))).toBe(false);
    expect(isPreviewOffBase(model(), editorAt({ FaceAngleX: 0, EyeOpenL: 1 }, { activeParameterIds: [] }))).toBe(false);
    expect(isPreviewOffBase(model(), editorAt({ FaceAngleX: 0 }))).toBe(false); // 編集中だがデフォルト値
    expect(isPreviewOffBase(model(), editorAt({ FaceAngleX: 30 }))).toBe(false); // キーの編集
    expect(isPreviewOffBase(model(), editorAt({ FaceAngleX: 30, MouthOpen: 1 }))).toBe(false);
  });

  it('値は min..max に丸めて比べ、モデルに無いパラメータと数でない値は数えない', () => {
    const none = { activeParameterIds: [] };
    expect(isPreviewOffBase(model(), editorAt({ Cheek: -1 }, none))).toBe(false); // 0..1 に丸めると 0
    expect(isPreviewOffBase(model(), editorAt({ Missing: 5 }, none))).toBe(false);
    expect(isPreviewOffBase(model(), editorAt({ FaceAngleX: Number.NaN }, none))).toBe(false);
    // モデルに無い id だけが編集中なら、編集中のパラメータが無いのと同じ
    expect(isPreviewOffBase(model(), editorAt({ Missing: 1, MouthOpen: 1 }, { activeParameterIds: ['Missing'] }))).toBe(
      true,
    );
  });
});
