import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { launchApp, ROOT, sleep, waitForStartup, type RunningApp } from './app';

let app: RunningApp;
const work = join(ROOT, '.cache/speech-shutdown-e2e');
const python = join(ROOT, '../liverVoiceChanger/.venv-quality/Scripts/python.exe');
function inspect(script: string): unknown {
  const result = spawnSync(python, ['-X', 'utf8', '-c', script], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}
afterAll(async () => app?.close());

it('別入力窓と常駐読み上げモデルがあっても、メイン画面を閉じると所有プロセスを全て解放する', async () => {
  mkdirSync(work, { recursive: true });
  app = await launchApp(9351);
  await waitForStartup(app.page);
  await app.page.evaluate(() => {
    window.__studio.services.autoSaver.stop();
    window.__studio.services.editor.set({ mode: 'studio' });
  });
  await app.page.getByRole('button', { name: '別ウィンドウで入力', exact: true }).click();
  let input = app.browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().includes('/speech-input'));
  for (let i = 0; !input && i < 100; i++) {
    await sleep(100);
    input = app.browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url().includes('/speech-input'));
  }
  if (!input) throw new Error('別入力窓がありません');
  await input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).fill('終了時にモデルを解放します。');
  await app.page.waitForFunction(
    () => window.__studio.services.voice.state().speech.preparation?.state === 'ready',
    null,
    { timeout: 150000 },
  );
  const owned = inspect(
    `import json,psutil; print(json.dumps([dict(pid=p.pid,started=p.create_time(),command=p.cmdline()) for p in psutil.Process(${app.process.pid}).children(recursive=True)]))`,
  ) as { pid: number; started: number; command: string[] }[];
  expect(owned.some((process) => process.command.some((part) => part.endsWith('speech_worker.py')))).toBe(true);
  const exited = new Promise<number | null>((resolve) => app.process.once('exit', resolve));
  await app.page
    .evaluate(async () => {
      const tauri = (window as unknown as { __TAURI_INTERNALS__: { invoke(name: string): Promise<void> } })
        .__TAURI_INTERNALS__;
      await tauri.invoke('plugin:window|close');
    })
    .catch(() => {}); // WebView自体が閉じるため応答が失われてもよい。
  expect(await Promise.race([exited, sleep(15000).then(() => 'timeout')])).toBe(0);
  let remaining: number[] = [];
  for (let i = 0; i < 50; i++) {
    remaining = inspect(
      `import json,psutil; owned=json.loads(${JSON.stringify(JSON.stringify(owned))}); print(json.dumps([p['pid'] for p in owned if psutil.pid_exists(p['pid']) and abs(psutil.Process(p['pid']).create_time()-p['started'])<.01]))`,
    ) as number[];
    if (!remaining.length) break;
    await sleep(100);
  }
  writeFileSync(join(work, 'shutdown.json'), JSON.stringify({ owned, remaining }, null, 2));
  expect(remaining).toEqual([]);
});
