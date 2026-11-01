import { describe, expect, it } from 'vitest';
import { emptyArmMotionStatus, emptyBodyTrackingStatus, type ArmServiceStatus } from '@app/contracts';
import { defaultArmTrackingSettings, type ArmRig, type ArmTrackingSettings } from '@app/schema';
import { armReadiness, type ReadinessInput } from './readiness';
import { SAMPLE_CALIBRATION } from './testService';

function status(patch: Partial<ArmServiceStatus> = {}): ArmServiceStatus {
  return {
    available: true,
    reason: null,
    tracking: {
      ...emptyBodyTrackingStatus(),
      pose: { state: 'ready', delegate: 'GPU', reason: null },
      hands: { state: 'ready', delegate: 'GPU', reason: null },
    },
    motion: { L: emptyArmMotionStatus(), R: emptyArmMotionStatus() },
    calibration: { state: 'ready', step: null, reason: null },
    rigIssues: [],
    ...patch,
  };
}
function settings(sides: ('L' | 'R')[]): ArmTrackingSettings {
  const s = defaultArmTrackingSettings();
  for (const side of sides) s.sides[side].enabled = true;
  return s;
}
const rig = (side: 'L' | 'R', enabled = true) => ({ side, enabled }) as ArmRig;
const input = (patch: Partial<ReadinessInput> = {}): ReadinessInput => ({
  status: status(),
  settings: settings(['L', 'R']),
  calibration: SAMPLE_CALIBRATION,
  rigs: [rig('L'), rig('R')],
  camera: { deviceId: 'cam', width: 640, height: 480 },
  faceMappingOff: false,
  ...patch,
});
const ids = (p: Partial<ReadinessInput>) => armReadiness(input(p)).map((i) => `${i.level}:${i.id}`);

describe('腕の準備が足りない項目', () => {
  it('全てそろえば何も出さない', () => {
    expect(armReadiness(input())).toEqual([]);
  });

  it('どちらの腕も入れていなければ、使えない理由だけ出す', () => {
    expect(ids({ settings: settings([]), calibration: null, rigs: [] })).toEqual([]);
    expect(
      armReadiness(
        input({ settings: settings([]), status: status({ available: false, reason: 'Worker を作れない' }) }),
      ),
    ).toEqual([{ id: 'unavailable', level: 'block', text: '腕の認識を使えない（Worker を作れない）' }]);
  });

  it('入れた側だけ、リグの不足・無効・問題を具体的に出す（1つ直すと次が見える、にしない）', () => {
    const items = armReadiness(
      input({
        rigs: [rig('L', false)],
        status: status({
          rigIssues: [
            {
              rigId: 'l',
              side: 'L',
              code: 'hand-missing',
              path: 'x',
              message: 'ピースの手の絵が無い',
              severity: 'warning',
            },
          ],
        }),
      }),
    );
    expect(items.map((i) => [i.level, i.text])).toEqual([
      ['block', '左腕：モデルの腕の設定が無効になっている'],
      ['advice', '左腕：ピースの手の絵が無い'],
      ['block', '右腕：モデルに腕の設定が無い（モデリングの「腕の設定」で作る）'],
    ]);
    const errors = armReadiness(
      input({
        rigs: [rig('L', false), rig('R')],
        settings: settings(['L']),
        status: status({
          rigIssues: [
            { rigId: 'l', side: 'L', code: 'length', path: 'x', message: '上腕の長さが0', severity: 'error' },
            { rigId: 'r', side: 'R', code: 'length', path: 'x', message: '反対側', severity: 'error' },
          ],
        }),
      }),
    );
    expect(errors.map((i) => i.text)).toEqual(['左腕：上腕の長さが0']);
  });

  it('カメラ・認識の状態', () => {
    const tracking = (pose: string, hands = 'ready') =>
      status({
        tracking: {
          ...emptyBodyTrackingStatus(),
          pose: { state: pose as 'off', delegate: null, reason: pose === 'error' ? 'GPUが無い' : null },
          hands: { state: hands as 'off', delegate: null, reason: null },
        },
      });
    expect(ids({ status: tracking('off', 'off') })).toEqual(['advice:camera']);
    expect(ids({ status: tracking('loading') })).toEqual(['advice:loading']);
    expect(armReadiness(input({ status: tracking('error') }))[0]).toMatchObject({
      level: 'block',
      text: '腕の認識を使えない（GPUが無い）',
    });
    expect(ids({ status: tracking('ready', 'off') })).toEqual(['advice:hands']);
    expect(ids({ status: tracking('ready', 'error') })).toEqual(['advice:hands']);
  });

  it('校正していない・失敗した・カメラが違うときは校正を勧め、解像度だけの違いは知らせるだけ', () => {
    expect(armReadiness(input({ calibration: null }))).toEqual([
      expect.objectContaining({ id: 'calibration', level: 'advice', action: 'calibrate' }),
    ]);
    expect(ids({ status: status({ calibration: { state: 'invalid', step: 'bend', reason: '肘が無い' } }) })).toEqual([
      'advice:calibration-invalid',
    ]);
    const other = armReadiness(input({ camera: { deviceId: 'other', width: 640, height: 480 } }));
    expect(other).toEqual([
      expect.objectContaining({
        level: 'advice',
        action: 'calibrate',
        text: 'カメラが校正のときと違う（カメラが変わった）',
      }),
    ]);
    const resolution = armReadiness(input({ camera: { deviceId: 'cam', width: 1280, height: 960 } }));
    expect(resolution).toEqual([expect.objectContaining({ level: 'note', action: undefined })]);
    expect(ids({ camera: null })).toEqual([]); // カメラを開始していなければ比べない
  });

  it('顔の割り当てが無効でも腕は動くことを知らせる', () => {
    expect(ids({ faceMappingOff: true })).toEqual(['note:face-off']);
    expect(ids({ faceMappingOff: true, settings: settings([]) })).toEqual([]);
  });
});
