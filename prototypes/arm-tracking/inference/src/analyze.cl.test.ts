// 実装者 CL の補助試験。合成した手・Pose の点で、照合の向きと左右を確かめる
import { describe, expect, it } from 'vitest';
import { analyzeStep, geometricShape, indexDirection } from './analyze';
import { POSE } from './protocol';
import type { RecFrame, RecHand, StepInfo } from './record';

type Finger = 'straight' | 'curled';

// 手基準の 3D 点（m）。指は dir の向きに伸び、曲げると第2関節から手のひら側へ折れる。angle で手全体を画面内で回す
function hand(fingers: [Finger, Finger, Finger, Finger], angle = 0, origin = { x: 0.5, y: 0.5 }): RecHand {
  const world: number[] = [];
  const lm: number[] = [];
  const rotate = (x: number, y: number): [number, number] => [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ];
  const push = (x: number, y: number, z: number): void => {
    const [rx, ry] = rotate(x, y);
    world.push(rx, ry, z, Number.NaN);
    // 画像座標は y が下向き。手の大きさは画像の 0.1 程度
    lm.push(origin.x + rx * 2, origin.y - ry * 2, z, Number.NaN);
  };
  push(0, 0, 0); // 手首
  for (let k = 1; k <= 4; k++) push(-0.02, 0.01 * k, 0); // 親指（判定に使わない）
  fingers.forEach((state, i) => {
    const x = -0.015 + i * 0.01;
    push(x, 0.05, 0); // MCP
    push(x, 0.08, 0); // PIP
    if (state === 'straight') {
      push(x, 0.1, 0);
      push(x, 0.12, 0);
    } else {
      push(x, 0.075, -0.02); // 手のひら側へ折れる
      push(x, 0.06, -0.025);
    }
  });
  return { sdkSide: null, sdkSideScore: null, gesture: null, gestureScore: null, lm, world };
}

describe('geometricShape', () => {
  it('4 種類を指の曲がりで見分ける', () => {
    expect(geometricShape(hand(['straight', 'straight', 'straight', 'straight']))).toBe('open');
    expect(geometricShape(hand(['curled', 'curled', 'curled', 'curled']))).toBe('fist');
    expect(geometricShape(hand(['straight', 'curled', 'curled', 'curled']))).toBe('point');
    expect(geometricShape(hand(['straight', 'straight', 'curled', 'curled']))).toBe('peace');
    expect(geometricShape(hand(['curled', 'straight', 'curled', 'straight']))).toBe('unknown');
  });

  it('横・斜めを向いた指さしも同じに判定する（画面上の上下で決めない）', () => {
    for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI / 4, Math.PI]) {
      expect(geometricShape(hand(['straight', 'curled', 'curled', 'curled'], angle))).toBe('point');
    }
  });
});

describe('indexDirection', () => {
  it('画像の縦横比を直してから角度を測る（0 = 右、90 = 上）', () => {
    const up = hand(['straight', 'curled', 'curled', 'curled']);
    expect(indexDirection(up, 640, 480)).toBeCloseTo(90);
    const side = hand(['straight', 'curled', 'curled', 'curled'], -Math.PI / 2);
    expect(indexDirection(side, 640, 480)).toBeCloseTo(0);
    // 正規化座標で 45° の線は、16:9 の画像では 45° より寝る
    const diagonal: RecHand = { ...up, lm: [...up.lm] };
    diagonal.lm[5 * 4] = 0.5;
    diagonal.lm[5 * 4 + 1] = 0.5;
    diagonal.lm[8 * 4] = 0.6;
    diagonal.lm[8 * 4 + 1] = 0.4;
    expect(indexDirection(diagonal, 1280, 720)).toBeCloseTo((Math.atan2(72, 128) * 180) / Math.PI);
  });
});

describe('analyzeStep', () => {
  // 演者の右手を上げる。未反転の映像では演者の右は画像の左に写る
  const pose = (rightWristY: number): number[] => {
    const values = new Array<number>(33 * 4).fill(0);
    const set = (i: number, x: number, y: number): void => {
      values.splice(i * 4, 4, x, y, 0, 0.9);
    };
    set(POSE.rightShoulder, 0.4, 0.5);
    set(POSE.leftShoulder, 0.6, 0.5);
    set(POSE.rightElbow, 0.35, 0.45);
    set(POSE.leftElbow, 0.65, 0.7);
    set(POSE.rightWrist, 0.35, rightWristY);
    set(POSE.leftWrist, 0.65, 0.9);
    return values;
  };
  const step: StepInfo = {
    id: 'wave-right',
    label: '',
    truth: { active: ['right'], shape: 'open' },
    start: 0,
    end: 1000,
  };

  it('Pose の左右名・SDK の手の左右名・近い Pose の手首を、案内の正解と別々に照合する', () => {
    const raised = hand(['straight', 'straight', 'straight', 'straight'], 0, { x: 0.35, y: 0.4 });
    // SDK が鏡像の前提で逆の名前を付けた場合を想定
    const frames: RecFrame[] = [0, 1, 2, 3].map((i) => ({
      t: i * 33,
      step: 'wave-right',
      face: true,
      pose: pose(0.3),
      poseWorld: null,
      hands: [{ ...raised, sdkSide: 'Left', gesture: 'Open_Palm' }],
    }));
    const result = analyzeStep(step, frames, 640, 480);
    expect(result.pose?.higherWristNamedAsTruth).toBe(1);
    expect(result.pose?.truthSideOnImageLeft).toBe(1);
    expect(result.hands?.sdkSameNameAsTruth).toBe(0);
    expect(result.truthHandRate).toBe(1);
    expect(result.otherHandRate).toBe(0);
    expect(result.followed).toBe(true);
    expect(result.sdkGestureMatch).toBe(1);
    expect(result.geometricMatch).toBe(1);
    expect(result.visibility.right.elbow).toBe(1);
  });

  it('反対の手が上に写っていても、案内の側の Pose の手首に近い手で照合し、反対の手が写ったことを数える', () => {
    const raised = hand(['straight', 'straight', 'straight', 'straight'], 0, { x: 0.35, y: 0.4 });
    // 演者の左手（画像の右）が、案内の右手より上に写っている
    const intruder = hand(['curled', 'curled', 'curled', 'curled'], 0, { x: 0.65, y: 0.2 });
    const withLeftUp = (): number[] => {
      const values = pose(0.3);
      values.splice(POSE.leftWrist * 4, 4, 0.65, 0.2, 0, 0.9);
      return values;
    };
    const frames: RecFrame[] = [0, 1, 2, 3].map((i) => ({
      t: i * 33,
      step: 'wave-right',
      face: true,
      pose: withLeftUp(),
      poseWorld: null,
      hands: [
        { ...intruder, sdkSide: 'Left', gesture: 'Closed_Fist' },
        { ...raised, sdkSide: 'Right', gesture: 'Open_Palm' },
      ],
    }));
    const result = analyzeStep(step, frames, 640, 480);
    expect(result.hands?.sdkSameNameAsTruth).toBe(1);
    expect(result.sdkGestureMatch).toBe(1);
    expect(result.truthHandRate).toBe(1);
    expect(result.otherHandRate).toBe(1);
    expect(result.followed).toBe(false); // 反対の手が写り続けた区間は精度の集計に使わない
  });

  it('推定していないフレームと見つからなかったフレームを分ける', () => {
    const frames: RecFrame[] = [
      { t: 0, step: 'wave-right', face: null, pose: [], poseWorld: null, hands: [] },
      { t: 33, step: 'wave-right', face: null, pose: pose(0.3), poseWorld: null, hands: null },
    ];
    const result = analyzeStep(step, frames, 640, 480);
    expect(result.poseRate).toBe(0.5);
    expect(result.handRate).toBe(0); // 手を推定したのは1フレームで、見つからなかった
    expect(result.faceRate).toBeNull();
  });
});
