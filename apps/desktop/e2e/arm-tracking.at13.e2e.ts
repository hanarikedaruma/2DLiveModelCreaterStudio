// COの通し試験。専用identifier/プロファイルと仮カメラで実行し、利用者のプロジェクトを開かない。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DeformedModel, ParamValues } from '@app/contracts';
import type { Project } from '@app/schema';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, ROOT, sleep, waitForStartup, type RunningApp } from './app';
import type { ArmServiceWithRuntime } from '../src/services/arms';

interface Replay {
  clock: number;
  preview: DeformedModel | null;
  sink: DeformedModel | null;
  sinkParams: ParamValues;
  offSink: () => void;
}
declare global {
  interface Window {
    __armReplay: Replay;
  }
}
const output = resolve(ROOT, 'docs/arm-tracking/evidence/AT-13');
const projectDir = resolve(ROOT, `.cache/arm-tracking/at13-project-${Date.now()}`).replace(/\\/g, '/');
let app: RunningApp;
const errors: string[] = [],
  external: string[] = [];
const results: Record<string, unknown> = {};

beforeAll(async () => {
  await mkdir(output, { recursive: true });
  app = await launchApp(9350, ['--use-fake-device-for-media-stream=fps=30']);
  await waitForStartup(app.page);
  app.page.on('pageerror', (e) => errors.push(e.message));
  app.page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      /^https?:$/.test(url.protocol) &&
      !['tauri.localhost', 'ipc.localhost', 'localhost', '127.0.0.1'].includes(url.hostname)
    )
      external.push(response.url());
  });
}, 180000);
afterAll(async () => {
  if (app) {
    await app.page
      .evaluate(() => {
        window.__studio.studio.runtime.stopTracking();
        window.__armReplay?.offSink();
        window.__studio.services.autoSaver.stop();
      })
      .catch(() => {});
    await app.close();
  }
  await writeFile(resolve(output, 'run.json'), JSON.stringify({ results, errors, external }, null, 2));
});
afterEach(async (context) => {
  if (context.task.result?.state !== 'fail' || !app) return;
  await app.page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  const state = await app.page
    .evaluate(() => ({
      mode: window.__studio.services.editor.get().mode,
      tool: window.__studio.canvas.getState().activeToolId,
      headings: [...document.querySelectorAll('h1,h2,h3')].map((el) => el.textContent),
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((el) => el.textContent),
    }))
    .catch(() => null);
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ test: context.task.name, state }, null, 2));
});

async function loadFixture(file = 'no-rig.json') {
  const fixture = JSON.parse(await readFile(resolve(ROOT, `fixtures/arm-tracking/${file}`), 'utf8')) as Project;
  const png = [...(await readFile(resolve(ROOT, 'fixtures/arm-tracking/assets/arm-tech.png')))];
  await app.page.evaluate(
    async ({ fixture, png, seedDirectory }) => {
      const a = window.__studio,
        s = a.services,
        rt = a.studio.runtime;
      rt.stopTracking();
      s.autoSaver.stop();
      s.store.load(fixture);
      await s.assets.put('arm-tech', new Uint8Array(png));
      // 通常の「開く」で標準パラメータ・標準呼吸を補う既存処理も最初から通す。
      await a.project.saveAs(seedDirectory);
      await a.project.open(seedDirectory);
      s.autoSaver.stop();
      a.environment.set({
        mirror: true,
        autoBlink: false,
        cameraCapture: { mode: 'manual', width: 640, height: 480, fps: 30 },
      });
      rt.setScheduler({ request: () => () => {} }); // 決定的な再生。実カメラ経路は別の試験で行う。
      const previous = window.__armReplay;
      previous?.offSink();
      window.__armReplay = { clock: performance.now(), preview: null, sink: null, sinkParams: {}, offSink: () => {} };
      const create = s.createRenderer.bind(s);
      s.createRenderer = () => {
        const renderer = create(),
          render = renderer.render.bind(renderer);
        renderer.render = (model, view, background) => {
          window.__armReplay.preview = model;
          render(model, view, background);
        };
        return renderer;
      };
      window.__armReplay.offSink = rt.registerFrameSink((f) => {
        window.__armReplay.sink = f.model;
        window.__armReplay.sinkParams = { ...f.params };
      });
      s.editor.set({ mode: 'modeling' });
      a.canvas.setActiveTool('modeling.arms');
      a.canvas.requestFit();
    },
    { fixture, png, seedDirectory: `${projectDir}/seed-${file.replace('.json', '')}-${Date.now()}` },
  );
  await app.page.getByRole('tab', { name: 'モデリング', exact: true }).click();
  await app.page.getByRole('button', { name: '腕の設定', exact: true }).click();
  await app.page.locator('.arm-setup').waitFor();
}

// COが作った未反転640x480の点列。校正用4姿勢は、腕長の測定と左右の手上げが可能な点を使う。
async function replay(step: 'neutral' | 'bend' | 'left' | 'right' | 'follow', frames = 36) {
  return app.page.evaluate(
    ({ step, frames }) => {
      const a = window.__studio,
        s = a.services,
        arm = s.arms as ArmServiceWithRuntime;
      window.__armReplay.clock = Math.max(window.__armReplay.clock, performance.now());
      let f = a.studio.runtime.lastFrame();
      for (let n = 0; n < frames; n++) {
        const t = (window.__armReplay.clock += 33.333);
        const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
        const set = (i: number, x: number, y: number) => {
          points[i] = { x: x / 640, y: y / 480, z: 0, visibility: 1 };
        };
        set(11, 416, 168);
        set(12, 224, 168);
        set(13, 466, 248);
        set(14, 174, 248);
        set(
          15,
          step === 'bend' ? 546 : 466,
          step === 'left' ? 100 : step === 'follow' ? 180 : step === 'bend' ? 248 : 338,
        );
        set(
          16,
          step === 'bend' ? 94 : 174,
          step === 'right' ? 100 : step === 'follow' ? 200 : step === 'bend' ? 248 : 338,
        );
        arm.runtime.feed({
          image: { width: 640, height: 480 },
          pose: {
            time: {
              generation: s.tracking.body!.status().generation,
              frameId: Math.round(t),
              capturedAt: t,
              completedAt: t + 5,
              receivedAt: t + 10,
              captureSource: 'captureTime',
            },
            value: { landmarks: points, worldLandmarks: [] },
          },
          hands: null,
        });
        if (step === 'follow') {
          const value = (['right', 'left'] as const).map((side, i) => {
            const wrist = points[i === 0 ? 16 : 15]!;
            const local = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
            for (let finger = 0; finger < 4; finger++) {
              const x = (finger - 1.5) * 0.005,
                y = -0.02;
              const ratio = i === 0 && finger < 2 ? 1.8 : 0.8; // 演者右=peace、左=fist
              for (let joint = 0; joint < 4; joint++) {
                const k = 1 + ((ratio - 1) * joint) / 3;
                local[5 + finger * 4 + joint] = { x: x * k, y: y * k, z: 0 };
              }
            }
            return {
              handedness: { side, score: 1 },
              gesture: null,
              worldLandmarks: local,
              landmarks: local.map((p) => ({ x: wrist.x + (p.x * 1000) / 640, y: wrist.y + (p.y * 1000) / 480, z: 0 })),
            };
          });
          arm.runtime.feed({
            image: { width: 640, height: 480 },
            pose: null,
            hands: {
              time: {
                generation: s.tracking.body!.status().generation,
                frameId: Math.round(t),
                capturedAt: t,
                completedAt: t + 5,
                receivedAt: t + 10,
                captureSource: 'captureTime',
              },
              value,
            },
          });
        }
        f = a.studio.runtime.tick(t + 10);
      }
      return {
        status: arm.status(),
        params: f?.params ?? {},
        sinkMatchesPreview: window.__armReplay.sink === window.__armReplay.preview,
        sinkMatchesRuntime: window.__armReplay.sink === f?.model,
      };
    },
    { step, frames },
  );
}

describe('AT-13 腕・手の回帰', () => {
  it('設定→実サービスの校正→追従→手形固定→保存/再読込→解除/Undoを通し、プレビューとsinkを一致させる', async () => {
    await loadFixture();
    const page = app.page,
      panel = page.locator('.arm-setup');
    for (const side of ['L', 'R'] as const) {
      await panel.getByLabel('設定する腕', { exact: true }).selectOption(side);
      await panel.getByLabel('体側の親', { exact: true }).selectOption('body-root');
      await panel.getByLabel('上腕の素材', { exact: true }).selectOption(`upper-${side}`);
      await panel.getByLabel('前腕の素材', { exact: true }).selectOption(`lower-${side}`);
      for (const [joint, y] of [
        ['肩', 240],
        ['肘', 358],
        ['手首', 466],
      ] as const) {
        await panel.getByLabel(`${joint} X`, { exact: true }).fill(side === 'L' ? '378' : '222');
        await panel.getByLabel(`${joint} Y`, { exact: true }).fill(String(y));
      }
      for (const [label, shape] of [
        ['パー', 'open'],
        ['グー', 'fist'],
        ['指さし', 'point'],
        ['ピース', 'peace'],
      ] as const) {
        const summary = panel.locator('summary').filter({ hasText: `${label}：未設定` });
        if (!(await summary.locator('..').evaluate((el) => (el as HTMLDetailsElement).open))) await summary.click();
        await panel.getByLabel(`${label}の素材`, { exact: true }).selectOption(`${shape}-${side}`);
        await panel.getByLabel(`${label} 指方向`, { exact: true }).fill('-90'); // 技術見本の手は上向きに描いてある
      }
      await panel.getByRole('button', { name: '専用関節を作成', exact: true }).click();
      expect(await page.evaluate(() => window.__studio.services.store.get().model.armRigs?.length)).toBe(
        side === 'L' ? 1 : 2,
      );
      await panel.getByRole('button', { name: '前腕・手を顔より前へ', exact: true }).click();
    }
    await page.evaluate(() => window.__studio.services.editor.set({ mode: 'studio' }));
    const section = page.locator('.arms-section');
    await section.getByRole('checkbox', { name: '左腕（あなたの右手）', exact: true }).check();
    await section.getByRole('checkbox', { name: '右腕（あなたの左手）', exact: true }).check();
    await section.getByRole('button', { name: '腕の校正', exact: true }).click();
    for (const step of ['neutral', 'bend', 'left', 'right'] as const) {
      // カウント開始に要る点を与え、UIがこの手順のcaptureを始めるまで待つ。
      await replay(step, 1);
      await page.waitForFunction((step) => {
        const c = window.__studio.services.arms!.status().calibration;
        return c.state === 'capturing' && c.step === step;
      }, step);
      await replay(step);
    }
    const dialog = page.getByRole('dialog', { name: '腕の校正', exact: true });
    await dialog.getByText(/腕の校正を保存した/).waitFor();
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    expect(await page.evaluate(() => window.__studio.environment.get().armCalibration)).toBeTruthy();
    const auto = await replay('follow');
    expect(auto.params.HandPeaceL).toBe(1);
    expect(auto.params.HandFistR).toBe(1);
    await section.getByRole('combobox', { name: '左腕の手形', exact: true }).selectOption('peace');
    await section.getByRole('combobox', { name: '右腕の手形', exact: true }).selectOption('fist');
    const follow = await replay('follow');
    expect(follow.status.motion.L.state).toBe('tracking');
    expect(follow.status.motion.R.state).toBe('tracking');
    expect(follow.params.HandPeaceL).toBe(1);
    expect(follow.params.HandFistR).toBe(1);
    expect(follow.sinkMatchesPreview).toBe(true);
    expect(follow.sinkMatchesRuntime).toBe(true);
    const geometry = await page.evaluate(() => {
      const s = window.__studio.services,
        model = window.__studio.studio.runtime.lastFrame()!.model;
      const hands = s.store.get().model.armRigs!.flatMap((r) => Object.values(r.hands).flatMap((h) => h.partIds));
      let checked = 0;
      for (const id of hands) {
        const item = model.byPartId[id];
        if (!item || item.opacity <= 0) continue;
        const part = s.store.get().model.parts.find((p) => p.id === id)!;
        const source = s.store.get().model.meshes.find((m) => m.id === part.meshId)!;
        for (const [a, b, c] of source.triangles) {
          const p = source.vertices,
            q = item.positions;
          const old = (p[b]!.x - p[a]!.x) * (p[c]!.y - p[a]!.y) - (p[b]!.y - p[a]!.y) * (p[c]!.x - p[a]!.x);
          const now =
            (q[2 * b]! - q[2 * a]!) * (q[2 * c + 1]! - q[2 * a + 1]!) -
            (q[2 * b + 1]! - q[2 * a + 1]!) * (q[2 * c]! - q[2 * a]!);
          if (!(old * now > 0)) throw new Error(`手の反転: ${id}`);
          checked++;
        }
      }
      return { checked, order: model.items.map((i) => i.partId) };
    });
    expect(geometry.checked).toBe(4);
    expect(geometry.order.indexOf('peace-L')).toBeGreaterThan(geometry.order.indexOf('face'));
    await page.evaluate((dir) => window.__studio.project.saveAs(dir), projectDir);
    expect(await page.evaluate(() => window.__studio.project.dir())).toBe(projectDir);
    const saved = await page.evaluate(
      () => JSON.parse(JSON.stringify(window.__studio.services.store.get())) as Project,
    );
    await page.evaluate((dir) => window.__studio.project.open(dir), projectDir);
    expect(await page.evaluate(() => window.__studio.services.store.get())).toEqual(saved);
    expect(await page.evaluate(() => window.__studio.services.arms!.settings().sides.L.handMode)).toBe('peace');
    await page.evaluate(() => {
      window.__studio.services.editor.set({ mode: 'modeling' });
      window.__studio.canvas.setActiveTool('modeling.arms');
    });
    await page.getByRole('button', { name: '腕の設定', exact: true }).click();
    await panel.getByRole('button', { name: '関節設定を解除（素材・キーを残す）', exact: true }).click();
    expect(await page.evaluate(() => window.__studio.services.store.get().model.armRigs!.length)).toBe(1);
    await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
    expect(await page.evaluate(() => window.__studio.services.store.get())).toEqual(saved);
    await page.screenshot({ path: resolve(output, 'setup-after-undo.png') });
    results.workflow = { passed: true, follow, geometry };
  }, 180000);

  it('別プロジェクト・モード・ミラー・遅延結果で古い姿勢を再採用せず、片側欠損でも反対側を描く', async () => {
    await loadFixture('project.json');
    const page = app.page;
    await page.evaluate(() => {
      const a = window.__studio,
        arm = a.services.arms!;
      const settings = arm.settings();
      settings.sides.L.enabled = true;
      settings.sides.R.enabled = true;
      arm.setSettings(settings);
      a.services.editor.set({ mode: 'studio' });
    });
    await replay('follow');
    const state = await page.evaluate(() => {
      const a = window.__studio,
        arm = a.services.arms as ArmServiceWithRuntime;
      const next = structuredClone(a.services.store.get());
      next.id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      a.services.store.load(next);
      const f = a.studio.runtime.tick((window.__armReplay.clock += 20))!;
      return { status: arm.status(), diagnostics: arm.diagnostics(), params: f.params };
    });
    expect(['rest', 'returning']).toContain(state.status.motion.L.state);
    expect(state.diagnostics).toBeNull();
    await page.evaluate(() => window.__studio.environment.set({ mirror: false }));
    await replay('follow');
    for (const mode of ['modeling', 'animation', 'studio'] as const) {
      await page.evaluate((mode) => window.__studio.services.editor.set({ mode }), mode);
      await sleep(100);
    }
    const after = await replay('follow');
    expect(after.sinkMatchesRuntime).toBe(true);
    await page.evaluate(() => {
      const s = window.__studio.services;
      s.store.dispatch({
        label: 'CO regression missing left hand',
        apply: (p) => ({ ...p, model: { ...p.model, parts: p.model.parts.filter((part) => part.id !== 'open-L') } }),
      });
    });
    await replay('follow');
    const broken = await page.evaluate(() =>
      window.__studio.studio.runtime
        .lastFrame()!
        .model.items.filter((i) => i.opacity > 0)
        .map((i) => i.partId),
    );
    expect(broken).toContain('face');
    expect(broken).toContain('peace-R'); // ミラーOFF：演者の右手（peace）がモデルRへ対応する
    expect(broken).not.toContain('lower-L');
    results.transitions = { passed: true, state, broken };
  }, 120000);

  it('同梱モデルを仮カメラで動かし、腕OFFで顔を継続し、外への応答なしで停止・再開する', async () => {
    // 再生の仮時計・描画計測器を捨て、本物の撮影時計とスケジューラで調べる。
    await app.page.reload();
    await waitForStartup(app.page);
    const project = JSON.parse(await readFile(resolve(ROOT, 'fixtures/arm-tracking/project.json'), 'utf8')) as Project;
    await app.page.evaluate(async (project) => {
      const a = window.__studio,
        s = a.services;
      s.autoSaver.stop();
      s.store.load(project);
      const settings = s.arms!.settings();
      settings.sides.L.enabled = true;
      s.arms!.setSettings(settings);
      s.editor.set({ mode: 'studio' });
    }, project);
    await app.page.waitForFunction(() => window.__studio.studio.runtime.getState().running);
    await app.page.evaluate(async () => {
      const s = window.__studio.services;
      const counts = { face: 0, pose: 0, hands: 0 };
      Object.assign(window, { __at13Camera: counts });
      s.tracking.onFrame(() => counts.face++);
      s.tracking.body!.onFrame((f) => {
        if (f.pose) counts.pose++;
        if (f.hands) counts.hands++;
      });
      await window.__studio.studio.runtime.startTracking();
    });
    await app.page.waitForFunction(
      () => window.__studio.services.tracking.body!.status().pose.state === 'ready',
      null,
      { timeout: 30000 },
    );
    // SDKの60秒周期の通信も含めて観測する。これは性能の合否ではない。
    await sleep(65000);
    const on = await app.page.evaluate(() => ({
      ...(window as unknown as { __at13Camera: Record<string, number> }).__at13Camera,
    }));
    expect(on.face).toBeGreaterThan(0);
    expect(on.pose).toBeGreaterThan(0);
    expect(on.hands).toBeGreaterThan(0);
    await app.page.evaluate(() => {
      const a = window.__studio.services.arms!,
        s = a.settings();
      s.sides.L.enabled = false;
      a.setSettings(s);
    });
    // 解除には遅延解放と実行中の推定の終了が含まれる。固定時間ではなく終了条件を待つ。
    const workerStopMs: number[] = [];
    const workerStops: Record<string, unknown>[] = [];
    results.fakeCamera = { passed: false, on, workerStops };
    const waitForWorkerStop = async () => {
      const started = Date.now();
      while (app.page.workers().length > 0 && Date.now() - started < 5000) await sleep(25);
      const elapsedMs = Date.now() - started;
      const workers = app.page.workers();
      const record: Record<string, unknown> = { elapsedMs, remaining: workers.length };
      // 通常の停止→再開の間にページの処理を挟まない。上限超過時だけ原因の診断を取る。
      if (workers.length > 0) {
        record.state = await app.page.evaluate(() => ({
          settings: window.__studio.services.arms!.settings(),
          body: window.__studio.services.tracking.body!.status(),
          hidden: document.hidden,
        }));
        record.afterStatusQuery = app.page.workers().length;
        record.probes = await Promise.all(
          workers.map(async (worker) => ({
            url: worker.url(),
            probe: await Promise.race([
              worker.evaluate(() => 'alive').catch((error: unknown) => String(error)),
              sleep(500).then(() => 'probe timeout'),
            ]),
          })),
        );
      }
      workerStops.push(record);
      // 診断の取得中に変化しても、上限到達時の結果で判定する。
      expect(workers).toHaveLength(0);
      workerStopMs.push(elapsedMs);
    };
    await waitForWorkerStop();
    const before = await app.page.evaluate(() => ({
      ...(window as unknown as { __at13Camera: Record<string, number> }).__at13Camera,
    }));
    await sleep(1000);
    const off = await app.page.evaluate(() => ({
      ...(window as unknown as { __at13Camera: Record<string, number> }).__at13Camera,
    }));
    expect(off.face).toBeGreaterThan(before.face!);
    expect(off.pose).toBe(before.pose);
    expect(off.hands).toBe(before.hands);
    for (let i = 0; i < 2; i++) {
      await app.page.evaluate(() => {
        const a = window.__studio.services.arms!,
          s = a.settings();
        s.sides.L.enabled = true;
        a.setSettings(s);
      });
      await app.page.waitForFunction(() => window.__studio.services.tracking.body!.status().pose.state === 'ready');
      expect(app.page.workers()).toHaveLength(1);
      await app.page.evaluate(() => {
        const a = window.__studio.services.arms!,
          s = a.settings();
        s.sides.L.enabled = false;
        a.setSettings(s);
      });
      await waitForWorkerStop();
    }
    await app.page.evaluate(() => window.__studio.studio.runtime.stopTracking());
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
    results.fakeCamera = { passed: true, on, before, off, external, workerStopMs, workerStops };
  }, 180000);

  it('表情/アニメーションの上書き終了を表示姿勢からつなぎ、口と物理の層を同時に合成する', async () => {
    await loadFixture('project.json');
    await app.page.evaluate(() => {
      const a = window.__studio,
        arm = a.services.arms!,
        settings = arm.settings();
      settings.sides.L.enabled = true;
      settings.sides.R.enabled = true;
      arm.setSettings(settings);
      a.services.editor.set({ mode: 'studio' });
    });
    await replay('follow');
    await app.page.evaluate(() => {
      const rt = window.__studio.studio.runtime;
      Object.assign(window, {
        __at13AnimationOff: rt.registerLayerProducer({
          id: 'animation',
          produce: () => ({ id: 'animation', weight: 1, values: { ArmShoulderL: 140, ArmElbowL: 110, HandAngleL: 0 } }),
        }),
        __at13OtherOff: [
          rt.registerLayerProducer({
            id: 'lipSync',
            produce: () => ({ id: 'lipSync', weight: 1, values: { MouthOpen: 0.6 } }),
          }),
          rt.registerLayerProducer({
            id: 'physics',
            produce: () => ({ id: 'physics', weight: 1, values: { HairFront: 0.4 } }),
          }),
        ],
      });
    });
    const held = await replay('follow', 3);
    expect(held.params.ArmShoulderL).toBe(140);
    expect(held.params.MouthOpen).toBeCloseTo(0.6);
    expect(held.params.HairFront).toBeCloseTo(0.4);
    await app.page.evaluate(() => (window as unknown as { __at13AnimationOff: () => void }).__at13AnimationOff());
    const first = await replay('follow', 1);
    expect(Math.abs(first.params.ArmShoulderL! - 140)).toBeLessThan(1);
    expect(first.status.motion.R.state).toBe('tracking');
    const recovered = await replay('follow');
    expect(recovered.status.motion.L.state).toBe('tracking');
    expect(recovered.params.ArmShoulderL).not.toBe(140);
    await app.page.evaluate(() =>
      (window as unknown as { __at13OtherOff: (() => void)[] }).__at13OtherOff.forEach((off) => off()),
    );
    results.composition = { passed: true, held: held.params, first: first.params, recovered: recovered.params };
  }, 90000);

  it('旧保存形式11を腕なしのまま読み、腕パラメータや描画順を勝手に作らない', async () => {
    const old = JSON.parse(await readFile(resolve(ROOT, 'fixtures/arm-tracking/no-rig.json'), 'utf8')) as Project;
    old.schemaVersion = 11;
    delete old.armTracking;
    delete old.model.armRigs;
    old.model.parameters = old.model.parameters.filter(
      (p) => !/^(ArmShoulder|ArmElbow|HandAngle|HandOpen|HandFist|HandPoint|HandPeace)[LR]$/.test(p.id),
    );
    const directory = resolve(ROOT, '.cache/arm-tracking/at13-old-project');
    await mkdir(resolve(directory, 'assets'), { recursive: true });
    await writeFile(resolve(directory, 'project.json'), JSON.stringify(old));
    await writeFile(
      resolve(directory, 'assets/arm-tech.png'),
      await readFile(resolve(ROOT, 'fixtures/arm-tracking/assets/arm-tech.png')),
    );
    const loaded = await app.page.evaluate(
      async (directory) => {
        const result = await window.__studio.services.io.load(directory);
        window.__studio.services.store.load(result.project);
        return window.__studio.services.store.get();
      },
      directory.replace(/\\/g, '/'),
    );
    expect(loaded.schemaVersion).toBe(12);
    expect(loaded.model.armRigs?.length ?? 0).toBe(0);
    expect(loaded.model.drawOrder).toEqual(old.model.drawOrder);
    expect(
      loaded.model.parameters.filter((p) =>
        /^(ArmShoulder|ArmElbow|HandAngle|HandOpen|HandFist|HandPoint|HandPeace)[LR]$/.test(p.id),
      ),
    ).toEqual([]);
    expect(await app.page.evaluate(() => window.__studio.services.arms!.settings().sides.L.enabled)).toBe(false);
    results.oldProject = { passed: true, schemaVersion: loaded.schemaVersion, armRigs: loaded.model.armRigs ?? [] };
  }, 90000);
});
