import type { BodyTrackingFrame, HandObservation, PosePoint } from '@app/contracts';
import type { ArmCalibration } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { ASSOCIATION, createBodyAssociation } from './association';
import { ARM_PER_SHOULDER_WIDTH } from './calibration';
import { loadFixture } from './fixtures';

// 正面の演者を px で置き、画像の大きさで 0..1 に直す。未反転の映像なので、演者の右肩は画像の左
interface Body {
  rightShoulder: [number, number];
  leftShoulder: [number, number];
  rightElbow?: [number, number] | null;
  leftElbow?: [number, number] | null;
  rightWrist?: [number, number] | null;
  leftWrist?: [number, number] | null;
}
const IMAGE = { width: 640, height: 480 };
const BODY: Body = {
  rightShoulder: [220, 200],
  leftShoulder: [420, 200],
  rightElbow: [200, 300],
  leftElbow: [440, 300],
  rightWrist: [190, 390],
  leftWrist: [450, 390],
};

function pose(body: Body, image = IMAGE): PosePoint[] {
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const put = (i: number, p: [number, number] | null | undefined) => {
    if (p) points[i] = { x: p[0] / image.width, y: p[1] / image.height, z: 0, visibility: 0.95 };
  };
  put(12, body.rightShoulder);
  put(11, body.leftShoulder);
  put(14, body.rightElbow);
  put(13, body.leftElbow);
  put(16, body.rightWrist);
  put(15, body.leftWrist);
  return points;
}
function hand(wrist: [number, number], side: 'left' | 'right' | null = null, image = IMAGE): HandObservation {
  const landmarks = Array.from({ length: 21 }, (_, i) => ({
    x: (wrist[0] + (i ? 5 : 0)) / image.width,
    y: (wrist[1] - i * 3) / image.height,
    z: 0,
  }));
  return { landmarks, worldLandmarks: [], handedness: side ? { side, score: 0.9 } : null, gesture: null };
}
const time = (capturedAt: number, generation = 1, frameId = 1) => ({
  generation,
  frameId,
  capturedAt,
  captureSource: 'captureTime' as const,
  completedAt: capturedAt + 10,
  receivedAt: capturedAt + 12,
});
function frame(
  at: number,
  body: Body | null,
  hands: HandObservation[] | null,
  image = IMAGE,
  generation = 1,
): BodyTrackingFrame {
  const p = body ? { time: time(at, generation), value: { landmarks: pose(body, image), worldLandmarks: [] } } : null;
  const h = hands ? { time: time(at, generation), value: hands } : null;
  return (p ? { image, pose: p, hands: h } : { image, pose: null, hands: h! }) as BodyTrackingFrame;
}
const armLength = 200 * ARM_PER_SHOULDER_WIDTH; // 未校正の目安（肩幅200px）

describe('観測の正規化', () => {
  it('肩を原点に外向き +x・下向き +y、腕の長さを1にする。ミラー ON は演者の右腕→モデル L', () => {
    const a = createBodyAssociation({ mirror: true });
    const out = a.update(frame(0, BODY, null));
    const left = out.arms.L!; // 演者の右腕
    expect(left.actorSide).toBe('right');
    expect(left.validity).toBe('valid');
    // 右肩 (220,200) から手首 (190,390)：外向き（画像の左）へ30px、下へ190px
    expect(left.wrist.position!.x).toBeCloseTo(30 / armLength);
    expect(left.wrist.position!.y).toBeCloseTo(190 / armLength);
    expect(out.arms.R!.actorSide).toBe('left');
    expect(out.arms.R!.wrist.position!.x).toBeCloseTo(30 / armLength); // 左腕も外向きが正
  });

  it('ミラー OFF は演者の右腕→モデル R。向き（外・下）は同じ', () => {
    const a = createBodyAssociation({ mirror: false });
    const out = a.update(frame(0, BODY, null));
    expect(out.arms.R!.actorSide).toBe('right');
    expect(out.arms.R!.wrist.position!.x).toBeCloseTo(30 / armLength);
  });

  it('縦横比の違う映像でも、同じ体の位置なら同じ値（0..1 の座標をそのまま角度に使わない）', () => {
    const wide = { width: 1280, height: 720 };
    const a = createBodyAssociation().update(frame(0, BODY, null));
    const b = createBodyAssociation().update(frame(0, BODY, null, wide));
    expect(b.arms.L!.wrist.position!.x).toBeCloseTo(a.arms.L!.wrist.position!.x);
    expect(b.arms.L!.wrist.position!.y).toBeCloseTo(a.arms.L!.wrist.position!.y);
  });

  it('肩の線が傾いても、肩の線に対する向きで測る', () => {
    // 体を 30° 傾けた（肩の線の向き (cos30°, sin30°)）とき、腕を体の真下（肩の線と直角）へ200px下ろした状態
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const tilted: Body = {
      rightShoulder: [220, 200],
      leftShoulder: [220 + 200 * c, 200 + 200 * s],
      rightElbow: null,
      leftElbow: null,
      rightWrist: [220 - 200 * s, 200 + 200 * c],
      leftWrist: null,
    };
    const out = createBodyAssociation().update(frame(0, tilted, null));
    expect(out.arms.L!.wrist.position!.x).toBeCloseTo(0);
    expect(out.arms.L!.wrist.position!.y).toBeCloseTo(200 / armLength);
  });

  it('校正があれば演者の腕の長さで割り、解像度の違いは比で直す', () => {
    const calibration: ArmCalibration = {
      version: 1,
      camera: { deviceId: null, width: 320, height: 240, fps: 30 },
      shoulderCenter: { x: 160, y: 100 },
      shoulderAxis: { x: 1, y: 0 },
      shoulderWidth: 100,
      arms: {
        left: { upper: 60, lower: 50, neutralWrist: { x: 220, y: 210 } },
        right: { upper: 50, lower: 45, neutralWrist: { x: 100, y: 210 } },
      },
    };
    const out = createBodyAssociation({ calibration }).update(frame(0, BODY, null));
    expect(out.arms.L!.wrist.position!.y).toBeCloseTo(190 / ((50 + 45) * 2)); // 演者の右腕、640/320 = 2倍
    expect(out.arms.R!.wrist.position!.y).toBeCloseTo(190 / ((60 + 50) * 2));
  });

  it('肘が見えなければ inferred、手首が見えなければ missing。人が見つからなければ両腕 missing', () => {
    const a = createBodyAssociation();
    const out = a.update(frame(0, { ...BODY, rightElbow: null, leftWrist: null }, null));
    expect(out.arms.L!.validity).toBe('inferred');
    expect(out.arms.L!.elbow.position).toBeNull();
    expect(out.arms.R!.validity).toBe('missing');
    const none = a.update({
      image: IMAGE,
      pose: { time: time(33), value: { landmarks: [], worldLandmarks: [] } },
      hands: null,
    });
    expect([none.arms.L!.validity, none.arms.R!.validity]).toEqual(['missing', 'missing']);
  });

  it('肩を一瞬見失っても 200ms までは最後の肩の基準で続け、その後は missing', () => {
    const a = createBodyAssociation();
    a.update(frame(0, BODY, null));
    const noShoulder = { ...BODY, rightShoulder: [-1000, -1000] as [number, number] };
    expect(a.update(frame(150, noShoulder, null)).arms.L!.validity).toBe('valid');
    expect(a.update(frame(260, noShoulder, null)).arms.L!.validity).toBe('missing');
  });

  it('手首の飛び（50ms で腕の長さ×1.5 超）は使わない', () => {
    const a = createBodyAssociation();
    a.update(frame(0, BODY, null));
    const out = a.update(frame(33, { ...BODY, rightWrist: [600, 20] }, null));
    expect(out.arms.L!.wrist.validity).toBe('missing');
    expect(a.diagnostics().reasons.L).toBe('手首の位置が飛んだ');
  });

  it('肩の中心が一度に大きく動いたら別の人への乗り換えを疑い、安定してから受け入れる', () => {
    const a = createBodyAssociation();
    a.update(frame(0, BODY, null));
    const moved: Body = {
      rightShoulder: [420, 200],
      leftShoulder: [600, 200],
      rightWrist: [400, 390],
      leftWrist: [620, 390],
    };
    expect(a.update(frame(33, moved, null)).arms.L!.validity).toBe('ambiguous');
    expect(a.update(frame(66, moved, null)).arms.L!.validity).toBe('ambiguous');
    expect(a.update(frame(140, moved, null)).arms.L!.validity).not.toBe('ambiguous');
  });
});

describe('手の対応付け', () => {
  it('Pose の手首に近い側へ割り当て、検出の配列の順を入れ替えても同じ', () => {
    const a = createBodyAssociation();
    const r = hand([190, 390]);
    const l = hand([450, 390]);
    const out1 = a.update(frame(0, BODY, [r, l]));
    const out2 = createBodyAssociation().update(frame(0, BODY, [l, r]));
    expect(out1.hands.L!.validity).toBe('valid'); // 演者の右手 → モデル L
    expect(out1.hands.L!.landmarks[0]!.x).toBeCloseTo(30 / armLength);
    expect(out2.hands.L!.landmarks).toEqual(out1.hands.L!.landmarks);
    expect(out2.hands.R!.landmarks).toEqual(out1.hands.R!.landmarks);
  });

  it('SDK の左右候補が逆でも、位置で割り当てる', () => {
    const out = createBodyAssociation().update(frame(0, BODY, [hand([190, 390], 'left')]));
    expect(out.hands.L!.validity).toBe('valid'); // 演者の右手
    expect(out.hands.R!.validity).toBe('missing');
  });

  it('どちらの手首からも遠い手（別の人の手など）は割り当てない', () => {
    const out = createBodyAssociation().update(frame(0, BODY, [hand([190, 390]), hand([620, 60])]));
    expect(out.hands.L!.validity).toBe('valid');
    expect(out.hands.R!.validity).toBe('missing');
  });

  it('両手首が重なる・交差して入れ替えても同じくらいのときは、所属を確定しない', () => {
    const together: Body = { ...BODY, rightWrist: [318, 300], leftWrist: [322, 300] };
    const out = createBodyAssociation().update(frame(0, together, [hand([318, 300]), hand([322, 300])]));
    expect(out.hands.L!.validity).toBe('ambiguous');
    expect(out.hands.R!.validity).toBe('ambiguous');
    expect(out.hands.L!.landmarks).toEqual([]);
  });

  it('同じ手を両方の側へは割り当てない', () => {
    const near: Body = { ...BODY, rightWrist: [300, 300], leftWrist: [340, 300] };
    const out = createBodyAssociation().update(frame(0, near, [hand([320, 300])]));
    const valid = [out.hands.L, out.hands.R].filter((h) => h!.validity === 'valid');
    expect(valid.length).toBeLessThanOrEqual(1);
  });

  it('同じ頃（80ms 以内）の Pose が無い手は所属を決めない', () => {
    const a = createBodyAssociation();
    a.update(frame(0, BODY, null));
    const out = a.update(frame(ASSOCIATION.poseHandMaxGapMs + 20, null, [hand([190, 390])]));
    expect(out.hands.L!.validity).toBe('ambiguous');
    expect(out.arms).toEqual({}); // Pose の更新は無い
  });

  it('手が見つからない通知は両側 missing。手だけの通知は同じ頃の Pose で正規化する', () => {
    const a = createBodyAssociation();
    a.update(frame(0, BODY, null));
    const none = a.update(frame(30, null, []));
    expect([none.hands.L!.validity, none.hands.R!.validity]).toEqual(['missing', 'missing']);
    const one = a.update(frame(40, null, [hand([450, 390])]));
    expect(one.hands.R!.validity).toBe('valid'); // 演者の左手 → モデル R
  });
});

describe('世代とリセット', () => {
  it('reset の後は古い世代の通知を受け付けず、新しい世代では前の連続性を持ち込まない', () => {
    const a = createBodyAssociation();
    a.reset(5);
    expect(a.update(frame(0, BODY, null, IMAGE, 4))).toEqual({ generation: 5, arms: {}, hands: {} });
    expect(a.update(frame(0, BODY, null, IMAGE, 5)).arms.L!.validity).toBe('valid');
    // 世代 6 では前の手首の記憶が無いので、大きく離れた位置でも飛びと見なさない
    expect(a.update(frame(10, { ...BODY, rightWrist: [600, 20] }, null, IMAGE, 6)).arms.L!.wrist.validity).toBe(
      'valid',
    );
  });

  it('ミラーを変えると左右の割当が入れ替わる', () => {
    const a = createBodyAssociation({ mirror: true });
    expect(a.update(frame(0, BODY, null)).arms.L!.actorSide).toBe('right');
    a.configure({ mirror: false, calibration: null });
    expect(a.update(frame(33, BODY, null)).arms.L!.actorSide).toBe('left');
  });
});

// 2026-11-01 追加（AT-05 CL v2）：新しい世代の後に遅れて届いた古い世代の通知は使わない（AT-09 でCOの独立試験が見つけた同じ種類の問題）
describe('世代の後戻り', () => {
  it('新しい世代を受け取った後の、古い世代の通知は何も更新しない', () => {
    const a = createBodyAssociation({ mirror: true });
    const frames = loadFixture('at01-wave.json', 2).filter((f) => f.frame.pose);
    a.update(frames[0]!.frame);
    const old = loadFixture('at01-wave.json', 1).filter((f) => f.frame.pose)[1]!.frame;
    expect(a.update(old)).toEqual({ generation: 2, arms: {}, hands: {} });
  });
});
