// 腕・手の推定で使う同梱ファイルの URL と、Worker の作り方（AT-04）。実行時にネットワークへ取りに行かない。
// Vite は new URL('相対パス', import.meta.url) の形を見つけてファイルを同梱する。パスを変数や連結にしないこと。
import workerUrl from './worker?worker&url';
import type { BodyWorkerUrls } from './protocol';

export interface BodyAssetUrls extends BodyWorkerUrls {
  worker: string;
}

export function defaultBodyAssetUrls(): BodyAssetUrls {
  return {
    worker: workerUrl,
    wasmLoader: new URL(
      '../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js',
      import.meta.url,
    ).href,
    wasmBinary: new URL(
      '../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm',
      import.meta.url,
    ).href,
    pose: new URL('../../../assets/pose_landmarker_lite.task', import.meta.url).href,
    gesture: new URL('../../../assets/gesture_recognizer.task', import.meta.url).href,
  };
}

// blob の URL から Worker のモジュールを読み込む。blob の Worker は作ったページの CSP を引き継ぐので、
// Tauri が CSP を HTML の応答にだけ付けても、Worker 内の MediaPipe の送信が CSP で止まる（AT-01 の NetLog で確認）
export function createBlobModuleWorker(url: string, base: string = globalThis.location?.href ?? ''): Worker {
  const source = `import ${JSON.stringify(new URL(url, base).href)};`;
  const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return new Worker(blobUrl, { type: 'module' });
  } finally {
    // Worker は作られた時点で読み込みを始めるので、URL はすぐ手放してよい
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  }
}
