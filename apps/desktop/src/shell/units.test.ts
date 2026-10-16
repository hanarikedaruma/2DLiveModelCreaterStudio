import { MemoryFileSystem } from '@app/contracts';
import { createDefaultEnvironment } from '@app/schema';
import { describe, expect, it, vi } from 'vitest';
import { canvasToScreen, fitRect, pan, screenToCanvas, zoomAt } from './canvas/view';
import {
  createEnvironmentStore,
  fileEnvironmentStorage,
  memoryEnvironmentStorage,
  parseEnvironment,
} from './environment';
import { emitAppEvent, onAppEvent } from './events';
import { isTypingTarget, matchesShortcut } from './keys';
import { byOrder } from './registry';

describe('registry の順序', () => {
  it('order 順。同じなら登録順', () => {
    const items = [{ id: 'a', order: 2 }, { id: 'b' }, { id: 'c', order: -1 }, { id: 'd', order: 2 }];
    expect(byOrder(items).map((i) => i.id)).toEqual(['c', 'b', 'a', 'd']);
  });
});

describe('ショートカット', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  });

  it('修飾キーまで一致したときだけ当たる', () => {
    expect(matchesShortcut(key('z', { ctrlKey: true }), 'Ctrl+Z')).toBe(true);
    expect(matchesShortcut(key('Z', { ctrlKey: true, shiftKey: true }), 'Ctrl+Z')).toBe(false);
    expect(matchesShortcut(key('Z', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Z')).toBe(true);
    expect(matchesShortcut(key('y', { metaKey: true }), 'Ctrl+Y')).toBe(true);
    expect(matchesShortcut(key('1', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+1')).toBe(true);
    expect(matchesShortcut(key('z'), 'Ctrl+Z')).toBe(false);
  });

  it('入力欄は横取りしない', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('表示の変換', () => {
  const view = { scale: 2, offset: { x: 10, y: 20 } };

  it('画面座標とキャンバス座標を行き来できる', () => {
    expect(canvasToScreen(view, { x: 5, y: 5 })).toEqual({ x: 20, y: 30 });
    expect(screenToCanvas(view, { x: 20, y: 30 })).toEqual({ x: 5, y: 5 });
  });

  it('zoomAt は指定した画面上の点を動かさない', () => {
    const at = { x: 123, y: 45 };
    const before = screenToCanvas(view, at);
    const zoomed = zoomAt(view, at, 1.7);
    expect(zoomed.scale).toBeCloseTo(3.4);
    const after = screenToCanvas(zoomed, at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zoomAt は倍率を範囲に収める', () => {
    expect(zoomAt(view, { x: 0, y: 0 }, 1e9).scale).toBe(32);
    expect(zoomAt(view, { x: 0, y: 0 }, 1e-9).scale).toBe(0.02);
  });

  it('pan は offset だけを動かす', () => {
    expect(pan(view, { x: 3, y: -4 })).toEqual({ scale: 2, offset: { x: 13, y: 16 } });
  });

  it('fitRect は余白を残して中央に収める', () => {
    const fitted = fitRect({ x: 0, y: 0, width: 1000, height: 1500 }, 800, 600);
    expect(fitted.scale).toBeCloseTo(0.36);
    expect(canvasToScreen(fitted, { x: 500, y: 750 })).toEqual({ x: 400, y: 300 });
    expect(canvasToScreen(fitted, { x: 0, y: 0 }).y).toBeCloseTo(30);
  });
});

describe('環境設定（environment.json）', () => {
  it('保存先が無ければ既定値', async () => {
    const store = createEnvironmentStore(memoryEnvironmentStorage());
    await store.load();
    expect(store.get()).toEqual(createDefaultEnvironment());
  });

  it('environment.json を読み書きできる', async () => {
    const fs = new MemoryFileSystem();
    const dir = '/config/live2d-studio';
    const store = createEnvironmentStore(fileEnvironmentStorage(fs, dir));
    await store.load();
    store.set({ mirror: false, silenceThreshold: -40 });
    store.set({});
    await store.flush();
    const saved = JSON.parse(await fs.readText(`${dir}/environment.json`));
    expect(saved).toMatchObject({ mirror: false, silenceThreshold: -40 });

    // 別のストアで読み直すと同じ値
    const again = createEnvironmentStore(fileEnvironmentStorage(fs, dir));
    await again.load();
    expect(again.get()).toEqual(store.get());
  });

  it('足りない項目は既定値で埋め、壊れていれば既定値にする', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseEnvironment('{"mirror":false,"output":{"fps":30}}')).toMatchObject({
      mirror: false,
      output: { method: 'window', width: 1920, height: 1080, fps: 30 },
      trackingPreset: 'standard',
    });
    expect(parseEnvironment('{ broken')).toEqual(createDefaultEnvironment());
    expect(parseEnvironment('{"trackingPreset":"turbo"}')).toEqual(createDefaultEnvironment());
    warn.mockRestore();
  });

  it('読み込み後、同じ値の set は書き込まない・通知しない', async () => {
    const storage = memoryEnvironmentStorage();
    const store = createEnvironmentStore(storage);
    await store.load();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ mirror: true });
    await store.flush();
    expect(listener).not.toHaveBeenCalled();
    expect(storage.text).toBeNull();
  });
});

describe('アプリイベント', () => {
  it('名前ごとに届き、解除できる', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onAppEvent('x', a);
    onAppEvent('y', b);
    emitAppEvent('x', 1);
    offA();
    emitAppEvent('x', 2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(1);
    expect(b).not.toHaveBeenCalled();
  });
});
