// AT-12 実装者の補助試験。偽の体の推定（FakeBodyTracking）と正式fixture（AT-08）で、腕のサービスと実行部への接続を確かめる
import { describe, expect, it } from 'vitest';
import {
  FakeBodyTracking,
  FakeTrackingSource,
  type BodyTrackingFrame,
  type Layer,
  type PosePoint,
  type Services,
} from '@app/contracts';
import { createArmTrackingFixture, createParameterMixer, createProjectStore } from '@app/core';
import { defaultArmTrackingSettings, newId, type ArmTrackingSettings } from '@app/schema';
import { createFakeServices } from '../../services';
import { createStudioRuntime } from '../../modes/studio/runtime';
import { armRuntimeOf, createArmService } from './service';

// 未反転の画像（0..1）。演者の右は画像の左。腕を外へ上げた姿勢（肩・肘・手首が見えている）
function poseLandmarks(raise = 0.25): PosePoint[] {
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.9, z: 0, visibility: 0.1 }));
  const set = (i: number, x: number, y: number) => (points[i] = { x, y, z: 0, visibility: 0.95 });
  set(0, 0.5, 0.25);
  set(11, 0.6, 0.45); // 演者の左肩
  set(12, 0.4, 0.45); // 演者の右肩
  set(13, 0.7, 0.55);
  set(14, 0.3, 0.55);
  set(15, 0.78, 0.55 - raise);
  set(16, 0.22, 0.55 - raise);
  return points;
}
function frameAt(t: number, generation: number, raise = 0.25): BodyTrackingFrame {
  const time = {
    generation,
    frameId: Math.round(t),
    capturedAt: t,
    captureSource: 'captureTime' as const,
    completedAt: t,
    receivedAt: t,
  };
  return {
    image: { width: 640, height: 480 },
    pose: { time, value: { landmarks: poseLandmarks(raise), worldLandmarks: [] } },
    hands: null,
  };
}

function setup(sides: Partial<Record<'L' | 'R', boolean>> = { L: true }) {
  const project = createArmTrackingFixture();
  const settings: ArmTrackingSettings = defaultArmTrackingSettings();
  for (const [side, on] of Object.entries(sides)) settings.sides[side as 'L' | 'R'].enabled = !!on;
  project.armTracking = settings;
  const store = createProjectStore(project);
  const body = new FakeBodyTracking();
  const timers: (() => void)[] = [];
  const clock = { now: 0 }; // 切替の時刻（撮影時刻と同じ時計）
  const arms = createArmService({
    store,
    tracking: { body, captureStats: () => null },
    schedule: (cb) => {
      timers.push(cb);
      return () => {
        const i = timers.indexOf(cb);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    now: () => clock.now,
  });
  const runtime = armRuntimeOf(arms)!;
  return { store, body, arms, runtime, timers, clock };
}
// 撮影時刻 from から to まで 30fps で流し、描画も進める
function play(s: ReturnType<typeof setup>, from: number, to: number, raise = 0.25) {
  let layer: Layer | null = null;
  for (let t = from; t < to; t += 33) {
    s.body.emit(frameAt(t, s.body.status().generation, raise));
    layer = s.runtime.tick(t + 30);
  }
  return layer;
}

describe('腕のサービス（AT-12）', () => {
  it('設定は Project.armTracking へ、1回の Undo で戻る変更として書く', () => {
    const { store, arms } = setup({});
    const next = arms.settings();
    next.sides.R.enabled = true;
    arms.setSettings(next);
    expect(store.get().armTracking!.sides.R.enabled).toBe(true);
    expect(arms.settings().sides.R.enabled).toBe(true);
    arms.setSettings(arms.settings()); // 同じ値は積まない
    store.undo();
    expect(store.get().armTracking!.sides.R.enabled).toBe(false);
  });

  it('体の推定は、つないでいて、入れた側に腕の設定がある間だけ動かす（判断2）', () => {
    const s = setup({});
    expect(s.body.status().pose.state).toBe('off');
    const off = s.runtime.attach();
    expect(s.body.status().pose.state).toBe('off'); // まだどちらも入れていない
    const next = s.arms.settings();
    next.sides.L.enabled = true;
    s.arms.setSettings(next);
    expect(s.body.status().pose.state).toBe('ready');
    const generation = s.body.status().generation;
    s.arms.setSettings({ ...next, sides: { ...next.sides, L: { ...next.sides.L, gain: 1.5 } } });
    expect(s.body.status().generation).toBe(generation); // 推定の条件が同じなら世代を上げない
    off();
    expect(s.body.status().pose.state).toBe('off');
  });

  it('観測から入れた側だけの腕の層を出し、追従・手形（休止形）の状態を画面へ知らせる', () => {
    const s = setup({ L: true });
    s.runtime.attach();
    let notified = 0;
    s.arms.subscribe(() => notified++);
    const layer = play(s, 0, 900);
    expect(Object.keys(layer!.values).every((id) => id.endsWith('L'))).toBe(true);
    expect(layer!.values.ArmShoulderL).toBeGreaterThan(20);
    expect(layer!.values.HandOpenL).toBe(1);
    const status = s.arms.status();
    expect(status.motion.L.state).toBe('tracking');
    expect(status.motion.R.state).toBe('off');
    expect(notified).toBeGreaterThan(0);
    expect(notified).toBeLessThan(20); // 姿勢の数値の変化では毎フレーム知らせない
  });

  it('診断は撮影時刻・Poseの点・採用した点・目標と実際の手首を持つ', () => {
    const s = setup({ L: true });
    s.runtime.attach();
    play(s, 0, 600);
    const d = s.arms.diagnostics()!;
    expect(d.image).toEqual({ width: 640, height: 480 });
    expect(d.pose!.right.shoulder).toMatchObject({ x: 0.4, y: 0.45 });
    const L = d.sides.L!;
    expect(L.actorSide).toBe('right'); // ミラーON：演者の右 → L
    expect(L.wrist).not.toBeNull();
    expect(L.target).not.toBeNull();
    expect(L.actual).not.toBeNull();
  });

  it('ミラーを変えると、左右をいきなり入れ替えず休止へ戻り始める', () => {
    const s = setup({ L: true });
    s.runtime.attach();
    play(s, 0, 900);
    s.runtime.setMirror(false);
    s.runtime.tick(950);
    expect(s.arms.status().motion.L.state).toBe('returning');
  });

  it('表情・アニメーションが重み1で上書きした側は、表示中の姿勢に合わせ、終わったらそこからつなぐ', () => {
    const s = setup({ L: true });
    s.runtime.attach();
    play(s, 0, 900);
    const shown = { ArmShoulderL: 140, ArmElbowL: 110, HandAngleL: 0 };
    s.runtime.afterFrame({ layers: [{ id: 'animation', weight: 1, values: shown }], params: shown });
    play(s, 900, 935);
    const status = s.arms.status().motion.L;
    expect(status.state).toBe('recovering');
    expect(status.pose!.shoulder).toBeGreaterThan(120); // 表示中の140°の近くから
    // 重み0.5の混ぜ合わせ（上書きでない）では合わせない
    const s2 = setup({ L: true });
    s2.runtime.attach();
    play(s2, 0, 900);
    s2.runtime.afterFrame({ layers: [{ id: 'animation', weight: 0.5, values: shown }], params: shown });
    play(s2, 900, 935);
    expect(s2.arms.status().motion.L.state).toBe('tracking');
  });

  it('校正：点が来なければ時間切れで失敗、取り消しは何も保存せずに終える', async () => {
    const s = setup({});
    s.runtime.attach();
    const saved: unknown[] = [];
    s.runtime.onCalibrationChange((c) => saved.push(c));
    const waiting = s.arms.captureCalibration('neutral');
    expect(s.body.status().pose.state).toBe('ready'); // 校正の間は推定を動かす
    s.timers[0]!();
    await waiting;
    expect(s.arms.status().calibration).toMatchObject({ state: 'invalid', step: 'neutral' });
    const second = s.arms.captureCalibration('neutral');
    s.arms.cancelCalibration();
    await second;
    expect(s.arms.status().calibration.state).toBe('empty');
    expect(saved).toEqual([]);
    expect(s.body.status().pose.state).toBe('off');
  });

  it('校正の値を Environment から受け取ると、追従をやり直す', () => {
    const s = setup({ L: true });
    s.runtime.attach();
    play(s, 0, 900);
    s.runtime.setCalibration({
      version: 1,
      camera: { deviceId: null, width: 640, height: 480, fps: 30 },
      shoulderCenter: { x: 320, y: 216 },
      shoulderAxis: { x: 1, y: 0 },
      shoulderWidth: 128,
      arms: {
        left: { upper: 70, lower: 60, neutralWrist: { x: 380, y: 400 } },
        right: { upper: 70, lower: 60, neutralWrist: { x: 260, y: 400 } },
      },
    });
    expect(s.arms.calibration()).not.toBeNull();
    expect(s.arms.status().calibration.state).toBe('ready');
    s.runtime.tick(950);
    expect(s.arms.status().motion.L.state).toBe('returning');
  });

  it('別のプロジェクトを開くと、リグが同じでも追従・診断を捨て、切替の後に撮影した同じ世代の観測で取り直す。校正の結果は残す', () => {
    const s = setup({ L: true });
    s.runtime.attach();
    play(s, 0, 900);
    expect(s.arms.status().motion.L.state).toBe('tracking');
    s.clock.now = 900;
    s.runtime.setCalibration({
      version: 1,
      camera: { deviceId: null, width: 640, height: 480, fps: 30 },
      shoulderCenter: { x: 320, y: 216 },
      shoulderAxis: { x: 1, y: 0 },
      shoulderWidth: 128,
      arms: {
        left: { upper: 70, lower: 60, neutralWrist: { x: 380, y: 400 } },
        right: { upper: 70, lower: 60, neutralWrist: { x: 260, y: 400 } },
      },
    });
    play(s, 900, 1800);
    const generation = s.body.status().generation;
    s.clock.now = 1800;
    s.store.load({ ...structuredClone(s.store.get()), id: newId() });
    expect(s.arms.diagnostics()).toBeNull();
    // 切替の前に撮影し、後から届いた Pose は使わない（手だけの通知も同じ）
    s.runtime.feed(frameAt(1790, generation));
    const lateHands = frameAt(1795, generation);
    s.runtime.feed({ image: lateHands.image, pose: null, hands: { time: lateHands.pose!.time, value: [] } });
    expect(s.arms.diagnostics()).toBeNull();
    s.runtime.tick(1830);
    expect(s.arms.status().motion.L.state).toBe('returning');
    expect(s.arms.status().calibration.state).toBe('ready');
    expect(s.arms.calibration()).not.toBeNull();
    expect(s.body.status().generation).toBe(generation); // カメラ・推定は止めない
    play(s, 1830, 2700);
    expect(s.arms.status().motion.L.state).toBe('tracking');
  });

  it('dispose の後は観測・接続・校正を受け付けず、体の推定を設定し直さない', async () => {
    const s = setup({ L: true });
    const off = s.runtime.attach();
    play(s, 0, 300);
    s.runtime.dispose();
    expect(s.body.status().pose.state).toBe('off');
    const generation = s.body.status().generation;
    off();
    s.runtime.dispose();
    s.runtime.attach();
    s.runtime.feed(frameAt(400, generation));
    await s.arms.captureCalibration('neutral');
    expect(s.body.status().generation).toBe(generation);
    expect(s.timers).toEqual([]);
    expect(s.arms.diagnostics()!.time).toBeLessThan(400);
  });
});

describe('スタジオの実行部への接続（AT-12）', () => {
  it('腕の層は顔のトラッキングを開始していなくても出て、合成後の値に入る。外したら体の推定を止める', () => {
    const body = new FakeBodyTracking();
    const tracking = Object.assign(new FakeTrackingSource(), { body });
    const project = createArmTrackingFixture();
    project.armTracking = defaultArmTrackingSettings();
    project.armTracking.sides.L.enabled = true;
    const base = createFakeServices();
    const store = createProjectStore(project);
    const services: Services = {
      ...base,
      store,
      mixer: createParameterMixer(),
      tracking,
      arms: createArmService({ store, tracking }),
    };
    const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
    const off = runtime.attach(services);
    expect(body.status().pose.state).toBe('ready');
    let frame = null;
    for (let t = 0; t < 900; t += 33) {
      body.emit(frameAt(t, body.status().generation));
      frame = runtime.tick(t + 30);
    }
    expect(frame!.params.ArmShoulderL).toBeGreaterThan(20);
    expect(frame!.layers.filter((l) => l.id === 'tracking')).toHaveLength(1); // 顔の層は無く、腕の層だけ
    off();
    expect(body.status().pose.state).toBe('off');
  });
});

describe('校正の4手順（AT-12）', () => {
  // 手首の高さを左右別に変えた Pose（演者の左＝画像の右）
  type Wrists = { left: [number, number]; right: [number, number] };
  function calibrationFrame(t: number, generation: number, wrists: Wrists): BodyTrackingFrame {
    const f = frameAt(t, generation, 0);
    const landmarks = f.pose!.value.landmarks;
    landmarks[15] = { x: wrists.left[0], y: wrists.left[1], z: 0, visibility: 0.95 };
    landmarks[16] = { x: wrists.right[0], y: wrists.right[1], z: 0, visibility: 0.95 };
    return f;
  }
  it('楽な姿勢・肘を曲げる・左手・右手の4手順で校正を求め、Environment へ保存する関数を呼ぶ', async () => {
    const s = setup({});
    s.runtime.attach();
    const saved: unknown[] = [];
    s.runtime.onCalibrationChange((c) => saved.push(c));
    // 肩 (0.6/0.4, 0.45)・肘 (0.7/0.3, 0.55)。曲げた前腕は上腕の約1.2倍
    const down: [number, number] = [0.72, 0.75];
    const poses: Record<string, Wrists> = {
      neutral: { left: down, right: [0.28, 0.75] },
      bend: { left: [0.8, 0.7], right: [0.2, 0.7] },
      left: { left: [0.75, 0.3], right: [0.28, 0.75] },
      right: { left: down, right: [0.25, 0.3] },
    };
    let t = 0;
    for (const step of ['neutral', 'bend', 'left', 'right'] as const) {
      const done = s.arms.captureCalibration(step);
      for (const end = t + 1100; t < end; t += 33)
        s.body.emit(calibrationFrame(t, s.body.status().generation, poses[step]!));
      await done;
      if (step !== 'right') expect(s.arms.status().calibration).toMatchObject({ state: 'capturing', step });
    }
    const status = s.arms.status().calibration;
    expect(status.reason).toBeNull();
    expect(status.state).toBe('ready');
    expect(saved).toHaveLength(1);
    expect(s.arms.calibration()).toEqual(saved[0]);
  });
});
