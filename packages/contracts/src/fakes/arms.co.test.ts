import { expect, it, vi } from 'vitest';
import { defaultArmTrackingSettings } from '@app/schema';
import { FakeArmService, FakeBodyTracking } from './arms';
import { FakeTrackingSource } from './tracking';
import type { BodyTrackingFrame } from '../arms';

it('腕は追加能力で、既存の顔だけのsourceを変更しない', () => {
  expect('body' in new FakeTrackingSource()).toBe(false);
});
it('仮の腕通知でもOFF・古い世代・購読解除を守り、顔通知を作らない', () => {
  const body = new FakeBodyTracking();
  const listener = vi.fn();
  const off = body.onFrame(listener);
  const frame: BodyTrackingFrame = {
    image: { width: 640, height: 480 },
    pose: {
      time: { generation: 0, frameId: 1, capturedAt: 1, captureSource: 'captureTime', completedAt: 10, receivedAt: 11 },
      value: { landmarks: [], worldLandmarks: [] },
    },
    hands: null,
  };
  body.emit(frame);
  expect(listener).not.toHaveBeenCalled();
  body.configure({ enabled: true, mode: 'normal', hands: false });
  body.emit(frame);
  expect(listener).not.toHaveBeenCalled();
  frame.pose!.time.generation = body.status().generation;
  body.emit(frame);
  expect(listener).toHaveBeenCalledTimes(1);
  off();
  body.emit(frame);
  expect(listener).toHaveBeenCalledTimes(1);
});
it('仮の校正を観測無しで成功扱いにせず、設定をコピーする', async () => {
  const service = new FakeArmService();
  const listener = vi.fn();
  const off = service.subscribe(listener);
  const settings = defaultArmTrackingSettings();
  service.setSettings(settings);
  settings.sides.L.enabled = true;
  expect(service.getSettings().sides.L.enabled).toBe(false);
  await service.captureCalibration('left');
  expect(service.status().calibration.state).toBe('capturing');
  expect(service.calibration()).toBeNull();
  off();
  const n = listener.mock.calls.length;
  service.clearCalibration();
  expect(listener).toHaveBeenCalledTimes(n);
});

it('診断の購読を状態通知から分離し、呼び出し側の変更と購読解除を守る', () => {
  const service = new FakeArmService(),
    diagnostics = vi.fn(),
    status = vi.fn();
  const off = service.onDiagnostics(diagnostics);
  service.subscribe(status);
  service.setDiagnostics({ time: 100, image: { width: 640, height: 480 }, pose: null, hands: [], sides: {} });
  expect(diagnostics).toHaveBeenCalledTimes(1);
  expect(status).not.toHaveBeenCalled();
  service.diagnostics()!.time = 999;
  expect(service.diagnostics()!.time).toBe(100);
  off();
  service.setDiagnostics(null);
  expect(diagnostics).toHaveBeenCalledTimes(1);
});

it('校正を取り消しても前の校正は残し、未校正に戻す操作と分ける', async () => {
  const service = new FakeArmService();
  const prior = {
    version: 1 as const,
    camera: { deviceId: 'c', width: 640, height: 480, fps: 25 },
    shoulderCenter: { x: 320, y: 200 },
    shoulderAxis: { x: 1, y: 0 },
    shoulderWidth: 100,
    arms: {
      left: { upper: 100, lower: 90, neutralWrist: { x: 200, y: 300 } },
      right: { upper: 100, lower: 90, neutralWrist: { x: 400, y: 300 } },
    },
  };
  service.setCalibrationResult(prior);
  await service.captureCalibration('neutral');
  service.cancelCalibration();
  expect(service.calibration()).toEqual(prior);
  expect(service.status().calibration.state).toBe('ready');
  service.clearCalibration();
  expect(service.calibration()).toBeNull();
});
