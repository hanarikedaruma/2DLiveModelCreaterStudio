import type { Project } from '@app/schema';
import type { EditorState } from '@app/contracts';
import { isPreviewOffBase } from '../../../services/keyEditor/common';
import { descendantImageBounds, groupPart, warpOfPart } from './warpOps';

export function warpGuide(project: Project, editor: EditorState): string | null {
  if (isPreviewOffBase(project.model, editor))
    return 'プレビュー中は編集できない。パラメータの［値をすべて戻す］で基準状態に戻す';
  const group = editor.selectedPartIds.length === 1 ? groupPart(project.model, editor.selectedPartIds[0]) : null;
  if (!group) return '画像を含むグループを選ぶ。画像を選んだ場合は、パーツの設定でグループを選ぶか作る';
  if (!descendantImageBounds(project, group.id)) return '子に画像パーツが無い。画像をこのグループへ入れる';
  if (!warpOfPart(project.model, group.id)) return '格子が無い。パーツの設定の［ワープを追加］を押す';
  return null;
}
