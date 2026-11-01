import { describe, expect, it } from 'vitest';
import { HAND_SHAPES } from '@app/schema';
import { classifyHand } from './classifier';
import { fingerFeatures, indexDirection, palmAxis } from './features';
import { sampleTime, syntheticHand, type SyntheticHand } from './synthetic';

const hand = (options: Omit<SyntheticHand, 'time'>) => syntheticHand({ time: sampleTime(0), ...options });
const angleOf = (v: { x: number; y: number }) => (Math.atan2(v.y, v.x) * 180) / Math.PI;

describe('指の伸び・曲がり', () => {
  it('合成した比のとおりに測れる', () => {
    const f = fingerFeatures(hand({ ratios: { index: 1.6, middle: 0.9 } }).worldLandmarks);
    expect(f.index.ratio).toBeCloseTo(1.6, 6);
    expect(f.middle.ratio).toBeCloseTo(0.9, 6);
    expect(f.index.state).toBe('extended');
    expect(f.middle.state).toBe('curled');
  });

  it('境界の間（1.15〜1.4）は決めない。点が欠けた指も決めない', () => {
    const points = hand({ ratios: { index: 1.3 } }).worldLandmarks.slice();
    points[20] = { x: Number.NaN, y: 0, z: 0 };
    const f = fingerFeatures(points);
    expect(f.index.state).toBe('unknown');
    expect(f.pinky).toEqual({ ratio: null, state: 'unknown' });
  });
});

describe('手形の候補', () => {
  // 画面の上下だけで決めないこと：上・外・斜め・下（上下反転）・内向き、掌を横・裏へ回した手
  const directions = [-90, 0, -45, 90, 180, -135];
  const turns = [0, 60, 120, 180];
  for (const shape of HAND_SHAPES)
    it(`${shape} は手の向き・回転によらず同じ形`, () => {
      for (const direction of directions)
        for (const turn of turns) expect(classifyHand(hand({ shape, direction, turn })).shape).toBe(shape);
    });

  it('既成の手形と一致すると確かさが上がり、理由に残る', () => {
    const plain = classifyHand(hand({ shape: 'peace', ratios: { index: 1.5 } }));
    const agreed = classifyHand(
      hand({ shape: 'peace', ratios: { index: 1.5 }, gesture: { name: 'Victory', score: 0.9 } }),
    );
    expect(plain.score).toBeLessThan(1);
    expect(agreed.score).toBeGreaterThan(plain.score);
    expect(agreed.reason).toContain('既成');
  });

  it('Pointing_Up の名前だけで指さしにしない（指の形が優先）', () => {
    const guess = classifyHand(hand({ shape: 'open', gesture: { name: 'Pointing_Up', score: 0.95 } }));
    expect(guess.shape).toBe('open');
  });

  it('横向きの指さしは、既成の手形が無くても指の形で決まる', () => {
    const guess = classifyHand(hand({ shape: 'point', direction: 0, gesture: { name: 'None', score: 0.9 } }));
    expect(guess.shape).toBe('point');
  });

  it('決まらない指があるときは、決まった指と矛盾しない既成の手形だけを使う', () => {
    // カメラへ向けた人さし指は短く写り、伸びが決まらない
    const short = { shape: 'point' as const, ratios: { index: 1.3 } };
    expect(classifyHand(hand({ ...short, gesture: { name: 'Pointing_Up', score: 0.9 } })).shape).toBe('point');
    expect(classifyHand(hand({ ...short, gesture: { name: 'Open_Palm', score: 0.9 } })).shape).toBeNull();
    expect(classifyHand(hand({ ...short, gesture: { name: 'Pointing_Up', score: 0.5 } })).shape).toBeNull();
    expect(classifyHand(hand(short)).shape).toBeNull();
  });

  it('4種類のどれでもない指の形は unknown', () => {
    const rock = classifyHand(hand({ shape: 'fist', ratios: { index: 1.8, pinky: 1.8 } }));
    expect(rock.shape).toBeNull();
    expect(rock.reason).toContain('どれでもない');
  });

  it('確定した形は維持の閾値（1.3／1.25）まで保ち、新しい形の開始には使わない', () => {
    const edge = hand({ shape: 'open', ratios: { index: 1.33, ring: 1.35 } });
    expect(classifyHand(edge).shape).toBeNull();
    expect(classifyHand(edge, 'open').shape).toBe('open');
    const curledEdge = hand({ shape: 'fist', ratios: { middle: 1.22 } });
    expect(classifyHand(curledEdge).shape).toBeNull();
    expect(classifyHand(curledEdge, 'fist').shape).toBe('fist');
    // 維持の閾値も外れたら、通常の判定に戻る
    expect(classifyHand(hand({ shape: 'open', ratios: { index: 1.25 } }), 'open').shape).toBeNull();
    expect(classifyHand(hand({ shape: 'point' }), 'open').shape).toBe('point');
  });

  it('手基準の3Dが無いときは肩の座標の点で測る', () => {
    expect(classifyHand(hand({ shape: 'peace', world: false })).shape).toBe('peace');
  });
});

describe('掌の軸と指さしの向き', () => {
  it('掌の軸は手首→中指の付け根の向き（肩の座標）', () => {
    for (const direction of [-90, -45, 0, 45, 90, 180]) {
      const axis = palmAxis(hand({ direction }))!;
      expect(axis.x).toBeCloseTo(Math.cos((direction * Math.PI) / 180), 6);
      expect(axis.y).toBeCloseTo(Math.sin((direction * Math.PI) / 180), 6);
    }
  });

  it('グーでも掌の点を使い、指先の向きに引かれない', () => {
    const axis = palmAxis(hand({ shape: 'fist', direction: 0 }))!;
    expect(angleOf(axis)).toBeCloseTo(0, 4);
  });

  it('掌を回しても軸は変わらない', () => {
    for (const turn of [0, 90, 180]) expect(angleOf(palmAxis(hand({ direction: -60, turn }))!)).toBeCloseTo(-60, 4);
  });

  it('奥行きへ60°より傾いた（潰れた）軸・短すぎる軸は null', () => {
    expect(palmAxis(hand({ tilt: 50 }))).not.toBeNull();
    expect(palmAxis(hand({ tilt: 70 }))).toBeNull();
    expect(palmAxis(hand({ scale: 0.3 }))).toBeNull();
  });

  it('潰れは手基準の3Dで判断する（画像のzが平らでも）', () => {
    const tilted = hand({ tilt: 65 }); // 画面上の長さは足りている（0.08）
    const flatImage = { ...tilted, landmarks: tilted.landmarks.map((p) => ({ ...p, z: 0 })) };
    expect(palmAxis(flatImage)).toBeNull();
  });

  it('指さしの向きは人さし指の向きで、掌の軸とは別の値', () => {
    const h = hand({ shape: 'point', direction: -90, indexBend: -40 });
    expect(angleOf(palmAxis(h)!)).toBeCloseTo(-90, 4);
    expect(Math.abs(angleOf(indexDirection(h)!) + 90)).toBeGreaterThan(30);
    expect(indexDirection(hand({ shape: 'point', tilt: 75 }))).toBeNull();
  });
});
