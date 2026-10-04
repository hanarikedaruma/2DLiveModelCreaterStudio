// 自動まばたき（カード36）。目の入力が無いときに使う（トラッキングのレイヤーが setEyeTracking の off と外れたときに呼ぶ）
import type { AutoBlink } from '@app/contracts';

export const BLINK_INTERVAL_MIN = 2000; // まばたきの間隔（始まりから次の始まりまで、ミリ秒）は 2〜6秒の一様乱数
export const BLINK_INTERVAL_MAX = 6000;
export const BLINK_CLOSE_MS = 80; // 閉じる
export const BLINK_HOLD_MS = 40; // 閉じたまま
export const BLINK_OPEN_MS = 120; // 開く
export const BLINK_DURATION_MS = BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS;

// ease-in-out（始めと終わりがゆっくり。0 → 0、0.5 → 0.5、1 → 1）
export function blinkEase(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

// まばたきが始まってから elapsed ミリ秒の目の開き（0..1）。まばたきの外は 1
export function blinkOpenness(elapsed: number): number {
  if (!(elapsed >= 0) || elapsed >= BLINK_DURATION_MS) return 1;
  if (elapsed < BLINK_CLOSE_MS) return 1 - blinkEase(elapsed / BLINK_CLOSE_MS);
  if (elapsed < BLINK_CLOSE_MS + BLINK_HOLD_MS) return 0;
  return blinkEase((elapsed - BLINK_CLOSE_MS - BLINK_HOLD_MS) / BLINK_OPEN_MS);
}

// random は 0 以上 1 未満を返す関数（テストでは固定の列を渡す）。左右は同時に閉じる。
// 最初の tick から間隔を数え始める。時刻が戻ったときと、長く呼ばれずにまばたきを通り過ぎたときは、その時刻から数え直す
export function createAutoBlink(random: () => number = Math.random): AutoBlink {
  let start: number | null = null; // 次の（または今の）まばたきの始まり
  let last = -Infinity;

  const interval = () => {
    const r = random();
    const u = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0.5;
    return BLINK_INTERVAL_MIN + (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN) * u;
  };

  return {
    tick(now) {
      if (!Number.isFinite(now)) return { EyeOpenL: 1, EyeOpenR: 1 };
      if (start === null || now < last) start = now + interval();
      last = now;
      if (now >= start + BLINK_DURATION_MS) {
        const gap = interval();
        start += gap;
        if (now >= start + BLINK_DURATION_MS) start = now + gap;
      }
      const open = blinkOpenness(now - start);
      return { EyeOpenL: open, EyeOpenR: open };
    },
  };
}
