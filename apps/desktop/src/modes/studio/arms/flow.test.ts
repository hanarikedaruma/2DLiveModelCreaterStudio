import { describe, expect, it } from 'vitest';
import {
  ARM_CALIBRATION_STEPS,
  ARM_COUNTDOWN_FROM,
  createArmCalibrationFlow,
  NO_RESULT_MESSAGE,
  type ScheduleFn,
} from './flow';
import { sampleDiagnostics, SAMPLE_CALIBRATION, TestArmService } from './testService';

// 時間を手で進める予定表
function manualSchedule() {
  let jobs: { cb: () => void; cancelled: boolean }[] = [];
  const schedule: ScheduleFn = (cb) => {
    const job = { cb, cancelled: false };
    jobs.push(job);
    return () => {
      job.cancelled = true;
    };
  };
  const tick = () => {
    const now = jobs;
    jobs = [];
    for (const j of now) if (!j.cancelled) j.cb();
  };
  return { schedule, tick, pending: () => jobs.filter((j) => !j.cancelled).length };
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function setup() {
  const time = manualSchedule();
  const flow = createArmCalibrationFlow(time.schedule);
  const service = new TestArmService();
  const countdown = () => {
    for (let i = 0; i < ARM_COUNTDOWN_FROM; i++) time.tick();
  };
  return { time, flow, service, countdown };
}

describe('腕の校正の流れ', () => {
  it('要る点が写るまで数え始めず、写ったら 3・2・1 のあと手順を集める', async () => {
    const { flow, service, countdown } = setup();
    flow.start(service);
    expect(flow.state()).toMatchObject({ kind: 'waiting', step: 0, noPoints: true });
    service.emitDiagnostics(sampleDiagnostics(['leftShoulder']));
    expect(flow.state()).toEqual({ kind: 'waiting', step: 0, missing: ['rightShoulder'], noPoints: false });
    service.emitDiagnostics(sampleDiagnostics());
    expect(flow.state()).toEqual({ kind: 'countdown', step: 0, count: ARM_COUNTDOWN_FROM });
    countdown();
    expect(flow.state()).toEqual({ kind: 'capturing', step: 0 });
    expect(service.captures).toEqual(['neutral']);
  });

  it('肘を曲げる手順は両肘・両手首、手を上げる手順はその側の手首が要る', async () => {
    const { flow, service, countdown } = setup();
    service.emitDiagnostics(sampleDiagnostics(['leftShoulder', 'rightShoulder', 'leftWrist']));
    flow.start(service);
    countdown();
    await service.finish();
    await flush();
    expect(flow.state()).toEqual({
      kind: 'waiting',
      step: 1,
      missing: ['leftElbow', 'rightElbow', 'rightWrist'],
      noPoints: false,
    });
    service.emitDiagnostics(sampleDiagnostics());
    countdown();
    await service.finish();
    await flush();
    // 左手を上げる：左手首は写っている
    expect(flow.state()).toMatchObject({ kind: 'countdown', step: 2 });
    countdown();
    service.emitDiagnostics(sampleDiagnostics(['leftShoulder', 'rightShoulder', 'leftWrist']));
    await service.finish();
    await flush();
    // 右手を上げる：右手首が写るまで待つ
    expect(flow.state()).toEqual({ kind: 'waiting', step: 3, missing: ['rightWrist'], noPoints: false });
    countdown();
    expect(service.captures).toEqual(['neutral', 'bend', 'left']);
  });

  it('4手順を終えると手形を試す画面になり、追従中に認識した形に印を付ける', async () => {
    const { flow, service, countdown } = setup();
    service.emitDiagnostics(sampleDiagnostics());
    flow.start(service);
    for (const _ of ARM_CALIBRATION_STEPS) {
      countdown();
      await service.finish();
      await flush();
    }
    expect(service.captures).toEqual(['neutral', 'bend', 'left', 'right']);
    expect(flow.state()).toEqual({ kind: 'shapes', seen: { L: [], R: [] } });
    const status = service.status();
    const motion = (hand: 'open' | 'fist', handState: 'tracking' | 'fixed' = 'tracking') => ({
      state: 'tracking' as const,
      handState,
      pose: null,
      hand,
      reasons: [],
    });
    service.setStatus({ ...status, motion: { L: motion('open'), R: motion('fist', 'fixed') } });
    service.setStatus({ ...status, motion: { L: motion('fist'), R: motion('fist', 'fixed') } });
    expect(flow.state()).toEqual({ kind: 'shapes', seen: { L: ['open', 'fist'], R: [] } });
    expect(flow.active()).toBe(false);
    flow.cancel();
    expect(flow.state()).toEqual({ kind: 'idle' });
    expect(service.cancels).toBe(0); // 保存した校正は取り消さない
  });

  it('サービスが失敗を返したら理由を出し、その手順だけやり直せる', async () => {
    const { flow, service, countdown } = setup();
    service.emitDiagnostics(sampleDiagnostics());
    flow.start(service);
    countdown();
    await service.finish();
    await flush();
    countdown();
    await service.finish({ invalid: '右肘が写っていないフレームが多い' });
    await flush();
    expect(flow.state()).toEqual({ kind: 'failed', step: 1, message: '右肘が写っていないフレームが多い' });
    flow.retry();
    expect(flow.state()).toMatchObject({ kind: 'countdown', step: 1 });
    countdown();
    await service.finish(new Error('集められなかった'));
    await flush();
    expect(flow.state()).toEqual({ kind: 'failed', step: 1, message: '集められなかった' });
    expect(service.captures).toEqual(['neutral', 'bend', 'bend']);
  });

  it('最後の手順の後に校正が無ければ失敗にする', async () => {
    const { flow, service, countdown } = setup();
    service.emitDiagnostics(sampleDiagnostics());
    flow.start(service);
    for (let i = 0; i < 3; i++) {
      countdown();
      await service.finish();
      await flush();
    }
    // 右手の手順をサービスは成功で返したが、結果を作れなかった
    service.captureCalibration = async (step) => {
      service.captures.push(step);
    };
    countdown();
    await flush();
    expect(flow.state()).toEqual({ kind: 'failed', step: 3, message: NO_RESULT_MESSAGE });
  });

  it('キャンセルはサービスの途中の記録を捨て、遅れて終わった手順の結果を使わない。前の校正は残る', async () => {
    const { flow, service, countdown, time } = setup();
    service.setCalibrationResult(SAMPLE_CALIBRATION);
    service.emitDiagnostics(sampleDiagnostics());
    flow.start(service);
    countdown();
    expect(flow.state()).toMatchObject({ kind: 'capturing', step: 0 });
    flow.cancel();
    expect(service.cancels).toBe(1);
    expect(flow.state()).toEqual({ kind: 'idle' });
    await service.finish();
    await flush();
    expect(flow.state()).toEqual({ kind: 'idle' });
    expect(service.calibration()).toEqual(SAMPLE_CALIBRATION);
    expect(service.diagnosticListenerCount()).toBe(0);
    expect(time.pending()).toBe(0);
  });

  it('数えている間のキャンセルは数えるのをやめ、もう一度始めると最初の手順から', async () => {
    const { flow, service, time } = setup();
    service.emitDiagnostics(sampleDiagnostics());
    flow.start(service);
    time.tick();
    flow.cancel();
    expect(time.pending()).toBe(0);
    flow.start(service);
    expect(flow.state()).toEqual({ kind: 'countdown', step: 0, count: ARM_COUNTDOWN_FROM });
    expect(service.captures).toEqual([]);
  });
});
