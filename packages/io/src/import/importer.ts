// 公開の Importer の型を保ったまま、ブラウザでは1回の取り込みごとに Worker を使う。
import type { Importer } from '@app/contracts';
import type { ImportProgress, WorkerReply, WorkerRequest } from './workerMessages';

export interface ImportFile {
  name: string;
  data: Uint8Array;
}
export const MIN_CANVAS_SIDE = 1000;
export const MAX_CANVAS_SIDE = 8000;
export type { ImportProgress } from './workerMessages';
export type ImportResult = Awaited<ReturnType<Importer['importFiles']>>;
export interface ImportControls {
  progress(): ImportProgress | null;
  subscribe(listener: () => void): () => void;
  cancel(): void;
}
const controls = new WeakMap<Importer, ImportControls>();
export const importControlsOf = (importer: Importer): ImportControls | undefined => controls.get(importer);

export interface ImportWorker {
  postMessage(message: WorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export class ImportCancelledError extends Error {
  constructor() {
    super('取り込みを取り消した');
    this.name = 'AbortError';
  }
}
interface ImportJob {
  cancelled: boolean;
  worker?: ImportWorker;
  reject?: (error: Error) => void;
  failure?: Error;
}

// Node の単体テストでは同じ解析部を直接使う。ブラウザでは Worker の失敗を画面へ返す。
export function createImporter(
  options: { workerFactory?: () => ImportWorker; mode?: 'inline' | 'auto' } = {},
): Importer {
  const listeners = new Set<() => void>();
  let progress: ImportProgress | null = null;
  let active: ImportJob | null = null;
  const publish = (value: ImportProgress | null) => {
    progress = value;
    for (const listener of [...listeners]) listener();
  };
  const importer: Importer = {
    async importFiles(files) {
      if (active) throw new Error('素材を取り込み中です。終わるか取り消してから追加してください');
      const job: ImportJob = { cancelled: false };
      active = job;
      const checkCancelled = () => {
        if (job.cancelled) throw new ImportCancelledError();
        if (job.failure) throw job.failure;
      };
      const report = (value: ImportProgress) => {
        if (active === job && !job.cancelled) publish(value);
      };
      try {
        const inline = options.mode === 'inline' || (!options.workerFactory && typeof Worker === 'undefined');
        if (inline) {
          const engine = await import('./importEngine');
          checkCancelled();
          const result = await engine.importFiles(files, report);
          checkCancelled();
          return result;
        }
        const worker: ImportWorker =
          options.workerFactory?.() ?? new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
        job.worker = worker;
        // モジュールを読み込めないエラーは入力のコピー中にも届くので、先に受け口を付ける。
        const fail = (error: Error) => {
          job.failure = error;
          job.reject?.(error);
        };
        worker.onerror = (event) => fail(new Error(`取り込みの Worker が停止した: ${event.message}`));
        worker.onmessageerror = () => fail(new Error('取り込みの Worker の結果を読めない'));
        // 元の入力は変えない。大きな PSD を一度にコピーして画面を止めないように、4 MiB ごとに譲る。
        const copied: ImportFile[] = [];
        for (const [index, file] of files.entries()) {
          report({
            phase: 'reading',
            fileName: file.name,
            fileIndex: index + 1,
            fileCount: files.length,
            layerIndex: 0,
            layerCount: 0,
          });
          const data = new Uint8Array(file.data.byteLength);
          for (let offset = 0; offset < file.data.byteLength; offset += 4 * 1024 * 1024) {
            checkCancelled();
            data.set(file.data.subarray(offset, offset + 4 * 1024 * 1024), offset);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          copied.push({ name: file.name, data });
        }
        checkCancelled();
        return await new Promise<ImportResult>((resolve, reject) => {
          job.reject = reject;
          worker.onmessage = ({ data }) => {
            if (data.kind === 'progress') report(data.progress);
            else if (data.kind === 'result') resolve(data.result);
            else reject(new Error(data.message));
          };
          worker.postMessage(
            { kind: 'import', files: copied },
            copied.map((file) => file.data.buffer as ArrayBuffer),
          );
        });
      } finally {
        job.worker?.terminate();
        if (active === job) {
          active = null;
          publish(null);
        }
      }
    },
  };
  controls.set(importer, {
    progress: () => progress,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {
      if (!active) return;
      active.cancelled = true;
      active.worker?.terminate();
      active.reject?.(new ImportCancelledError());
    },
  });
  return importer;
}
