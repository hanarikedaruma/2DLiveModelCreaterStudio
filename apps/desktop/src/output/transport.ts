// 出力ウィンドウとのやりとりの口。Tauri（tauriTransport.ts）、ブラウザでの開発用（browserTransport.ts）、テスト用（下のメモリ）がある
import type { Size } from '../modes/studio/placement';
import type { FromOutput, ToOutput } from './protocol';

// メインのウィンドウ側
export interface OutputHost {
  open(size: Size): Promise<void>; // 出力ウィンドウを開く。中の大きさを size（実ピクセル）にする
  resize(size: Size): Promise<void>;
  focus(): Promise<void>;
  close(): void;
  send(message: ToOutput): void;
  onMessage(listener: (message: FromOutput) => void): () => void; // ready・closed（ユーザーが閉じたとき）
}

// 出力ウィンドウ側
export interface OutputClient {
  listen(listener: (message: ToOutput) => void): Promise<() => void>; // 受け取りを始めてから resolve する
  send(message: FromOutput): void;
}

// テスト用。同じプロセスの中で、すぐに相手へ渡す
export interface MemoryOutputPair {
  host: OutputHost;
  client: OutputClient;
  opened: Size[];
  resized: Size[];
  focused: number;
  isOpen: boolean;
  sent: ToOutput[]; // host が送ったもの
  closeFromOutput(): void; // ユーザーが出力ウィンドウを閉じたことにする
}

export function createMemoryOutputPair(): MemoryOutputPair {
  const toHost = new Set<(m: FromOutput) => void>();
  const toClient = new Set<(m: ToOutput) => void>();
  const pair: MemoryOutputPair = {
    opened: [],
    resized: [],
    focused: 0,
    isOpen: false,
    sent: [],
    host: {
      async open(size) {
        pair.opened.push(size);
        pair.isOpen = true;
      },
      async resize(size) {
        pair.resized.push(size);
      },
      async focus() {
        pair.focused += 1;
      },
      close() {
        if (!pair.isOpen) return;
        pair.isOpen = false;
        for (const l of [...toHost]) l({ type: 'closed' });
      },
      send(message) {
        if (!pair.isOpen) return;
        pair.sent.push(message);
        for (const l of [...toClient]) l(message);
      },
      onMessage(listener) {
        toHost.add(listener);
        return () => {
          toHost.delete(listener);
        };
      },
    },
    client: {
      async listen(listener) {
        toClient.add(listener);
        return () => {
          toClient.delete(listener);
        };
      },
      send(message) {
        for (const l of [...toHost]) l(message);
      },
    },
    closeFromOutput() {
      pair.host.close();
    },
  };
  return pair;
}
