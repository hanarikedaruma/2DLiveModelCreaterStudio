// マイクの波形を、決まった長さ（既定は 10ms 分）ずつまとめてメインスレッドへ送る AudioWorklet（カード37）。
// 音量の計算はメインスレッド（level.ts）で行う。音声は PC の中だけで扱い、外へは送らない。
// AudioWorklet はモジュールとして読むので、TypeScript ではなくそのまま動く JavaScript で書く。
// graph.ts の new URL('./levelWorklet.js?no-inline', import.meta.url) で Vite がこのファイルをそのまま同梱する
// （Tauri の CSP は script-src 'self' なので、blob: や data: ではなくアプリの中のファイルとして読む）

const DEFAULT_CHUNK_FRAMES = 480; // 48kHz の 10ms

class LevelTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const frames = options && options.processorOptions ? options.processorOptions.chunkFrames : undefined;
    this.size = Number.isInteger(frames) && frames > 0 ? frames : DEFAULT_CHUNK_FRAMES;
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
    this.startFrame = 0;
  }

  // 入力はノードの設定（channelCount 1・explicit）でモノラルにまとまっている。入力が無いときは無音として数える
  process(inputs) {
    const input = inputs[0];
    const channel = input && input.length > 0 ? input[0] : null;
    const length = channel ? channel.length : 128;
    for (let i = 0; i < length; i++) {
      if (this.filled === 0) this.startFrame = currentFrame + i;
      this.buffer[this.filled] = channel ? channel[i] : 0;
      this.filled += 1;
      if (this.filled === this.size) {
        // バッファは渡してしまう（写さない）。次は新しいバッファに貯める
        this.port.postMessage({ samples: this.buffer, startFrame: this.startFrame }, [this.buffer.buffer]);
        this.buffer = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('level-tap', LevelTapProcessor);
