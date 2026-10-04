// かんたんのプリセットを選び直すときの確認（カード27）。各機能のかんたんの画面が使う。
// 例:
//   const confirmOverwrite = useConfirmOverwriteCustom();
//   const current = presetOf(values, PRESETS);
//   if (await confirmOverwrite(current)) dispatch(applyPreset(name));
import { useCallback } from 'react';
import { useDialogs } from '../api';
import type { Dialogs } from '../dialogs';

export const OVERWRITE_CUSTOM_MESSAGE = '個別に調整した値を上書きします';

// current（presetOf の結果や保存してあるプリセット名）が 'custom' なら確認を出し、OK なら true。
// プリセットのどれかに一致しているなら確認せずに true
export async function confirmOverwriteCustom(dialogs: Pick<Dialogs, 'confirm'>, current: string): Promise<boolean> {
  if (current !== 'custom') return true;
  return dialogs.confirm(OVERWRITE_CUSTOM_MESSAGE);
}

// 画面の部品から使う形。枠の確認ダイアログを出す
export function useConfirmOverwriteCustom(): (current: string) => Promise<boolean> {
  const dialogs = useDialogs();
  return useCallback((current: string) => confirmOverwriteCustom(dialogs, current), [dialogs]);
}
