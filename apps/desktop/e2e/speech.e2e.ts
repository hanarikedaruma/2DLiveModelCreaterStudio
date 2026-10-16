import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDataDir, launchApp, ROOT, waitForStartup, type RunningApp } from './app';

let app: RunningApp;
const work = join(ROOT, '.cache', 'speech-e2e');
const errors: string[] = [];
beforeAll(async () => {
  mkdirSync(work, { recursive: true });
  cpSync(join(ROOT, 'fixtures', 'reference-model'), join(work, 'model'), { recursive: true });
  app = await launchApp(9347);
  app.page.on('pageerror', (error) => errors.push(error.message));
  await waitForStartup(app.page);
  await app.page.evaluate(
    async (directory) => {
      const { services, project } = window.__studio;
      services.autoSaver.stop();
      await project.open(directory);
      services.autoSaver.stop();
      services.editor.set({ mode: 'studio' });
    },
    join(work, 'model').replace(/\\/g, '/'),
  );
});
afterAll(async () => {
  if (app) {
    await app.page
      .evaluate(async () => {
        await window.__studio.services.voice.stop();
        window.__studio.services.autoSaver.stop();
      })
      .catch(() => {});
    await app.close();
  }
});
describe('チャット読み上げのTauri結合', () => {
  it('マイクを選ばず、文脈付きの日本語を実GPUで生成し、Muteで実出力へ送る', async () => {
    const page = app.page;
    const inspection = await page.evaluate(async () => {
      const { services } = window.__studio;
      return services.voice.inspectSpeech(
        services.store.get().studio.voice?.profile ?? {
          name: 'Test',
          backend: 'seed-xlsr-tiny',
          quality: 'fast',
          reference: 'builtin',
          outputGainDb: -3,
          voiceTone: { brightnessDb: 0, bodyDb: 0, softnessDb: 0 },
          inputCleanup: { noiseReduction: 0, speechOnly: false, speechSensitivity: 40 },
          outputFilters: { schemaVersion: 1, enabled: false, items: [] },
        },
      );
    });
    expect(inspection.ready).toBe(true);
    const output = inspection.outputs.find((device) => /Sound Blaster/i.test(device.label)) ?? inspection.outputs[0];
    if (!output) throw new Error('読み上げの出力機器がありません');
    await page.getByRole('combobox', { name: '読み上げの出力先', exact: true }).selectOption(output.id);
    await page
      .getByRole('textbox', { name: '場面・話し方', exact: true })
      .fill('配信の最初に、見に来てくれた人へ明るく挨拶する');
    await page.getByRole('checkbox', { name: '読み上げをミュート', exact: true }).check();
    await page
      .getByRole('textbox', { name: 'モデルが話す言葉', exact: true })
      .fill('みなさん、こんにちは。今日もよろしくね。');
    await page.getByRole('button', { name: '読み上げ', exact: true }).click();
    const result = await page.evaluate(async () => {
      const { services, environment } = window.__studio;
      const voice = services.voice;
      let frames = 0,
        nonzero = 0,
        previous = -Infinity;
      let monotonic = true,
        finite = true;
      const off = voice.onPlayback((frame) => {
        frames++;
        nonzero += frame.samples.filter((sample) => sample !== 0).length;
        finite &&= frame.samples.every(Number.isFinite);
        monotonic &&= frame.time >= previous;
        previous = frame.time;
      });
      const started = performance.now();
      try {
        while (['loading', 'priming', 'running'].includes(voice.state().state)) {
          if (performance.now() - started > 150000) throw new Error('読み上げの時間切れ');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (voice.state().error) throw new Error(voice.state().error);
        return {
          frames,
          nonzero,
          monotonic,
          finite,
          state: voice.state(),
          input: environment.get().voice?.inputDeviceId,
        };
      } finally {
        off();
      }
    });
    writeFileSync(join(work, 'native-speech.json'), JSON.stringify(result, null, 2));
    expect(result.frames).toBeGreaterThan(20);
    expect(result.nonzero).toBe(0);
    expect(result.finite).toBe(true);
    expect(result.monotonic).toBe(true);
    expect(result.input).toBeNull();
    expect(result.state.speech.history).toEqual(['みなさん、こんにちは。今日もよろしくね。']);
    expect(result.state.state).toBe('stopped');
    expect(result.state.speech.resident).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(work, 'speech-1440.png') });
    await page.setViewportSize({ width: 960, height: 600 });
    const size = await page
      .locator('.speech-panel')
      .evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
    await page.screenshot({ path: join(work, 'speech-960.png') });
    await page.evaluate(() => window.__studio.project.save());
    const saved = await page.evaluate(
      async (directory) => (await window.__studio.services.io.load(directory)).project.studio.voice,
      join(work, 'model').replace(/\\/g, '/'),
    );
    expect(saved?.speech?.scene).toContain('明るく挨拶');
    expect(JSON.stringify(saved)).not.toContain('みなさん、こんにちは');
    expect(errors).toEqual([]);
  });
  it('生成を途中停止し、遅い再生を出さず、一時ファイルを破棄する', async () => {
    const page = app.page;
    await page
      .getByRole('textbox', { name: 'モデルが話す言葉', exact: true })
      .fill('次のお知らせです。少し長めの文章を用意して途中で停止します。');
    await page.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).press('Control+Enter');
    await page.waitForFunction(
      () =>
        window.__studio.services.voice.state().sessionId !== null &&
        window.__studio.services.voice.state().state === 'loading',
    );
    const result = await page.evaluate(async () => {
      const voice = window.__studio.services.voice;
      let lateFrames = 0;
      const off = voice.onPlayback(() => lateFrames++);
      const start = performance.now();
      await voice.stop();
      const stopMs = performance.now() - start;
      await new Promise((resolve) => setTimeout(resolve, 500));
      off();
      return { stopMs, lateFrames, state: voice.state() };
    });
    writeFileSync(join(work, 'cancel-speech.json'), JSON.stringify(result, null, 2));
    expect(result.stopMs).toBeLessThan(5000);
    expect(result.lateFrames).toBe(0);
    expect(result.state.state).toBe('stopped');
    await page.getByRole('button', { name: '発話履歴をクリア', exact: true }).click();
    await page.waitForFunction(() => window.__studio.services.voice.state().speech.history.length === 0);
    const directory = await appDataDir(page);
    expect(readdirSync(join(directory, 'voice', 'speech-temp'))).toEqual([]);
    expect(errors).toEqual([]);
  });
  it('別ウィンドウで逐次再生を選び、実GPUのチャンクを同じ出力へ送り、両画面で状態を共有する', async () => {
    const page = app.page;
    await page.getByRole('button', { name: '別ウィンドウで入力', exact: true }).click();
    let input = app.browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('/speech-input'));
    const deadline = Date.now() + 15000;
    while (!input && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      input = app.browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes('/speech-input'));
    }
    if (!input) throw new Error('入力ウィンドウがありません');
    input.on('pageerror', (error) => errors.push(error.message));
    await input.getByRole('combobox', { name: '再生方式', exact: true }).waitFor();
    expect(await input.evaluate(() => '__studio' in window)).toBe(false);
    await page.getByRole('button', { name: '別ウィンドウで入力', exact: true }).click();
    expect(
      app.browser
        .contexts()
        .flatMap((c) => c.pages())
        .filter((p) => p.url().includes('/speech-input')).length,
    ).toBe(1);
    await input.getByRole('combobox', { name: '再生方式', exact: true }).selectOption('stream');
    await page.waitForFunction(() => window.__studio.services.store.get().studio.voice?.speech?.delivery === 'stream');
    await input
      .getByRole('textbox', { name: 'モデルが話す言葉', exact: true })
      .fill('こんにちは。今日は何をして遊ぼうか。');
    await input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).press('Enter');
    expect(await page.evaluate(() => window.__studio.services.voice.state().state)).toBe('stopped');
    expect((await input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).inputValue()).trim()).toBe(
      'こんにちは。今日は何をして遊ぼうか。',
    );
    await input.getByRole('button', { name: '読み上げ', exact: true }).click();
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'loading');
    // Draft remains editable while the main window generates/plays.
    await input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).fill('次に話す文章');
    const result = await page.evaluate(async () => {
      const voice = window.__studio.services.voice;
      let frames = 0,
        nonzero = 0,
        previous = -Infinity;
      let finite = true,
        monotonic = true;
      const backward: { sequence: number; previous: number; time: number }[] = [];
      const phases = new Set<string>();
      const off = voice.onPlayback((frame) => {
        frames++;
        nonzero += frame.samples.filter((s) => s !== 0).length;
        finite &&= frame.samples.every(Number.isFinite);
        if (frame.time < previous && backward.length < 10)
          backward.push({ sequence: frame.sequence, previous, time: frame.time });
        monotonic &&= frame.time >= previous;
        previous = frame.time;
      });
      const started = performance.now();
      try {
        while (['loading', 'priming', 'running'].includes(voice.state().state)) {
          phases.add(voice.state().state);
          if (performance.now() - started > 150000) throw new Error('逐次読み上げの時間切れ');
          await new Promise((r) => setTimeout(r, 20));
        }
        return { state: voice.state(), frames, nonzero, finite, monotonic, backward, phases: [...phases] };
      } finally {
        off();
      }
    });
    writeFileSync(join(work, 'native-stream.json'), JSON.stringify(result, null, 2));
    expect(result.state.error).toBe('');
    expect(result.state.state).toBe('stopped');
    expect(result.state.speech.delivery).toBe('stream');
    expect(result.state.speech.resident).toBe(true);
    expect(result.state.speech.history).toEqual(['こんにちは。今日は何をして遊ぼうか。']);
    expect(result.phases).toContain('priming');
    expect(result.phases).toContain('running');
    expect(result.frames).toBeGreaterThan(20);
    expect(result.nonzero).toBe(0);
    expect(result.finite).toBe(true);
    expect(result.monotonic).toBe(true);
    expect(result.state.metrics.firstPcmSeconds).toBeLessThan(result.state.metrics.generationSeconds!);
    expect(await input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).inputValue()).toBe(
      '次に話す文章',
    );
    await input.getByRole('status').filter({ hasText: '文章を入力して読み上げ' }).waitFor();
    await input.screenshot({ path: join(work, 'speech-input-stream.png') });
    const overflow = await input.locator('main').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflow).toBe(false);
    // Close while generating: main must continue to own the request.
    await input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).press('Control+Enter');
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'loading');
    const closingInput = input;
    await closingInput
      .evaluate(async () => {
        const tauri = (window as unknown as { __TAURI_INTERNALS__: { invoke(name: string): Promise<void> } })
          .__TAURI_INTERNALS__;
        await tauri.invoke('plugin:window|close');
      })
      .catch((error: unknown) => {
        if (!closingInput.isClosed()) throw error;
      });
    expect(await page.evaluate(() => window.__studio.services.voice.state().state)).toBe('loading');
    await page.getByRole('button', { name: '別ウィンドウで入力', exact: true }).click();
    const stopped = await page.evaluate(async () => {
      const voice = window.__studio.services.voice;
      const started = performance.now();
      await voice.stop();
      return { ms: performance.now() - started, state: voice.state() };
    });
    writeFileSync(join(work, 'cancel-stream.json'), JSON.stringify(stopped, null, 2));
    expect(stopped.ms).toBeLessThan(5000);
    expect(stopped.state.state).toBe('stopped');
    expect(stopped.state.speech.resident).toBe(true);
    await page.getByRole('combobox', { name: '再生方式', exact: true }).selectOption('whole');
    await page.evaluate(() => window.__studio.project.save());
    const saved = await page.evaluate(
      async (directory) => (await window.__studio.services.io.load(directory)).project.studio.voice,
      join(work, 'model').replace(/\\/g, '/'),
    );
    expect(saved?.speech?.delivery).toBe('whole');
    expect(JSON.stringify(saved)).not.toContain('次に話す文章');
    expect(errors).toEqual([]);
  });
});
