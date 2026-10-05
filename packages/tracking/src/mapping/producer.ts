import type { AutoBlink, Layer, ParamValues, TrackingFrame, TrackingLayerProducer } from '@app/contracts';
import type { Environment, Parameter, TrackingMapping } from '@app/schema';
import { applyCalibration, normalizeCalibration, sameCalibration, type TrackingCalibration } from './calibrate';
import { createDefaultTrackingMappings } from './defaults';
import { LOST_DELAY, type LostBehavior, LostWeight } from './lostWeight';
import { clamp, clampToInputRange, mapTrackingValue } from './map';
import { trackingInputs } from './mirror';
import { ONE_EURO_DEFAULTS, OneEuroFilter, smoothingToMinCutoff } from './oneEuro';
import {
  CENTERED_TRACKING_INPUTS,
  UNTUNED_TRACKING,
  resolveTrackingTuning,
  sameTuning,
  type TrackingPreset,
  type TrackingTuning,
} from './presets';

// One Euro の beta は値の単位で効き方が変わる。入力範囲の幅をこの値にそろえてからならす
// （既定の顔の角度 [−30, 30] では度のまま。目や口の 0..1 も同じ割合の動きなら同じように追う）
export const FILTER_SPAN = 60;

// 自動まばたきを渡されていないときの目（開けたまま）
const EYES_OPEN = Object.freeze({ EyeOpenL: 1, EyeOpenR: 1 });
const EYE_PARAMETERS = ['EyeOpenL', 'EyeOpenR'] as const;

export interface TrackingLayerOptions {
  // 目のトラッキングをオフにしたときと外れたときの EyeOpenL / R（@app/core の createAutoBlink など）。
  // 無ければ目を開けたまま（アプリではカード44で services.autoBlink を渡す）
  autoBlink?: AutoBlink;
}

interface ResolvedMapping {
  mapping: TrackingMapping;
  parameter: Parameter;
  filter: OneEuroFilter;
  scale: number; // 入力 × scale をならす
  centered: boolean; // gain と preset の deadZone を当てる入力か
}

// トラッキングの値をパラメータへ写し、ならし、顔が外れたら正面へ戻すレイヤー（id 'tracking'）。
// mappings が無いか空なら既定のマッピング。parameters に無いパラメータへのマッピングは使わない
export function createTrackingLayerProducer(
  parameters: Parameter[],
  mappings?: TrackingMapping[],
  options: TrackingLayerOptions = {},
): TrackingLayerProducer {
  return new TrackingLayer(
    parameters,
    mappings && mappings.length > 0 ? mappings : createDefaultTrackingMappings(),
    options.autoBlink ?? null,
  );
}

class TrackingLayer implements TrackingLayerProducer {
  private readonly resolved: ResolvedMapping[];
  private readonly parametersById: Map<string, Parameter>;
  private readonly weight = new LostWeight();
  private values: ParamValues = {};
  private mirror = true;
  private calibration: TrackingCalibration | null = null;
  private tuning: TrackingTuning = { ...UNTUNED_TRACKING };
  private eyeTracking = true;
  private lastFrameDetected = false;
  private lastDetectedFrame: TrackingFrame | null = null;
  private lastTick: number | null = null;

  constructor(
    parameters: Parameter[],
    mappings: TrackingMapping[],
    private readonly autoBlink: AutoBlink | null,
  ) {
    this.parametersById = new Map(parameters.map((p) => [p.id, p]));
    this.resolved = [];
    for (const mapping of mappings) {
      const parameter = this.parametersById.get(mapping.parameterId);
      if (!parameter) continue;
      const span = Math.abs(mapping.inputRange[1] - mapping.inputRange[0]);
      this.resolved.push({
        mapping,
        parameter,
        filter: this.createFilter(mapping),
        scale: span > 0 ? FILTER_SPAN / span : 1,
        centered: CENTERED_TRACKING_INPUTS.has(mapping.input),
      });
    }
  }

  update(frame: TrackingFrame): void {
    this.lastFrameDetected = frame.detected;
    // 顔が無いフレームは値を変えない（最後の値のまま）
    if (!frame.detected) return;
    this.weight.detected(frame.time);
    this.lastDetectedFrame = frame;
    this.values = this.compute(frame);
  }

  // 目のトラッキングがオフのときと外れたときは、EyeOpenL / R を自動まばたきの値にする
  // 顔の正面復帰の重みと分け、未検出でも目の動きは継続する。
  tick(now: number): Layer {
    this.lastTick = now;
    const values = { ...this.values };
    const fallback = !this.eyeTracking || this.status() === 'lost';
    if (fallback) this.applyBlink(values, now);
    const layer: Layer = { id: 'tracking', weight: clamp(this.weight.weightAt(now), 0, 1), values };
    if (fallback)
      layer.parameterWeights = Object.fromEntries(
        EYE_PARAMETERS.filter((id) => this.parametersById.has(id)).map((id) => [id, 1]),
      );
    return layer;
  }

  // 最後のフレームが detected でないか、detected のフレームが 0.5秒より長く来ていなければ 'lost'
  status(): 'tracking' | 'lost' {
    const last = this.weight.lastDetectedAt;
    if (!this.lastFrameDetected || last === null) return 'lost';
    if (this.lastTick !== null && this.lastTick - last > LOST_DELAY) return 'lost';
    return 'tracking';
  }

  // 切り替えたらならしをやり直し、最後のフレームから値を作り直す（すぐに切り替わる）
  setMirror(on: boolean): void {
    if (on === this.mirror) return;
    this.mirror = on;
    this.restart();
  }

  setLostBehavior(b: LostBehavior): void {
    this.weight.behavior = b;
  }

  // 次のフレームから当てる。変わったらならしをやり直し、最後のフレームから値を作り直す
  setCalibration(c: Environment['calibration']): void {
    const next = normalizeCalibration(c);
    if (sameCalibration(next, this.calibration)) return;
    this.calibration = next;
    this.restart();
  }

  // stable・standard・large は決まった値、custom は custom の値（無ければ標準）。
  // 変わったらフィルタを作り直し、最後のフレームから値を作り直す
  setPreset(p: TrackingPreset, custom?: TrackingTuning): void {
    const next = resolveTrackingTuning(p, custom);
    if (sameTuning(next, this.tuning)) return;
    this.tuning = next;
    for (const r of this.resolved) r.filter = this.createFilter(r.mapping);
    this.refresh();
  }

  setEyeTracking(on: boolean): void {
    this.eyeTracking = on;
  }

  // minCutoff はマッピングの smoothing から求めた値に、プリセットの倍率（標準 1.0 に対する比）を掛ける
  private createFilter(mapping: TrackingMapping): OneEuroFilter {
    return new OneEuroFilter({
      minCutoff: smoothingToMinCutoff(mapping.smoothing) * (this.tuning.minCutoff / ONE_EURO_DEFAULTS.minCutoff),
      beta: this.tuning.beta,
      dCutoff: ONE_EURO_DEFAULTS.dCutoff,
    });
  }

  private restart(): void {
    for (const r of this.resolved) r.filter.reset();
    this.refresh();
  }

  private refresh(): void {
    if (this.lastDetectedFrame) this.values = this.compute(this.lastDetectedFrame);
  }

  private applyBlink(values: ParamValues, now: number): void {
    const blink = this.autoBlink ? this.autoBlink.tick(now) : EYES_OPEN;
    for (const id of EYE_PARAMETERS) {
      const parameter = this.parametersById.get(id);
      const v = blink[id];
      if (parameter && Number.isFinite(v)) values[id] = clamp(v, parameter.min, parameter.max);
    }
  }

  // キャリブレーション → ミラー → 入力範囲で丸めてならす → 写像（deadZone はマッピングの値 + プリセットの値）
  // → 中央からの差に gain → パラメータの範囲で丸める
  private compute(frame: TrackingFrame): ParamValues {
    const inputs = trackingInputs(applyCalibration(frame, this.calibration), this.mirror);
    const values: ParamValues = { ...this.values };
    const { gain, deadZone } = this.tuning;
    for (const r of this.resolved) {
      const x = inputs[r.mapping.input];
      if (x === undefined || !Number.isFinite(x)) continue; // 推定に無い入力・壊れた値は前のまま
      const smoothed = r.filter.filter(clampToInputRange(x, r.mapping.inputRange) * r.scale, frame.time) / r.scale;
      let v: number;
      if (r.centered && (deadZone !== 0 || gain !== 1)) {
        v = mapTrackingValue(smoothed, { ...r.mapping, deadZone: r.mapping.deadZone + deadZone / r.scale });
        const [c, d] = r.mapping.outputRange;
        const mid = (c + d) / 2;
        v = mid + (v - mid) * gain;
      } else {
        v = mapTrackingValue(smoothed, r.mapping);
      }
      values[r.parameter.id] = clamp(v, r.parameter.min, r.parameter.max);
    }
    return values;
  }
}
