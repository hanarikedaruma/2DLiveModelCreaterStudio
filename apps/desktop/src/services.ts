// Services の組み立て。仮実装を本物に差し替えるときは、このファイルだけを書き換える
import { createEmptyProject } from '@app/schema';
import {
  FakeAnimationPlayer,
  FakeAudioSource,
  FakeAutoBlink,
  FakeAutoSaver,
  FakeAutoSetup,
  FakeBodyFollow,
  FakeCalibration,
  FakeEvaluator,
  FakeExpressions,
  FakeHotkeys,
  FakeImporter,
  FakeKeyEditor,
  FakeKeyGenerator,
  FakeLipSync,
  FakeMeshGenerator,
  FakeMixer,
  FakePeriodic,
  FakePhysics,
  FakePipeline,
  FakeProjectIO,
  FakeRenderer,
  FakeSpout,
  FakeTrackingLayer,
  FakeTrackingSource,
  FakeVowels,
  MemoryFileSystem,
  createAssetRepository,
  type Renderer,
  type Services,
} from '@app/contracts';
import { createAudioSource, createLipSyncProducer, createVowelEstimator } from '@app/audio';
import {
  createAutoBlink,
  createAnimationPlayer,
  createPeriodicPlayer,
  createPhysicsEngine,
  createAutoSetup,
  createBindingEvaluator,
  createBodyFollowProducer,
  createDeformPipeline,
  createEditorStore,
  createExpressionController,
  createKeyGenerator,
  createMeshGenerator,
  createParameterMixer,
  createProjectStore,
} from '@app/core';
import { createAutoSaver, createImporter, createProjectIO } from '@app/io';
import { createWebGLRenderer } from '@app/render';
import { createCalibrationService, createMediaPipeTrackingSource, createTrackingLayerProducer } from '@app/tracking';
import { createHotkeyService } from './hotkeys/service';
import { createSpoutSink } from './output/spout/sink';
import { appConfigDirPath, isTauri } from './platform/tauri';
import { TauriFileSystem } from './platform/tauriFs';
import { createKeyEditor } from './services/keyEditor';
import { createProjectTrackingLayer } from './services/trackingLayer';
import {
  createEnvironmentStore,
  fileEnvironmentStorage,
  localStorageEnvironmentStorage,
  type EnvironmentStore,
} from './shell/environment';

// WebGL2 が使えなければ Canvas 2D（仮実装の描画）で描く
function createRendererWithFallback(): Renderer {
  let active: Renderer | null = null;
  return {
    init(canvas) {
      try {
        const renderer = createWebGLRenderer();
        renderer.init(canvas);
        active = renderer;
      } catch (e) {
        console.warn('WebGL2 が使えないので Canvas 2D で描く', e);
        const renderer = new FakeRenderer();
        renderer.init(canvas);
        active = renderer;
      }
    },
    setTextures: (images) => active?.setTextures(images),
    render: (model, view, background) => active?.render(model, view, background),
    dispose() {
      active?.dispose();
      active = null;
    },
  };
}

// 本物の実装。作っただけでは何も始めない（カメラ・マイクを開かない、ホットキーを登録しない、Spout2 で送らない）。
// 顔の推定と音声の処理はすべて PC の中で行う。MediaPipe の利用状況の送信は、Tauri の CSP（connect-src）で止めている
export function createServices(): Services {
  const store = createProjectStore(createEmptyProject('新しいプロジェクト'));
  const assets = createAssetRepository();
  const fs = isTauri() ? new TauriFileSystem() : new MemoryFileSystem();
  const io = createProjectIO(fs);
  // 自動保存には、いまのプロジェクトが使っている素材だけを渡す
  const projectAssetPngs = () => {
    const all = assets.all();
    const out: Record<string, Uint8Array> = {};
    for (const a of store.get().assets) {
      const png = all[a.id];
      if (png) out[a.id] = png;
    }
    return out;
  };
  // 自動まばたきは、スタジオ（目のトラッキングをオフにしたとき・外れたとき）とトラッキングのレイヤーで同じものを使う
  const autoBlink = createAutoBlink();
  const audio = createAudioSource();
  const vowels = createVowelEstimator();
  return {
    store,
    editor: createEditorStore(),
    assets,
    fs,
    evaluator: createBindingEvaluator(),
    pipeline: createDeformPipeline(),
    mixer: createParameterMixer(),
    createRenderer: createRendererWithFallback,
    meshGenerator: createMeshGenerator(),
    keyGenerator: createKeyGenerator({
      assets: () => store.get().assets,
      parameters: () => store.get().model.parameters,
    }),
    // I-039 暫定: 顔側の曲面変形を頭部共通にし、髪も追従させる。
    autoSetup: createAutoSetup({ faceTurn: 'head-surface' }),
    keyEditor: createKeyEditor(),
    importer: createImporter(),
    io,
    autoSaver: createAutoSaver(fs, io, store, projectAssetPngs),
    tracking: createMediaPipeTrackingSource(),
    trackingLayer: createProjectTrackingLayer(store, (parameters, mappings, combine) =>
      createTrackingLayerProducer(parameters, mappings, { autoBlink, combine }),
    ),
    // STEP1（カード44で本物に差し替えた）
    audio,
    lipSync: createLipSyncProducer({ audio, vowels }),
    autoBlink,
    bodyFollow: createBodyFollowProducer(),
    expressions: createExpressionController(),
    calibration: createCalibrationService(),
    hotkeys: createHotkeyService(),
    spout: createSpoutSink(),
    animations: createAnimationPlayer(),
    periodic: createPeriodicPlayer(),
    physics: createPhysicsEngine(),
    vowels,
  };
}

// STEP2 の仮実装（画面のテスト用）。本番はカード54で本物へ差し替えた
function createStep2FakeServices(): Pick<Services, 'animations' | 'periodic' | 'physics' | 'vowels'> {
  return {
    animations: new FakeAnimationPlayer(),
    periodic: new FakePeriodic(),
    physics: new FakePhysics(),
    vowels: new FakeVowels(),
  };
}

// STEP1 で足したサービス（カード26）の仮実装。画面のテストで使う
function createStep1FakeServices(): Pick<
  Services,
  'audio' | 'lipSync' | 'autoBlink' | 'bodyFollow' | 'expressions' | 'calibration' | 'hotkeys' | 'spout'
> {
  return {
    audio: new FakeAudioSource(),
    lipSync: new FakeLipSync(),
    autoBlink: new FakeAutoBlink(),
    bodyFollow: new FakeBodyFollow(),
    expressions: new FakeExpressions(),
    calibration: new FakeCalibration(),
    hotkeys: new FakeHotkeys(),
    spout: new FakeSpout(),
  };
}

// 仮実装だけで組み立てる（画面のテスト用）
export function createFakeServices(): Services {
  const store = createProjectStore(createEmptyProject('新しいプロジェクト'));
  return {
    store,
    editor: createEditorStore(),
    assets: createAssetRepository(),
    fs: new MemoryFileSystem(),
    evaluator: new FakeEvaluator(),
    pipeline: new FakePipeline(() => store.get().assets),
    mixer: new FakeMixer(),
    createRenderer: () => new FakeRenderer(),
    meshGenerator: new FakeMeshGenerator(),
    keyGenerator: new FakeKeyGenerator(),
    autoSetup: new FakeAutoSetup(),
    keyEditor: new FakeKeyEditor(),
    importer: new FakeImporter(),
    io: new FakeProjectIO(),
    autoSaver: new FakeAutoSaver(),
    tracking: new FakeTrackingSource(),
    trackingLayer: new FakeTrackingLayer(),
    ...createStep1FakeServices(),
    ...createStep2FakeServices(),
  };
}

// Tauri ではアプリ設定フォルダの environment.json、ブラウザでの開発中は localStorage に保存する
export function createEnvironment(services: Services): EnvironmentStore {
  if (!isTauri()) return createEnvironmentStore(localStorageEnvironmentStorage());
  let storage: ReturnType<typeof fileEnvironmentStorage> | null = null;
  const resolve = async () => (storage ??= fileEnvironmentStorage(services.fs, await appConfigDirPath()));
  return createEnvironmentStore({
    read: async () => (await resolve()).read(),
    write: async (text) => (await resolve()).write(text),
  });
}
