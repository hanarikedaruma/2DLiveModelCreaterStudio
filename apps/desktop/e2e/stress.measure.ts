// ストレステスト（カード25。合否には含めず結果だけを残す）: 4000×6000px・100レイヤーの PSD を取り込む時間とメモリ、
// すべてを自由パーツに割り当てる（メッシュの自動生成）時間、そのモデルをスタジオで描く fps。`pnpm measure -- stress`
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { answerDialog, appMemoryMb, launchApp, RESULTS, ROOT, sleep, slash, type RunningApp } from './app';

const PSD = join(ROOT, 'fixtures', 'stress', 'stress-4000x6000-100.psd');
const GPU = process.env.MEASURE_GPU;
const GPU_ARGS = GPU === 'low' ? ['--force_low_power_gpu'] : GPU === 'high' ? ['--force_high_performance_gpu'] : [];

const APP_DATA = join(process.env.APPDATA ?? '', 'jp.co.globalsystems.live2dstudio');

let app: RunningApp | null = null;
let projectId = '';

afterAll(async () => {
  await app?.close();
  // 取り込んだ大きなプロジェクトの自動保存を残さない
  if (projectId) rmSync(join(APP_DATA, 'unsaved', projectId), { recursive: true, force: true });
});

describe('ストレステスト', () => {
  it('4000×6000px・100レイヤーの PSD', async () => {
    if (!existsSync(PSD)) throw new Error(`PSD が無い: ${PSD}（pnpm --filter @app/fixtures generate:stress）`);
    app = await launchApp(9341, GPU_ARGS);
    const page = app.page;
    // 前回の記録と同じ描画領域で比べる。利用者の最後のウィンドウサイズでメモリが変わらないようにする。
    await page.setViewportSize({ width: 1920, height: 1009 });
    while ((await answerDialog(page, 'キャンセル', 2000)) !== null) {
      // 前の作業の残りは復元しない
    }
    // 自動保存は止めておく（大きな素材を unsaved/ に書かないように）
    await page.evaluate(() => window.__studio.services.autoSaver.stop());
    projectId = await page.evaluate(() => window.__studio.services.store.get().id);
    const memBefore = appMemoryMb();

    // 1. 取り込み（Playwright は 50MB を超えるファイルをファイルの入力に渡せないので、アプリの fs で読んでから
    //    セットアップ画面と同じ取り込みの関数に渡す。読む時間と取り込みの時間を分けて測る）
    const timing = await page.evaluate(async (path) => {
      const { services, modeling } = window.__studio;
      const t0 = performance.now();
      const data = await services.fs.readBinary(path);
      // 読み込みの完了のタスクを終える。IPC の復号など、取り込み前の処理を Long Task に混ぜない。
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const t1 = performance.now();
      const longTasks: PerformanceEntry[] = [];
      const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
      const observer = supported ? new PerformanceObserver((list) => longTasks.push(...list.getEntries())) : null;
      observer?.observe({ type: 'longtask' });
      let lastBeat = t1;
      let maxHeartbeatGapMs = 0;
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastBeat);
        lastBeat = now;
      }, 16);
      try {
        await modeling.importAssetFiles(services, [{ name: 'stress-4000x6000-100.psd', data }]);
        const t2 = performance.now();
        // 確定直後の素材一覧の描画も監視し、Observer の最後の通知を回収する。
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        longTasks.push(...(observer?.takeRecords() ?? []));
        return {
          readSeconds: (t1 - t0) / 1000,
          importSeconds: (t2 - t1) / 1000,
          bytes: data.length,
          mainThread: {
            maxLongTaskMs: supported ? Math.max(0, ...longTasks.map((task) => task.duration)) : null,
            maxHeartbeatGapMs,
            longTaskCount: supported ? longTasks.length : null,
          },
        };
      } finally {
        clearInterval(heartbeat);
        observer?.disconnect();
      }
    }, slash(PSD));
    expect(await page.evaluate(() => window.__studio.services.store.get().assets.length)).toBe(100);
    const importSeconds = timing.importSeconds;
    await page.evaluate(() => window.__studio.services.autoSaver.stop());
    const memAfterImport = appMemoryMb();

    // 2. すべてを自由パーツに割り当てる（メッシュを作る）
    const t = Date.now();
    await page.evaluate(() => {
      const { services, modeling } = window.__studio;
      for (const a of services.store.get().assets) {
        modeling.assignAssets(services, { kind: 'free', partId: null, name: a.source.layerName ?? a.id }, [a.id]);
      }
    });
    const assignSeconds = (Date.now() - t) / 1000;
    const model = await page.evaluate(() => {
      const m = window.__studio.services.store.get().model;
      return { parts: m.parts.length, vertices: m.meshes.reduce((n, x) => n + x.vertices.length, 0) };
    });
    const memAfterAssign = appMemoryMb();

    // 3. スタジオで描く fps（トラッキングなし、20秒）
    await page.evaluate(() => window.__studio.services.editor.set({ mode: 'studio' }));
    await sleep(2000);
    await page.evaluate(() => window.__studio.diagnostics.startRecording());
    await sleep(20_000);
    const record = await page.evaluate(() => window.__studio.diagnostics.stopRecording());
    const memAfterStudio = appMemoryMb();

    const result = {
      psd: { path: PSD, layers: 100, canvas: '4000x6000' },
      gpuRequest: GPU ?? null,
      readSeconds: timing.readSeconds,
      importSeconds,
      mainThread: timing.mainThread,
      assignSeconds,
      model,
      memoryMb: {
        before: memBefore,
        afterImport: memAfterImport,
        afterAssign: memAfterAssign,
        afterStudio: memAfterStudio,
      },
      studio: record?.summary,
      environment: record?.environment,
    };
    mkdirSync(RESULTS, { recursive: true });
    const file = join(
      RESULTS,
      `stress-${GPU ? `gpu-${GPU}-` : ''}${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(file, JSON.stringify(result, null, 2));
    console.log(
      `[ストレス] 読み込み ${timing.readSeconds.toFixed(1)} 秒 / 取り込み ${importSeconds.toFixed(1)} 秒 / 割り当て（メッシュ）${assignSeconds.toFixed(1)} 秒（パーツ ${model.parts}・頂点 ${model.vertices}）` +
        ` / 最長のメインスレッド処理 ${timing.mainThread.maxLongTaskMs ?? '未対応'} ms（心拍の最大間隔 ${timing.mainThread.maxHeartbeatGapMs.toFixed(1)} ms）` +
        ` / メモリ ${memBefore}→${memAfterImport}→${memAfterAssign}→${memAfterStudio} MB` +
        ` / スタジオ ${record?.summary.render.avg.toFixed(1)} fps（1%最低 ${record?.summary.render.low1.toFixed(1)}） / GPU ${String(record?.environment.gpu)}\n  → ${file}`,
    );
    expect(model.parts).toBe(100);
  }, 900_000);
});
