import { emitTo, listen, TauriEvent } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { REQUEST_EVENT, RESPONSE_EVENT, type SpeechAction, type SpeechResponse, type SpeechSnapshot } from './protocol';

export async function connectSpeechInput(onSnapshot: (value: SpeechSnapshot) => void) {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) throw new Error('メインウィンドウから入力欄を開いてください');
  let projectId = '';
  const pending = new Map<
    string,
    { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  const off = await listen<SpeechResponse>(RESPONSE_EVENT, ({ payload }) => {
    if (payload.token !== token) return;
    if ('snapshot' in payload) {
      projectId = payload.snapshot.projectId;
      onSnapshot(payload.snapshot);
      return;
    }
    const item = pending.get(payload.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(payload.id);
    if (payload.error) item.reject(new Error(payload.error));
    else item.resolve();
  });
  const offMain = await listen(
    TauriEvent.WINDOW_DESTROYED,
    () => {
      void getCurrentWindow().close();
    },
    { target: { kind: 'Window', label: 'main' } },
  );
  async function request(action: SpeechAction) {
    const id = crypto.randomUUID();
    const result = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('メインウィンドウから応答がありません'));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
    });
    void emitTo('main', REQUEST_EVENT, { ...action, token, id, projectId }).catch((error: unknown) => {
      const item = pending.get(id);
      if (item) {
        clearTimeout(item.timer);
        pending.delete(id);
        item.reject(new Error(String(error)));
      }
    });
    return result;
  }
  return {
    request,
    close() {
      off();
      offMain();
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('入力ウィンドウを閉じました'));
      }
      pending.clear();
    },
  };
}
