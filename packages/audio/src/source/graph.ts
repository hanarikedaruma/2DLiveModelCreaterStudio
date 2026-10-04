// マイクのストリームを Web Audio の AudioWorklet に通して、波形を決まった長さずつ受け取る（カード37）。
// 音声はこの PC の中だけで扱い、外へは送らない
import { LEVEL_INTERVAL_MS, levelWindowFrames } from './level';

export interface MediaStreamLike {
  getTracks(): { stop(): void }[];
}

// 波形の受け取り口。startFrame はこのサンプルの先頭の通し番号（AudioContext が始まってからのサンプル数）
export type CaptureChunkListener = (samples: Float32Array, startFrame: number) => void;

export interface CaptureGraph {
  readonly sampleRate: number;
  close(): void; // ノードを外して AudioContext を閉じる（ストリームは止めない）
}

export type CreateCaptureGraph = (stream: MediaStreamLike, onChunk: CaptureChunkListener) => Promise<CaptureGraph>;

export const LEVEL_TAP_PROCESSOR = 'level-tap'; // levelWorklet.js が登録する名前

// AudioWorklet のモジュールの URL。アプリに同梱したファイルを読む（Tauri の CSP は script-src 'self' だけを許す）。
// Vite は new URL('相対パス', import.meta.url) の形を見つけて同梱する。小さいファイルは data: の URL に
// 埋め込まれてしまい CSP で止められるので、?no-inline で必ずファイルにする（パスを変数や文字列の連結にしないこと）
export function defaultLevelWorkletUrl(): string {
  return new URL('./levelWorklet.js?no-inline', import.meta.url).href;
}

export interface WorkletCaptureGraphOptions {
  workletUrl?: string;
  chunkMs?: number; // 1回に送る長さ（ミリ秒）。既定は音量の間隔と同じ 10ms
}

// 本物の Web Audio でつなぐ: マイク → AudioWorklet（波形を送る） → 音量 0 → 出力。
// AudioWorklet は出力先までつながっていないと動かないことがあるので、音量 0 のノードを通して出力へつなぐ
export function createWorkletCaptureGraph(options: WorkletCaptureGraphOptions = {}): CreateCaptureGraph {
  return async (stream, onChunk) => {
    const context = new AudioContext({ latencyHint: 'interactive' });
    try {
      await context.audioWorklet.addModule(options.workletUrl ?? defaultLevelWorkletUrl());
      // ボタンを押してから時間がたつと止まった状態で作られることがある。待たずに動かす
      if (context.state === 'suspended') void context.resume().catch(() => {});
      const source = context.createMediaStreamSource(stream as MediaStream);
      const node = new AudioWorkletNode(context, LEVEL_TAP_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers', // ステレオのマイクはモノラルにまとめる
        processorOptions: { chunkFrames: levelWindowFrames(context.sampleRate, options.chunkMs ?? LEVEL_INTERVAL_MS) },
      });
      node.port.onmessage = (e: MessageEvent<unknown>) => {
        const data = e.data as { samples?: unknown; startFrame?: unknown } | null;
        if (data && data.samples instanceof Float32Array && typeof data.startFrame === 'number') {
          onChunk(data.samples, data.startFrame);
        }
      };
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute);
      mute.connect(context.destination);
      return {
        sampleRate: context.sampleRate,
        close() {
          node.port.onmessage = null;
          node.port.close();
          source.disconnect();
          node.disconnect();
          mute.disconnect();
          void context.close().catch(() => {});
        },
      };
    } catch (error) {
      void context.close().catch(() => {});
      throw error;
    }
  };
}
