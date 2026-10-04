import { afterEach, describe, expect, it } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createEmptyProject } from '@app/schema';
import type { FromOutput, ToOutput } from './protocol';
import {
  createTauriOutputClient,
  createTauriOutputHost,
  EVENT_TO_MAIN,
  EVENT_TO_OUTPUT,
  OUTPUT_WINDOW_LABEL,
} from './tauriTransport';

interface Call {
  cmd: string;
  args: Record<string, unknown>;
}
interface Handler {
  event: string;
  target: unknown;
  callback: number;
  eventId: number;
}

// Tauri の IPC の偽物。invoke を記録し、イベントの listen を覚えておいて fire で呼ぶ
function fakeIpc(windows: string[]) {
  const calls: Call[] = [];
  let handlers: Handler[] = [];
  let nextId = 1;
  mockIPC((cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args });
    if (cmd === 'plugin:event|listen') {
      const eventId = nextId++;
      handlers.push({ event: String(args.event), target: args.target, callback: Number(args.handler), eventId });
      return eventId;
    }
    if (cmd === 'plugin:event|unlisten') {
      handlers = handlers.filter((h) => h.eventId !== args.eventId);
      return null;
    }
    if (cmd === 'plugin:window|get_all_windows') return windows;
    return null;
  });
  const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback(id: number, data: unknown): void } })
    .__TAURI_INTERNALS__;
  return {
    calls,
    listening: (event: string) => handlers.filter((h) => h.event === event),
    fire(event: string, payload: unknown, target?: unknown) {
      for (const h of handlers.filter((x) => x.event === event)) {
        if (target !== undefined && JSON.stringify(h.target) !== JSON.stringify(target)) continue;
        internals.runCallback(h.callback, { event, id: h.eventId, payload });
      }
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  clearMocks();
});

describe('Tauri の出力ウィンドウ（メイン側）', () => {
  it('受け取りを始めてから、選んだ大きさで別ウィンドウを作り、実ピクセルで合わせる', async () => {
    mockWindows('main');
    const ipc = fakeIpc(['main']);
    const host = createTauriOutputHost();
    const received: FromOutput[] = [];
    host.onMessage((m) => received.push(m));
    await host.open({ width: 1280, height: 720 });

    const cmds = ipc.calls.map((c) => c.cmd);
    expect(cmds.indexOf('plugin:event|listen')).toBeLessThan(cmds.indexOf('plugin:webview|create_webview_window'));
    const create = ipc.calls.find((c) => c.cmd === 'plugin:webview|create_webview_window')!;
    expect(create.args.options).toMatchObject({
      label: OUTPUT_WINDOW_LABEL,
      url: '/output',
      title: '出力',
      width: 1280,
      height: 720,
    });
    const setSize = ipc.calls.find((c) => c.cmd === 'plugin:window|set_size')!;
    expect(setSize.args.label).toBe(OUTPUT_WINDOW_LABEL);
    expect(JSON.parse(JSON.stringify(setSize.args.value))).toEqual({ Physical: { width: 1280, height: 720 } });

    ipc.fire(EVENT_TO_MAIN, { type: 'ready' });
    expect(received).toEqual([{ type: 'ready' }]);

    // 送るときは JSON にできる形（base64）にして、出力ウィンドウ宛てに出す
    host.send({
      type: 'project',
      project: createEmptyProject('p'),
      assets: { a: new Uint8Array([1, 2, 3]) },
      backgrounds: {},
    });
    await settle();
    const emit = ipc.calls.find((c) => c.cmd === 'plugin:event|emit_to')!;
    expect(emit.args.target).toEqual({ kind: 'AnyLabel', label: OUTPUT_WINDOW_LABEL });
    expect(emit.args.event).toBe(EVENT_TO_OUTPUT);
    expect((emit.args.payload as { assets: Record<string, string> }).assets).toEqual({ a: 'AQID' });

    await host.resize({ width: 1920, height: 1080 });
    expect(
      JSON.parse(JSON.stringify(ipc.calls.filter((c) => c.cmd === 'plugin:window|set_size')[1]!.args.value)),
    ).toEqual({
      Physical: { width: 1920, height: 1080 },
    });

    host.close();
    await settle();
    expect(ipc.calls.some((c) => c.cmd === 'plugin:window|close' && c.args.label === OUTPUT_WINDOW_LABEL)).toBe(true);

    // ウィンドウが消えたら closed
    ipc.fire('tauri://destroyed', null, { kind: 'WebviewWindow', label: OUTPUT_WINDOW_LABEL });
    expect(received).toEqual([{ type: 'ready' }, { type: 'closed' }]);
  });

  it('出力ウィンドウがもう開いていれば、それを前に出して送り直す', async () => {
    mockWindows('main');
    const ipc = fakeIpc(['main', OUTPUT_WINDOW_LABEL]);
    const host = createTauriOutputHost();
    const received: FromOutput[] = [];
    host.onMessage((m) => received.push(m));
    await host.open({ width: 1280, height: 720 });
    expect(ipc.calls.some((c) => c.cmd === 'plugin:webview|create_webview_window')).toBe(false);
    expect(ipc.calls.some((c) => c.cmd === 'plugin:window|set_focus')).toBe(true);
    expect(received).toEqual([{ type: 'ready' }]);
  });
});

describe('Tauri の出力ウィンドウ（出力側）', () => {
  it('メインからのメッセージを戻して受け取り、メインへ返す。メインが閉じたら自分も閉じる', async () => {
    mockWindows(OUTPUT_WINDOW_LABEL);
    const ipc = fakeIpc(['main', OUTPUT_WINDOW_LABEL]);
    const client = createTauriOutputClient();
    const received: ToOutput[] = [];
    await client.listen((m) => received.push(m));

    ipc.fire(EVENT_TO_OUTPUT, {
      type: 'project',
      project: createEmptyProject('p'),
      assets: { a: 'AQID' },
      backgrounds: {},
    });
    expect(received[0]).toMatchObject({ type: 'project', assets: { a: new Uint8Array([1, 2, 3]) } });

    client.send({ type: 'ready' });
    await settle();
    const emit = ipc.calls.find((c) => c.cmd === 'plugin:event|emit_to')!;
    expect(emit.args).toMatchObject({ target: { kind: 'AnyLabel', label: 'main' }, event: EVENT_TO_MAIN });

    expect(ipc.listening('tauri://destroyed')[0]!.target).toEqual({ kind: 'Window', label: 'main' });
    ipc.fire('tauri://destroyed', null, { kind: 'Window', label: 'main' });
    await settle();
    expect(ipc.calls.some((c) => c.cmd === 'plugin:window|close' && c.args.label === OUTPUT_WINDOW_LABEL)).toBe(true);
  });
});
