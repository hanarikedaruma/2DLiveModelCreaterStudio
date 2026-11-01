// AT-04 の実装者の確認（CL）。製品の推定元をそのまま使い、WebView2 で同梱モデル・Worker・外部通信を確かめる。
import type { BodyTrackingConfig, TrackingSource } from '@app/contracts';
import { createMediaPipeTrackingSource } from '@app/tracking/src/source/source';

const source: TrackingSource = createMediaPipeTrackingSource();
const counts = { faces: 0, pose: 0, hands: 0, poseDetected: 0, handsDetected: 0 };
source.onFrame(() => counts.faces++);
source.body!.onFrame((frame) => {
  if (frame.pose) {
    counts.pose++;
    if (frame.pose.value.landmarks.length) counts.poseDetected++;
  }
  if (frame.hands) {
    counts.hands++;
    if (frame.hands.value.length) counts.handsDetected++;
  }
});

const body = source.body as NonNullable<TrackingSource['body']> & { blockedRequests(): number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitReady(timeoutMs = 30_000) {
  const until = performance.now() + timeoutMs;
  while (performance.now() < until) {
    const s = body.status();
    if (s.pose.state !== 'loading' && s.hands.state !== 'loading') return s;
    await sleep(100);
  }
  return body.status();
}

declare global {
  interface Window {
    __at04: Record<string, unknown>;
  }
}

window.__at04 = {
  async start(config: BodyTrackingConfig) {
    body.configure(config);
    const startedAt = performance.now();
    await source.start();
    const status = await waitReady();
    return { status, readyMs: performance.now() - startedAt };
  },
  async configure(config: BodyTrackingConfig) {
    body.configure(config);
    return waitReady();
  },
  stop() {
    source.stop();
  },
  async measure(ms: number) {
    const before = { ...counts };
    await sleep(ms);
    const delta = Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, (v - before[k as keyof typeof counts]) / (ms / 1000)]),
    );
    return { perSecond: delta, status: body.status(), capture: source.captureStats() };
  },
  status: () => body.status(),
  blocked: () => body.blockedRequests(),
  counts: () => ({ ...counts }),
};
document.getElementById('out')!.textContent = '準備完了';
