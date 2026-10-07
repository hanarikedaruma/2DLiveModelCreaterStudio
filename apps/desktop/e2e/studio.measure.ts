// 計測（カード25）: 基準モデルをスタジオで動かし、描画の fps・トラッキングの fps・遅延・メモリを記録する。
// `pnpm measure -- studio`。環境変数:
//   MEASURE_SECONDS  記録する秒数（既定 60。5分の記録は 300、連続動作は 7200 など）
//   MEASURE_GPU      low なら内蔵 GPU、high なら外付けの GPU を WebView2 に頼む（ハイブリッドの PC）
//   MEASURE_LABEL    結果のファイル名に付ける名前
//   MEASURE_OBS      1 なら1080pの緑背景の出力を開き、顔検出を待ってから記録する（OBS録画は別途開始）
// 結果は e2e/results/measure-<名前>-<日時>.json に書き、要約を表示する
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { answerDialog, appMemoryMb, launchApp, RESULTS, ROOT, sleep, slash, type RunningApp } from './app';

const SECONDS = Number(process.env.MEASURE_SECONDS ?? 60);
const GPU = process.env.MEASURE_GPU;
const OBS = process.env.MEASURE_OBS === '1';
const LABEL = process.env.MEASURE_LABEL ?? (GPU ? `gpu-${GPU}` : 'default');
const GPU_ARGS = GPU === 'low' ? ['--force_low_power_gpu'] : GPU === 'high' ? ['--force_high_performance_gpu'] : [];

let app: RunningApp | null = null;
let workDir = '';
let previousLastProjectDir: string | null = null;

afterAll(async () => {
  await app?.page.evaluate(() => window.__studio.services.tracking.stop()).catch(() => {});
  // 利用者の環境設定に、消してしまう計測用のフォルダを残さない
  await app?.page
    .evaluate(async (dir) => {
      window.__studio.environment.set({ lastProjectDir: dir });
      await window.__studio.environment.flush();
    }, previousLastProjectDir)
    .catch(() => {});
  await app?.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('計測', () => {
  it(
    `基準モデルをスタジオで ${SECONDS} 秒動かす（${LABEL}）`,
    async () => {
      // 基準モデルは自動保存でフォルダが書き換わらないように写してから開く
      workDir = mkdtempSync(join(tmpdir(), 'live2d-studio-measure-'));
      const dir = join(workDir, 'reference-model');
      cpSync(join(ROOT, 'fixtures', 'reference-model'), dir, { recursive: true });

      app = await launchApp(9340, GPU_ARGS);
      const page = app.page;
      while ((await answerDialog(page, 'キャンセル', 2000)) !== null) {
        // 前の作業の残りは復元しない
      }
      previousLastProjectDir = await page.evaluate(() => window.__studio.environment.get().lastProjectDir);
      await page.evaluate((d) => window.__studio.project.open(d), slash(dir));
      await page.evaluate(() => window.__studio.services.editor.set({ mode: 'studio' }));
      await page.getByRole('button', { name: '開始', exact: true }).waitFor({ state: 'visible' });

      if (OBS) {
        await page.evaluate(() => {
          const environment = window.__studio.environment;
          environment.set({ output: { ...environment.get().output, width: 1920, height: 1080 } });
        });
        await page.getByRole('button', { name: '緑', exact: true }).click();
        await page.getByRole('button', { name: '出力ウィンドウを開く', exact: true }).click();
        await page.getByRole('button', { name: '閉じる', exact: true }).waitFor({ state: 'visible' });
      }

      const cameras = await page.evaluate(() => window.__studio.services.tracking.listDevices());
      if (cameras.length > 0) {
        await page.getByRole('button', { name: '開始', exact: true }).click();
        await page.getByRole('button', { name: '停止', exact: true }).waitFor({ state: 'visible' });
      }
      if (OBS) {
        const detected = await page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => {
                off();
                resolve(false);
              }, 30_000);
              const off = window.__studio.services.tracking.onFrame((frame) => {
                if (!frame.detected) return;
                clearTimeout(timer);
                off();
                resolve(true);
              });
            }),
        );
        expect(detected, 'OBS同時計測には実カメラの顔検出が必要').toBe(true);
      }
      await sleep(2000); // 立ち上がりを落ち着かせる

      await page.evaluate(() => window.__studio.diagnostics.startRecording());
      // Rust側で実際に共有テクスチャへ送れた数。JSのsubmitの呼び出し数ではない。
      const spoutBefore = await page.evaluate(async () => {
        const sink = window.__studio.services.spout as typeof window.__studio.services.spout & {
          telemetry?(): Promise<{
            sentFrames: number;
            failures: number;
            recoveries: number;
            elapsedSeconds: number;
            adapterId: string;
          } | null>;
        };
        return (await sink.telemetry?.()) ?? null;
      });
      const memory: { atSeconds: number; mb: number }[] = [{ atSeconds: 0, mb: appMemoryMb() }];
      const started = Date.now();
      while (Date.now() - started < SECONDS * 1000) {
        await sleep(Math.min(10_000, SECONDS * 1000 - (Date.now() - started)));
        memory.push({ atSeconds: Math.round((Date.now() - started) / 1000), mb: appMemoryMb() });
      }
      const record = await page.evaluate(() => window.__studio.diagnostics.stopRecording());
      const spoutAfter = await page.evaluate(async () => {
        const sink = window.__studio.services.spout as typeof window.__studio.services.spout & {
          telemetry?(): Promise<{
            sentFrames: number;
            failures: number;
            recoveries: number;
            elapsedSeconds: number;
            adapterId: string;
          } | null>;
        };
        return (await sink.telemetry?.()) ?? null;
      });
      expect(record).not.toBeNull();

      const result = {
        label: LABEL,
        seconds: SECONDS,
        gpuRequest: GPU ?? null,
        outputWindow: OBS ? { width: 1920, height: 1080, background: 'green' } : null,
        tracking: cameras.length > 0 ? cameras.map((c) => c.label) : null,
        cameraCapture: record!.environment.cameraCapture ?? null,
        spout:
          spoutBefore && spoutAfter
            ? {
                before: spoutBefore,
                after: spoutAfter,
                frames: spoutAfter.sentFrames - spoutBefore.sentFrames,
                failures: spoutAfter.failures - spoutBefore.failures,
                recoveries: spoutAfter.recoveries - spoutBefore.recoveries,
                fps:
                  (spoutAfter.sentFrames - spoutBefore.sentFrames) /
                  Math.max(0.001, spoutAfter.elapsedSeconds - spoutBefore.elapsedSeconds),
              }
            : null,
        memory,
        summary: record!.summary,
        environment: record!.environment,
        record,
      };
      mkdirSync(RESULTS, { recursive: true });
      const file = join(RESULTS, `measure-${LABEL}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(file, JSON.stringify(result, null, 2));
      const s = record!.summary;
      console.log(
        `[計測 ${LABEL}] 描画 ${s.render.avg.toFixed(1)} fps（1%最低 ${s.render.low1.toFixed(1)}）` +
          ` / トラッキング ${s.trackingFps.toFixed(1)} fps / 遅延 p95 ${Number.isFinite(s.latency.p95) ? s.latency.p95.toFixed(0) : '—'} ms（${s.latency.samples} 件）` +
          ` / メモリ ${memory[0]!.mb}→${memory.at(-1)!.mb} MB / GPU ${String(record!.environment.gpu)}\n  → ${file}`,
      );
      expect(s.render.frames).toBeGreaterThan(0);
      if (OBS) expect(s.latency.samples, '顔ありの遅延サンプルが必要').toBeGreaterThan(0);
    },
    (SECONDS + 180) * 1000,
  );
});
