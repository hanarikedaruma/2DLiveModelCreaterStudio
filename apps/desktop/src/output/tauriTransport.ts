// Tauri の別ウィンドウ（label 'output'）とイベントでやりとりする
import { emitTo, listen, TauriEvent } from '@tauri-apps/api/event';
import { PhysicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Size } from '../modes/studio/placement';
import { decodeToOutput, encodeToOutput, isFromOutput, type FromOutput, type WireToOutput } from './protocol';
import type { OutputClient, OutputHost } from './transport';

export const MAIN_WINDOW_LABEL = 'main';
export const OUTPUT_WINDOW_LABEL = 'output';
export const EVENT_TO_OUTPUT = 'studio-output:message';
export const EVENT_TO_MAIN = 'studio-output:reply';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createTauriOutputHost(): OutputHost {
  const listeners = new Set<(m: FromOutput) => void>();
  let win: WebviewWindow | null = null;
  let unlistenReply: Promise<() => void> | null = null;
  const deliver = (m: FromOutput) => {
    for (const l of [...listeners]) l(m);
  };

  // ユーザーが閉じたら closed を出す
  function watch(w: WebviewWindow) {
    win = w;
    void w.once(TauriEvent.WINDOW_DESTROYED, () => {
      if (win !== w) return;
      win = null;
      deliver({ type: 'closed' });
    });
  }

  async function setInnerSize(w: WebviewWindow, size: Size) {
    // 拡大率に左右されないように実ピクセルで合わせる（window-state が前回の大きさに戻すのもここで上書きする）
    await w.setSize(new PhysicalSize(Math.round(size.width), Math.round(size.height)));
  }

  return {
    async open(size) {
      // 出力ウィンドウが ready を出す前に受け取りを始めておく
      unlistenReply ??= listen<unknown>(EVENT_TO_MAIN, (e) => {
        if (isFromOutput(e.payload)) deliver(e.payload);
      });
      await unlistenReply;

      const existing = await WebviewWindow.getByLabel(OUTPUT_WINDOW_LABEL);
      if (existing) {
        // メインを読み込み直したときなど。すでに開いている出力ウィンドウを使い、送り直す
        watch(existing);
        await setInnerSize(existing, size);
        await existing.setFocus();
        deliver({ type: 'ready' });
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const created = new WebviewWindow(OUTPUT_WINDOW_LABEL, {
        url: '/output',
        title: '出力',
        width: size.width / dpr,
        height: size.height / dpr,
        resizable: true,
      });
      await new Promise<void>((resolve, reject) => {
        void created.once('tauri://created', () => resolve());
        void created.once('tauri://error', (e) => reject(new Error(`出力ウィンドウを開けない: ${String(e.payload)}`)));
      });
      watch(created);
      await setInnerSize(created, size);
    },
    async resize(size) {
      if (win) await setInnerSize(win, size);
    },
    async focus() {
      await win?.setFocus();
    },
    close() {
      const w = win;
      if (!w) return;
      w.close().catch((e: unknown) => console.error('出力ウィンドウを閉じられない', errorText(e)));
    },
    send(message) {
      if (!win) return;
      emitTo(OUTPUT_WINDOW_LABEL, EVENT_TO_OUTPUT, encodeToOutput(message)).catch(() => {
        // 閉じる途中などで届かなかったものは捨てる
      });
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createTauriOutputClient(): OutputClient {
  return {
    async listen(listener) {
      const offMessage = await listen<WireToOutput>(EVENT_TO_OUTPUT, (e) => listener(decodeToOutput(e.payload)));
      // メインのウィンドウが閉じたら出力ウィンドウも閉じる（残るとアプリが終わらない）
      const offMain = await listen(
        TauriEvent.WINDOW_DESTROYED,
        () => {
          getCurrentWindow()
            .close()
            .catch(() => {});
        },
        { target: { kind: 'Window', label: MAIN_WINDOW_LABEL } },
      );
      return () => {
        offMessage();
        offMain();
      };
    },
    send(message) {
      emitTo(MAIN_WINDOW_LABEL, EVENT_TO_MAIN, message).catch((e: unknown) =>
        console.error('メインのウィンドウに送れない', errorText(e)),
      );
    },
  };
}
