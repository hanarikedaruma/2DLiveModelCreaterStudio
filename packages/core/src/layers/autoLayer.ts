// 自動の層（STEP3 のカード66・CC-010）。プログラムが作る値を、カメラから来た値（トラッキングの層）と分けて出す。
// 自動まばたき: 目の値がトラッキングの層から来ていない間（割り当てに目が無い・「無効」・顔が外れた・
// 目のトラッキングがオフ・カメラ停止中）は、いつでも EyeOpenL / R を出す（I-055）
import type { AutoBlink, Layer, LayerProducer } from '@app/contracts';

export const AUTO_BLINK_PARAMETERS = ['EyeOpenL', 'EyeOpenR'] as const;

export interface AutoLayerProducer extends LayerProducer {
  setBlinkEnabled(on: boolean): void; // Environment.autoBlink。オフなら目の値を出さない
}

export function createAutoLayerProducer(autoBlink: AutoBlink): AutoLayerProducer {
  let blinkEnabled = true;
  return {
    id: 'auto',
    setBlinkEnabled(on) {
      blinkEnabled = on;
    },
    produce(ctx): Layer | null {
      if (!blinkEnabled) return null;
      // トラッキングの層が値を持っているパラメータは、カメラから来ている
      const fromCamera = new Set<string>();
      for (const layer of ctx.layersSoFar ?? []) {
        if (layer.id === 'tracking') for (const id of Object.keys(layer.values)) fromCamera.add(id);
      }
      const parameters = new Map(ctx.project.model.parameters.map((p) => [p.id, p]));
      const eyes = AUTO_BLINK_PARAMETERS.filter((id) => parameters.has(id) && !fromCamera.has(id));
      if (eyes.length === 0) return null;
      const blink = autoBlink.tick(ctx.now);
      const values: Record<string, number> = {};
      for (const id of eyes) {
        const p = parameters.get(id)!;
        const v = blink[id];
        if (typeof v === 'number' && Number.isFinite(v)) values[id] = Math.min(p.max, Math.max(p.min, v));
      }
      return { id: 'auto', weight: 1, values };
    },
  };
}
