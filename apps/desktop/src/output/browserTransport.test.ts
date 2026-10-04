import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserOutputClient,
  createBrowserOutputHost,
  OUTPUT_WINDOW_NAME,
  type ChannelLike,
  type PopupLike,
} from './browserTransport';
import type { FromOutput, ToOutput } from './protocol';

// 同じ名前の BroadcastChannel の代わり。送った本人には届かない
function channelHub() {
  const members = new Set<{ listeners: Set<(e: MessageEvent) => void> }>();
  const make = (): ChannelLike => {
    const me = { listeners: new Set<(e: MessageEvent) => void>() };
    members.add(me);
    return {
      postMessage(data) {
        for (const m of members) {
          if (m === me) continue;
          for (const l of [...m.listeners]) l({ data } as MessageEvent);
        }
      },
      addEventListener: (_type, l) => me.listeners.add(l),
      removeEventListener: (_type, l) => me.listeners.delete(l),
      close: () => members.delete(me),
    };
  };
  return { make, size: () => members.size };
}

function fakePopup() {
  const popup = {
    closed: false,
    focus: vi.fn(),
    close: vi.fn(() => {
      popup.closed = true;
    }),
    resizeTo: vi.fn(),
    innerWidth: 1000,
    innerHeight: 500,
    outerWidth: 1016,
    outerHeight: 540,
  };
  return popup satisfies PopupLike;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ブラウザでの出力ウィンドウ', () => {
  it('window.open で /output を開き、BroadcastChannel でやりとりする', async () => {
    const hub = channelHub();
    const popup = fakePopup();
    const openWindow = vi.fn((_url: string, _name: string, _features: string): PopupLike => popup);
    const host = createBrowserOutputHost({ channel: hub.make, openWindow });
    const fromOutput: FromOutput[] = [];
    host.onMessage((m) => fromOutput.push(m));
    await host.open({ width: 1280, height: 720 });
    expect(openWindow).toHaveBeenCalledWith('/output', OUTPUT_WINDOW_NAME, expect.stringContaining('width=1280'));
    expect(openWindow.mock.calls[0]![2]).toContain('height=720');

    const client = createBrowserOutputClient(hub.make());
    const toOutput: ToOutput[] = [];
    await client.listen((m) => toOutput.push(m));
    client.send({ type: 'ready' });
    expect(fromOutput).toEqual([{ type: 'ready' }]);
    const message: ToOutput = {
      type: 'frame',
      params: {},
      view: { scale: 1, offset: { x: 0, y: 0 } },
      background: { type: 'transparent' },
      size: { width: 1280, height: 720 },
      now: 1,
    };
    host.send(message);
    expect(toOutput).toEqual([message]);

    await host.resize({ width: 1920, height: 1080 });
    expect(popup.resizeTo).toHaveBeenCalledWith(1920 + 16, 1080 + 40);
  });

  it('ユーザーが閉じたら closed を出す', async () => {
    const hub = channelHub();
    const popup = fakePopup();
    const host = createBrowserOutputHost({ channel: hub.make, openWindow: () => popup, pollMs: 100 });
    const fromOutput: FromOutput[] = [];
    host.onMessage((m) => fromOutput.push(m));
    await host.open({ width: 640, height: 360 });
    popup.closed = true;
    vi.advanceTimersByTime(100);
    expect(fromOutput).toEqual([{ type: 'closed' }]);
    expect(hub.size()).toBe(0);
  });

  it('ポップアップが止められたら例外', async () => {
    const host = createBrowserOutputHost({ channel: channelHub().make, openWindow: () => null });
    await expect(host.open({ width: 640, height: 360 })).rejects.toThrow('ポップアップ');
  });
});
