import { useSyncExternalStore } from 'react';
import type { Services } from '@app/contracts';
import { importControlsOf, ImportCancelledError, type ImportProgress } from '@app/io';

interface ImportState {
  busy: boolean;
  progress: ImportProgress | null;
}
const idle: ImportState = { busy: false, progress: null };
const sessions = new WeakMap<Services, ReturnType<typeof createSession>>();
function createSession(services: Services) {
  const listeners = new Set<() => void>();
  let state = idle;
  let active: { cancelled: boolean } | null = null;
  const set = (next: ImportState) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {
      if (active) {
        active.cancelled = true;
        importControlsOf(services.importer)?.cancel();
      }
    },
    async run<T>(operation: (check: () => void, report: (progress: ImportProgress) => void) => Promise<T>): Promise<T> {
      if (active) throw new Error('素材を取り込み中です。終わるか取り消してから追加してください');
      const job = { cancelled: false };
      active = job;
      const projectId = services.store.get().id;
      const check = () => {
        if (job.cancelled || services.store.get().id !== projectId) throw new ImportCancelledError();
      };
      const report = (progress: ImportProgress) => {
        if (active === job && !job.cancelled) set({ busy: true, progress });
      };
      const control = importControlsOf(services.importer);
      const off = control?.subscribe(() => {
        const progress = control.progress();
        if (progress) report(progress);
      });
      set({ busy: true, progress: null });
      try {
        return await operation(check, report);
      } finally {
        off?.();
        active = null;
        set(idle);
      }
    },
  };
}
export function importSessionOf(services: Services) {
  let session = sessions.get(services);
  if (!session) {
    session = createSession(services);
    sessions.set(services, session);
  }
  return session;
}
export function useImportState(services: Services): ImportState {
  const session = importSessionOf(services);
  return useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
}
