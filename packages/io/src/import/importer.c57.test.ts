// カード57（PSD の取り込みを Worker へ）のテスト。テストの担当は CL（実装の担当は CO。docs/step3/README.md の「テストの分担」）
import { describe, expect, it } from 'vitest';
import { writePsdUint8Array, type Layer } from 'ag-psd';
import type { ImportedAsset, ImportWarning } from '@app/contracts';
import { createImporter, importControlsOf, ImportCancelledError, type ImportWorker } from './importer';
import { encodePng } from './png';
import { makeImage, toPixelData, type Rgba } from './testImages';
import type { ImportProgress, WorkerReply, WorkerRequest } from './workerMessages';

const RED: Rgba = [255, 0, 0, 255];

function layer(
  name: string,
  left: number,
  top: number,
  width: number,
  height: number,
  extra: Partial<Layer> = {},
): Layer {
  return {
    name,
    left,
    top,
    right: left + width,
    bottom: top + height,
    imageData: toPixelData(makeImage(width, height, RED, { x: 2, y: 3, width: width - 4, height: height - 6 })),
    ...extra,
  };
}

// 警告が出る組み合わせを入れた PSD と PNG（大きさの違う PNG・背景が塗られたレイヤー・統合が要るレイヤー）
function sampleFiles() {
  const psd = writePsdUint8Array({
    width: 1200,
    height: 1000,
    children: [
      layer('体', 100, 200, 200, 200),
      layer('顔', 400, 100, 300, 300),
      {
        name: '背景',
        left: 0,
        top: 0,
        right: 1200,
        bottom: 1000,
        imageData: toPixelData(makeImage(1200, 1000, RED, { x: 0, y: 0, width: 1200, height: 1000 })),
      },
      { name: '影', children: [layer('影の中', 10, 10, 50, 50)], blendMode: 'multiply', opacity: 0.5 },
    ],
  });
  const png = encodePng(makeImage(800, 600, RED, { x: 10, y: 20, width: 30, height: 40 }));
  return [
    { name: 'model.psd', data: psd },
    { name: 'extra.png', data: png },
  ];
}

// 本物の Worker の代わりに、同じ解析部をメッセージの受け渡しだけ通して動かす（同じプロセスの中）
function inProcessWorker(
  options: { hold?: Promise<void> } = {},
): ImportWorker & { terminated: boolean; requests: number } {
  const worker = {
    terminated: false,
    requests: 0,
    onmessage: null as ((event: MessageEvent<WorkerReply>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as ((event: MessageEvent<unknown>) => void) | null,
    postMessage(message: WorkerRequest) {
      worker.requests++;
      void (async () => {
        const engine = await import('./importEngine');
        await options.hold;
        if (worker.terminated) return;
        const send = (data: WorkerReply) => worker.onmessage?.({ data } as MessageEvent<WorkerReply>);
        try {
          const result = await engine.importFiles(message.files, (progress) => send({ kind: 'progress', progress }));
          if (!worker.terminated) send({ kind: 'result', result });
        } catch (e) {
          send({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      })();
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker;
}

// id は毎回変わるので、比べるときは id を外し、警告の assetIds は素材の並びの番号にする
function comparable(result: { assets: ImportedAsset[]; warnings: ImportWarning[] }) {
  const index = new Map(result.assets.map((a, i) => [a.asset.id, i]));
  return {
    assets: result.assets.map(({ asset, png }) => {
      const { id: _id, path: _path, ...rest } = asset;
      return { ...rest, pngBytes: png.length };
    }),
    warnings: result.warnings.map((w) => ({ ...w, assetIds: w.assetIds.map((id) => index.get(id)) })),
  };
}

describe('カード57: Worker の経路と前の経路で同じ結果', () => {
  it('同じ PSD・PNG から、同じ素材（位置・大きさ・ハッシュ・元のレイヤー）と警告が出る', async () => {
    const inline = await createImporter({ mode: 'inline' }).importFiles(sampleFiles());
    const viaWorker = await createImporter({ workerFactory: () => inProcessWorker() }).importFiles(sampleFiles());
    expect(comparable(viaWorker)).toEqual(comparable(inline));
    // 警告が実際に出ている組み合わせで比べている
    const kinds = inline.warnings.map((w) => w.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(['canvasMismatch', 'noTransparency']));
    expect(inline.assets.length).toBeGreaterThanOrEqual(4);
  });

  it('呼び出し元のファイルのバイト列を変えない（Worker へは写しを渡す）', async () => {
    const files = sampleFiles();
    const before = files.map((f) => f.data.slice());
    await createImporter({ workerFactory: () => inProcessWorker() }).importFiles(files);
    files.forEach((f, i) => expect(f.data).toEqual(before[i]));
  });
});

describe('カード57: 進み具合と取り消し', () => {
  it('取り込みの間、ファイルとレイヤーの進み具合を出し、終わったら消す', async () => {
    const importer = createImporter({ workerFactory: () => inProcessWorker() });
    const controls = importControlsOf(importer)!;
    const seen: ImportProgress[] = [];
    controls.subscribe(() => {
      const p = controls.progress();
      if (p) seen.push(p);
    });
    await importer.importFiles(sampleFiles());
    expect(seen.some((p) => p.phase === 'layers' && p.fileName === 'model.psd' && p.layerCount > 0)).toBe(true);
    expect(seen.some((p) => p.fileName === 'extra.png')).toBe(true);
    expect(seen.every((p) => p.fileCount === 2)).toBe(true);
    expect(controls.progress()).toBeNull();
  });

  it('途中で取り消すと ImportCancelledError になり、Worker を止め、素材を返さない。次の取り込みはできる', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    // 1回目の取り込みの Worker だけ止めておく。2回目は新しい Worker
    const workers: ReturnType<typeof inProcessWorker>[] = [];
    const importer = createImporter({
      workerFactory: () => {
        const w = inProcessWorker(workers.length === 0 ? { hold } : {});
        workers.push(w);
        return w;
      },
    });
    const running = importer.importFiles(sampleFiles());
    await new Promise((r) => setTimeout(r, 20));
    importControlsOf(importer)!.cancel();
    release();
    await expect(running).rejects.toBeInstanceOf(ImportCancelledError);
    expect(workers[0]?.terminated).toBe(true);
    expect(importControlsOf(importer)!.progress()).toBeNull();
    // 取り消したあとも、同じ取り込みの口で次の取り込みができる
    const again = await importer.importFiles(sampleFiles());
    expect(again.assets.length).toBeGreaterThan(0);
  });
});
