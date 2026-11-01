// 腕・手の推定 Worker の入口（AT-04）。モジュール Worker として組み立て、blob の URL から読み込まれる（assets.ts）。
import { installNetworkGuard, type GuardScope } from './guard';
import type { FromBodyWorker, InitMessage, ToBodyWorker } from './protocol';
import { createBodyWorkerCore, type GestureTaskLike, type PoseTaskLike } from './workerCore';

interface WorkerScope extends GuardScope {
  postMessage(message: FromBodyWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToBodyWorker>) => void): void;
  performance: Performance;
  ModuleFactory?: unknown;
}
const scope = globalThis as unknown as WorkerScope;

// 推定器を読み込む前に、ページの外への通信を止める
installNetworkGuard(scope, (attempt) => scope.postMessage({ type: 'net', ...attempt }));

// モジュール Worker では WASM の読み込み口（ES モジュール）が1度しか評価されず、SDK は推定器を作るたびに
// self.ModuleFactory を消す。2つ目の推定器（手・CPU での作り直し）の前に、覚えたファクトリを入れ直す（AT-01）
let moduleFactory: unknown = null;
async function restoreFactory(url: string): Promise<void> {
  moduleFactory ??= ((await import(/* @vite-ignore */ url)) as { default: unknown }).default;
  scope.ModuleFactory = moduleFactory;
}

function tasks(init: InitMessage) {
  const fileset = { wasmLoaderPath: init.urls.wasmLoader, wasmBinaryPath: init.urls.wasmBinary };
  return {
    async pose(delegate: 'GPU' | 'CPU'): Promise<PoseTaskLike> {
      const { PoseLandmarker } = await import('@mediapipe/tasks-vision');
      await restoreFactory(init.urls.wasmLoader);
      return PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: init.urls.pose, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        outputSegmentationMasks: false,
      });
    },
    async gesture(delegate: 'GPU' | 'CPU'): Promise<GestureTaskLike> {
      const { GestureRecognizer } = await import('@mediapipe/tasks-vision');
      await restoreFactory(init.urls.wasmLoader);
      return GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: init.urls.gesture, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
      });
    },
  };
}

const core = createBodyWorkerCore({
  post: (message) => scope.postMessage(message),
  now: () => scope.performance.now(),
  timeOrigin: scope.performance.timeOrigin,
  tasks,
});
scope.addEventListener('message', (event) => void core.handle(event.data));
