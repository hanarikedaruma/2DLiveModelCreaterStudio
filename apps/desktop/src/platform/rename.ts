// 名前の変更（保存の .tmp → 本物）を、移動先を消さずに行う（STEP3 のカード58・I-057）。
// Tauri の fs プラグインの rename は std::fs::rename で、Windows では移動先があれば置き換える（1回の操作）。
// 失敗するのはほかのプログラムがファイルを開いているときなどなので、少し待って試し直す。
// 移動先は消さない（消したあとに止まると、元のファイルも新しいファイルも無くなる）
export const RENAME_RETRY_DELAYS_MS = [50, 200, 800];

export async function renameWithRetry(
  rename: (from: string, to: string) => Promise<void>,
  from: string,
  to: string,
  delays: readonly number[] = RENAME_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]!);
    try {
      await rename(from, to);
      return;
    } catch (e) {
      last = e;
    }
  }
  const reason = last instanceof Error ? last.message : String(last);
  throw new Error(
    `${to} を置き換えられなかった（前のファイルはそのまま。新しい内容は ${from} に残っている）: ${reason}`,
  );
}
