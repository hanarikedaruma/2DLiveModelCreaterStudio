import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultVoiceSettings } from '@app/schema';
import { launchApp, ROOT, waitForStartup, type RunningApp } from './app';
let app: RunningApp;
const work = join(ROOT, '.cache', 'speech-draft-e2e');
beforeAll(async () => {
  mkdirSync(work, { recursive: true });
  cpSync(join(ROOT, 'fixtures/reference-model'), join(work, 'model'), { recursive: true });
  app = await launchApp(9348);
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
        await window.__studio.services.voice.releaseSpeech();
        window.__studio.services.autoSaver.stop();
      })
      .catch(() => {});
    await app.close();
  }
});

describe('固定話者と入力中の先行合成', () => {
  it('IMEを待ち、最新入力だけを無音で生成し、送信で既存音声を再利用する', async () => {
    const page = app.page;
    const output = await page.evaluate(async (profile) => {
      const { services } = window.__studio;
      const inspection = await services.voice.inspectSpeech(services.store.get().studio.voice?.profile ?? profile);
      return inspection.outputs.find((d) => /Sound Blaster/i.test(d.label)) ?? inspection.outputs[0];
    }, createDefaultVoiceSettings().profile);
    if (!output) throw new Error('出力デバイスがありません');
    await page.getByRole('combobox', { name: '読み上げの出力先', exact: true }).selectOption(output.id);
    await page.getByRole('checkbox', { name: '読み上げをミュート', exact: true }).check();
    await page.getByRole('button', { name: '別ウィンドウで入力', exact: true }).click();
    let input = app.browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('/speech-input'));
    for (let i = 0; !input && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100));
      input = app.browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes('/speech-input'));
    }
    if (!input) throw new Error('入力ウィンドウがありません');
    const editor = input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true });
    await editor.waitFor();
    await input.getByRole('combobox', { name: '再生方式', exact: true }).selectOption('whole');
    await page.evaluate(() => {
      const capture = { frames: 0, nonzero: 0 };
      window.__studio.services.voice.onPlayback((frame) => {
        capture.frames++;
        capture.nonzero += frame.samples.filter((s) => s !== 0).length;
      });
      Object.assign(window, { __draftCapture: capture });
    });
    await editor.dispatchEvent('compositionstart');
    await editor.fill('にほんご');
    await new Promise((r) => setTimeout(r, 900));
    const before = await page.evaluate(() => window.__studio.services.voice.state());
    expect(before.speech.preparation?.state ?? 'idle').toBe('idle');
    await editor.fill('日本語です。');
    await editor.dispatchEvent('compositionend');
    await page.waitForFunction(() => window.__studio.services.voice.state().speech.preparation?.state === 'generating');
    await editor.fill('こんにちは。同じ声でお話しします。');
    await page.waitForFunction(
      () => window.__studio.services.voice.state().speech.preparation?.state === 'ready',
      null,
      { timeout: 150000 },
    );
    const ready = await page.evaluate(() => ({
      state: window.__studio.services.voice.state(),
      capture: (window as unknown as { __draftCapture: { frames: number; nonzero: number } }).__draftCapture,
    }));
    expect(ready.state.state).toBe('stopped');
    expect(ready.capture.frames).toBe(0);
    expect(ready.state.speech.history).toEqual([]);
    const speaker = createHash('sha256')
      .update(readFileSync(join(ROOT, 'tools/voice-engine/voices/original-soft-girl.wav')))
      .digest('hex');
    expect(ready.state.speech.speakerKey).toBe(speaker);
    const start = Date.now();
    await editor.press('Control+Enter');
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'running');
    const sendMs = Date.now() - start;
    expect(sendMs).toBeLessThan(3000);
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'stopped', null, {
      timeout: 30000,
    });
    const first = await page.evaluate(() => ({
      state: window.__studio.services.voice.state(),
      capture: (window as unknown as { __draftCapture: { frames: number; nonzero: number } }).__draftCapture,
    }));
    expect(first.state.metrics.prefetchHit).toBe(1);
    expect(first.capture.frames).toBeGreaterThan(20);
    expect(first.capture.nonzero).toBe(0);
    expect(first.state.speech.history).toEqual(['こんにちは。同じ声でお話しします。']);
    await input.getByRole('status').filter({ hasText: '文章を入力して読み上げ' }).waitFor();
    await input.getByRole('combobox', { name: '再生方式', exact: true }).selectOption('stream');
    await editor.fill('次の文章でも、同じ声で話します。');
    await page.waitForFunction(() => window.__studio.services.voice.state().speech.preparation?.state === 'generating');
    await editor.press('Control+Enter');
    await page.waitForFunction(() =>
      ['loading', 'priming', 'running'].includes(window.__studio.services.voice.state().state),
    );
    await editor.fill('まだ送らない下書き');
    await new Promise((r) => setTimeout(r, 700));
    await editor.fill('');
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'stopped', null, {
      timeout: 150000,
    });
    const second = await page.evaluate(() => window.__studio.services.voice.state());
    expect(second.error).toBe('');
    expect(second.metrics.prefetchHit).toBe(1);
    expect(second.speech.speakerKey).toBe(speaker);
    expect(second.speech.history).toEqual(['こんにちは。同じ声でお話しします。', '次の文章でも、同じ声で話します。']);
    await input.screenshot({ path: join(work, 'fixed-speaker-draft.png') });
    writeFileSync(join(work, 'native-draft.json'), JSON.stringify({ sendMs, speaker, ready, first, second }, null, 2));
    await page.evaluate(() => window.__studio.project.save());
    const saved = await page.evaluate(
      async (directory) => JSON.stringify((await window.__studio.services.io.load(directory)).project),
      join(work, 'model').replace(/\\/g, '/'),
    );
    expect(saved).not.toContain('まだ送らない下書き');
    expect(saved).not.toContain('同じ声でお話しします');
  });
  it('合成完了を待たずに送信し、実出力の開始時刻で応答時間を測る', async () => {
    const page = app.page;
    await page.evaluate(async () => {
      await window.__studio.services.voice.clearSpeechHistory();
    });
    await page.getByRole('combobox', { name: '再生方式', exact: true }).selectOption('stream');
    const editor = page.getByRole('textbox', { name: 'モデルが話す言葉', exact: true });
    const trials = [];
    for (const text of ['こんにちは。今日もよろしくね。', '明日は晴れるかな。楽しみだね。']) {
      const began = Date.now();
      await editor.fill(text);
      const before = await page.evaluate(() => window.__studio.services.voice.state().speech.preparation);
      expect(before?.state).not.toBe('ready');
      const sent = Date.now();
      await editor.press('Control+Enter');
      await page.waitForFunction(() => window.__studio.services.voice.state().state === 'running', null, {
        timeout: 15000,
      });
      await page.waitForFunction(() => window.__studio.services.voice.state().state === 'stopped', null, {
        timeout: 60000,
      });
      const state = await page.evaluate(() => window.__studio.services.voice.state());
      expect(state.error).toBe('');
      expect(state.metrics.cudaGraph).toBe(1);
      expect(state.metrics.predictorGraphReplays).toBeGreaterThan(0);
      expect(state.metrics.textEmbeddingOffloadMiB).toBe(593.5);
      expect(state.metrics.loadSeconds).toBe(0);
      expect(state.metrics.firstAudioMs).toBeGreaterThan(0);
      expect(state.metrics.firstAudioMs).toBeLessThan(6000);
      expect(state.metrics.rebuffers).toBe(0);
      const firstAudioWallMs = state.metrics.firstAudioWallMs;
      if (typeof firstAudioWallMs !== 'number') throw new Error('音声出力の開始時刻がありません');
      trials.push({ text, inputToSendMs: sent - began, inputToFirstAudioMs: firstAudioWallMs - began, state });
    }
    writeFileSync(join(work, 'native-latency.json'), JSON.stringify(trials, null, 2));
  });
  it('同じ文章を繰り返しても復号状態を発話ごとに分け、全文と逐次の両方を使える', async () => {
    const page = app.page;
    await page.evaluate(async () => window.__studio.services.voice.clearSpeechHistory());
    const editor = page.getByRole('textbox', { name: 'モデルが話す言葉', exact: true });
    const states = [];
    for (let i = 0; i < 5; i++) {
      await page.getByRole('combobox', { name: '再生方式', exact: true }).selectOption(i < 3 ? 'whole' : 'stream');
      await editor.fill('みんなのことがすきです');
      await editor.press('Control+Enter');
      await page.waitForFunction(() => window.__studio.services.voice.state().state === 'running', null, {
        timeout: 15000,
      });
      await page.waitForFunction(() => window.__studio.services.voice.state().state === 'stopped', null, {
        timeout: 60000,
      });
      const state = await page.evaluate(() => window.__studio.services.voice.state());
      expect(state.error).toBe('');
      expect(state.metrics.statefulDecoder).toBe(1);
      expect(state.speech.speakerKey).toBe(states[0]?.speech.speakerKey ?? state.speech.speakerKey);
      expect(state.speech.history).toEqual(Array.from({ length: i + 1 }, () => 'みんなのことがすきです'));
      states.push(state);
    }
    expect(states[4]?.metrics.frames).toBe(states[3]?.metrics.frames);
    writeFileSync(join(work, 'native-repeated-speech.json'), JSON.stringify(states, null, 2));
  });
  it('長めの発話を途中と語尾で待たずに再生し、別窓でも響きの指示を共有する', async () => {
    const page = app.page;
    await page.evaluate(async () => window.__studio.services.voice.clearSpeechHistory());
    await page.getByRole('combobox', { name: '再生方式', exact: true }).selectOption('stream');
    const input = app.browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('/speech-input'));
    if (!input) throw new Error('入力ウィンドウがありません');
    await input.getByRole('button', { name: '大切なことを伝える', exact: true }).click();
    await page.waitForFunction(() =>
      window.__studio.services.store.get().studio.voice?.speech?.scene.includes('芯と自然な響き'),
    );
    const editor = input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true });
    const text =
      '今日は、みんなに大切なことを伝えたいです。いつもそばにいてくれて、ありがとう。みんなのことがすきです。';
    await editor.fill(text);
    await editor.press('Control+Enter');
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'running', null, {
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'stopped', null, {
      timeout: 120000,
    });
    const state = await page.evaluate(() => window.__studio.services.voice.state());
    expect(state.error).toBe('');
    expect(state.metrics.rebuffers).toBe(0);
    expect(state.metrics.startupBufferMs).toBeGreaterThanOrEqual(1000);
    expect(state.metrics.statefulDecoder).toBe(1);
    expect(state.speech.history).toEqual([text]);
    await input.getByRole('button', { name: '話題を切り替える', exact: true }).click();
    await page.waitForFunction(() =>
      window.__studio.services.store.get().studio.voice?.speech?.scene.includes('短く自然な間'),
    );
    await input.screenshot({ path: join(work, 'resonant-delivery.png') });
    writeFileSync(join(work, 'native-continuity.json'), JSON.stringify(state, null, 2));
  });
});
