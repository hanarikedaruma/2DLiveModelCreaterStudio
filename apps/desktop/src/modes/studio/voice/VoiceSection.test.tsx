import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultVoiceSettings } from '@app/schema';
import type { VoiceInspection } from '@app/contracts';
import { createFakeServices } from '../../../services';
import { Shell } from '../../../shell/Shell';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { register as registerStudio } from '../index';
import { animationFrameScheduler, studioRuntime } from '../runtime';
import { register } from './index';

const inspection: VoiceInspection = {
  ready: true,
  reason: '',
  modelRoot: 'models',
  inputs: [{ id: 'mic', index: 0, label: 'マイク' }],
  outputs: [{ id: 'out', index: 1, label: 'ヘッドホン' }],
  filters: [
    {
      type: 'resonance',
      title: '電子感・金属音の抑制',
      description: '帯域を抑える',
      parameters: [{ key: 'strength', label: '抑制の強さ', minimum: 0, maximum: 100, default: 35, unit: '%' }],
    },
  ],
};
beforeEach(() => {
  registry.reset();
  registerStudio();
  register();
  studioRuntime.setScheduler({ request: () => () => {} });
});
afterEach(() => {
  studioRuntime.setScheduler(animationFrameScheduler());
  registry.reset();
});
async function setup(metrics?: Record<string, number>) {
  const services = createFakeServices();
  if (metrics) {
    const state = { ...services.voice.state(), metrics };
    services.voice.state = () => state;
  }
  services.createRenderer = () => ({ init() {}, setTextures() {}, render() {}, dispose() {} });
  services.voice.inspect = vi.fn(async () => inspection);
  services.voice.start = vi.fn(async () => {});
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  await act(async () => {
    await environment.load();
    services.editor.set({ mode: 'studio' });
  });
  await waitFor(() => expect(services.voice.inspect).toHaveBeenCalled());
  return { services, environment };
}
describe('スタジオの声と口の設定', () => {
  it('入力ゲイン調整後のレベルと過大入力の注意を表示する', async () => {
    await setup({ inputPeak: 0.2, inputGainPeak: 1.2 });
    expect(screen.getByRole('meter', { name: '音声の入力レベル' }).getAttribute('value')).toBe('1.2');
    expect(screen.getByText('入力ゲイン調整後の音量が大きすぎます。入力ゲインを下げてください。')).toBeTruthy();
  });
  it('声の調整とフィルタをプロジェクトに記録し、Undoできる', async () => {
    const { services } = await setup();
    fireEvent.click(screen.getByRole('tab', { name: '声の調整' }));
    fireEvent.change(screen.getByRole('slider', { name: '声の明るさ' }), { target: { value: '2' } });
    expect(services.store.get().studio.voice?.profile.voiceTone.brightnessDb).toBe(2);
    services.store.undo();
    expect(services.store.get().studio.voice).toBeUndefined();
    fireEvent.click(screen.getByRole('tab', { name: 'フィルタ' }));
    fireEvent.click(screen.getByLabelText('フィルタ全体を有効'));
    expect(services.store.get().studio.voice?.profile.outputFilters.enabled).toBe(false);
  });
  it('AI専用の品質と機器を選び、1つの操作で音声と口を開始する', async () => {
    const { services, environment } = await setup();
    fireEvent.change(screen.getByRole('combobox', { name: '音声のマイク' }), { target: { value: 'mic' } });
    fireEvent.change(screen.getByRole('combobox', { name: '音声の出力先' }), { target: { value: 'out' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '音声と口の動きを開始' })));
    expect(services.voice.start).toHaveBeenCalledWith(createDefaultVoiceSettings().profile, environment.get().voice);
    expect(services.store.get().model.lipSync.mouthSource).toBe('micOnly');
    fireEvent.click(screen.getByRole('tab', { name: '声の調整' }));
    expect(screen.getByRole('combobox', { name: 'AI方式・品質' }).textContent).not.toContain('Pitch');
    fireEvent.change(screen.getByRole('combobox', { name: 'AI方式・品質' }), { target: { value: 'hqQuality' } });
    expect(services.store.get().studio.voice?.profile).toMatchObject({
      quality: 'hq',
      backend: 'seed-whisper-large',
      advanced: { steps: 30 },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'AI方式・品質' }), { target: { value: 'balanced' } });
    expect(services.store.get().studio.voice?.profile.quality).toBe('balanced');
    expect(services.store.get().studio.voice?.profile.advanced).toBeUndefined();
  });
});
