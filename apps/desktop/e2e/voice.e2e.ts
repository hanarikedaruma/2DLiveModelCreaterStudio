import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultVoiceSettings, type Environment } from '@app/schema';
import { launchApp, waitForStartup, ROOT, type RunningApp } from './app';

let app: RunningApp | null = null;
let previous: Environment | null = null;
const work = join(ROOT, '.cache', 'voice-e2e');
const errors: string[] = [];
beforeAll(async () => {
  mkdirSync(work, { recursive: true });
  cpSync(join(ROOT, 'fixtures', 'reference-model'), join(work, 'model'), { recursive: true });
  app = await launchApp();
  await waitForStartup(app.page);
  app.page.on('pageerror', (e) => errors.push(e.message));
  previous = await app.page.evaluate(() => window.__studio.environment.get());
  await app.page.evaluate(
    async (dir) => {
      window.__studio.services.autoSaver.stop();
      await window.__studio.project.open(dir);
      window.__studio.services.editor.set({ mode: 'studio' });
    },
    join(work, 'model').replace(/\\/g, '/'),
  );
});
afterAll(async () => {
  if (app) {
    await app.page
      .evaluate(async (previous) => {
        await window.__studio.services.voice.stop();
        window.__studio.services.autoSaver.stop();
        if (previous) window.__studio.environment.set(previous);
        await window.__studio.environment.flush();
      }, previous)
      .catch(() => {});
    await app.close();
  }
});
describe('AI音声のTauri結合', () => {
  it('GPU・機器を確認し、声質・フィルタ・口の設定を保存する', async () => {
    const page = app!.page;
    const inspect = await page.evaluate(() => window.__studio.services.voice.inspect());
    expect(inspect.ready).toBe(true);
    expect(inspect.filters).toHaveLength(5);
    await page.getByRole('tab', { name: '声の調整', exact: true }).click();
    await page.getByRole('slider', { name: '声の明るさ', exact: true }).fill('1.5');
    await page.getByRole('tab', { name: 'フィルタ', exact: true }).click();
    await page.getByRole('button', { name: 'フィルタを追加', exact: true }).click();
    await page.getByRole('tab', { name: '口の動き', exact: true }).click();
    await page.getByRole('slider', { name: '口の同期微調整', exact: true }).fill('100');
    await page.evaluate(() => window.__studio.project.save());
    const current = await page.evaluate(() => window.__studio.services.store.get());
    expect(current.studio.voice?.profile.voiceTone.brightnessDb).toBe(1.5);
    expect(current.studio.voice?.profile.outputFilters.items).toHaveLength(4);
    expect(current.studio.voice?.syncOffsetMs).toBe(100);
    const loaded = await page.evaluate(
      async (dir) => (await window.__studio.services.io.load(dir)).project,
      join(work, 'model').replace(/\\/g, '/'),
    );
    expect(loaded.studio.voice).toEqual(current.studio.voice);
    const transfer = await page.evaluate(
      async (directory) => {
        const voice = window.__studio.services.voice;
        const profile = window.__studio.services.store.get().studio.voice!.profile;
        const path = `${directory}/voice-${Date.now()}.json`;
        const preview = await voice.previewReference(profile.reference);
        await voice.exportProfile(path, profile);
        return { preview, imported: await voice.importProfile(path) };
      },
      work.replace(/\\/g, '/'),
    );
    expect(transfer.preview.startsWith('UklGR')).toBe(true);
    expect(transfer.imported.voiceTone).toEqual(current.studio.voice!.profile.voiceTone);
    expect(transfer.imported.outputFilters).toEqual(current.studio.voice!.profile.outputFilters);
    await page.screenshot({ path: join(work, 'voice-mouth.png') });
    await page.getByRole('tab', { name: 'フィルタ', exact: true }).click();
    await page.screenshot({ path: join(work, 'voice-filters.png') });
    await page.setViewportSize({ width: 960, height: 600 });
    await page.getByRole('tab', { name: '声の調整', exact: true }).click();
    await page.getByRole('slider', { name: '声の柔らかさ', exact: true }).scrollIntoViewIfNeeded();
    const size = await page
      .locator('[data-section-id="studio.voice"] .voice-section')
      .evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
    await page.screenshot({ path: join(work, 'voice-960.png') });
    expect(errors).toEqual([]);
  });
  it.skipIf(process.env.VOICE_E2E_SKIP_DEVICES === '1')(
    '実デバイスへMute出力し、時刻付きPCM・停止・再開を確認する',
    async () => {
      const page = app!.page;
      const result = await page.evaluate(async () => {
        const { services, environment } = window.__studio;
        const v = services.voice;
        const info = await v.inspect();
        const input = info.inputs.find((d) => /Razer Seiren/i.test(d.label)) ?? info.inputs[0];
        const output = info.outputs.find((d) => /Sound Blaster|スピーカー|Headphone/i.test(d.label)) ?? info.outputs[0];
        if (!input || !output) throw new Error('実機の音声入出力がありません');
        await v.controls({ mute: true });
        let frames = 0;
        let nonzero = 0;
        let largestAge = 0;
        const off = v.onPlayback((frame) => {
          frames++;
          nonzero += frame.samples.filter((x) => x !== 0).length;
          largestAge = Math.max(largestAge, performance.now() - frame.time);
        });
        const profile = services.store.get().studio.voice!.profile;
        const devices = { inputDeviceId: input.id, outputDeviceId: output.id, inputGainDb: 0, silenceThreshold: -50 };
        environment.set({ voice: devices });
        await v.start(profile, devices);
        const deadline = performance.now() + 60000;
        while (v.state().state !== 'running') {
          if (v.state().state === 'error') throw new Error(v.state().error);
          if (performance.now() > deadline) throw new Error('モデル開始の時間切れ');
          await new Promise((r) => setTimeout(r, 50));
        }
        await new Promise((r) => setTimeout(r, 5000));
        const first = { ...v.state().metrics };
        await v.stop();
        const stopped = v.state().state;
        await v.start(profile, devices);
        while (v.state().state !== 'running') {
          if (v.state().state === 'error') throw new Error(v.state().error);
          if (performance.now() > deadline + 60000) throw new Error('再開の時間切れ');
          await new Promise((r) => setTimeout(r, 50));
        }
        await new Promise((r) => setTimeout(r, 1000));
        await v.stop();
        off();
        return { frames, nonzero, largestAge, first, stopped, final: v.state().state };
      });
      writeFileSync(join(work, 'native-audio.json'), JSON.stringify(result, null, 2));
      expect(result.frames).toBeGreaterThan(100);
      expect(result.nonzero).toBe(0);
      expect(result.first.underruns).toBe(0);
      expect(result.first.overflows).toBe(0);
      expect(result.stopped).toBe('stopped');
      expect(result.final).toBe('stopped');
      expect(errors).toEqual([]);
    },
  );
  it.skipIf(process.env.VOICE_E2E_SKIP_DEVICES === '1')('大型AIのMuteライブとTinyのWAV比較を確認する', async () => {
    const page = app!.page;
    const output = join(work, `converted-${Date.now()}.wav`);
    const result = await page.evaluate(
      async ({ source, output }) => {
        const { services, environment } = window.__studio;
        const voice = services.voice;
        const profile = services.store.get().studio.voice!.profile;
        const devices = environment.get().voice!;
        await voice.controls({ mute: true });
        let frames = 0;
        let nonzero = 0;
        const off = voice.onPlayback((frame) => {
          frames++;
          nonzero += frame.samples.filter((sample) => sample !== 0).length;
        });
        await voice.start({ ...profile, backend: 'seed-whisper-large', quality: 'hq', advanced: undefined }, devices);
        const deadline = performance.now() + 120000;
        while (voice.state().state !== 'running') {
          if (voice.state().state === 'error') throw new Error(voice.state().error);
          if (performance.now() > deadline) throw new Error('大型AI開始の時間切れ');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const metrics = { ...voice.state().metrics };
        await voice.stop();
        off();
        await voice.convert(source, output, profile);
        while (voice.state().converting) {
          if (performance.now() > deadline + 120000) throw new Error('WAV変換の時間切れ');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (voice.state().error) throw new Error(voice.state().error);
        return { frames, nonzero, metrics, converted: voice.state().conversionOutput };
      },
      {
        source: join(ROOT, 'tools', 'voice-engine', 'voices', 'original-soft-girl.wav').replace(/\\/g, '/'),
        output: output.replace(/\\/g, '/'),
      },
    );
    writeFileSync(join(work, 'large-and-wav.json'), JSON.stringify(result, null, 2));
    expect(result.frames).toBeGreaterThan(100);
    expect(result.nonzero).toBe(0);
    expect(result.metrics.underruns).toBe(0);
    expect(result.metrics.overflows).toBe(0);
    expect(result.converted?.replace(/\\/g, '/')).toBe(output.replace(/\\/g, '/'));
    expect(readFileSync(output).length).toBeGreaterThan(44);
    expect(errors).toEqual([]);
  });
  it.skipIf(process.env.VOICE_E2E_SKIP_DEVICES === '1')(
    'WAV比較を準備中に中断し、出力と一時ファイルを残さない',
    async () => {
      const output = join(work, `cancelled-${Date.now()}.wav`);
      const before = new Set(readdirSync(work).filter((name) => name.startsWith('.voice-')));
      const result = await app!.page.evaluate(
        async ({ source, output, profile }) => {
          const voice = window.__studio.services.voice;
          await voice.convert(source, output, profile);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await voice.stop();
          return { state: voice.state().state, converting: voice.state().converting };
        },
        {
          source: join(ROOT, 'tools', 'voice-engine', 'voices', 'original-soft-girl.wav').replace(/\\/g, '/'),
          output: output.replace(/\\/g, '/'),
          profile: createDefaultVoiceSettings().profile,
        },
      );
      expect(result).toEqual({ state: 'stopped', converting: false });
      expect(existsSync(output)).toBe(false);
      expect(readdirSync(work).filter((name) => name.startsWith('.voice-') && !before.has(name))).toEqual([]);
      expect(errors).toEqual([]);
    },
  );
});
