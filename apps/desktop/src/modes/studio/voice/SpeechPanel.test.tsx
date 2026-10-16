import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSpeechPreferences, createDefaultVoiceSettings } from '@app/schema';
import { createFakeServices } from '../../../services';
import { Shell } from '../../../shell/Shell';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { register as registerStudio } from '../index';
import { animationFrameScheduler, studioRuntime } from '../runtime';
import { register } from './index';

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
async function setup() {
  const services = createFakeServices();
  services.createRenderer = () => ({ init() {}, setTextures() {}, render() {}, dispose() {} });
  services.voice.inspectSpeech = vi.fn(async () => ({
    ready: true,
    reason: '',
    voice: createDefaultSpeechPreferences().voice,
    outputs: [{ id: 'out', index: 1, label: '配信先' }],
  }));
  services.voice.speak = vi.fn(async () => {});
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  await act(async () => {
    await environment.load();
    services.editor.set({ mode: 'studio' });
  });
  await waitFor(() => expect(screen.getByRole('option', { name: '配信先' })).toBeTruthy());
  fireEvent.change(screen.getByRole('combobox', { name: '読み上げの出力先' }), { target: { value: 'out' } });
  return { services, environment };
}
describe('配信するモデルのチャット読み上げ', () => {
  it('逐次再生を選ぶと設定を保存し、送信時も同じ方式を使う', async () => {
    const { services } = await setup();
    fireEvent.change(screen.getByRole('combobox', { name: '再生方式' }), { target: { value: 'stream' } });
    expect(services.store.get().studio.voice?.speech?.delivery).toBe('stream');
    fireEvent.change(screen.getByRole('textbox', { name: 'モデルが話す言葉' }), {
      target: { value: '続けて話します' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^読み上げ$/ })));
    expect(services.voice.speak).toHaveBeenCalledWith(
      '続けて話します',
      expect.objectContaining({ delivery: 'stream' }),
      expect.any(Object),
      expect.any(Object),
    );
    fireEvent.change(screen.getByRole('combobox', { name: '再生方式' }), { target: { value: 'whole' } });
    expect(services.store.get().studio.voice?.speech?.delivery).toBe('whole');
  });
  it('日本語変換の確定・Enterで送信せず、Ctrl＋Enterでマイクなしに読み上げる', async () => {
    const { services, environment } = await setup();
    const input = screen.getByRole('textbox', { name: 'モデルが話す言葉' });
    fireEvent.change(input, { target: { value: 'みなさん、こんにちは！' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true, keyCode: 229 });
    expect(services.voice.speak).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true }));
    expect(services.voice.speak).toHaveBeenCalledWith(
      'みなさん、こんにちは！',
      createDefaultSpeechPreferences(),
      createDefaultVoiceSettings().profile,
      expect.objectContaining({ inputDeviceId: null, outputDeviceId: 'out' }),
    );
    expect((input as HTMLTextAreaElement).value).toBe('');
    expect(services.store.get().model.lipSync.mouthSource).toBe('micOnly');
    expect(environment.get().voice?.inputDeviceId).toBeNull();
  });
  it('文章をプロジェクトへ保存せず、場面と読み方だけを保存する', async () => {
    const { services } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'やさしい' }));
    fireEvent.change(screen.getByRole('textbox', { name: '場面・話し方' }), { target: { value: '友人を励ます' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'モデルが話す言葉' }), {
      target: { value: '未送信の下書き' },
    });
    const settings = services.store.get().studio.voice;
    expect(settings?.speech).toMatchObject({ style: 'gentle', scene: '友人を励ます', useContext: true });
    expect(JSON.stringify(services.store.get())).not.toContain('未送信の下書き');
  });
  it('生成中も次の文章を書けるが、二重送信と設定変更はできない', async () => {
    const { services } = await setup();
    const current = { ...services.voice.state(), source: 'speech' as const, state: 'loading' as const };
    services.voice.state = () => current;
    // 外部ストアを再描画するためモードを切り替える。
    await act(async () => {
      services.editor.set({ mode: 'modeling' });
    });
    await act(async () => {
      services.editor.set({ mode: 'studio' });
    });
    const input = screen.getByRole('textbox', { name: 'モデルが話す言葉' });
    expect(input.hasAttribute('disabled')).toBe(false);
    fireEvent.change(input, { target: { value: '次の発話' } });
    expect((screen.getByRole('button', { name: /^読み上げ$/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '恥ずかしい' }) as HTMLButtonElement).disabled).toBe(true);
    services.voice.stop = vi.fn(async () => {});
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^読み上げを停止$/ })));
    expect(services.voice.stop).toHaveBeenCalled();
  });
  it('左の感情を選んで入力すると、その感情で先行合成し、変更後の感情で送信する', async () => {
    const { services } = await setup();
    services.voice.prepareSpeechDraft = vi.fn(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '恥ずかしい' }));
    expect(screen.getByRole('button', { name: '恥ずかしい', pressed: true })).toBeTruthy();
    const input = screen.getByRole('textbox', { name: 'モデルが話す言葉' });
    fireEvent.change(input, { target: { value: 'あなたのことが大好きです' } });
    await waitFor(() =>
      expect(services.voice.prepareSpeechDraft).toHaveBeenLastCalledWith(
        'あなたのことが大好きです',
        expect.objectContaining({ style: 'shy' }),
        expect.any(Object),
        expect.any(String),
        expect.any(Number),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'うれしい' }));
    await waitFor(() =>
      expect(services.voice.prepareSpeechDraft).toHaveBeenLastCalledWith(
        'あなたのことが大好きです',
        expect.objectContaining({ style: 'cheerful' }),
        expect.any(Object),
        expect.any(String),
        expect.any(Number),
      ),
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^読み上げ$/ })));
    expect(services.voice.speak).toHaveBeenCalledWith(
      'あなたのことが大好きです',
      expect.objectContaining({ style: 'cheerful' }),
      expect.any(Object),
      expect.any(Object),
    );
  });
});
