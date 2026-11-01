// AT-13 CL独立確認。COの通し試験（arm-tracking.at13.e2e.ts）とは別に組んだ観測で、検証用の実アプリ
// （専用identifier・プロファイル）を動かし、COの試験では区別できない点を確かめる：
// 観測と違う手形の固定と自動への戻し、手形の Undo/Redo と画面の表示、カメラを止めないプロジェクト切替の直前に撮影した遅延結果
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BodyPoint, HandObservation, ParamValues, PosePoint } from '@app/contracts';
import type { HandShape, Project } from '@app/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, ROOT, sleep, waitForStartup, type RunningApp } from './app';
import type { ArmServiceWithRuntime } from '../src/services/arms';

interface ClReplay {
  clock: number;
  sink: ParamValues;
  offSink: () => void;
}
declare global {
  interface Window {
    __clArm: ClReplay;
  }
}
type Shapes = { right: HandShape; left: HandShape } | null; // 演者の右手・左手
interface Step {
  params: ParamValues;
  sink: ParamValues;
  state: { L: string; R: string };
  diagnosticsTime: number | null;
}

const output = resolve(ROOT, 'docs/arm-tracking/evidence/AT-13-cl');
const HAND_IDS = ['Open', 'Fist', 'Point', 'Peace'].flatMap((s) => [`Hand${s}L`, `Hand${s}R`]);
let app: RunningApp;
const errors: string[] = [];
const results: Record<string, unknown> = {};
let savedCalibration: unknown = null;

// 未反転の画像（0..1）。演者の左肩は画像の右。両腕を外へ上げた姿勢
function poseLandmarks(): PosePoint[] {
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.9, z: 0, visibility: 0.1 }));
  const set = (i: number, x: number, y: number) => (points[i] = { x, y, z: 0, visibility: 0.95 });
  set(0, 0.5, 0.25);
  set(11, 0.6, 0.45);
  set(12, 0.4, 0.45);
  set(13, 0.7, 0.55);
  set(14, 0.3, 0.55);
  set(15, 0.78, 0.3);
  set(16, 0.22, 0.3);
  return points;
}
// 手の21点。手基準の3D（m、手首が原点、指は上）で、各指の 手首→指先 ÷ 手首→付け根 を形ごとに決める
const MCP: [number, number][] = [
  [-0.025, -0.085],
  [-0.005, -0.09],
  [0.015, -0.085],
  [0.033, -0.075],
];
const RATIOS: Record<HandShape, number[]> = {
  open: [1.8, 1.9, 1.8, 1.75],
  fist: [0.8, 0.8, 0.8, 0.8],
  point: [1.8, 0.8, 0.8, 0.8],
  peace: [1.8, 1.9, 0.8, 0.8],
};
function hand(side: 'left' | 'right', shape: HandShape, wrist: PosePoint): HandObservation {
  const world: BodyPoint[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  [
    [-0.03, -0.02],
    [-0.045, -0.04],
    [-0.055, -0.055],
    [-0.06, -0.065],
  ].forEach(([x, y], i) => (world[1 + i] = { x: x!, y: y!, z: 0.01 }));
  MCP.forEach(([mx, my], finger) => {
    const r = RATIOS[shape][finger]!;
    const tip = { x: mx * r, y: my * r, z: r < 1 ? 0.02 : 0 }; // 曲げた指は掌の前へ
    for (let j = 0; j < 4; j++) {
      const t = j / 3;
      world[5 + finger * 4 + j] = { x: mx + (tip.x - mx) * t, y: my + (tip.y - my) * t, z: tip.z * t };
    }
  });
  return {
    landmarks: world.map((p) => ({ x: wrist.x + p.x * 0.75, y: wrist.y + p.y, z: p.z })),
    worldLandmarks: world,
    handedness: { side, score: 0.9 },
    gesture: null,
  };
}
function handsFor(shapes: Shapes): HandObservation[] | null {
  if (!shapes) return null;
  const pose = poseLandmarks();
  return [hand('right', shapes.right, pose[16]!), hand('left', shapes.left, pose[15]!)];
}

async function prepare() {
  const fixture = JSON.parse(await readFile(resolve(ROOT, 'fixtures/arm-tracking/project.json'), 'utf8')) as Project;
  const png = [...(await readFile(resolve(ROOT, 'fixtures/arm-tracking/assets/arm-tech.png')))];
  await app.page.evaluate(
    async ({ fixture, png }) => {
      const a = window.__studio,
        s = a.services,
        rt = a.studio.runtime;
      rt.stopTracking();
      s.autoSaver.stop();
      s.store.load(fixture);
      await s.assets.put('arm-tech', new Uint8Array(png));
      s.arms!.clearCalibration(); // 前の検証の校正（別の点列から求めたもの）を使わない。終わりに戻す
      a.environment.set({ mirror: true, autoBlink: false });
      const settings = s.arms!.settings();
      settings.sides.L.enabled = true;
      settings.sides.R.enabled = true;
      s.arms!.setSettings(settings);
      s.editor.set({ mode: 'studio' });
      rt.setScheduler({ request: () => () => {} }); // 描画はこの試験の tick だけで進める
      window.__clArm?.offSink();
      window.__clArm = { clock: performance.now(), sink: {}, offSink: () => {} };
      window.__clArm.offSink = rt.registerFrameSink((f) => {
        window.__clArm.sink = { ...f.params };
      });
    },
    { fixture, png },
  );
  await app.page.locator('.arms-section').waitFor();
}

// 撮影時刻 from（省略は前回の続き）から 30fps で frames 枚の Pose（と手）を渡し、描画を進める
async function feed(frames: number, shapes: Shapes, from?: number): Promise<Step> {
  return app.page.evaluate(
    ({ frames, pose, hands, from }) => {
      const a = window.__studio,
        arm = a.services.arms as ArmServiceWithRuntime;
      if (from !== null) window.__clArm.clock = from;
      let frame = a.studio.runtime.lastFrame();
      for (let n = 0; n < frames; n++) {
        const t = (window.__clArm.clock += 33.333);
        const time = {
          generation: a.services.tracking.body!.status().generation,
          frameId: Math.round(t),
          capturedAt: t,
          completedAt: t + 8,
          receivedAt: t + 12,
          captureSource: 'captureTime' as const,
        };
        arm.runtime.feed({
          image: { width: 640, height: 480 },
          pose: { time, value: { landmarks: pose, worldLandmarks: [] } },
          hands: hands ? { time, value: hands } : null,
        });
        frame = a.studio.runtime.tick(t + 16);
      }
      const status = arm.status();
      return {
        params: frame?.params ?? {},
        sink: window.__clArm.sink,
        state: { L: status.motion.L.state, R: status.motion.R.state },
        diagnosticsTime: arm.diagnostics()?.time ?? null,
      };
    },
    { frames, pose: poseLandmarks(), hands: handsFor(shapes), from: from ?? null },
  );
}
const handParams = (p: ParamValues) => Object.fromEntries(HAND_IDS.map((id) => [id, p[id]]));
const settingsOf = () =>
  app.page.evaluate(() => {
    const s = window.__studio.services.arms!.settings();
    return { L: s.sides.L.handMode, R: s.sides.R.handMode };
  });

beforeAll(async () => {
  await mkdir(output, { recursive: true });
  app = await launchApp(9351, ['--use-fake-device-for-media-stream=fps=30']);
  await waitForStartup(app.page);
  app.page.on('pageerror', (e) => errors.push(e.message));
  savedCalibration = await app.page.evaluate(() => window.__studio.environment.get().armCalibration ?? null);
}, 180000);
afterAll(async () => {
  if (app) {
    await app.page
      .evaluate((calibration) => {
        window.__clArm?.offSink();
        window.__studio.services.autoSaver.stop();
        window.__studio.environment.set({ armCalibration: calibration as never });
      }, savedCalibration)
      .catch(() => {});
    await app.close();
  }
  await writeFile(resolve(output, 'run.json'), JSON.stringify({ results, errors }, null, 2));
});

describe('AT-13 CL独立確認（実アプリ）', () => {
  it('観測と違う手形に固定すると固定の形を出し、自動に戻すと観測の形へ戻る。Undo/Redoで手形と画面が戻る', async () => {
    await prepare();
    const section = app.page.locator('.arms-section');
    const left = section.getByRole('combobox', { name: '左腕の手形', exact: true });

    // ミラーON：演者の右手（ピース）→ モデルの左、演者の左手（グー）→ モデルの右
    const auto = await feed(30, { right: 'peace', left: 'fist' });
    expect(auto.state).toEqual({ L: 'tracking', R: 'tracking' });
    expect(auto.params.HandPeaceL).toBe(1);
    expect(auto.params.HandFistR).toBe(1);

    await left.selectOption('open');
    const fixed = await feed(10, { right: 'peace', left: 'fist' });
    expect(handParams(fixed.params)).toMatchObject({ HandOpenL: 1, HandPeaceL: 0, HandFistR: 1 });
    expect(fixed.state.L).toBe('tracking'); // 手形を固定しても腕は追従する
    expect(handParams(fixed.sink)).toEqual(handParams(fixed.params)); // 配信と同じ手形

    await left.selectOption('auto');
    const back = await feed(20, { right: 'peace', left: 'fist' });
    expect(handParams(back.params)).toMatchObject({ HandOpenL: 0, HandPeaceL: 1, HandFistR: 1 });

    await app.page.evaluate(() => window.__studio.services.store.undo());
    expect(await settingsOf()).toEqual({ L: 'open', R: 'auto' });
    await expect.poll(() => left.inputValue()).toBe('open');
    const undone = await feed(5, { right: 'peace', left: 'fist' });
    expect(undone.params.HandOpenL).toBe(1);
    await app.page.evaluate(() => window.__studio.services.store.redo());
    expect(await settingsOf()).toEqual({ L: 'auto', R: 'auto' });
    await expect.poll(() => left.inputValue()).toBe('auto');
    results.fixedShape = {
      passed: true,
      auto: handParams(auto.params),
      fixed: handParams(fixed.params),
      back: handParams(back.params),
    };
  }, 120000);

  it('カメラを止めずにプロジェクトを切り替えた直前に撮影した結果が後から届いても、新しいプロジェクトに使わない', async () => {
    await app.page.reload();
    await waitForStartup(app.page);
    await prepare();
    // 追従させてから、実際の時計が最後の撮影時刻を越えるまで待つ（切替の直前に撮影した結果を作れるように）
    const before = await feed(30, null);
    expect(before.state.L).toBe('tracking');
    await sleep(1500);
    const switched = await app.page.evaluate((landmarks) => {
      const a = window.__studio,
        arm = a.services.arms as ArmServiceWithRuntime;
      const generation = a.services.tracking.body!.status().generation;
      const next = structuredClone(a.services.store.get());
      next.id = '01JBCLAT13LATERESULT000000';
      const at = performance.now();
      a.services.store.load(next);
      // 切替の20ms前に撮影し、切替の後に届いた推定（同じ世代、撮影時刻は最後の採用より後）
      const late = at - 20;
      arm.runtime.feed({
        image: { width: 640, height: 480 },
        pose: {
          time: {
            generation,
            frameId: Math.round(late),
            capturedAt: late,
            completedAt: at + 30,
            receivedAt: at + 40,
            captureSource: 'captureTime',
          },
          value: { landmarks, worldLandmarks: [] },
        },
        hands: null,
      });
      a.studio.runtime.tick(at); // 追従の状態は描画のたびに更新される
      return {
        at,
        lastAccepted: window.__clArm.clock,
        sameGeneration: a.services.tracking.body!.status().generation === generation,
        diagnostics: arm.diagnostics(),
        state: arm.status().motion.L.state,
      };
    }, poseLandmarks());
    expect(switched.sameGeneration).toBe(true); // カメラ・推定は止まっていない
    expect(switched.at - 20).toBeGreaterThan(switched.lastAccepted); // 遅れた結果は撮影時刻の順序の確認を通る
    expect(switched.diagnostics).toBeNull();
    expect(['rest', 'returning']).toContain(switched.state);
    const after = await feed(30, null, switched.at);
    expect(after.state.L).toBe('tracking');
    expect(after.diagnosticsTime).toBeGreaterThan(switched.at);
    expect(errors).toEqual([]);
    results.lateResult = { passed: true, switchedAt: switched.at, before: before.state, after: after.state };
  }, 120000);

  it('仮カメラで腕のON/OFFを5回繰り返すと、OFFのたびに推定のWorkerが終わり、ONで1つだけ動く（終わるまでの時間を測る）', async () => {
    await app.page.reload();
    await waitForStartup(app.page);
    const project = JSON.parse(await readFile(resolve(ROOT, 'fixtures/arm-tracking/project.json'), 'utf8')) as Project;
    await app.page.evaluate(async (project) => {
      const s = window.__studio.services;
      s.autoSaver.stop();
      s.store.load(project);
      const settings = s.arms!.settings();
      settings.sides.L.enabled = true;
      s.arms!.setSettings(settings);
      s.editor.set({ mode: 'studio' });
    }, project);
    await app.page.waitForFunction(() => window.__studio.studio.runtime.getState().running);
    await app.page.evaluate(() => window.__studio.studio.runtime.startTracking());
    const setLeft = (on: boolean) =>
      app.page.evaluate((on) => {
        const arm = window.__studio.services.arms!,
          s = arm.settings();
        s.sides.L.enabled = on;
        arm.setSettings(s);
      }, on);
    const ready = () =>
      app.page.waitForFunction(() => window.__studio.services.tracking.body!.status().pose.state === 'ready', null, {
        timeout: 30000,
      });
    await ready();
    const stopMs: number[] = [];
    const runningWorkers: number[] = [];
    for (let i = 0; i < 5; i++) {
      runningWorkers.push(app.page.workers().length);
      const off = Date.now();
      await setLeft(false);
      while (app.page.workers().length > 0 && Date.now() - off < 5000) await sleep(25);
      stopMs.push(Date.now() - off);
      expect(app.page.workers()).toHaveLength(0);
      await setLeft(true);
      await ready();
    }
    await app.page.evaluate(() => window.__studio.studio.runtime.stopTracking());
    expect(runningWorkers).toEqual([1, 1, 1, 1, 1]);
    expect(errors).toEqual([]);
    results.workerCycles = { passed: true, stopMs, runningWorkers };
  }, 180000);
});
