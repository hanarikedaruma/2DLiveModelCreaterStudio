import { describe, expect, it, vi } from 'vitest';
import { installNetworkGuard, type GuardScope } from './guard';

function scope(href: string) {
  const fetch = vi.fn(async () => new Response('ok'));
  const open = vi.fn();
  class FakeXhr {}
  (FakeXhr.prototype as unknown as { open: unknown }).open = open;
  const target = { fetch, location: { href }, XMLHttpRequest: FakeXhr } as unknown as GuardScope;
  return { target, fetch, open };
}

describe('installNetworkGuard', () => {
  it('ページの外への fetch を止めて知らせ、同じ起点は通す', async () => {
    const { target, fetch } = scope('http://tauri.localhost/assets/worker.js');
    const attempts: { url: string; method: string }[] = [];
    installNetworkGuard(target, (a) => attempts.push(a));
    await expect(target.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' })).rejects.toThrow();
    await target.fetch('http://tauri.localhost/assets/pose.task');
    await target.fetch('/assets/hand.task');
    expect(attempts).toEqual([{ url: 'https://odml.pa.googleapis.com/v1/log', method: 'POST' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('blob の URL から読まれた Worker でも、作ったページの起点を同じ起点として扱う', async () => {
    const { target, fetch } = scope('blob:http://tauri.localhost/0b1c');
    const attempts: unknown[] = [];
    installNetworkGuard(target, (a) => attempts.push(a));
    await target.fetch('http://tauri.localhost/assets/pose.task');
    await expect(target.fetch('http://127.0.0.1:9/x')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(attempts.length).toBe(1);
  });

  it('XHR もページの外へは開かせない', () => {
    const { target, open } = scope('http://tauri.localhost/');
    installNetworkGuard(target, () => {});
    const Xhr = target.XMLHttpRequest as unknown as new () => { open(method: string, url: string): void };
    expect(() => new Xhr().open('POST', 'https://odml.pa.googleapis.com/v1/log')).toThrow();
    new Xhr().open('GET', '/assets/a.task');
    expect(open).toHaveBeenCalledTimes(1);
  });
});
