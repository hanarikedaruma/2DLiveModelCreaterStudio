// 割り当ての画面が出ている間（スタジオのモードの間）、ホットキーの実行部を services につなぐ
import { useEffect, useRef } from 'react';
import { emitAppEvent, useDialogs, useEnvironment, useServices } from '../shell/api';
import { useStudioRuntime } from '../modes/studio';
import { hotkeyRuntime, type HotkeyRuntime } from './runtime';

export function useHotkeyBinding(runtime: HotkeyRuntime = hotkeyRuntime): void {
  const services = useServices();
  const [env] = useEnvironment();
  const dialogs = useDialogs();
  const { status } = useStudioRuntime();
  // ホットキーは画面の外から呼ばれるので、いまの値は ref から読む
  const latest = useRef({ cameraDeviceId: env.cameraDeviceId, status });
  useEffect(() => {
    latest.current = { cameraDeviceId: env.cameraDeviceId, status };
  });

  useEffect(
    () =>
      runtime.attach({
        services,
        now: () => performance.now(),
        emit: emitAppEvent,
        trackingSessionActive: () => latest.current.status !== 'stopped',
        cameraDeviceId: () => latest.current.cameraDeviceId,
        notify: dialogs.notify,
      }),
    [runtime, services, dialogs],
  );

  // トラッキングを停止したら、ホットキーの一時停止の印を消す
  useEffect(() => {
    if (status === 'stopped') runtime.actions.trackingSessionEnded();
  }, [runtime, status]);
}
