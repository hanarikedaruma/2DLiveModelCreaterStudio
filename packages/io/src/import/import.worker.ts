import { importFiles } from './importEngine';
import type { WorkerReply, WorkerRequest } from './workerMessages';

// DOM と Worker の両方を使うパッケージなので、Worker の窓口だけを構造で表す。
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
};
scope.onmessage = async ({ data }) => {
  try {
    const result = await importFiles(data.files, (progress) => scope.postMessage({ kind: 'progress', progress }));
    scope.postMessage(
      { kind: 'result', result },
      result.assets.map((asset) => asset.png.buffer as ArrayBuffer),
    );
  } catch (error) {
    scope.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
