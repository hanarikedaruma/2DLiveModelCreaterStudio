// カード57（取り込み中の進み具合と、画面が止まらないこと）の画面のテスト。テストの担当は CL（実装の担当は CO）
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createImporter, type ImportWorker } from '@app/io';
import { registry } from '../../../shell/registry';
import { register as registerAssets } from './index';
import { renderShell, testServices } from './testShell';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 進み具合を1つ送ってから、release まで結果を返さない Worker（画面のテストなので中身は解析しない）
function heldWorker() {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  const worker = {
    terminated: false,
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as ((event: MessageEvent<unknown>) => void) | null,
    postMessage(message: { files: { name: string }[] }) {
      void (async () => {
        const send = (data: unknown) => worker.onmessage?.({ data } as MessageEvent);
        send({
          kind: 'progress',
          progress: {
            phase: 'layers',
            fileName: message.files[0]!.name,
            fileIndex: 1,
            fileCount: 1,
            layerIndex: 1,
            layerCount: 3,
            layerName: '前髪',
          },
        });
        await hold;
        if (!worker.terminated) send({ kind: 'result', result: { assets: [], warnings: [] } });
      })();
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return { worker: worker as unknown as ImportWorker & { terminated: boolean }, release };
}

function setup() {
  const held = heldWorker();
  const services = testServices({ importer: createImporter({ workerFactory: () => held.worker }) });
  renderShell(services);
  const input = screen.getAllByLabelText('素材を追加').find((el) => el.tagName === 'INPUT') as HTMLInputElement;
  const pick = () =>
    act(async () => {
      fireEvent.change(input, { target: { files: [new File([PNG_SIGNATURE], 'model.png', { type: 'image/png' })] } });
    });
  return { services, held, pick };
}

beforeEach(() => {
  registry.reset();
  registerAssets();
});

describe('カード57: 取り込み中の画面', () => {
  it('取り込み中は進み具合（ファイル・レイヤー）を出し、ほかの操作ができる。終わったら消える', async () => {
    const { held, pick } = setup();
    await pick();
    const status = await screen.findByRole('status', { name: '素材の取り込み' });
    await waitFor(() => expect(status.textContent).toContain('レイヤー 1/3'));
    expect(status.textContent).toContain('model.png');
    // 取り込み中でも画面は動く（モードを切り替えられる）
    fireEvent.click(screen.getByRole('tab', { name: 'スタジオ' }));
    expect(screen.getByRole('tab', { name: 'スタジオ' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'モデリング' }));
    await act(async () => held.release());
    await waitFor(() => expect(screen.queryByRole('status', { name: '素材の取り込み' })).toBeNull());
  });

  it('「取り込みを取り消す」で止まり、素材は増えない', async () => {
    const { services, held, pick } = setup();
    await pick();
    const status = await screen.findByRole('status', { name: '素材の取り込み' });
    // 開始直後の表示はWorker生成より先に出る。ここでは起動済みWorkerの停止を確かめる
    await waitFor(() => expect(status.textContent).toContain('レイヤー 1/3'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取り込みを取り消す' }));
    });
    await waitFor(() => expect(screen.queryByRole('status', { name: '素材の取り込み' })).toBeNull());
    expect(held.worker.terminated).toBe(true);
    held.release();
    expect(services.store.get().assets).toHaveLength(0);
  });
});
