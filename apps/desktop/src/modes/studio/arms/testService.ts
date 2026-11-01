// 試験だけが使う。FakeArmService（AT-03）を包み、画面が要る3つ（設定の読み出し・校正の取り消し・診断）と、
// 校正の各手順の終わり方を試験から決める仕組みを足す
import { FakeArmService, type ArmCalibrationStep, type ArmServiceStatus } from '@app/contracts';
import type { ArmCalibration, ArmTrackingSettings } from '@app/schema';
import { BODY_PARTS, type BodyPart } from './points';
import type { ArmDiagnostics, DiagnosticPoint, StudioArmService } from './service';

export const SAMPLE_CALIBRATION: ArmCalibration = {
  version: 1,
  camera: { deviceId: 'cam', width: 640, height: 480, fps: 30 },
  shoulderCenter: { x: 320, y: 230 },
  shoulderAxis: { x: 1, y: 0 },
  shoulderWidth: 128,
  arms: {
    left: { upper: 75, lower: 70, neutralWrist: { x: 400, y: 440 } },
    right: { upper: 75, lower: 70, neutralWrist: { x: 240, y: 440 } },
  },
};

// 未反転の画像の点。演者の右は画像の左
const POSITIONS: Record<BodyPart, [number, number]> = {
  rightShoulder: [0.4, 0.48],
  leftShoulder: [0.6, 0.48],
  rightElbow: [0.35, 0.66],
  leftElbow: [0.65, 0.66],
  rightWrist: [0.33, 0.85],
  leftWrist: [0.7, 0.3],
};
export function sampleDiagnostics(visible: readonly BodyPart[] = BODY_PARTS, time = performance.now()): ArmDiagnostics {
  const p = (part: BodyPart): DiagnosticPoint => ({
    x: POSITIONS[part][0],
    y: POSITIONS[part][1],
    visibility: visible.includes(part) ? 0.95 : 0.2,
  });
  return {
    time,
    image: { width: 640, height: 480 },
    pose: {
      left: { shoulder: p('leftShoulder'), elbow: p('leftElbow'), wrist: p('leftWrist') },
      right: { shoulder: p('rightShoulder'), elbow: p('rightElbow'), wrist: p('rightWrist') },
    },
    hands: [{ x: 0.7, y: 0.3 }],
    sides: {
      L: {
        actorSide: 'right',
        validity: 'valid',
        elbow: { x: 0.25, y: 0.4 },
        wrist: { x: 0.1, y: 0.9 },
        target: { x: 14, y: 128 },
        actual: { x: 14, y: 125 },
        reasons: ['elbow'],
      },
    },
  };
}

type Ending = 'ok' | { invalid: string } | Error;

// FakeArmService は設定を private の settings に持つので、継がずに包む（settings() と名前がぶつかる）
export class TestArmService implements StudioArmService {
  readonly fake = new FakeArmService();
  readonly captures: ArmCalibrationStep[] = [];
  cancels = 0;
  private pending: ((ending: Ending) => void) | null = null;
  private current: ArmDiagnostics | null = null;
  private diagnosticListeners = new Set<() => void>();

  status() {
    return this.fake.status();
  }
  subscribe(listener: () => void) {
    return this.fake.subscribe(listener);
  }
  setSettings(settings: ArmTrackingSettings) {
    this.fake.setSettings(settings);
  }
  settings() {
    return this.fake.getSettings();
  }
  calibration() {
    return this.fake.calibration();
  }
  clearCalibration() {
    this.fake.clearCalibration();
  }
  setCalibrationResult(result: ArmCalibration | null) {
    this.fake.setCalibrationResult(result);
  }
  setStatus(status: ArmServiceStatus) {
    this.fake.setStatus(status);
  }
  captureCalibration(step: ArmCalibrationStep): Promise<void> {
    this.captures.push(step);
    // finish() がすぐ呼べるように、待ちは同期で用意する
    const ending = new Promise<Ending>((resolve) => (this.pending = resolve));
    void this.fake.captureCalibration(step);
    return ending.then((end) => {
      if (end instanceof Error) throw end;
      const status = this.status();
      if (end !== 'ok') this.setStatus({ ...status, calibration: { state: 'invalid', step, reason: end.invalid } });
      else if (step === 'right') this.setCalibrationResult(SAMPLE_CALIBRATION);
    });
  }
  // 集めている手順を終わらせる
  async finish(ending: Ending = 'ok'): Promise<void> {
    const resolve = this.pending;
    this.pending = null;
    resolve?.(ending);
    await Promise.resolve();
    await Promise.resolve();
  }
  cancelCalibration(): void {
    this.cancels++;
    const status = this.status();
    this.setStatus({
      ...status,
      calibration: { state: this.calibration() ? 'ready' : 'empty', step: null, reason: null },
    });
  }
  diagnostics() {
    return this.current;
  }
  onDiagnostics(listener: () => void) {
    this.diagnosticListeners.add(listener);
    return () => {
      this.diagnosticListeners.delete(listener);
    };
  }
  emitDiagnostics(next: ArmDiagnostics | null): void {
    this.current = next;
    for (const l of [...this.diagnosticListeners]) l();
  }
  diagnosticListenerCount(): number {
    return this.diagnosticListeners.size;
  }
}
