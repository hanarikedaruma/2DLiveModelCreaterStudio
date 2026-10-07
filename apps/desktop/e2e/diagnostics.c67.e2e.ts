// カード67（計測の表示に層ごとの値）のテスト。テストの担当は CL（実装の担当は CO）
// 本物のアプリで計測の表示（Ctrl+Shift+D）を開き、カメラ停止中の目の値が「自動」の層から来ていると表と JSON で読む
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { answerDialog, launchApp, sleep, type RunningApp } from './app';

let app: RunningApp | null = null;
let page: Page;
let previousAutoBlink = true;

// 表の見出し（パラメータ・最後の値・9つの層）
const HEADERS = [
  'パラメータ',
  '最後の値',
  'カメラ',
  '自動',
  '体の追従',
  '表情',
  'ホットキー',
  'アニメーション',
  '音声',
  '周期',
  '物理',
];
const OTHER_LAYERS = ['カメラ', '体の追従', '表情', 'ホットキー', 'アニメーション', '音声', '周期', '物理'];

beforeAll(async () => {
  app = await launchApp(9342);
  page = app.page;
  while ((await answerDialog(page, 'キャンセル', 2000)) !== null) {
    // 利用者の前回の自動保存は復元しない
  }
  previousAutoBlink = await page.evaluate(() => window.__studio.environment.get().autoBlink);
}, 180_000);

afterAll(async () => {
  if (page)
    await page
      .evaluate(async (autoBlink) => {
        const { diagnostics, environment } = window.__studio;
        if (diagnostics.collector.isRecording()) diagnostics.stopRecording();
        if (diagnostics.isVisible()) diagnostics.toggle();
        environment.set({ autoBlink });
        await environment.flush();
      }, previousAutoBlink)
      .catch(() => {});
  await app?.close();
});

// 表の目の行を、見出しの列の位置で読む（1回の evaluate の中で読むので、途中で表示が更新されない）
async function readEyes() {
  return page.evaluate(() => {
    const table = document.querySelector('.diagnostics table');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
    const rows: Record<string, Record<string, string>> = {};
    for (const id of ['EyeOpenL', 'EyeOpenR']) {
      const row = table.querySelector(`tbody tr[data-parameter-id="${id}"]`);
      if (!row) continue;
      const cells = [...row.children].map((cell) => cell.textContent ?? '');
      rows[id] = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']));
      rows[id]!.autoByData = row.querySelector('[data-layer-id="auto"]')?.textContent ?? '';
      rows[id]!.trackingByData = row.querySelector('[data-layer-id="tracking"]')?.textContent ?? '';
      rows[id]!.finalByData = row.querySelector('[data-final]')?.textContent ?? '';
    }
    return { headers, rows };
  });
}

describe('カード67: 計測の表示の層ごとの値（本物のアプリ）', () => {
  it('カメラ停止中は、目の値が「自動」の列から来て最後の値と同じで、記録の JSON にも自動の層の値が入る', async () => {
    const status = await page.evaluate(async () => {
      const { services, environment, studio } = window.__studio;
      services.autoSaver.stop();
      studio.runtime.stopTracking();
      await services.tracking.stop();
      services.editor.set({ mode: 'studio' });
      environment.set({ autoBlink: true });
      await environment.flush();
      return studio.runtime.getState().status;
    });
    expect(status).toBe('stopped');
    await page.locator('.app-title').click();

    await page.keyboard.press('Control+Shift+D');
    const overlay = page.getByRole('status', { name: '計測' });
    await overlay.waitFor({ state: 'visible' });
    await overlay.getByRole('table', { name: /層ごとの値/ }).waitFor({ state: 'visible' });
    await expect
      .poll(async () => (await readEyes())?.rows.EyeOpenL?.['最後の値'], { timeout: 5000 })
      .toMatch(/^\d\.\d{3}$/);

    // 6秒のあいだ 100ms ごとに読む（表は 500ms ごとに変わる。まばたきで閉じかけた値が入ることもある）
    const reads: NonNullable<Awaited<ReturnType<typeof readEyes>>>[] = [];
    const frames: { tracking: boolean; autoEyes: boolean }[] = [];
    for (let i = 0; i < 60; i++) {
      const read = await readEyes();
      expect(read).not.toBeNull();
      reads.push(read!);
      frames.push(
        await page.evaluate(() => {
          const frame = window.__studio.studio.runtime.lastFrame()!;
          return {
            tracking: frame.layers.some((layer) => layer.id === 'tracking'),
            autoEyes: frame.layers.some(
              (layer) => layer.id === 'auto' && 'EyeOpenL' in layer.values && 'EyeOpenR' in layer.values,
            ),
          };
        }),
      );
      await sleep(100);
    }
    expect(reads[0]!.headers).toEqual(HEADERS);
    const autoValues = new Set<string>();
    for (const read of reads) {
      for (const id of ['EyeOpenL', 'EyeOpenR']) {
        const row = read.rows[id]!;
        expect(row['パラメータ']).toBe(id);
        const auto = /^(\d\.\d{3}) \/ 重み 1\.000・上書き$/.exec(row['自動']!);
        expect(auto, `${id} の自動の列: ${row['自動']}`).not.toBeNull();
        const value = Number(auto![1]);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        autoValues.add(auto![1]!);
        // 目の値は自動の層だけから来ている: 最後の値が自動の値と同じで、カメラほかの列は —
        expect(row['最後の値']).toBe(auto![1]);
        for (const header of OTHER_LAYERS) expect([id, header, row[header]]).toEqual([id, header, '—']);
        // 見出しの列と、データの印（data-layer-id・data-final）が同じ所を指す
        expect(row.autoByData).toBe(row['自動']);
        expect(row.trackingByData).toBe('—');
        expect(row.finalByData).toBe(row['最後の値']);
      }
    }
    expect(autoValues.size).toBeGreaterThanOrEqual(1);
    expect(frames.every((frame) => !frame.tracking && frame.autoEyes)).toBe(true);

    // 記録の JSON: 500ms ごとに間引いた層の値に、自動の層の目の値と最後の値が入る
    await page.getByRole('button', { name: '記録を始める' }).click();
    await sleep(3000);
    await page.getByRole('button', { name: '記録を止める' }).click();
    const record = await page.evaluate(() => window.__studio.diagnostics.lastRecord());
    expect(record?.kind).toBe('live2d-studio-diagnostics');
    expect(record!.version).toBe(1);
    const samples = record!.samples.layers;
    expect(samples.length).toBeGreaterThanOrEqual(4);
    expect(samples.length).toBeLessThanOrEqual(8);
    expect(record!.samples.renderTimes.length).toBeGreaterThan(samples.length * 5);
    for (const [i, sample] of samples.entries()) {
      if (i > 0) expect(sample.atMs - samples[i - 1]!.atMs).toBeGreaterThanOrEqual(500);
      expect(sample.parameterIds).toEqual(expect.arrayContaining(['EyeOpenL', 'EyeOpenR']));
      expect(sample.layers.some((layer) => layer.id === 'tracking')).toBe(false);
      const eyeLayers = sample.layers.filter((layer) => 'EyeOpenL' in layer.values || 'EyeOpenR' in layer.values);
      expect(eyeLayers.map((layer) => layer.id)).toEqual(['auto']);
      expect(eyeLayers[0]!.weight).toBe(1);
      for (const id of ['EyeOpenL', 'EyeOpenR']) {
        expect(sample.final[id]).toBeCloseTo(eyeLayers[0]!.values[id]!, 6);
      }
    }

    // 自動まばたきを切ると、自動の列も — になり、目の最後の値はデフォルト値（1）
    await page.evaluate(async () => {
      window.__studio.environment.set({ autoBlink: false });
      await window.__studio.environment.flush();
    });
    await expect.poll(async () => (await readEyes())?.rows.EyeOpenL?.['自動'], { timeout: 5000 }).toBe('—');
    const off = (await readEyes())!.rows;
    for (const id of ['EyeOpenL', 'EyeOpenR']) {
      expect(off[id]!['最後の値']).toBe('1.000');
      expect(off[id]!['カメラ']).toBe('—');
    }
    await page.evaluate(async () => {
      window.__studio.environment.set({ autoBlink: true });
      await window.__studio.environment.flush();
    });
    await expect
      .poll(async () => (await readEyes())?.rows.EyeOpenL?.['自動'], { timeout: 5000 })
      .toMatch(/^\d\.\d{3} \/ 重み 1\.000・上書き$/);

    await page.keyboard.press('Control+Shift+D');
    await overlay.waitFor({ state: 'detached' });
  });
});
