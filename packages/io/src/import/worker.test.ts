// カード57の実装担当の回帰テスト。Worker の転送・終了・エラー・キャンセルを確かめる。
import { describe, expect, it, vi } from 'vitest';
import { createImporter, importControlsOf, type ImportWorker } from './importer';
import { importFiles } from './importEngine';
import { encodePng } from './png';
import type { WorkerReply, WorkerRequest } from './workerMessages';

class WorkerDouble implements ImportWorker {
  onmessage: ImportWorker['onmessage'] = null;
  onerror: ImportWorker['onerror'] = null;
  onmessageerror: ImportWorker['onmessageerror'] = null;
  terminate = vi.fn();
  posted: WorkerRequest | null = null;
  constructor(private parse = false) {}
  reply(data: WorkerReply) {
    this.onmessage?.({ data } as MessageEvent<WorkerReply>);
  }
  postMessage(message: WorkerRequest, transfer: Transferable[]) {
    this.posted = structuredClone(message, { transfer });
    if (this.parse) {
      void importFiles(this.posted.files, (progress) => this.reply({ kind: 'progress', progress }))
        .then((result) => this.reply({ kind: 'result', result }))
        .catch((error: Error) => this.reply({ kind: 'error', message: error.message }));
    }
  }
}
const png = () => encodePng({ width: 2, height: 1, data: new Uint8Array([1, 2, 3, 255, 0, 0, 0, 0]) });

describe('Worker の取り込み（カード57）', () => {
  it('転送しても入力を変えず、直接の解析と素材・位置・ハッシュ・警告が一致する', async () => {
    const worker = new WorkerDouble(true);
    const importer = createImporter({ workerFactory: () => worker });
    const input = png();
    const before = input.slice();
    const progress = vi.fn();
    importControlsOf(importer)!.subscribe(progress);
    const threaded = await importer.importFiles([{ name: 'test.png', data: input }]);
    const direct = await createImporter({ mode: 'inline' }).importFiles([{ name: 'test.png', data: input }]);
    const normalize = (result: typeof threaded) => ({
      assets: result.assets.map(({ asset, png }) => ({ ...asset, id: '', path: '', png })),
      warnings: result.warnings.map((warning) => ({ ...warning, assetIds: [] })),
    });
    expect(normalize(threaded)).toEqual(normalize(direct));
    expect(input).toEqual(before);
    expect(progress).toHaveBeenCalled();
    expect(importControlsOf(importer)!.progress()).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('解析中の取り消しは Worker を止めて拒否し、次の取り込みは新しい Worker を使える', async () => {
    const workers: WorkerDouble[] = [];
    const importer = createImporter({
      workerFactory: () => {
        const worker = new WorkerDouble();
        workers.push(worker);
        return worker;
      },
    });
    const first = importer.importFiles([{ name: 'test.png', data: png() }]);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(workers[0]!.posted).not.toBeNull());
    importControlsOf(importer)!.cancel();
    await rejected;
    expect(workers[0]!.terminate).toHaveBeenCalled();
    const second = importer.importFiles([{ name: 'again.png', data: png() }]);
    await vi.waitFor(() => expect(workers[1]!.posted).not.toBeNull());
    workers[1]!.reply({ kind: 'result', result: { assets: [], warnings: [] } });
    await expect(second).resolves.toEqual({ assets: [], warnings: [] });
    expect(workers[1]!.terminate).toHaveBeenCalledOnce();
  });

  it('Worker の実行時エラーを知らせて終了し、進捗を残さない', async () => {
    const worker = new WorkerDouble();
    const importer = createImporter({ workerFactory: () => worker });
    const pending = importer.importFiles([{ name: 'test.png', data: png() }]);
    const rejected = expect(pending).rejects.toThrow('Worker が停止した: broken');
    await vi.waitFor(() => expect(worker.posted).not.toBeNull());
    worker.onerror?.({ message: 'broken' } as ErrorEvent);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(importControlsOf(importer)!.progress()).toBeNull();
  });

  it('入力のコピー中に届く Worker の起動エラーも見逃さない', async () => {
    const worker = new WorkerDouble();
    const importer = createImporter({
      workerFactory: () => {
        queueMicrotask(() => worker.onerror?.({ message: '起動に失敗' } as ErrorEvent));
        return worker;
      },
    });
    await expect(importer.importFiles([{ name: 'test.png', data: png() }])).rejects.toThrow('起動に失敗');
    expect(worker.posted).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
