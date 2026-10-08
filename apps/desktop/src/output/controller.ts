// メインのウィンドウ側で出力ウィンドウを開き、プロジェクトと素材・毎フレームの ParamValues を送る
import { useMemo, useSyncExternalStore } from 'react';
import type { Services } from '@app/contracts';
import { isTauri } from '../platform/tauri';
import { studioRuntime, type StudioFrame, type StudioRuntime } from '../modes/studio/runtime';
import { sceneBackground } from '../modes/studio/scene';
import { createBrowserOutputHost } from './browserTransport';
import type { FrameMessage, FromOutput } from './protocol';
import { createTauriOutputHost } from './tauriTransport';
import type { OutputHost } from './transport';

export const PROJECT_BATCH_MS = 500; // プロジェクトの変更はこの間隔でまとめて送る

export function createDefaultOutputHost(): OutputHost {
  return isTauri() ? createTauriOutputHost() : createBrowserOutputHost();
}

export interface OutputController {
  open(services: Services): Promise<void>; // 開いていれば前に出す
  close(): void;
  isOpen(): boolean;
  subscribe(listener: () => void): () => void;
  setHostFactory(create: () => OutputHost): void; // テストや結合で差し替える
}

interface Session {
  host: OutputHost;
  services: Services;
  opened: boolean; // host.open が終わった
  ready: boolean; // 出力ウィンドウが受け取れる
  sentPngs: Map<string, Uint8Array>; // 送った素材（同じ参照なら送り直さない）
  sentBackgrounds: Map<string, Uint8Array>;
  timer: ReturnType<typeof setTimeout> | null;
  offs: (() => void)[];
}

export function createOutputController(options: {
  runtime: StudioRuntime;
  createHost?: () => OutputHost;
  batchMs?: number;
}): OutputController {
  const { runtime } = options;
  let createHost = options.createHost ?? createDefaultOutputHost;
  const batchMs = options.batchMs ?? PROJECT_BATCH_MS;
  let sharedHost: OutputHost | null = null; // 開くたびに作らず使い回す（イベントの受け取りを増やさない）
  let session: Session | null = null;
  let opening: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };

  function sendProject(s: Session) {
    if (s.timer !== null) clearTimeout(s.timer);
    s.timer = null;
    const project = s.services.store.get();
    const pngs = s.services.assets.all();
    const assets: Record<string, Uint8Array> = {};
    for (const asset of project.assets) {
      const png = pngs[asset.id];
      if (!png || s.sentPngs.get(asset.id) === png) continue;
      assets[asset.id] = png;
      s.sentPngs.set(asset.id, png);
    }
    const backgrounds: Record<string, Uint8Array> = {};
    for (const scene of project.studio.scenes) {
      if (scene.background.type !== 'image') continue;
      const { path } = scene.background;
      const bytes = runtime.backgrounds.bytes(path);
      if (!bytes || s.sentBackgrounds.get(path) === bytes) continue;
      backgrounds[path] = bytes;
      s.sentBackgrounds.set(path, bytes);
    }
    s.host.send({ type: 'project', project, assets, backgrounds });
  }

  // 変わったら、まとめて送る
  function schedule(s: Session) {
    if (!s.ready || s.timer !== null) return;
    s.timer = setTimeout(() => {
      s.timer = null;
      if (session === s) sendProject(s);
    }, batchMs);
  }

  function frameMessage(s: Session, frame: StudioFrame): FrameMessage {
    return {
      type: 'frame',
      params: frame.params,
      view: frame.view,
      background: sceneBackground(s.services.store.get()),
      size: runtime.getOutputSize(),
      now: frame.now,
      ...(s.services.store
        .get()
        .model.curveGuides?.some(
          (g) =>
            g.dynamics?.enabled ||
            g.collision?.enabled ||
            (g.enabled && g.gravity && s.services.store.get().physics.length > 0),
        )
        ? { positions: Object.fromEntries(frame.model.items.map((item) => [item.partId, Array.from(item.positions)])) }
        : {}),
    };
  }

  function teardown(s: Session) {
    if (session !== s) return;
    session = null;
    if (s.timer !== null) clearTimeout(s.timer);
    s.timer = null;
    for (const off of s.offs.splice(0)) off();
    changed();
  }

  function onMessage(s: Session, m: FromOutput) {
    if (session !== s) return;
    if (m.type === 'closed') {
      teardown(s);
      return;
    }
    // 開いた・読み込み直した。すべてを送り直す
    s.ready = true;
    s.sentPngs.clear();
    s.sentBackgrounds.clear();
    sendProject(s);
  }

  async function open(services: Services) {
    if (session) {
      await session.host.focus();
      return;
    }
    const host = (sharedHost ??= createHost());
    const s: Session = {
      host,
      services,
      opened: false,
      ready: false,
      sentPngs: new Map(),
      sentBackgrounds: new Map(),
      timer: null,
      offs: [],
    };
    session = s;
    s.offs.push(host.onMessage((m) => onMessage(s, m)));
    try {
      await host.open(runtime.getOutputSize());
    } catch (e) {
      teardown(s);
      throw e;
    }
    if (session !== s) return; // 開いている途中で閉じられた
    s.offs.push(
      runtime.attach(services), // スタジオの画面を離れても出力は動かし続ける
      runtime.registerFrameSink((frame) => {
        if (s.ready) host.send(frameMessage(s, frame));
      }),
      services.store.subscribe(() => schedule(s)),
      services.assets.subscribe(() => schedule(s)),
      runtime.backgrounds.subscribe(() => schedule(s)),
      runtime.subscribeOutputSize((size) => {
        host.resize(size).catch((e: unknown) => console.error('出力ウィンドウの大きさを変えられない', e));
      }),
    );
    s.opened = true;
    changed();
  }

  return {
    async open(services) {
      // 続けて押されても1つだけ開く
      opening ??= open(services).finally(() => {
        opening = null;
      });
      return opening;
    },
    close() {
      const s = session;
      if (!s) return;
      s.host.close();
      teardown(s);
    },
    isOpen: () => session?.opened === true,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setHostFactory(create) {
      createHost = create;
      sharedHost = null;
    },
  };
}

// アプリで1つ
export const outputWindow: OutputController = createOutputController({ runtime: studioRuntime });

export function useOutputWindow(services: Services): { open: boolean; openWindow(): Promise<void>; close(): void } {
  const open = useSyncExternalStore(outputWindow.subscribe, outputWindow.isOpen);
  return useMemo(
    () => ({ open, openWindow: () => outputWindow.open(services), close: () => outputWindow.close() }),
    [open, services],
  );
}
