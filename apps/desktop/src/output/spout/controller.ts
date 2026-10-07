// Spout2 の出力を Environment.output に合わせて動かす（method が 'spout2' のときだけ）。
// services.spout（OutputSink）を start し、素材の PNG を送り、スタジオの実行部の毎フレームを submit する。
// 出力ウィンドウと同じく、スタジオの画面を離れても止めない（method を戻すか、アプリを閉じるまで送り続ける）
import { useSyncExternalStore } from 'react';
import type { Environment } from '@app/schema';
import type { OutputSink, Services, ViewTransform } from '@app/contracts';
import { fitFrame, type Size } from '../../modes/studio/placement';
import { studioRuntime, type StudioRuntime } from '../../modes/studio/runtime';
import type { SpoutSink, SpoutTelemetry } from './sink';

export type OutputSettings = Environment['output'];

export type SpoutStatus =
  | { state: 'off' }
  | { state: 'starting' }
  | {
      state: 'running' | 'recovering';
      width: number;
      height: number;
      fps: number;
      senderName: string | null;
      telemetry?: SpoutTelemetry;
    }
  | { state: 'error'; message: string };

export const TEXTURE_BATCH_MS = 300; // 素材の変更はこの間隔でまとめて送る

export interface SpoutOutputController {
  // 環境設定が変わったら呼ぶ。同じ値なら何もしない
  sync(services: Services, output: OutputSettings): void;
  status(): SpoutStatus;
  subscribe(listener: () => void): () => void;
  retry(): void; // 始められなかったときに、同じ設定でもう一度試す
  stop(): Promise<void>;
  whenIdle(): Promise<void>; // 始める・止める処理が終わるのを待つ（テスト用）
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// 実行部の出力画面（runtime の大きさ）の view を、Spout2 の大きさに縦横比を保って収める
export function fitView(view: ViewTransform, from: Size, to: Size): ViewTransform {
  if (from.width === to.width && from.height === to.height) return view;
  const f = fitFrame(from, to.width, to.height);
  return {
    scale: view.scale * f.scale,
    offset: { x: view.offset.x * f.scale + f.x, y: view.offset.y * f.scale + f.y },
  };
}

// 開いているプロジェクトが使っている素材の PNG
export function projectPngs(services: Services): Record<string, Uint8Array> {
  const all = services.assets.all();
  const out: Record<string, Uint8Array> = {};
  for (const asset of services.store.get().assets) {
    const png = all[asset.id];
    if (png) out[asset.id] = png;
  }
  return out;
}

interface Session {
  services: Services;
  sink: OutputSink;
  settings: OutputSettings;
  offs: (() => void)[];
  timer: ReturnType<typeof setTimeout> | null;
  healthTimer: ReturnType<typeof setInterval> | null;
}

const sameSettings = (a: OutputSettings, b: OutputSettings) =>
  a.width === b.width && a.height === b.height && a.fps === b.fps && a.adapterId === b.adapterId;

export function createSpoutOutputController(options: {
  runtime: StudioRuntime;
  batchMs?: number;
}): SpoutOutputController {
  const { runtime } = options;
  const batchMs = options.batchMs ?? TEXTURE_BATCH_MS;
  let wanted: { services: Services; settings: OutputSettings } | null = null;
  let session: Session | null = null;
  let status: SpoutStatus = { state: 'off' };
  // 同じ設定で失敗したら繰り返さない（retry か、設定を変えたときだけ試す）
  let failed: { services: Services; settings: OutputSettings; message: string } | null = null;
  let work: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  function setStatus(next: SpoutStatus) {
    status = next;
    for (const l of [...listeners]) l();
  }

  async function close(s: Session) {
    if (s.timer !== null) clearTimeout(s.timer);
    if (s.healthTimer !== null) clearInterval(s.healthTimer);
    s.timer = null;
    for (const off of s.offs.splice(0)) off();
    try {
      await s.sink.stop();
    } catch (e) {
      console.warn('Spout2 の出力を止められない', errorText(e));
    }
  }

  function sendTextures(s: Session) {
    if (s.timer !== null) clearTimeout(s.timer);
    s.timer = null;
    s.sink.setTextures(projectPngs(s.services)).catch((e: unknown) => {
      console.error('Spout2 の出力に素材を送れない', errorText(e));
    });
  }

  function schedule(s: Session) {
    if (s.timer !== null) return;
    s.timer = setTimeout(() => {
      s.timer = null;
      if (session === s) sendTextures(s);
    }, batchMs);
  }

  async function open(services: Services, settings: OutputSettings) {
    const sink = services.spout;
    const s: Session = { services, sink, settings, offs: [], timer: null, healthTimer: null };
    setStatus({ state: 'starting' });
    try {
      (sink as Partial<SpoutSink>).configureAdapter?.(settings.adapterId);
      await sink.start({ width: settings.width, height: settings.height, fps: settings.fps });
      await sink.setTextures(projectPngs(services));
    } catch (e) {
      failed = { services, settings, message: errorText(e) };
      try {
        await sink.stop();
      } catch {
        // 始められなかったものは止められなくてよい
      }
      setStatus({ state: 'error', message: errorText(e) });
      return;
    }
    session = s;
    const size: Size = { width: settings.width, height: settings.height };
    s.offs.push(
      runtime.attach(services), // スタジオの画面を離れてもフレームを回す
      runtime.registerFrameSink((frame) => {
        sink.submit(frame.model, fitView(frame.view, runtime.getOutputSize(), size), frame.background);
      }),
      services.assets.subscribe(() => schedule(s)),
      services.store.subscribe(() => schedule(s)),
    );
    const senderName = (sink as { started?: () => { senderName: string } | null }).started?.()?.senderName ?? null;
    setStatus({ state: 'running', width: settings.width, height: settings.height, fps: settings.fps, senderName });
    const read = (sink as Partial<SpoutSink>).telemetry;
    if (read) {
      let reading = false;
      s.healthTimer = setInterval(() => {
        if (reading || session !== s) return;
        reading = true;
        void read
          .call(sink)
          .then(
            (telemetry) => {
              if (session !== s || !telemetry) return;
              setStatus({
                state: telemetry.state,
                width: settings.width,
                height: settings.height,
                fps: settings.fps,
                senderName: telemetry.senderName,
                telemetry,
              });
            },
            (e: unknown) => {
              if (session === s) setStatus({ state: 'error', message: `送信の状態を読めない: ${errorText(e)}` });
            },
          )
          .finally(() => {
            reading = false;
          });
      }, 1000);
    }
  }

  // 望む状態に合わせる（順に1つずつ行う。sync のたびに積むので、最後には最新の望みに合う）
  function reconcile(forceRestart = false) {
    work = work.then(async () => {
      const target = wanted;
      const current = session;
      if (
        !forceRestart &&
        current &&
        target &&
        current.services === target.services &&
        sameSettings(current.settings, target.settings)
      ) {
        return;
      }
      if (current) {
        session = null;
        await close(current);
      }
      if (!target) {
        if (status.state !== 'off') setStatus({ state: 'off' });
        return;
      }
      if (failed && failed.services === target.services && sameSettings(failed.settings, target.settings)) {
        setStatus({ state: 'error', message: failed.message });
        return;
      }
      failed = null;
      await open(target.services, target.settings);
    });
  }

  return {
    sync(services, output) {
      const next = output.method === 'spout2' ? { services, settings: { ...output } } : null;
      const prev = wanted;
      if (
        prev === next ||
        (prev && next && prev.services === next.services && sameSettings(prev.settings, next.settings))
      ) {
        return;
      }
      wanted = next;
      // 始めるなら、すぐに「準備中」を出す（同じ設定で失敗していれば、エラーのまま）
      const willFail =
        next && failed && failed.services === next.services && sameSettings(failed.settings, next.settings);
      if (next && !willFail) setStatus({ state: 'starting' });
      reconcile();
    },
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retry() {
      failed = null;
      if (wanted) setStatus({ state: 'starting' });
      reconcile(true);
    },
    async stop() {
      wanted = null;
      failed = null;
      reconcile();
      await work;
    },
    whenIdle: () => work,
  };
}

// アプリで1つ
export const spoutOutput: SpoutOutputController = createSpoutOutputController({ runtime: studioRuntime });

export function useSpoutStatus(controller: SpoutOutputController = spoutOutput): SpoutStatus {
  return useSyncExternalStore(controller.subscribe, controller.status);
}

// 環境設定を見張って sync を呼ぶ（起動したときから Spout2 で送るために、結合（カード44）で main.tsx から呼ぶ）
export function bindSpoutOutput(
  services: Services,
  environment: { get(): Environment; subscribe(listener: (env: Environment) => void): () => void },
  controller: SpoutOutputController = spoutOutput,
): () => void {
  controller.sync(services, environment.get().output);
  return environment.subscribe((env) => controller.sync(services, env.output));
}
