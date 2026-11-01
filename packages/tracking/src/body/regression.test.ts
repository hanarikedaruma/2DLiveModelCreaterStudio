// AT-01 の案内つき収録（実カメラ、案内どおりの区間の先頭1秒）を再生し、左右の対応付けを確かめる回帰試験。
// 正解は案内（演者自身の手）。未反転の映像なので、演者の右手は画像の左に写る。
import { describe, expect, it } from 'vitest';
import { createBodyAssociation } from './association';
import { loadFixture } from './fixtures';

function play(name: string, mirror: boolean) {
  const a = createBodyAssociation({ mirror });
  return loadFixture(name).map(({ step, active, frame }) => ({ step, active, out: a.update(frame) }));
}

describe('AT-01 の点列の再生', () => {
  for (const mirror of [true, false]) {
    // ミラー ON は演者の右→モデル L、OFF は演者の右→モデル R
    const of = (actor: 'left' | 'right') => (mirror ? (actor === 'right' ? 'L' : 'R') : actor === 'right' ? 'R' : 'L');

    it(`片手を振る：上げた腕と手が、案内の側に対応するモデルの側に出る（ミラー ${mirror ? 'ON' : 'OFF'}）`, () => {
      for (const actor of ['right', 'left'] as const) {
        const frames = play('at01-wave.json', mirror).filter((f) => f.step === `wave-${actor}`);
        expect(frames.length).toBeGreaterThan(20);
        const up = of(actor);
        const down = up === 'L' ? 'R' : 'L';
        const raised = frames.filter((f) => (f.out.arms[up]?.wrist.position?.y ?? 1) < 0).length;
        expect(raised / frames.length).toBeGreaterThanOrEqual(0.95);
        const handed = frames.filter((f) => f.out.hands[up]?.validity === 'valid').length;
        expect(handed / frames.length).toBeGreaterThanOrEqual(0.9);
        // 下ろした側に、上げた手を割り当てない
        expect(frames.filter((f) => f.out.hands[down]?.validity === 'valid').length).toBe(0);
      }
    });

    it(`両手を振る・両腕を交差する：同じ手を両側に割り当てず、交差中も左右が入れ替わらない（ミラー ${mirror ? 'ON' : 'OFF'}）`, () => {
      const both = play('at01-wave.json', mirror).filter((f) => f.step === 'wave-both');
      for (const { out } of both) {
        expect(out.arms.L!.wrist.position!.y).toBeLessThan(0);
        expect(out.arms.R!.wrist.position!.y).toBeLessThan(0);
        const l = out.hands.L;
        const r = out.hands.R;
        if (l?.validity === 'valid' && r?.validity === 'valid') expect(l.landmarks).not.toEqual(r.landmarks);
      }
      const cross = play('at01-cross.json', mirror);
      expect(cross.length).toBeGreaterThan(20);
      for (const { out } of cross) {
        const l = out.hands.L!;
        const r = out.hands.R!;
        expect(['valid', 'ambiguous']).toContain(l.validity);
        expect(['valid', 'ambiguous']).toContain(r.validity);
        if (l.validity === 'valid' && r.validity === 'valid') {
          expect(l.landmarks).not.toEqual(r.landmarks);
          // 交差していても、各側の手は同じ側の肩の外向きの座標で、その腕の手首の近く
          for (const side of ['L', 'R'] as const) {
            const wrist = out.arms[side]!.wrist.position!;
            const hand = out.hands[side]!.landmarks[0]!;
            expect(Math.hypot(hand.x - wrist.x, hand.y - wrist.y)).toBeLessThan(0.35);
          }
        }
      }
    });
  }

  it('ミラーの ON/OFF は左右の割当だけを入れ替え、値は同じ', () => {
    const on = play('at01-wave.json', true);
    const off = play('at01-wave.json', false);
    on.forEach((f, i) => {
      expect(f.out.arms.L?.wrist.position).toEqual(off[i]!.out.arms.R?.wrist.position);
      expect(f.out.hands.L?.landmarks).toEqual(off[i]!.out.hands.R?.landmarks);
    });
  });
});
