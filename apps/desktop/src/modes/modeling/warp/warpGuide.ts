import type { Project } from '@app/schema';
import type { EditorState } from '@app/contracts';
import { isPreviewOffBase } from '../../../services/keyEditor/common';
import { descendantImageBounds, groupPart, warpOfPart } from './warpOps';

// ワープのツールの次の手順。パレットの案内とキャンバスの帯に同じ文を出す（対象を選ぶ段の帯は枠が描く）
export const WARP_PICK_PROMPT = '① キャンバスでパーツをクリックし、画像を含むグループを選ぶ';

export function warpGuide(project: Project, editor: EditorState): string | null {
  if (isPreviewOffBase(project.model, editor))
    return 'プレビュー中は編集できない。パラメータの［値をすべて戻す］で基準状態に戻す';
  const group = editor.selectedPartIds.length === 1 ? groupPart(project.model, editor.selectedPartIds[0]) : null;
  if (!group) return WARP_PICK_PROMPT;
  if (!descendantImageBounds(project, group.id)) return '子に画像パーツが無い。画像をこのグループへ入れる';
  if (!warpOfPart(project.model, group.id)) return '② 格子が無い。ワープのパレットで［ワープを追加］を押す';
  return null;
}
