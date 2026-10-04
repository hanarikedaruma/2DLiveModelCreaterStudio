// 計測の記録（カード25）。スタジオのフレームとトラッキングのフレームを受け取り、
// 描画の fps（平均と1%最低値）・トラッキングの fps・遅延（TrackingFrame.time から、その値を使ったフレームを描いた時刻まで）を求める
import type { TrackingFrame } from '@app/contracts';
import { fpsStats, latencyStats, ratePerSecond, type FpsStats, type LatencyStats } from './stats';

export const DISPLAY_WINDOW_MS = 5000; // 画面に出す値は直近5秒
export const RECORD_LIMIT_MS = 5 * 60 * 1000; // 記録は最大5分

export interface DiagnosticsSnapshot {
  render: FpsStats;
  trackingFps: number;
  latency: LatencyStats;
  vowelLatency: LatencyStats;
  recording: { active: boolean; elapsedMs: number };
}

export interface DiagnosticsRecord {
  kind: 'live2d-studio-diagnostics';
  version: 1;
  startedAt: string; // ISO 8601
  durationMs: number;
  environment: Record<string, unknown>; // GPU・画面などの情報
  summary: { render: FpsStats; trackingFps: number; latency: LatencyStats; vowelLatency: LatencyStats };
  samples: {
    renderTimes: number[]; // 記録の開始からのミリ秒
    trackingTimes: number[];
    latencies: number[]; // ミリ秒
    vowelLatencies: number[];
  };
}

export interface DiagnosticsCollector {
  onRenderedFrame(now: number): void; // スタジオのフレームを描いた直後に呼ぶ
  onTrackingFrame(frame: TrackingFrame, receivedAt: number): void;
  onVowelRendered(frameTime: number, renderedAt: number): void;
  snapshot(now: number): DiagnosticsSnapshot;
  startRecording(now: number, startedAt: Date): void;
  stopRecording(now: number, environment?: Record<string, unknown>): DiagnosticsRecord | null;
  isRecording(): boolean;
}

// 古いものを捨てながら時刻を貯める
function trimBefore(times: number[], limit: number) {
  let drop = 0;
  while (drop < times.length && times[drop]! < limit) drop++;
  if (drop > 0) times.splice(0, drop);
}

export function createDiagnosticsCollector(): DiagnosticsCollector {
  const renderTimes: number[] = [];
  const trackingTimes: number[] = [];
  const latencies: { at: number; ms: number }[] = [];
  const vowelLatencies: { at: number; ms: number }[] = [];
  let lastVowelTime: number | null = null;
  // まだ描いていない最新のトラッキングのフレームの時刻（次に描いたフレームで遅延を1つ取る）
  let pendingFrameTime: number | null = null;
  let record: {
    start: number;
    startedAt: Date;
    renderTimes: number[];
    trackingTimes: number[];
    latencies: number[];
    vowelLatencies: number[];
  } | null = null;

  const trim = (now: number) => {
    trimBefore(renderTimes, now - DISPLAY_WINDOW_MS);
    trimBefore(trackingTimes, now - DISPLAY_WINDOW_MS);
    let drop = 0;
    while (drop < latencies.length && latencies[drop]!.at < now - DISPLAY_WINDOW_MS) drop++;
    if (drop > 0) latencies.splice(0, drop);
    let vowelDrop = 0;
    while (vowelDrop < vowelLatencies.length && vowelLatencies[vowelDrop]!.at < now - DISPLAY_WINDOW_MS) vowelDrop++;
    if (vowelDrop > 0) vowelLatencies.splice(0, vowelDrop);
  };

  const recordingActive = (now: number) => record !== null && now - record.start <= RECORD_LIMIT_MS;

  return {
    onVowelRendered(frameTime, renderedAt) {
      if (
        !Number.isFinite(frameTime) ||
        !Number.isFinite(renderedAt) ||
        renderedAt < frameTime ||
        frameTime === lastVowelTime
      )
        return;
      lastVowelTime = frameTime;
      const ms = renderedAt - frameTime;
      vowelLatencies.push({ at: renderedAt, ms });
      if (recordingActive(renderedAt)) record!.vowelLatencies.push(ms);
      trim(renderedAt);
    },
    onRenderedFrame(now) {
      renderTimes.push(now);
      if (recordingActive(now)) record!.renderTimes.push(now - record!.start);
      if (pendingFrameTime !== null) {
        const ms = now - pendingFrameTime;
        pendingFrameTime = null;
        latencies.push({ at: now, ms });
        if (recordingActive(now)) record!.latencies.push(ms);
      }
      trim(now);
    },
    onTrackingFrame(frame, receivedAt) {
      trackingTimes.push(receivedAt);
      if (recordingActive(receivedAt)) record!.trackingTimes.push(receivedAt - record!.start);
      // 顔が外れたフレームの値は使われないので、遅延は顔のあるフレームだけで測る
      if (frame.detected) pendingFrameTime = frame.time;
    },
    snapshot(now) {
      trim(now);
      return {
        render: fpsStats(renderTimes),
        trackingFps: ratePerSecond(trackingTimes, DISPLAY_WINDOW_MS, now),
        latency: latencyStats(latencies.map((l) => l.ms)),
        vowelLatency: latencyStats(vowelLatencies.map((l) => l.ms)),
        recording: { active: record !== null, elapsedMs: record ? Math.min(now - record.start, RECORD_LIMIT_MS) : 0 },
      };
    },
    startRecording(now, startedAt) {
      record = { start: now, startedAt, renderTimes: [], trackingTimes: [], latencies: [], vowelLatencies: [] };
    },
    stopRecording(now, environment = {}) {
      if (!record) return null;
      const r = record;
      record = null;
      const durationMs = Math.min(now - r.start, RECORD_LIMIT_MS);
      return {
        kind: 'live2d-studio-diagnostics',
        version: 1,
        startedAt: r.startedAt.toISOString(),
        durationMs,
        environment,
        summary: {
          render: fpsStats(r.renderTimes),
          trackingFps: (r.trackingTimes.length * 1000) / Math.max(1, durationMs),
          latency: latencyStats(r.latencies),
          vowelLatency: latencyStats(r.vowelLatencies),
        },
        samples: {
          renderTimes: r.renderTimes,
          trackingTimes: r.trackingTimes,
          latencies: r.latencies,
          vowelLatencies: r.vowelLatencies,
        },
      };
    },
    isRecording: () => record !== null,
  };
}
