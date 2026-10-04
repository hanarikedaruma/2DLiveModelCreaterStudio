// Tauri の外（ブラウザでの開発）で使う。window.open('/output') で開き、BroadcastChannel でやりとりする
import { isFromOutput, isToOutput, type FromOutput, type ToOutput } from './protocol';
import type { OutputClient, OutputHost } from './transport';

export const OUTPUT_CHANNEL_NAME = 'live2d-studio-output';
export const OUTPUT_WINDOW_NAME = 'live2d-studio-output';

export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  close(): void;
}

export interface PopupLike {
  readonly closed: boolean;
  close(): void;
  focus(): void;
  resizeTo(width: number, height: number): void;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly outerWidth: number;
  readonly outerHeight: number;
}

function defaultChannel(): ChannelLike {
  if (typeof BroadcastChannel === 'undefined') throw new Error('BroadcastChannel が使えない');
  return new BroadcastChannel(OUTPUT_CHANNEL_NAME);
}

export function createBrowserOutputHost(
  options: {
    channel?: () => ChannelLike;
    openWindow?: (url: string, name: string, features: string) => PopupLike | null;
    pollMs?: number;
  } = {},
): OutputHost {
  const makeChannel = options.channel ?? defaultChannel;
  const openWindow = options.openWindow ?? ((url, name, features) => window.open(url, name, features));
  const listeners = new Set<(m: FromOutput) => void>();
  let popup: PopupLike | null = null;
  let channel: ChannelLike | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  const deliver = (m: FromOutput) => {
    for (const l of [...listeners]) l(m);
  };
  const onChannel = (e: MessageEvent) => {
    if (isFromOutput(e.data)) deliver(e.data);
  };

  function finish() {
    if (poll !== null) clearInterval(poll);
    poll = null;
    channel?.removeEventListener('message', onChannel);
    channel?.close();
    channel = null;
    if (!popup) return;
    popup = null;
    deliver({ type: 'closed' });
  }

  // ブラウザの window.open の大きさは CSS ピクセル。実ピクセルの大きさに合わせる
  const cssSize = (n: number) => Math.round(n / (window.devicePixelRatio || 1));

  return {
    async open(size) {
      if (!channel) {
        channel = makeChannel();
        channel.addEventListener('message', onChannel);
      }
      const w = openWindow(
        '/output',
        OUTPUT_WINDOW_NAME,
        `popup=yes,width=${cssSize(size.width)},height=${cssSize(size.height)}`,
      );
      if (!w) {
        finish();
        throw new Error('出力ウィンドウを開けない（ポップアップが止められている）');
      }
      popup = w;
      poll ??= setInterval(() => {
        if (popup?.closed) finish();
      }, options.pollMs ?? 500);
    },
    async resize(size) {
      if (!popup) return;
      try {
        popup.resizeTo(
          cssSize(size.width) + (popup.outerWidth - popup.innerWidth),
          cssSize(size.height) + (popup.outerHeight - popup.innerHeight),
        );
      } catch {
        // ブラウザによっては変えられない
      }
    },
    async focus() {
      popup?.focus();
    },
    close() {
      popup?.close();
      finish();
    },
    send(message: ToOutput) {
      channel?.postMessage(message);
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createBrowserOutputClient(channel: ChannelLike = defaultChannel()): OutputClient {
  return {
    async listen(listener) {
      const onMessage = (e: MessageEvent) => {
        if (isToOutput(e.data)) listener(e.data);
      };
      channel.addEventListener('message', onMessage);
      return () => channel.removeEventListener('message', onMessage);
    },
    send(message) {
      channel.postMessage(message);
    },
  };
}
