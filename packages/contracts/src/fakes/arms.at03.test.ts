// AT-03 の独立確認（CL）。腕の能力が無いときに顔だけの経路が変わらないこと、
// 仮の腕の推定が世代と「更新なし（null）／推定済み・未検出（空）」の区別を守ることを確かめる。
import { describe, expect, it } from 'vitest';
import type {
  BodySample,
  BodyTrackingFrame,
  HandShapeResult,
  HandObservation,
  PoseObservation,
  TrackingFrame,
  TrackingSource,
} from '../index';
import { FakeArmService, FakeBodyTracking, FakeTrackingSource } from './index';

const time = (generation: number, frameId: number) => ({
  generation,
  frameId,
  capturedAt: frameId * 33,
  captureSource: 'captureTime' as const,
  completedAt: frameId * 33 + 20,
  receivedAt: frameId * 33 + 22,
});
const pose = (generation: number, frameId: number, detected = true): BodySample<PoseObservation> => ({
  time: time(generation, frameId),
  value: {
    landmarks: detected ? [{ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }] : [],
    worldLandmarks: detected ? [{ x: 0, y: 0, z: 0 }] : [],
  },
});
const hands = (generation: number, frameId: number, list: HandObservation[]): BodySample<HandObservation[]> => ({
  time: time(generation, frameId),
  value: list,
});

describe('AT-03 独立確認: 顔だけの経路', () => {
  it('腕の能力（body）を持たない既存の推定元は、顔の通知をそのまま出す', async () => {
    let t = 0;
    // 呼ぶ側は契約（TrackingSource）の型で body の有無を見る
    const source: TrackingSource = new FakeTrackingSource(() => t);
    expect(source.body).toBeUndefined();
    const frames: TrackingFrame[] = [];
    source.onFrame((frame) => frames.push(frame));
    await source.start();
    t = 1000;
    await new Promise((r) => setTimeout(r, 60));
    source.stop();
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => typeof f.detected === 'boolean')).toBe(true);
  });
});

describe('AT-03 独立確認: 仮の腕の推定', () => {
  it('設定のたびに世代が増え、古い世代の通知は届かない', () => {
    const body = new FakeBodyTracking();
    const received: BodyTrackingFrame[] = [];
    body.onFrame((f) => received.push(f));
    body.configure({ enabled: true, mode: 'normal', hands: true });
    const first = body.status().generation;
    body.configure({ enabled: true, mode: 'light', hands: true });
    const second = body.status().generation;
    expect(second).toBeGreaterThan(first);
    body.emit({ image: { width: 640, height: 480 }, pose: pose(first, 1), hands: null });
    expect(received).toEqual([]);
    body.emit({ image: { width: 640, height: 480 }, pose: pose(second, 2), hands: null });
    expect(received.length).toBe(1);
  });

  it('Pose だけ・手だけの通知を分けて届け、null（更新なし）と空（推定済み・未検出）を区別する', () => {
    const body = new FakeBodyTracking();
    const received: BodyTrackingFrame[] = [];
    body.onFrame((f) => received.push(f));
    body.configure({ enabled: true, mode: 'normal', hands: true });
    const g = body.status().generation;
    body.emit({ image: { width: 640, height: 480 }, pose: pose(g, 1, false), hands: null });
    body.emit({ image: { width: 640, height: 480 }, pose: null, hands: hands(g, 1, []) });
    expect(received[0]!.pose!.value.landmarks).toEqual([]); // 推定済み・未検出
    expect(received[0]!.hands).toBeNull(); // この通知で手の更新なし
    expect(received[1]!.pose).toBeNull();
    expect(received[1]!.hands!.value).toEqual([]);
    // 同じ frameId でも別の部位の通知は捨てない
    expect(received[0]!.pose!.time.frameId).toBe(received[1]!.hands!.time.frameId);
  });

  it('手を止めた設定では手の通知が届かず、腕（Pose）は届く。どちらも無い通知は出さない', () => {
    const body = new FakeBodyTracking();
    const received: BodyTrackingFrame[] = [];
    body.onFrame((f) => received.push(f));
    body.configure({ enabled: true, mode: 'normal', hands: false });
    const g = body.status().generation;
    body.emit({ image: { width: 640, height: 480 }, pose: null, hands: hands(g, 1, []) });
    expect(received).toEqual([]);
    body.emit({ image: { width: 640, height: 480 }, pose: pose(g, 2), hands: hands(g, 2, []) });
    expect(received.length).toBe(1);
    expect(received[0]!.hands).toBeNull();
    expect(body.status().hands.state).toBe('off');
  });

  it('腕のサービスの状態は写しで返り、外から書き換えられない', () => {
    const service = new FakeArmService();
    const status = service.status();
    status.available = false;
    expect(service.status().available).toBe(true);
    expect(service.calibration()).toBeNull();
  });
});

// AT-03 CO v3 の再確認（CL、2026-11-01）。AT-11から依頼した3つと、手形の結果の指さしの向き
describe('AT-03 再確認（CO v3）: 腕のサービスの追加', () => {
  const calibration = {
    version: 1 as const,
    camera: { deviceId: 'cam', width: 640, height: 480, fps: 30 },
    shoulderCenter: { x: 320, y: 230 },
    shoulderAxis: { x: 1, y: 0 },
    shoulderWidth: 128,
    arms: {
      left: { upper: 75, lower: 70, neutralWrist: { x: 400, y: 440 } },
      right: { upper: 75, lower: 70, neutralWrist: { x: 240, y: 440 } },
    },
  };

  it('settings() は setSettings の値を写しで返す（外から書き換えても中身は変わらない）', () => {
    const service = new FakeArmService();
    const next = service.settings();
    next.sides.L.enabled = true;
    expect(service.settings().sides.L.enabled).toBe(false);
    service.setSettings(next);
    const read = service.settings();
    read.sides.L.gain = 2;
    expect(service.settings().sides.L).toMatchObject({ enabled: true, gain: 1 });
  });

  it('cancelCalibration() は途中の手順を捨て、前の校正を残す（無ければ未校正）', async () => {
    const service = new FakeArmService();
    await service.captureCalibration('bend');
    service.cancelCalibration();
    expect(service.status().calibration).toEqual({ state: 'empty', step: null, reason: null });
    service.setCalibrationResult(calibration);
    await service.captureCalibration('neutral');
    expect(service.status().calibration.state).toBe('capturing');
    service.cancelCalibration();
    expect(service.status().calibration).toEqual({ state: 'ready', step: null, reason: null });
    expect(service.calibration()).toEqual(calibration);
  });

  it('診断は状態の通知と分かれて届き、写しで返る', () => {
    const service = new FakeArmService();
    const statusCalls: number[] = [];
    const diagnosticCalls: number[] = [];
    service.subscribe(() => statusCalls.push(1));
    const off = service.onDiagnostics(() => diagnosticCalls.push(1));
    expect(service.diagnostics()).toBeNull();
    const point = { x: 0.4, y: 0.5, visibility: 0.9 };
    service.setDiagnostics({
      time: 100,
      image: { width: 640, height: 480 },
      pose: {
        left: { shoulder: point, elbow: null, wrist: null },
        right: { shoulder: point, elbow: point, wrist: point },
      },
      hands: [],
      sides: {
        L: {
          actorSide: 'right',
          validity: 'valid',
          elbow: { x: 0.2, y: 0.4 },
          wrist: { x: 0.5, y: 0.8 },
          target: { x: 10, y: 20 },
          actual: { x: 10, y: 19 },
          reasons: ['elbow'],
        },
      },
    });
    expect(diagnosticCalls).toHaveLength(1);
    expect(statusCalls).toHaveLength(0);
    const copy = service.diagnostics()!;
    copy.sides.L!.reasons.push('wrist');
    expect(service.diagnostics()!.sides.L!.reasons).toEqual(['elbow']);
    off();
    service.setDiagnostics(null);
    expect(diagnosticCalls).toHaveLength(1);
    expect(service.diagnostics()).toBeNull();
  });

  it('手形の結果の pointDirection は任意（無くても、null でもよい）', () => {
    const base = {
      side: 'L' as const,
      time: time(1, 1),
      candidate: { shape: 'point' as const, score: 1, palmAxis: { x: 1, y: 0 } },
      confirmed: 'point' as const,
      confirmedAt: 33,
      axisObservedAt: 33,
      validity: 'valid' as const,
    };
    const results: HandShapeResult[] = [
      base,
      { ...base, pointDirection: null },
      { ...base, pointDirection: { x: 1, y: 0 } },
    ];
    expect(results.map((r) => r.pointDirection ?? null)).toEqual([null, null, { x: 1, y: 0 }]);
  });
});
