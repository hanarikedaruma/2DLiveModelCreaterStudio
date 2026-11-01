// AT-03 の独立確認（CL）。Environment.armCalibration は PC ごとの設定として保存され、開き直しても残ること。
// 壊れた腕の校正は未校正に戻すだけで、カメラなど他の設定を失わないこと。
import { createDefaultEnvironment, type ArmCalibration } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './environment';

const calibration: ArmCalibration = {
  version: 1,
  camera: { deviceId: 'cam', width: 640, height: 480, fps: 30 },
  shoulderCenter: { x: 320, y: 300 },
  shoulderAxis: { x: 1, y: 0 },
  shoulderWidth: 160,
  arms: {
    left: { upper: 120, lower: 110, neutralWrist: { x: 420, y: 470 } },
    right: { upper: 118, lower: 112, neutralWrist: { x: 220, y: 470 } },
  },
};

describe('AT-03 独立確認: environment.json の腕の校正', () => {
  it('保存した腕の校正は、読み直しても同じ', () => {
    const saved = { ...createDefaultEnvironment(), cameraDeviceId: 'cam', armCalibration: calibration };
    const env = parseEnvironment(JSON.stringify(saved));
    expect(env.armCalibration).toEqual(calibration);
    expect(env.cameraDeviceId).toBe('cam');
  });

  it('腕の校正の無い古い environment.json は未校正として読み、他の設定は保つ', () => {
    const old = { ...createDefaultEnvironment(), cameraDeviceId: 'cam', mirror: false };
    delete (old as { armCalibration?: unknown }).armCalibration;
    const env = parseEnvironment(JSON.stringify(old));
    expect(env.armCalibration ?? null).toBeNull();
    expect(env.cameraDeviceId).toBe('cam');
    expect(env.mirror).toBe(false);
  });

  it('壊れた腕の校正は未校正に戻し、カメラ・ミラーの設定は失わない', () => {
    const broken = {
      ...createDefaultEnvironment(),
      cameraDeviceId: 'cam',
      mirror: false,
      armCalibration: { ...calibration, shoulderAxis: { x: 3, y: 0 } },
    };
    const env = parseEnvironment(JSON.stringify(broken));
    expect(env.armCalibration ?? null).toBeNull();
    expect(env.cameraDeviceId).toBe('cam');
    expect(env.mirror).toBe(false);
  });
});
