// 体の追従（カード36）。それまでのレイヤーを合成した顔の向きに、率を掛けて体の向きにする（override、weight 1）
import type { BodyFollowProducer, FrameContext, Layer, ParamValues } from '@app/contracts';

export type BodyFollowStrength = 'low' | 'standard' | 'high';

// 顔の向き × 率 = 体の向き
export const BODY_FOLLOW_RATES: Record<BodyFollowStrength, number> = { low: 0.15, standard: 0.3, high: 0.45 };

// 体のパラメータ ← 顔のパラメータ
const FOLLOWS: readonly (readonly [body: string, face: string])[] = [
  ['BodyAngleX', 'FaceAngleX'],
  ['BodyAngleZ', 'FaceAngleZ'],
];

// 強さの初期値は標準。プロジェクトに体のパラメータが無いときはそのパラメータを出さない（パラメータは足さない）。
// 顔のパラメータが無いときも出さない。出すものが1つも無ければ null。返すレイヤーはいつも1つ
export function createBodyFollowProducer(): Omit<BodyFollowProducer, 'produce'> & {
  produce(ctx: FrameContext): Layer | null;
} {
  let rate = BODY_FOLLOW_RATES.standard;
  return {
    id: 'bodyFollow',
    setStrength(s) {
      const next = BODY_FOLLOW_RATES[s] as number | undefined;
      if (next !== undefined) rate = next;
    },
    produce(ctx): Layer | null {
      const { parameters } = ctx.project.model;
      const values: ParamValues = {};
      let any = false;
      for (const [body, face] of FOLLOWS) {
        if (!parameters.some((p) => p.id === body)) continue;
        const v = ctx.mixedSoFar[face];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        values[body] = v * rate;
        any = true;
      }
      return any ? { id: 'bodyFollow', weight: 1, values } : null;
    },
  };
}
