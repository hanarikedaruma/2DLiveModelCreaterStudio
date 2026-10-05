// KeyEditor の本物（カード19）。EditorState の activeParameterIds と editorParamValues に応じて、
// 基準状態を変えるか、編集中のパラメータのキーを変えるコマンドを返す。コマンドの apply は純粋関数
import type { KeyEditor } from '@app/contracts';
import { addPointsKey, pointsEdit } from './points';
import { addTransformKey, transformEdit } from './transform';

export function createKeyEditor(): KeyEditor {
  return {
    transformEdit,
    pointsEdit,
    addKeyAtCurrentValue: (project, editor, target) =>
      'partId' in target ? addTransformKey(project, editor, target.partId) : addPointsKey(project, editor, target),
  };
}
