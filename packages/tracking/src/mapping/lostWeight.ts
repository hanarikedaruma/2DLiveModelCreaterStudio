import { smoothstep } from './map';

export const LOST_DELAY = 500; // 最後に detected だった時刻から下げ始めるまで（ミリ秒）
export const FADE_OUT = 1000; // 1 → 0 へ下げる時間
export const FADE_IN = 300; // 再検出で 1 に戻す時間

export type LostBehavior = 'returnToFront' | 'hold';

// 外れたときのレイヤーの weight。時刻はすべて呼ぶ側が渡す（ミリ秒、performance.now）
//   returnToFront: 最後に detected だった時刻から 0.5秒たったら、1 → 0 へ 1秒かけて下げる（ease-in-out）。
//                  再び detected になったら、そのときの weight から 0.3秒で 1 に戻す。まだ一度も検出していなければ 0
//   hold: 常に 1
export class LostWeight {
  behavior: LostBehavior = 'returnToFront';
  private lastDetected: number | null = null;
  private fadeInStart: number | null = null;
  private fadeInFrom = 0;

  get lastDetectedAt(): number | null {
    return this.lastDetected;
  }

  // detected のフレームが来た
  detected(time: number): void {
    const wasLost = this.lastDetected === null || time - this.lastDetected > LOST_DELAY;
    if (wasLost) {
      this.fadeInFrom = this.returnToFrontWeight(time);
      this.fadeInStart = time;
    }
    this.lastDetected = this.lastDetected === null ? time : Math.max(this.lastDetected, time);
  }

  weightAt(now: number): number {
    return this.behavior === 'hold' ? 1 : this.returnToFrontWeight(now);
  }

  private returnToFrontWeight(now: number): number {
    if (this.lastDetected === null) return 0;
    const fadeOut = 1 - smoothstep((now - this.lastDetected - LOST_DELAY) / FADE_OUT);
    const fadeIn =
      this.fadeInStart === null
        ? 1
        : this.fadeInFrom + (1 - this.fadeInFrom) * smoothstep((now - this.fadeInStart) / FADE_IN);
    return Math.min(fadeOut, fadeIn);
  }
}
