// STEP1 の結合（カード44）: 本物のアプリの中で、STEP1 のサービスが本物に差し替わり、Tauri の上で動くこと。
// - 自動まばたき・体の追従・表情・リップシンク・キャリブレーションが、仮実装ではなく本物の動きをする
// - グローバルホットキーを OS に登録でき（capabilities の権限）、キーを押すと届く
// - Spout2 の送り手を始めると、ほかのプロセスから送り手の名前が見え、フレームを送っても失敗しない
// - マイクがあれば、本番の CSP の下で AudioWorklet が動き、音量が 10ms ごとに届く
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Environment } from '@app/schema';
import { answerDialog, launchApp, ROOT, sleep, slash, type RunningApp } from './app';

const APP_DATA = join(process.env.APPDATA ?? '', 'jp.co.globalsystems.live2dstudio');

let app: RunningApp | null = null;
let workDir = '';
let projectId = '';
let previous: Pick<Environment, 'lastProjectDir' | 'output'> | null = null;
const warnings: string[] = [];

function powershell(script: string): string {
  const out = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return `${out.stdout}${out.stderr}`.trim();
}

// PC がロックされているか（前面がロック画面・サインイン画面）。ロック中はキーの入力がアプリに届かない
function workstationLocked(): boolean {
  const name = powershell(
    [
      'Add-Type @"',
      'using System; using System.Runtime.InteropServices;',
      'public class Foreground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
      '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }',
      '"@',
      '$id = 0; [void][Foreground]::GetWindowThreadProcessId([Foreground]::GetForegroundWindow(), [ref]$id)',
      '(Get-Process -Id $id -ErrorAction SilentlyContinue).ProcessName',
    ].join('\n'), // here-string の @" と "@ は行の頭に置く
  );
  // ロックしてしばらくたち画面が消えると、前面のウィンドウが無くなる（pid 0 の Idle）
  return /^(LockApp|LogonUI|Idle)$/m.test(name) || name === '';
}

beforeAll(async () => {
  app = await launchApp(9338);
  while ((await answerDialog(app.page, 'キャンセル', 2000)) !== null) {
    // 前の作業の残りは復元しない
  }
  app.page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text());
  });
  // 起動時の新しいプロジェクトの自動保存を残さない（次に起動したときに復元を聞かれないように）
  await app.page.evaluate(() => window.__studio.services.autoSaver.stop());
  projectId = await app.page.evaluate(() => window.__studio.services.store.get().id);
  previous = await app.page.evaluate(() => {
    const env = window.__studio.environment.get();
    return { lastProjectDir: env.lastProjectDir, output: env.output };
  });
}, 180_000);

afterAll(async () => {
  const page = app?.page;
  if (page) {
    await page
      .evaluate(async (prev) => {
        const s = window.__studio.services;
        s.audio.stop();
        await s.hotkeys.unregisterAll();
        // 利用者の環境設定を元に戻す（消してしまう作業用のフォルダや Spout2 の選択を残さない）
        if (prev) window.__studio.environment.set(prev);
        await window.__studio.environment.flush();
      }, previous)
      .catch(() => {});
    await sleep(500);
  }
  await app?.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  if (projectId) rmSync(join(APP_DATA, 'unsaved', projectId), { recursive: true, force: true });
});

describe('STEP1 の結合', () => {
  it('自動まばたき・体の追従・表情・リップシンク・キャリブレーションが本物の動きをする', async () => {
    const result = await app!.page.evaluate(() => {
      const s = window.__studio.services;
      const project = s.store.get();
      // produce は配列も返せる（カード45）。ここで確かめる producer は1つだけ返す
      type One = { weight: number; values: Record<string, number> } | null;
      const one = (layer: unknown) => layer as One;
      const ctx = (now: number, mixedSoFar: Record<string, number> = {}) => ({
        now,
        dt: 16,
        project: s.store.get(),
        mixedSoFar,
        flags: { lipSyncWeight: 1, physicsActive: true },
      });

      // 体の追従: 標準の率 0.3（仮実装は何も出さない）。STEP1 の標準パラメータは起動時に足されている
      const body = one(s.bodyFollow.produce(ctx(0, { FaceAngleX: 20, FaceAngleZ: -10 })));

      // 自動まばたき: 閉じる・開く途中の値がある（仮実装は 0 か 1 だけ）
      let between = 0;
      let closed = 0;
      for (let t = 0; t <= 20_000; t += 5) {
        const v = s.autoBlink.tick(t).EyeOpenL;
        if (v > 0 && v < 1) between++;
        if (v === 0) closed++;
      }

      // リップシンク: しきい値 -50dB に +30dB で開き切る（仮実装は 0.6）
      s.lipSync.configure({ mouthSource: 'micOnly', strength: 'standard', silenceThresholdDb: -50 });
      for (let t = 0; t <= 500; t += 10) s.lipSync.update({ time: t, rmsDb: -20 });
      const lip = one(s.lipSync.produce(ctx(500)));

      // キャリブレーション: 中央値を使う（仮実装は平均）
      const frame = (faceYaw: number) => ({
        time: 0,
        detected: true,
        faceYaw,
        facePitch: 0,
        faceRoll: 0,
        eyeOpenL: 1,
        eyeOpenR: 1,
        eyeBallX: 0,
        eyeBallY: 0,
        mouthOpen: 0,
      });
      s.calibration.reset();
      s.calibration.capture('neutral', [1, 2, 3, 4, 5, 6, 100].map(frame));
      const yaw = s.calibration.result()?.neutral.yaw;
      s.calibration.reset();

      // 表情: 0.2秒かけて値が変わる（本物はフェードを値に織り込み、weight は常に 1）
      s.store.dispatch({
        label: '通しのテストの表情',
        apply: (p) => ({
          ...p,
          expressions: [
            ...p.expressions,
            {
              id: 'e2e-smile',
              name: '通しのテスト',
              entries: [{ parameterId: 'MouthForm', value: 1, blend: 'override' }],
              fadeIn: 0.2,
              fadeOut: 0.2,
            },
          ],
        }),
      });
      // 表情は表情ごとのレイヤーを配列で返す（カード52）。合成した口の形で見る
      const mouthForm = (now: number) => {
        const r = s.expressions.produce(ctx(now));
        const layers = r === null ? [] : Array.isArray(r) ? r : [r];
        return s.mixer.mix(s.store.get().model.parameters, layers).MouthForm ?? 0;
      };
      s.expressions.apply('e2e-smile', 1000);
      const atStart = mouthForm(1000);
      const half = mouthForm(1100);
      const end = mouthForm(1300);
      s.expressions.apply(null, 2000);
      s.expressions.produce(ctx(3000));
      s.store.undo();

      return {
        hasBodyParams: project.model.parameters.some((p) => p.id === 'BodyAngleX'),
        body: body?.values ?? null,
        between,
        closed,
        lip: lip?.values.MouthOpen ?? null,
        yaw,
        fade: [atStart, half, end],
        hotkeysIsFake: 'press' in s.hotkeys,
        spoutIsReal: typeof (s.spout as unknown as { running?: unknown }).running === 'function',
      };
    });
    expect(result.hasBodyParams).toBe(true);
    expect(result.body?.BodyAngleX).toBeCloseTo(6, 5);
    expect(result.body?.BodyAngleZ).toBeCloseTo(-3, 5);
    expect(result.between).toBeGreaterThan(0);
    expect(result.closed).toBeGreaterThan(0);
    expect(result.lip).toBeGreaterThan(0.95);
    expect(result.yaw).toBe(4);
    expect(result.fade[0]).toBeLessThan(0.05);
    expect(result.fade[1]).toBeGreaterThan(0.3);
    expect(result.fade[1]).toBeLessThan(0.7);
    expect(result.fade[2]).toBeCloseTo(1, 6);
    expect(result.hotkeysIsFake).toBe(false);
    expect(result.spoutIsReal).toBe(true);
  });

  it('グローバルホットキーを OS に登録でき、キーを押すと届く', async (ctx) => {
    const page = app!.page;
    const registered = await page.evaluate(async () => {
      const w = window as unknown as { __hotkeyPhases: string[] };
      w.__hotkeyPhases = [];
      const s = window.__studio.services;
      await s.hotkeys.unregisterAll();
      return s.hotkeys.register(
        { id: 'e2e', keys: 'Ctrl+Alt+Shift+F11', action: 'pauseTracking', targetId: null, mode: 'toggle' },
        (phase) => w.__hotkeyPhases.push(phase),
      );
    });
    expect(registered).toBe('ok');

    // ロック中はキーを送っても届かないので、届くことの確認だけを飛ばす（登録できることは上で確かめた）
    if (workstationLocked()) {
      await page.evaluate(() => window.__studio.services.hotkeys.unregisterAll());
      console.log('[ホットキー] PC がロックされているので、キーの入力が届くことの確認を飛ばした');
      ctx.skip();
    }

    // OS のキーの入力として送る（前面がどのウィンドウでも、登録したホットキーは OS が先に受け取る）
    powershell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^%+{F11}')");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __hotkeyPhases: string[] }).__hotkeyPhases), {
        timeout: 5000,
      })
      .toContain('down');
    await page.evaluate(() => window.__studio.services.hotkeys.unregisterAll());
  });

  it('Spout2 の送り手を始めると、ほかのプロセスから見え、フレームを送れる', async () => {
    workDir = mkdtempSync(join(tmpdir(), 'live2d-studio-step1-'));
    const dir = join(workDir, 'reference-model');
    cpSync(join(ROOT, 'fixtures', 'reference-model'), dir, { recursive: true });
    const page = app!.page;
    await page.evaluate((d) => window.__studio.project.open(d), slash(dir));
    await page.evaluate(() => window.__studio.services.editor.set({ mode: 'studio' }));
    warnings.length = 0;
    await page.evaluate(() => {
      const env = window.__studio.environment;
      env.set({ output: { ...env.get().output, method: 'spout2', width: 1280, height: 720, fps: 30 } });
    });
    const senderName = await page
      .waitForFunction(
        () => {
          const spout = window.__studio.services.spout as unknown as {
            running(): boolean;
            started(): { senderName: string } | null;
          };
          return spout.running() ? spout.started()?.senderName : null;
        },
        null,
        { timeout: 30_000 },
      )
      .then((h) => h.jsonValue());
    expect(String(senderName)).toMatch(/^2D Liver/);
    await sleep(2000); // フレームを送らせる

    // ほかのプロセス（PowerShell）から、Spout2 の送り手の名前の一覧を読む
    const names = powershell(
      [
        "$m = [System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('SpoutSenderNames', [System.IO.MemoryMappedFiles.MemoryMappedFileRights]::Read)",
        '$v = $m.CreateViewStream(0, 0, [System.IO.MemoryMappedFiles.MemoryMappedFileAccess]::Read)',
        '$b = New-Object byte[] 4096',
        '[void]$v.Read($b, 0, 4096)',
        "[System.Text.Encoding]::ASCII.GetString($b).Split([char]0) | Where-Object { $_ -ne '' }",
      ].join('; '),
    );
    expect(names).toContain(String(senderName));
    expect(warnings.filter((w) => w.includes('Spout2'))).toEqual([]);

    await page.evaluate(() => {
      const env = window.__studio.environment;
      env.set({ output: { ...env.get().output, method: 'window' } });
    });
    await page.waitForFunction(
      () => !(window.__studio.services.spout as unknown as { running(): boolean }).running(),
      null,
      { timeout: 10_000 },
    );
  }, 120_000);

  it('マイクがあれば、本番の CSP の下で音量が 10ms ごとに届く', async () => {
    const page = app!.page;
    const result = await page.evaluate(async () => {
      const s = window.__studio.services;
      const devices = await s.audio.listDevices();
      if (devices.length === 0) return { devices: 0, levels: 0, error: null as string | null };
      let levels = 0;
      const off = s.audio.onLevel(() => levels++);
      try {
        await s.audio.start(devices[0]!.id);
        levels = 0;
        await new Promise((r) => setTimeout(r, 1000));
        return { devices: devices.length, levels, error: null };
      } catch (e) {
        return { devices: devices.length, levels, error: String(e) };
      } finally {
        off();
        s.audio.stop();
      }
    });
    console.log(
      `[マイク] 機器 ${result.devices} 個、1秒の音量 ${result.levels} 回${result.error ? `、${result.error}` : ''}`,
    );
    if (result.devices === 0) return; // マイクの無い PC では確かめられない
    expect(result.error).toBeNull();
    expect(result.levels).toBeGreaterThanOrEqual(80);
  });
});
