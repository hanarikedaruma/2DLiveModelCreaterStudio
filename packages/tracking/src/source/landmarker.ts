import type { LandmarkerResultLike } from './convert';

// FaceLandmarker のうち使うところ（@mediapipe/tasks-vision の FaceLandmarker がそのまま当てはまる）
export interface FaceLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestamp: number): LandmarkerResultLike;
  close(): void;
}

// 同梱するファイルの URL
export interface MediaPipeAssetUrls {
  wasmLoaderUrl: string; // vision_wasm_internal.js
  wasmBinaryUrl: string; // vision_wasm_internal.wasm
  modelAssetUrl: string; // face_landmarker.task
}

// アプリに同梱するファイルの URL。実行時にネットワークへ取りに行かない。
// Vite は new URL('相対パス', import.meta.url) の形を見つけてファイルを同梱し、URL を書き換える。
// その形でしか見つけないので、パスを変数や文字列の連結にしないこと（ファイルの場所は packages/tracking の中）
export function defaultMediaPipeAssetUrls(): MediaPipeAssetUrls {
  return {
    wasmLoaderUrl: new URL('../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', import.meta.url)
      .href,
    wasmBinaryUrl: new URL('../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', import.meta.url)
      .href,
    modelAssetUrl: new URL('../../assets/face_landmarker.task', import.meta.url).href,
  };
}

export type Delegate = 'GPU' | 'CPU';

// GPU で作り、失敗したら CPU で作り直す
export async function createWithGpuFallback<T>(create: (delegate: Delegate) => Promise<T>): Promise<T> {
  try {
    return await create('GPU');
  } catch (gpuError) {
    console.warn('顔の推定を GPU で始められなかったので CPU で動かす', gpuError);
    return create('CPU');
  }
}

// 本物の FaceLandmarker を作る。ライブラリは使うときに読み込む（起動を遅くしないため）
export async function createMediaPipeFaceLandmarker(urls: MediaPipeAssetUrls): Promise<FaceLandmarkerLike> {
  const { FaceLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = { wasmLoaderPath: urls.wasmLoaderUrl, wasmBinaryPath: urls.wasmBinaryUrl };
  return createWithGpuFallback((delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: urls.modelAssetUrl, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    }),
  );
}
