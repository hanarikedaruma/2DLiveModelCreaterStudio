import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { createDefaultVoiceSettings } from '@app/schema';
import { launchApp, ROOT, waitForStartup, type RunningApp } from './app';

let app: RunningApp;
let input: Page;
let speaker = '';
const work = join(ROOT, '.cache/speech-emotion-e2e');
const text = 'あなたのことが大好きです';
beforeAll(async () => {
  mkdirSync(work, { recursive: true });
  cpSync(join(ROOT, 'fixtures/reference-model'), join(work, 'model'), { recursive: true });
  app = await launchApp(9350);
  await waitForStartup(app.page);
  await app.page.evaluate(
    async (folder) => {
      const { services, project } = window.__studio;
      services.autoSaver.stop();
      await project.open(folder);
      services.autoSaver.stop();
      services.editor.set({ mode: 'studio' });
    },
    join(work, 'model').replace(/\\/g, '/'),
  );
  const output = await app.page.evaluate(async (fallback) => {
    const { services } = window.__studio;
    const inspection = await services.voice.inspectSpeech(services.store.get().studio.voice?.profile ?? fallback);
    return inspection.outputs.find((device) => /Sound Blaster/i.test(device.label)) ?? inspection.outputs[0];
  }, createDefaultVoiceSettings().profile);
  if (!output) throw new Error('音声出力先がありません');
  await app.page.getByRole('combobox', { name: '読み上げの出力先', exact: true }).selectOption(output.id);
  await app.page.getByRole('checkbox', { name: '読み上げをミュート', exact: true }).check();
  await app.page.getByRole('combobox', { name: '再生方式', exact: true }).selectOption('stream');
  await app.page.getByRole('button', { name: '別ウィンドウで入力', exact: true }).click();
  for (let i = 0; i < 150; i++) {
    const found = app.browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url().includes('/speech-input'));
    if (found) {
      input = found;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!input) throw new Error('別入力ウィンドウがありません');
  await input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).waitFor();
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

describe('左の感情ボタンと恥ずかしい読み方', () => {
  it('両画面で縦並びの感情を共有し、先行合成を感情変更で無効にする', async () => {
    const page = app.page;
    await input.getByRole('button', { name: '恥ずかしい', exact: true }).click();
    await page.waitForFunction(() => window.__studio.services.store.get().studio.voice?.speech?.style === 'shy');
    expect(await page.getByRole('button', { name: '恥ずかしい', pressed: true }).count()).toBe(1);
    for (const surface of [page, input]) {
      const layout = await surface.locator('.speech-composer').evaluate((composer) => {
        const buttons = [...composer.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
        const editor = composer.querySelector('textarea')!.getBoundingClientRect();
        return {
          left: buttons.every((button) => button.right < editor.left),
          vertical: buttons.every((button, i) => i === 0 || button.top >= buttons[i - 1]!.bottom),
          count: buttons.length,
        };
      });
      expect(layout).toEqual({ left: true, vertical: true, count: 7 });
    }
    const editor = input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true });
    await editor.fill(text);
    await page.waitForFunction(
      () => window.__studio.services.voice.state().speech.preparation?.state === 'ready',
      null,
      { timeout: 150000 },
    );
    const first = await page.evaluate(() => window.__studio.services.voice.state());
    speaker = first.speech.speakerKey ?? '';
    expect(first.state).toBe('stopped');
    for (const [label, style] of [
      ['うれしい', 'cheerful'],
      ['恥ずかしい', 'shy'],
    ] as const) {
      const revision = await page.evaluate(
        () => window.__studio.services.voice.state().speech.preparation?.revision ?? -1,
      );
      await input.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(
        (expected) => window.__studio.services.store.get().studio.voice?.speech?.style === expected,
        style,
      );
      await page.waitForFunction(
        (prior) => {
          const preparation = window.__studio.services.voice.state().speech.preparation;
          return !!preparation && preparation.revision > prior && preparation.state === 'ready';
        },
        revision,
        { timeout: 60000 },
      );
    }
    await input.getByRole('button', { name: '読み上げ', exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__studio.services.voice.state().state === 'stopped' &&
        window.__studio.services.voice.state().speech.history.length === 1,
      null,
      { timeout: 30000 },
    );
    const result = await page.evaluate(() => window.__studio.services.voice.state());
    expect(result.error).toBe('');
    expect(result.metrics.prefetchHit).toBe(1);
    expect(result.metrics.hesitations).toBe(2);
    expect(result.metrics.breathyOnset).toBe(1);
    expect(result.metrics.shyDelivery).toBe(1);
    expect(result.metrics.shyTempoRatio).toBe(0.88);
    expect(result.metrics.shyTailBreaths).toBeGreaterThanOrEqual(1);
    expect(result.metrics.breathyWordOnset).toBe(1);
    expect(result.metrics.shyIntroGapMs).toBeGreaterThanOrEqual(650);
    expect(result.speech.speakerKey).toBe(speaker);
    expect(result.speech.history).toEqual([text]);
    writeFileSync(join(work, 'prefetch.json'), JSON.stringify(result, null, 2));
  });

  it('恥ずかしいを選んで即送信し、固定した声で口ごもり付きの逐次再生を行う', async () => {
    const page = app.page;
    await page.evaluate(async () => window.__studio.services.voice.clearSpeechHistory());
    const editor = input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true });
    const began = Date.now();
    await editor.fill(text);
    expect((await page.evaluate(() => window.__studio.services.voice.state().speech.preparation))?.state).not.toBe(
      'ready',
    );
    await input.getByRole('button', { name: '読み上げ', exact: true }).click();
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'running', null, {
      timeout: 30000,
    });
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'stopped', null, {
      timeout: 60000,
    });
    const result = await page.evaluate(() => window.__studio.services.voice.state());
    expect(result.error).toBe('');
    expect(result.metrics.hesitations).toBe(2);
    expect(result.metrics.breathyOnset).toBe(1);
    expect(result.metrics.performanceMs).toBeLessThan(10);
    expect(result.metrics.breathyWordOnset).toBe(1);
    expect(result.metrics.shyTailBreaths).toBeGreaterThanOrEqual(1);
    expect(result.metrics.rebuffers).toBe(0);
    expect(result.metrics.statefulDecoder).toBe(1);
    expect(result.speech.speakerKey).toBe(speaker);
    expect(result.speech.history).toEqual([text]);
    writeFileSync(join(work, 'stream-shy.json'), JSON.stringify({ inputAt: began, result }, null, 2));
  });

  it('うれしいへ戻すと自動の言い直しを加えず、感情だけを保存する', async () => {
    const page = app.page;
    await input.getByRole('button', { name: 'うれしい', exact: true }).click();
    await page.waitForFunction(() => window.__studio.services.store.get().studio.voice?.speech?.style === 'cheerful');
    const editor = input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true });
    await editor.fill(text);
    await input.getByRole('button', { name: '読み上げ', exact: true }).click();
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'running', null, {
      timeout: 30000,
    });
    await page.waitForFunction(() => window.__studio.services.voice.state().state === 'stopped', null, {
      timeout: 60000,
    });
    const result = await page.evaluate(() => window.__studio.services.voice.state());
    expect(result.error).toBe('');
    expect(result.metrics.hesitations).toBe(0);
    expect(result.metrics.breathyOnset).toBe(0);
    expect(result.metrics.shyDelivery).toBe(0);
    expect(result.speech.speakerKey).toBe(speaker);
    await page.evaluate(() => window.__studio.project.save());
    const saved = await page.evaluate(
      async (folder) => (await window.__studio.services.io.load(folder)).project,
      join(work, 'model').replace(/\\/g, '/'),
    );
    expect(saved.studio.voice?.speech?.style).toBe('cheerful');
    expect(JSON.stringify(saved)).not.toContain(text);
    await input.getByRole('button', { name: '恥ずかしい', exact: true }).click();
    await page.waitForFunction(() => window.__studio.services.store.get().studio.voice?.speech?.style === 'shy');
    await input.screenshot({ path: join(work, 'emotion-input.png') });
    await page.getByRole('button', { name: '恥ずかしい', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(work, 'emotion-main.png') });
    expect(await input.locator('main').evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(
      false,
    );
    writeFileSync(join(work, 'stream-cheerful.json'), JSON.stringify(result, null, 2));
  });

  it('全文生成後でも同じ冒頭の息処理と原文の履歴を使う', async () => {
    const page = app.page;
    await page.evaluate(async () => window.__studio.services.voice.clearSpeechHistory());
    await page.getByRole('combobox', { name: '再生方式', exact: true }).selectOption('whole');
    await input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).fill(text);
    await page.waitForFunction(
      () => window.__studio.services.voice.state().speech.preparation?.state === 'ready',
      null,
      { timeout: 60000 },
    );
    await input.getByRole('button', { name: '読み上げ', exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__studio.services.voice.state().state === 'stopped' &&
        window.__studio.services.voice.state().speech.history.length === 1,
      null,
      { timeout: 30000 },
    );
    const result = await page.evaluate(() => window.__studio.services.voice.state());
    expect(result.error).toBe('');
    expect(result.speech.delivery).toBe('whole');
    expect(result.metrics.breathyOnset).toBe(1);
    expect(result.metrics.shyDelivery).toBe(1);
    expect(result.metrics.shyTailBreaths).toBeGreaterThanOrEqual(1);
    expect(result.metrics.breathyWordOnset).toBe(1);
    expect(result.metrics.shyIntroGapMs).toBeGreaterThanOrEqual(650);
    expect(result.metrics.prefetchHit).toBe(1);
    expect(result.speech.history).toEqual([text]);
    expect(result.speech.speakerKey).toBe(speaker);
    writeFileSync(join(work, 'whole-shy.json'), JSON.stringify(result, null, 2));
  });

  it.each([
    ['i', 'い、行きます。', 'stream'],
    ['u', 'う、うん。', 'whole'],
    ['e', 'え、ええんですか。', 'stream'],
    ['o', 'お、おっきい。', 'whole'],
  ] as const)('%sの言い出しを息に近づけ、本文と固定話者を保つ', async (vowel, source, delivery) => {
    const page = app.page;
    await page.evaluate(async () => window.__studio.services.voice.clearSpeechHistory());
    await page.getByRole('combobox', { name: '再生方式', exact: true }).selectOption(delivery);
    await input.getByRole('textbox', { name: 'モデルが話す言葉', exact: true }).fill(source);
    await input.getByRole('button', { name: '読み上げ', exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__studio.services.voice.state().state === 'stopped' &&
        window.__studio.services.voice.state().speech.history.length === 1,
      null,
      { timeout: 60000 },
    );
    const result = await page.evaluate(() => window.__studio.services.voice.state());
    expect(result.error).toBe('');
    expect(result.speech.delivery).toBe(delivery);
    expect(result.metrics.breathyOnsetEligible).toBe(1);
    expect(result.metrics.breathyOnset).toBe(1);
    expect(result.metrics.breathyWordOnset).toBe(1);
    expect(result.metrics.shyIntroGapMs).toBeGreaterThanOrEqual(650);
    expect(result.metrics.shyTempoRatio).toBe(0.88);
    expect(result.metrics.shyTailBreaths).toBeGreaterThanOrEqual(1);
    expect(result.metrics.hesitations).toBe(0);
    expect(result.metrics.breathyOnsetContextMs).toBeLessThanOrEqual(1280);
    expect(result.speech.history).toEqual([source]);
    expect(result.speech.speakerKey).toBe(speaker);
    writeFileSync(join(work, `vowel-${vowel}.json`), JSON.stringify(result, null, 2));
  });
});
