// 異常終了の後の復元（カード23）: 変更して自動保存を待つ → 強制終了 → 起動し直すと復元を提案する
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { answerDialog, appDataDir, launchApp, removeTestAutosave, sleep, type RunningApp } from './app';

// Tauri の appDataDir（identifier のフォルダ）
let appData = '';

let app: RunningApp | null = null;
let projectId = '';

afterAll(async () => {
  await app?.close();
  // このテストで作った自動保存を残さない（残すと次の起動で復元を聞かれる）
  removeTestAutosave(appData, projectId);
});

describe('異常終了の後の復元', () => {
  it('自動保存の後に強制終了すると、次の起動で復元を提案し、承認すると作業が戻る', async () => {
    const name = `復元のテスト ${Date.now()}`;

    // 1. 起動して（前の自動保存を聞かれたら断り）、プロジェクトを変える
    app = await launchApp(9334);
    appData = await appDataDir(app.page);
    while ((await answerDialog(app.page, 'キャンセル', 2000)) !== null) {
      // 前のテストや作業の残りは復元しない
    }
    projectId = await app.page.evaluate((n) => {
      const { store } = window.__studio.services;
      store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: n }) });
      return store.get().id;
    }, name);

    // 2. 自動保存（最後の変更から5秒）が書かれるのを待つ
    const backups = join(appData, 'unsaved', projectId, 'backups');
    for (
      let i = 0;
      i < 60 && !(existsSync(backups) && readdirSync(backups).some((f) => f.startsWith('autosave-')));
      i++
    ) {
      await sleep(250);
    }
    expect(readdirSync(backups).filter((f) => f.startsWith('autosave-'))).toHaveLength(1);

    // 3. 強制終了する（異常終了の代わり）
    app.kill();
    await app.browser.close().catch(() => {});
    app = null;
    await sleep(1000);

    // 4. 起動し直すと、このプロジェクトの復元を提案する（ほかの残りは断る）
    app = await launchApp(9335);
    let restored = false;
    for (let i = 0; i < 20; i++) {
      const dialog = app.page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 10_000 });
      const message = (await dialog.locator('.dialog-message').textContent()) ?? '';
      expect(message).toContain('復元しますか');
      if (message.includes(name)) {
        await dialog.getByRole('button', { name: '復元する' }).click();
        restored = true;
        break;
      }
      await dialog.getByRole('button', { name: '後で決める' }).click();
    }
    expect(restored).toBe(true);
    await app.page.waitForFunction((n) => window.__studio.services.store.get().name === n, name);
    const state = await app.page.evaluate(() => ({
      id: window.__studio.services.store.get().id,
      dirty: window.__studio.project.isDirty(),
      dir: window.__studio.project.dir(),
    }));
    expect(state).toEqual({ id: projectId, dirty: true, dir: null });
  }, 180_000);
});
