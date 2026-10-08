import { describe, expect, it } from 'vitest';
import { HairDynamicsSession, type FlowDynamicsSettings } from './session';

const settings: FlowDynamicsSettings = { enabled: true, preset: 'normal', strength: 0.5, damping: 0.2 };
const along = Array.from({ length: 49 }, (_, i) => i / 48);
const line = (x = 0) => along.map((s) => ({ x, y: s * 200 }));
const length = (curve: ReturnType<typeof line>) =>
  curve.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - curve[i]!.x, p.y - curve[i]!.y), 0);
function run(fps: number, config = settings) {
  const session = new HairDynamicsSession();
  const frames = [];
  for (let i = 0; i <= fps * 5; i++) {
    const t = i / fps;
    const x = t < 0.5 ? 0 : t < 0.8 ? (25 * (t - 0.5)) / 0.3 : 25;
    frames.push(
      session.advance('g', line(x), along, 0.15, config, 'g', '', {
        now: t * 1000,
        dt: i ? 1000 / fps : 0,
        frameId: i,
        active: true,
      }),
    );
  }
  return frames;
}
describe('流れ揺れの慣性の試作', () => {
  it('静止線と固定区間を保ち、移動に遅れと余韻を加えて収束する', () => {
    const frames = run(60);
    expect(frames[0]!.curve).toEqual(line());
    const moving = frames[48]!.curve;
    expect(moving[0]).toEqual({ x: 25, y: 0 });
    expect(moving[6]).toEqual({ x: 25, y: 25 });
    expect(frames.slice(30, 48).some((f) => f.curve.at(-1)!.x < f.curve[0]!.x - 1)).toBe(true);
    expect(frames.slice(48, 130).some((f) => f.curve.at(-1)!.x > 25.1)).toBe(true);
    expect(Math.abs(frames.at(-1)!.curve.at(-1)!.x - 25)).toBeLessThan(0.1);
    for (const f of frames) expect(Math.abs(length(f.curve) - 200)).toBeLessThan(2);
  });
  it('同じ線形入力を30/60/120Hzで渡して同じ固定刻みを解く', () => {
    const a = run(30),
      b = run(60),
      c = run(120);
    for (let i = 0; i < a.length; i++) {
      const p = a[i]!.curve.at(-1)!;
      for (const q of [b[i * 2]!.curve.at(-1)!, c[i * 4]!.curve.at(-1)!])
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1);
    }
    expect(run(60)).toEqual(b);
  });
  it('強さ0・停止・長時間停止・逆行は静止形を返し、対象ごとに履歴を破棄する', () => {
    const s = new HairDynamicsSession();
    const step = (id: string, now: number, x: number, active = true) =>
      s.advance(id, line(x), along, 0.15, settings, id, '', { now, dt: now, frameId: now, active });
    step('a', 0, 0);
    step('b', 0, 0);
    expect(step('a', 1000, 50).curve).toEqual(line(50));
    expect(step('b', 16, 5, false).curve).toEqual(line(5));
    expect(step('b', 32, 10).curve).toEqual(line(10));
    expect(step('b', 0, 5).curve).toEqual(line(5));
    expect(run(60, { ...settings, strength: 0 }).at(-1)!.curve).toEqual(line(25));
  });
});
