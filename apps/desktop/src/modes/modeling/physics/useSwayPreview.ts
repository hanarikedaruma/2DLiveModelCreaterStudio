// [揺れを試す] の再生。前もって計算した値を、時刻に合わせて EditorState.editorParamValues（モデリングのプレビュー値）に入れ、
// 終わったら（止めたとき・セクションが消えたときも）元の値に戻す。プロジェクトと Undo の履歴には触れない
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParamValues } from '@app/contracts';
import type { Physics } from '@app/schema';
import { useServices } from '../../../shell/api';
import { simulateSwayPreview } from './preview';

type Handle = ReturnType<typeof setTimeout> | number;
const requestFrame = (cb: () => void): Handle =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16);
const cancelFrame = (h: Handle) => {
  if (typeof h === 'number' && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(h);
  else clearTimeout(h);
};

export function useSwayPreview(): {
  playing: boolean;
  start(physicsId: string, direction?: Physics['direction']): void;
  stop(): void;
} {
  const services = useServices();
  const running = useRef<{ handle: Handle | null; saved: ParamValues; projectId: string } | null>(null);
  const [playing, setPlaying] = useState(false);

  const stop = useCallback(() => {
    const run = running.current;
    if (!run) return;
    running.current = null;
    if (run.handle !== null) cancelFrame(run.handle);
    if (services.store.get().id === run.projectId) services.editor.set({ editorParamValues: run.saved });
    setPlaying(false);
  }, [services]);

  // セクションが消えたら止める
  useEffect(() => stop, [stop]);
  useEffect(() => {
    let selection = services.editor.get().selectedPartIds.join('\0');
    let project = services.store.get();
    const offEditor = services.editor.subscribe((editor) => {
      const next = editor.selectedPartIds.join('\0');
      if (next === selection) return;
      selection = next;
      stop();
    });
    const offStore = services.store.subscribe((next) => {
      const changed = next.id !== project.id || next.physics !== project.physics;
      project = next;
      if (changed) stop();
    });
    return () => {
      offEditor();
      offStore();
    };
  }, [services, stop]);

  const start = useCallback(
    (physicsId: string, direction?: Physics['direction']) => {
      stop();
      const preview = simulateSwayPreview(
        services.store.get(),
        physicsId,
        undefined,
        direction,
        services.editor.get().editorParamValues,
      );
      if (!preview) return;
      const run = {
        handle: null as Handle | null,
        saved: services.editor.get().editorParamValues,
        projectId: services.store.get().id,
      };
      running.current = run;
      setPlaying(true);
      const startedAt = performance.now();
      const tick = () => {
        if (running.current !== run) return;
        const frame = preview.frames[Math.floor(((performance.now() - startedAt) / 1000) * preview.fps)];
        if (!frame) {
          stop();
          return;
        }
        services.editor.set({ editorParamValues: { ...run.saved, ...frame } });
        run.handle = requestFrame(tick);
      };
      tick();
    },
    [services, stop],
  );

  return { playing, start, stop };
}
