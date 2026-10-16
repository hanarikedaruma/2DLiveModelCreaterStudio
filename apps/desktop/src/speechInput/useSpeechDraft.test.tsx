import { StrictMode, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSpeechDraft } from './useSpeechDraft';
afterEach(() => vi.useRealTimers());

describe('入力中の先行合成', () => {
  it('150msの停止で最新全文だけを渡し、再生操作は呼び出さない', async () => {
    vi.useFakeTimers();
    const prepare = vi.fn(async () => {}),
      discard = vi.fn(async () => {});
    const hook = renderHook(({ text }) => useSpeechDraft(text, true, 'profile', prepare, discard), {
      initialProps: { text: '最初' },
    });
    act(() => vi.advanceTimersByTime(100));
    hook.rerender({ text: '最新の文章' });
    act(() => vi.advanceTimersByTime(149));
    expect(prepare).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith('最新の文章', expect.any(String), 2);
    hook.unmount();
    expect(discard).toHaveBeenCalledWith(hook.result.current.owner);
  });
  it('IME変換中は送らず、確定後に合成し、空欄も通知する', async () => {
    vi.useFakeTimers();
    const prepare = vi.fn(async () => {}),
      discard = vi.fn(async () => {});
    const hook = renderHook(({ text }) => useSpeechDraft(text, true, 'profile', prepare, discard), {
      initialProps: { text: '' },
    });
    await act(async () => vi.advanceTimersByTime(0));
    prepare.mockClear();
    act(() => hook.result.current.onCompositionStart());
    hook.rerender({ text: 'へんかん' });
    act(() => vi.advanceTimersByTime(1500));
    expect(prepare).not.toHaveBeenCalled();
    hook.rerender({ text: '変換' });
    act(() => hook.result.current.onCompositionEnd());
    await act(async () => vi.advanceTimersByTime(150));
    expect(prepare).toHaveBeenLastCalledWith('変換', expect.any(String), expect.any(Number));
    hook.rerender({ text: '' });
    await act(async () => vi.advanceTimersByTime(0));
    expect(prepare).toHaveBeenLastCalledWith('', expect.any(String), expect.any(Number));
  });
  it('設定変更でも再合成し、StrictModeの再接続で監視を失わない', async () => {
    vi.useFakeTimers();
    const prepare = vi.fn(async () => {}),
      discard = vi.fn(async () => {});
    const hook = renderHook(({ key }) => useSpeechDraft('同じ文章', true, key, prepare, discard), {
      initialProps: { key: 'voice-a' },
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    await act(async () => vi.advanceTimersByTime(150));
    expect(prepare).toHaveBeenCalledOnce();
    hook.rerender({ key: 'voice-b' });
    await act(async () => vi.advanceTimersByTime(150));
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});
