// スタジオの実行部（カード22）。毎フレーム、LAYER_ORDER の順に producer を呼んで mixedSoFar を更新し、
// mixer.mix → evaluator → pipeline の結果をプレビューと登録された sink へ渡す
import { useMemo, useSyncExternalStore } from 'react';
import {
  LAYER_ORDER,
  type Background,
  type AnimationStartPose,
  type DeformedModel,
  type Layer,
  type LayerProducer,
  type ParamValues,
  type Services,
  type ViewTransform,
} from '@app/contracts';
import { createAutoLayerProducer, HairDynamicsSession, type AutoLayerProducer } from '@app/core';
import { armRuntimeOf } from '../../services/arms';
import { hairFrames } from '../../services/hairFrame';
import {
  createBackgroundFiles,
  createBackgroundImages,
  type BackgroundFiles,
  type BackgroundImages,
} from './backgrounds';
import {
  DEFAULT_MODEL_TRANSFORM,
  DEFAULT_OUTPUT_SIZE,
  modelRect,
  outputView,
  type ModelTransform,
  type Size,
} from './placement';
import { sceneBackground, sceneModelTransform } from './scene';

// view は出力画面（Environment.output の幅 × 高さ）の px での変換。プレビューや出力ウィンドウは自分の大きさに合わせて縮める
export interface StudioFrame {
  model: DeformedModel;
  view: ViewTransform;
  background: Background;
  params: ParamValues;
  now: number;
  layers: Layer[]; // そのフレームの層（合成する前の値と重み。合成した順）。STEP3 のカード66
}
export type StudioTrackingStatus = 'tracking' | 'lost' | 'stopped';
// running: フレームの処理を回しているか（スタジオの画面か出力ウィンドウが開いている間）。
// status: トラッキングの状態（開始していなければ 'stopped'）
export interface StudioRuntimeState {
  running: boolean;
  status: StudioTrackingStatus;
}

// 次のフレームで cb を呼ぶ。戻り値で取り消す
export interface FrameScheduler {
  request(cb: (now: number) => void): () => void;
}

// requestAnimationFrame で回す。ウィンドウが隠れている間は requestAnimationFrame が止まるので setTimeout にする
export function animationFrameScheduler(): FrameScheduler {
  return {
    request(cb) {
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (hidden || typeof requestAnimationFrame !== 'function') {
        const id = setTimeout(() => cb(performance.now()), 1000 / 60);
        return () => clearTimeout(id);
      }
      const id = requestAnimationFrame(cb);
      return () => cancelAnimationFrame(id);
    },
  };
}

export interface StudioRuntime {
  registerLayerProducer(p: LayerProducer): () => void;
  registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
  // services につなぐ。1つ以上つながっている間、毎フレーム回す。戻り値で外す
  attach(services: Services): () => void;
  tick(now: number): StudioFrame | null; // 1フレーム分を処理する（ふつうは attach の間に自動で呼ばれる）
  startTracking(deviceId?: string | null): Promise<void>;
  stopTracking(): void;
  getState(): StudioRuntimeState;
  subscribe(listener: () => void): () => void;
  lastFrame(): StudioFrame | null;
  getOutputSize(): Size;
  setOutputSize(size: Size): void;
  subscribeOutputSize(listener: (size: Size) => void): () => void;
  // ドラッグ・ホイールの途中の配置（確定したらシーンに保存して null に戻す）
  setModelTransformOverride(t: ModelTransform | null): void;
  modelTransform(): ModelTransform; // 今使っている配置
  setPreview(draw: ((frame: StudioFrame) => void) | null): () => void;
  setScheduler(scheduler: FrameScheduler): void;
  setAutoBlink(on: boolean): void; // Environment.autoBlink（自動の層のまばたき）。STEP3 のカード66
  readonly backgrounds: BackgroundImages;
  readonly backgroundFiles: BackgroundFiles;
}

export function createStudioRuntime(
  options: {
    scheduler?: FrameScheduler;
    decodeImage?: (bytes: Uint8Array, path: string) => Promise<ImageBitmap>;
  } = {},
): StudioRuntime {
  let scheduler = options.scheduler ?? animationFrameScheduler();
  const producers: LayerProducer[] = [];
  const sinks: { sink: (frame: StudioFrame) => void }[] = [];
  let preview: ((frame: StudioFrame) => void) | null = null;
  let services: Services | null = null;
  let attachments = 0;
  const hairSession = new HairDynamicsSession();
  let hairFrameId = 0;
  let hairProject: ReturnType<Services['store']['get']> | null = null;
  let cancelFrame: (() => void) | null = null;
  let tracking: { services: Services; off: () => void } | null = null;
  let outputSize: Size = DEFAULT_OUTPUT_SIZE;
  const sizeListeners = new Set<(size: Size) => void>();
  let override: ModelTransform | null = null;
  let lastNow: number | null = null;
  let last: StudioFrame | null = null;
  let previousAnimationPose: AnimationStartPose | null = null;
  let state: StudioRuntimeState = { running: false, status: 'stopped' };
  const listeners = new Set<() => void>();
  // 同じ producer・sink の例外は1回だけ知らせる（毎フレーム出さない）
  const reported = new WeakSet<object>();

  const backgrounds = createBackgroundImages({
    decode: options.decodeImage,
    load: (path) => backgroundFiles.load(path),
  });
  const backgroundFiles = createBackgroundFiles({ fs: () => services?.fs ?? null, images: backgrounds });

  function report(owner: object, what: string, e: unknown) {
    if (reported.has(owner)) return;
    reported.add(owner);
    console.error(`スタジオの${what}で例外が出た`, e);
  }

  function updateState() {
    const next: StudioRuntimeState = {
      running: attachments > 0,
      status: tracking ? tracking.services.trackingLayer.status() : 'stopped',
    };
    if (next.running === state.running && next.status === state.status) return;
    state = next;
    for (const l of [...listeners]) l();
  }

  // トラッキングの層はカメラから来た値だけ（カメラ停止中は出さない）。自動まばたきは自動の層が、目の値が
  // トラッキングの層から来ていない間に出す（STEP3 のカード66・CC-010。カメラ停止中もここで動く）
  const trackingProducer: LayerProducer = {
    id: 'tracking',
    produce: (ctx) => (tracking ? tracking.services.trackingLayer.tick(ctx.now) : null),
  };
  producers.push(trackingProducer);
  // 腕・手の層（AT-12）。顔の層と同じ順位で別に出し、腕のパラメータだけを左右別に持つ（顔が外れても止めない）
  producers.push({
    id: 'tracking',
    produce: (ctx) => (services ? (armRuntimeOf(services.arms)?.tick(ctx.now) ?? null) : null),
  });
  // 腕のサービスは、実行部が回っている間だけ体の推定を購読する
  let armAttachment: { services: Services; off: () => void } | null = null;
  function releaseArms() {
    armAttachment?.off();
    armAttachment = null;
  }
  let autoBlinkEnabled = true;
  let auto: { services: Services; producer: AutoLayerProducer } | null = null;
  const autoProducer: LayerProducer = {
    id: 'auto',
    produce(ctx) {
      if (!services) return null;
      if (auto?.services !== services) auto = { services, producer: createAutoLayerProducer(services.autoBlink) };
      auto.producer.setBlinkEnabled(autoBlinkEnabled);
      return auto.producer.produce(ctx);
    },
  };
  producers.push(autoProducer);
  producers.push({ id: 'physics', produce: (ctx) => services?.physics.produce(ctx) ?? null });

  function ordered(): LayerProducer[] {
    // LAYER_ORDER の順。同じ id のものは登録した順
    return LAYER_ORDER.flatMap((id) => producers.filter((p) => p.id === id));
  }

  function tick(now: number): StudioFrame | null {
    const s = services;
    if (!s) return null;
    const project = s.store.get();
    if (hairProject !== project && !s.store.canUndo()) {
      hairSession.reset();
      s.physics.reset();
      previousAnimationPose = null;
    }
    hairProject = project;
    const dt = lastNow === null ? 0 : Math.max(0, now - lastNow);
    if (lastNow !== null && now < lastNow) previousAnimationPose = null;
    lastNow = now;
    const { parameters } = project.model;
    const flags = { lipSyncWeight: 1, physicsActive: true }; // 前のレイヤーが書き換えて後のレイヤーへ伝える
    const frameId = ++hairFrameId;
    const layers: Layer[] = [];
    let mixedSoFar = s.mixer.mix(parameters, []);
    let animationValues = { ...mixedSoFar };
    const lipSyncOffsets: ParamValues = {},
      physicsOffsets: ParamValues = {};
    for (const p of ordered()) {
      let produced: Layer | Layer[] | null;
      try {
        produced = p.produce({
          now,
          dt,
          frameId,
          project,
          mixedSoFar,
          flags,
          layersSoFar: [...layers],
          previousAnimationPose,
        });
      } catch (e) {
        report(p, `レイヤー（${p.id}）`, e);
        continue;
      }
      // 配列なら配列の順に合成する（カード45）
      const added = produced === null ? [] : Array.isArray(produced) ? produced : [produced];
      const before = mixedSoFar;
      if (added.length) {
        layers.push(...added);
        mixedSoFar = s.mixer.mix(parameters, [...layers]);
      }
      if (LAYER_ORDER.indexOf(p.id) <= LAYER_ORDER.indexOf('animation')) animationValues = { ...mixedSoFar };
      const offsets = p.id === 'lipSync' ? lipSyncOffsets : p.id === 'physics' ? physicsOffsets : null;
      if (offsets)
        for (const id of new Set(added.flatMap((layer) => Object.keys(layer.values)))) {
          if (Number.isFinite(before[id]) && Number.isFinite(mixedSoFar[id]))
            offsets[id] = (offsets[id] ?? 0) + mixedSoFar[id]! - before[id]!;
        }
    }
    const params = mixedSoFar;
    const model = hairFrames(s).evaluate(
      project,
      params,
      {
        now,
        dt,
        frameId,
        active: flags.physicsActive,
        ...('freezePhysics' in flags ? { freeze: flags.freezePhysics === true } : {}),
      },
      hairSession,
    );
    const view = outputView(modelRect(project), override ?? sceneModelTransform(project), outputSize);
    const background = backgrounds.resolve(sceneBackground(project));
    const frame: StudioFrame = { model, view, background, params, now, layers: [...layers] };
    last = frame;
    try {
      armRuntimeOf(s.arms)?.afterFrame(frame); // 表情・アニメーションの上書きが終わったら、表示中の姿勢からつなぐ
    } catch (e) {
      report(trackingProducer, '腕の層の後処理', e);
    }
    previousAnimationPose = { projectId: project.id, values: animationValues, lipSyncOffsets, physicsOffsets };
    if (preview) {
      try {
        preview(frame);
      } catch (e) {
        report(preview, 'プレビュー', e);
      }
    }
    for (const entry of [...sinks]) {
      try {
        entry.sink(frame);
      } catch (e) {
        report(entry, '出力先（sink）', e);
      }
    }
    updateState();
    return frame;
  }

  const loopOwner = {};
  function loop(now: number) {
    cancelFrame = null;
    try {
      tick(now);
    } catch (e) {
      report(loopOwner, 'フレームの処理', e);
    }
    if (attachments > 0 && !cancelFrame) cancelFrame = scheduler.request(loop);
  }

  function stopTracking() {
    const t = tracking;
    if (!t) return;
    tracking = null;
    t.off();
    t.services.tracking.stop();
    updateState();
  }

  const runtime: StudioRuntime = {
    registerLayerProducer(p) {
      producers.push(p);
      return () => {
        const i = producers.indexOf(p);
        if (i >= 0) producers.splice(i, 1);
      };
    },
    registerFrameSink(sink) {
      const entry = { sink };
      sinks.push(entry);
      return () => {
        const i = sinks.indexOf(entry);
        if (i >= 0) sinks.splice(i, 1);
      };
    },
    attach(next) {
      if (services !== next) {
        stopTracking();
        releaseArms();
        services = next;
        hairSession.reset();
        override = null;
        last = null;
        previousAnimationPose = null;
        lastNow = null;
      }
      attachments += 1;
      if (!armAttachment) {
        const arms = armRuntimeOf(next.arms);
        if (arms) armAttachment = { services: next, off: arms.attach() };
      }
      if (!cancelFrame) cancelFrame = scheduler.request(loop);
      updateState();
      let attached = true;
      return () => {
        if (!attached) return;
        attached = false;
        attachments -= 1;
        if (attachments === 0) {
          releaseArms();
          previousAnimationPose = null;
          hairSession.reset();
          cancelFrame?.();
          cancelFrame = null;
          lastNow = null;
        }
        updateState();
      };
    },
    tick,
    async startTracking(deviceId) {
      const s = services;
      if (!s) throw new Error('スタジオの実行部がまだ動いていない');
      stopTracking();
      const off = s.tracking.onFrame((frame) => s.trackingLayer.update(frame));
      const session = { services: s, off };
      tracking = session;
      updateState();
      try {
        await s.tracking.start(deviceId ?? undefined);
      } catch (e) {
        if (tracking === session) stopTracking();
        throw e;
      }
    },
    stopTracking,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    lastFrame: () => last,
    getOutputSize: () => outputSize,
    setOutputSize(size) {
      if (size.width === outputSize.width && size.height === outputSize.height) return;
      outputSize = { width: size.width, height: size.height };
      for (const l of [...sizeListeners]) l(outputSize);
    },
    subscribeOutputSize(listener) {
      sizeListeners.add(listener);
      return () => {
        sizeListeners.delete(listener);
      };
    },
    setModelTransformOverride(t) {
      override = t;
    },
    modelTransform: () => override ?? (services ? sceneModelTransform(services.store.get()) : DEFAULT_MODEL_TRANSFORM),
    setPreview(draw) {
      preview = draw;
      return () => {
        if (preview === draw) preview = null;
      };
    },
    setScheduler(next) {
      cancelFrame?.();
      cancelFrame = null;
      scheduler = next;
      if (attachments > 0) cancelFrame = scheduler.request(loop);
    },
    setAutoBlink(on) {
      autoBlinkEnabled = on;
    },
    backgrounds,
    backgroundFiles,
  };
  return runtime;
}

// アプリで1つの実行部。下の関数はこれを使う
export const studioRuntime: StudioRuntime = createStudioRuntime();

export function registerLayerProducer(p: LayerProducer): () => void {
  return studioRuntime.registerLayerProducer(p);
}

export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void {
  return studioRuntime.registerFrameSink(sink);
}

export function useStudioRuntime(): {
  running: boolean;
  status: 'tracking' | 'lost' | 'stopped';
  lastFrame(): StudioFrame | null;
} {
  const state = useSyncExternalStore(studioRuntime.subscribe, studioRuntime.getState);
  return useMemo(() => ({ running: state.running, status: state.status, lastFrame: studioRuntime.lastFrame }), [state]);
}

export function useStudioOutputSize(): Size {
  return useSyncExternalStore(studioRuntime.subscribeOutputSize, studioRuntime.getOutputSize);
}
