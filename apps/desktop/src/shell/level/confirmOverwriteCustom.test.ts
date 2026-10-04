import { describe, expect, it, vi } from 'vitest';
import { presetOf } from '../presets';
import { OVERWRITE_CUSTOM_MESSAGE, confirmOverwriteCustom } from './confirmOverwriteCustom';

const presets = {
  stable: { minCutoff: 0.5, beta: 0.001 },
  standard: { minCutoff: 1, beta: 0.007 },
};

describe('confirmOverwriteCustom', () => {
  it("'custom' なら「個別に調整した値を上書きします」と確認し、答えを返す", async () => {
    const yes = { confirm: vi.fn(async () => true) };
    await expect(confirmOverwriteCustom(yes, 'custom')).resolves.toBe(true);
    expect(yes.confirm).toHaveBeenCalledWith('個別に調整した値を上書きします');
    expect(OVERWRITE_CUSTOM_MESSAGE).toBe('個別に調整した値を上書きします');

    const no = { confirm: vi.fn(async () => false) };
    await expect(confirmOverwriteCustom(no, 'custom')).resolves.toBe(false);
    expect(no.confirm).toHaveBeenCalledTimes(1);
  });

  it('プリセットに一致しているなら確認せずに true', async () => {
    const dialogs = { confirm: vi.fn(async () => false) };
    await expect(confirmOverwriteCustom(dialogs, 'standard')).resolves.toBe(true);
    expect(dialogs.confirm).not.toHaveBeenCalled();
  });

  it('presetOf の結果をそのまま渡せる', async () => {
    const dialogs = { confirm: vi.fn(async () => true) };
    await confirmOverwriteCustom(dialogs, presetOf({ minCutoff: 1, beta: 0.007 }, presets));
    expect(dialogs.confirm).not.toHaveBeenCalled();
    await confirmOverwriteCustom(dialogs, presetOf({ minCutoff: 0.8, beta: 0.007 }, presets));
    expect(dialogs.confirm).toHaveBeenCalledTimes(1);
  });
});
