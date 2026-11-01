import { defaultArmTrackingSettings, type ArmCalibration, type ArmTrackingSettings } from '@app/schema';
import type {
  ArmCalibrationStep,
  ArmDiagnostics,
  ArmMotionStatus,
  ArmService,
  ArmServiceStatus,
  BodyTrackingCapability,
  BodyTrackingConfig,
  BodyTrackingFrame,
  BodyTrackingStatus,
} from '../arms';

export function emptyBodyTrackingStatus(): BodyTrackingStatus {
  return {
    generation: 0,
    pose: { state: 'off', delegate: null, reason: null },
    hands: { state: 'off', delegate: null, reason: null },
    poseFps: null,
    handFps: null,
    droppedFrames: 0,
    staleResults: 0,
  };
}
export function emptyArmMotionStatus(): ArmMotionStatus {
  return { state: 'off', handState: 'rest', pose: null, hand: null, reasons: [] };
}
export class FakeBodyTracking implements BodyTrackingCapability {
  private value = emptyBodyTrackingStatus();
  private frames = new Set<(f: BodyTrackingFrame) => void>();
  private listeners = new Set<() => void>();
  configure(config: BodyTrackingConfig): void {
    this.value = {
      ...emptyBodyTrackingStatus(),
      generation: this.value.generation + 1,
      pose: { state: config.enabled ? 'ready' : 'off', delegate: null, reason: '仮の認識' },
      hands: { state: config.enabled && config.hands ? 'ready' : 'off', delegate: null, reason: '仮の認識' },
    };
    for (const l of [...this.listeners]) l();
  }
  status(): BodyTrackingStatus {
    return structuredClone(this.value);
  }
  onFrame(listener: (f: BodyTrackingFrame) => void): () => void {
    this.frames.add(listener);
    return () => {
      this.frames.delete(listener);
    };
  }
  onStatus(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(frame: BodyTrackingFrame): void {
    const pose =
      this.value.pose.state === 'ready' && frame.pose?.time.generation === this.value.generation ? frame.pose : null;
    const hands =
      this.value.hands.state === 'ready' && frame.hands?.time.generation === this.value.generation ? frame.hands : null;
    if (!pose && !hands) return;
    const accepted = { image: frame.image, pose, hands } as BodyTrackingFrame;
    for (const l of [...this.frames]) l(structuredClone(accepted));
  }
}
export class FakeArmService implements ArmService {
  private listeners = new Set<() => void>();
  private result: ArmCalibration | null = null;
  private currentSettings = defaultArmTrackingSettings();
  private diagnosticValue: ArmDiagnostics | null = null;
  private diagnosticListeners = new Set<() => void>();
  private value: ArmServiceStatus = {
    available: true,
    reason: '仮の腕サービス',
    tracking: emptyBodyTrackingStatus(),
    motion: { L: emptyArmMotionStatus(), R: emptyArmMotionStatus() },
    calibration: { state: 'empty', step: null, reason: null },
    rigIssues: [],
  };
  status(): ArmServiceStatus {
    return structuredClone(this.value);
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setSettings(settings: ArmTrackingSettings): void {
    this.currentSettings = structuredClone(settings);
    this.notify();
  }
  getSettings(): ArmTrackingSettings {
    return this.settings();
  }
  settings(): ArmTrackingSettings {
    return structuredClone(this.currentSettings);
  }
  diagnostics(): ArmDiagnostics | null {
    return structuredClone(this.diagnosticValue);
  }
  onDiagnostics(listener: () => void): () => void {
    this.diagnosticListeners.add(listener);
    return () => {
      this.diagnosticListeners.delete(listener);
    };
  }
  setDiagnostics(value: ArmDiagnostics | null): void {
    this.diagnosticValue = structuredClone(value);
    for (const listener of [...this.diagnosticListeners]) listener();
  }
  async captureCalibration(step: ArmCalibrationStep): Promise<void> {
    this.value = { ...this.value, calibration: { state: 'capturing', step, reason: '仮入力の校正結果を待っている' } };
    this.notify();
  }
  clearCalibration(): void {
    this.setCalibrationResult(null);
  }
  cancelCalibration(): void {
    this.value = { ...this.value, calibration: { state: this.result ? 'ready' : 'empty', step: null, reason: null } };
    this.notify();
  }
  calibration(): ArmCalibration | null {
    return structuredClone(this.result);
  }
  setCalibrationResult(result: ArmCalibration | null): void {
    this.result = structuredClone(result);
    this.value = { ...this.value, calibration: { state: result ? 'ready' : 'empty', step: null, reason: null } };
    this.notify();
  }
  setStatus(status: ArmServiceStatus): void {
    this.value = structuredClone(status);
    this.notify();
  }
  private notify(): void {
    for (const l of [...this.listeners]) l();
  }
}
