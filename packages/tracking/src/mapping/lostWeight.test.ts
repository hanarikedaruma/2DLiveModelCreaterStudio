import { describe, expect, it } from 'vitest';
import { LostWeight } from './lostWeight';

// t0 から t1 まで 30fps で detected を入れる
function detectBetween(w: LostWeight, t0: number, t1: number): void {
  for (let t = t0; t <= t1; t += 1000 / 30) w.detected(t);
  w.detected(t1);
}

describe('LostWeight', () => {
  it('まだ一度も検出していなければ 0、最初の検出から 0.3秒で 1 になる', () => {
    const w = new LostWeight();
    expect(w.weightAt(0)).toBe(0);
    w.detected(1000);
    expect(w.weightAt(1000)).toBe(0);
    expect(w.weightAt(1150)).toBeCloseTo(0.5, 9);
    detectBetween(w, 1000, 1300);
    expect(w.weightAt(1300)).toBe(1);
  });

  it('外れてから 0.5秒は 1、1.0秒で 0.5、1.5秒で 0（ease-in-out）', () => {
    const w = new LostWeight();
    detectBetween(w, 0, 2000);
    const lost = 2000;
    expect(w.weightAt(lost + 250)).toBe(1);
    expect(w.weightAt(lost + 500)).toBe(1);
    expect(w.weightAt(lost + 750)).toBeCloseTo(0.84375, 9); // ease-in-out の 1/4（線形なら 0.75）
    expect(w.weightAt(lost + 1000)).toBeCloseTo(0.5, 9);
    expect(w.weightAt(lost + 1500)).toBe(0);
    expect(w.weightAt(lost + 5000)).toBe(0);
  });

  it('再び検出したら 0.3秒で 1 に戻す', () => {
    const w = new LostWeight();
    detectBetween(w, 0, 2000);
    const back = 5000; // weight は 0
    w.detected(back);
    expect(w.weightAt(back)).toBe(0);
    expect(w.weightAt(back + 150)).toBeCloseTo(0.5, 9);
    detectBetween(w, back, back + 300);
    expect(w.weightAt(back + 300)).toBe(1);
    expect(w.weightAt(back + 600)).toBe(1);
  });

  it('下げている途中で再検出したら、そのときの weight から 0.3秒で 1 に戻す（跳ばない）', () => {
    const w = new LostWeight();
    detectBetween(w, 0, 2000);
    const back = 3000; // 外れて 1.0秒 → 0.5
    expect(w.weightAt(back)).toBeCloseTo(0.5, 9);
    w.detected(back);
    expect(w.weightAt(back)).toBeCloseTo(0.5, 9);
    expect(w.weightAt(back + 150)).toBeCloseTo(0.75, 9);
    detectBetween(w, back, back + 300);
    expect(w.weightAt(back + 300)).toBe(1);
  });

  it('0.5秒より短く外れただけなら 1 のまま', () => {
    const w = new LostWeight();
    detectBetween(w, 0, 2000);
    w.detected(2400);
    expect(w.weightAt(2400)).toBe(1);
    expect(w.weightAt(2700)).toBe(1);
  });

  it('戻している途中にフレームが続いても、戻すのはやり直さない', () => {
    const w = new LostWeight();
    detectBetween(w, 0, 1000);
    w.detected(4000);
    w.detected(4033);
    w.detected(4066);
    expect(w.weightAt(4150)).toBeCloseTo(0.5, 9);
  });

  it("'hold' のときは外れても 1 のまま", () => {
    const w = new LostWeight();
    w.behavior = 'hold';
    expect(w.weightAt(0)).toBe(1);
    detectBetween(w, 0, 2000);
    for (const dt of [500, 1000, 1500, 10000]) expect(w.weightAt(2000 + dt)).toBe(1);
  });
});
