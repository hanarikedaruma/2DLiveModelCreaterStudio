import { describe, expect, it } from 'vitest';
import { renameWithRetry } from './rename';

const noSleep = async () => {};

describe('renameWithRetry（カード58・I-057）', () => {
  it('1回目で置き換えられれば、そのまま終わる', async () => {
    const calls: string[] = [];
    await renameWithRetry(async (a, b) => void calls.push(`${a}->${b}`), 'x.tmp', 'x', [1, 1], noSleep);
    expect(calls).toEqual(['x.tmp->x']);
  });

  it('失敗したら待って試し直し、途中で通れば終わる', async () => {
    let n = 0;
    const slept: number[] = [];
    await renameWithRetry(
      async () => {
        n++;
        if (n < 3) throw new Error('使用中');
      },
      'x.tmp',
      'x',
      [10, 20, 30],
      async (ms) => void slept.push(ms),
    );
    expect(n).toBe(3);
    expect(slept).toEqual([10, 20]);
  });

  it('最後まで失敗しても移動先を消さず、元のファイルが残ることを伝えるエラーにする', async () => {
    const removed: string[] = [];
    const fs = {
      rename: async () => {
        throw new Error('使用中');
      },
      remove: async (p: string) => void removed.push(p),
    };
    await expect(renameWithRetry(fs.rename, 'p.json.tmp', 'p.json', [1, 1], noSleep)).rejects.toThrow(
      'p.json を置き換えられなかった（前のファイルはそのまま。新しい内容は p.json.tmp に残っている）: 使用中',
    );
    expect(removed).toEqual([]);
  });
});
