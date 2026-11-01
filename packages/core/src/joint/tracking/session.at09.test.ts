// COの独立確認。実装者の仮IKを使わずAT-06の実際の解を注入し、時刻と状態の期待値を確認する。
import { expect, it } from 'vitest';
import { armPoseAllowed, defaultArmTrackingSettings, type ArmPose } from '@app/schema';
import { solveArmIK, constrainArmPose } from '../math';
import { createArmMotionSession } from './session';
import { frame, observation, shapeResult, testModel, testRig } from './testing';

const pose: ArmPose = { shoulder: 65, elbow: 40, wrist: 0 };
function setup() {
  const settings = defaultArmTrackingSettings();
  settings.sides.L.enabled = true;
  settings.sides.R.enabled = true;
  const session = createArmMotionSession({ solveIK: solveArmIK, constrain: constrainArmPose });
  session.configure(testModel(), settings);
  return session;
}
it('実IKで両腕を追従し、片側を見失っても反対側と手形は継続する', () => {
  const session = setup();
  for (let t = 0; t <= 1500; t += 1000 / 60) {
    const arms = { ...(t <= 600 ? { L: observation('L', pose, t) } : {}), R: observation('R', pose, t) };
    session.update({ body: frame(arms), shapes: { R: shapeResult('R', t, 'peace') } });
    session.tick(t + 30);
  }
  expect(session.status().L.state).toBe('rest');
  expect(session.status().R.state).toBe('tracking');
  expect(session.status().R.hand).toBe('peace');
  for (const side of ['L', 'R'] as const)
    expect(armPoseAllowed(testRig(side), session.status()[side].pose!)).toBe(true);
});
it('古い再通知で保持を延長せず、現実のIKでも休止へ戻る', () => {
  const s = setup();
  for (let t = 0; t <= 500; t += 20) {
    s.update({ body: frame({ L: observation('L', pose, t) }), shapes: {} });
    s.tick(t);
  }
  const last = observation('L', pose, 500);
  for (let t = 520; t <= 1400; t += 20) {
    s.update({ body: frame({ L: last }), shapes: {} });
    s.tick(t);
  }
  expect(s.status().L.state).toBe('rest');
  expect(s.status().L.pose!.shoulder).toBeCloseTo(testRig('L').restPose.shoulder, 1);
});
it('表示中のアニメーション姿勢を始点にresetし、古い世代を使わない', () => {
  const s = setup();
  s.tick(1000);
  s.reset(4, { ArmShoulderL: 90, ArmElbowL: 40, HandAngleL: 10 });
  s.tick(1000);
  expect(s.status().L.pose!.shoulder).toBe(90);
  const before = s.status().L.pose!;
  s.update({ body: frame({ L: observation('L', pose, 1000, { generation: 1 }) }, 1), shapes: {} });
  s.tick(1001);
  expect(Math.abs(s.status().L.pose!.shoulder - before.shoulder)).toBeLessThan(0.1);
});

it('明示reset無しでも、新世代の観測後に旧世代へ戻らない', () => {
  const s = setup();
  s.update({ body: frame({ R: observation('R', pose, 200, { generation: 4 }) }, 4), shapes: {} });
  s.tick(200);
  // 旧世代で撮影した0/110msの左腕が、撮影200msの新世代の右腕より遅れて届く。
  for (const t of [0, 110])
    s.update({ body: frame({ L: observation('L', pose, t, { generation: 3 }) }, 3), shapes: {} });
  s.tick(230);
  s.tick(250);
  expect(s.status().L.state).toBe('rest');
});
