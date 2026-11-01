// CO独立確認。実サービスへ手計算の観測を渡し、実装者の試験用ヘルパーは使わない。
import { describe, expect, it, vi } from 'vitest';
import { FakeBodyTracking, type BodyTrackingFrame, type PosePoint } from '@app/contracts';
import { createArmTrackingFixture, createProjectStore } from '@app/core';
import { newId } from '@app/schema';
import { createArmService } from './service';

function observation(at: number, generation: number): BodyTrackingFrame {
  const landmarks: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  for (const [i, x, y] of [
    [11, 0.7, 0.25],
    [12, 0.3, 0.25],
    [13, 0.78, 0.45],
    [14, 0.22, 0.45],
    [15, 0.85, 0.35],
    [16, 0.15, 0.35],
  ])
    landmarks[i!] = { x: x!, y: y!, z: 0, visibility: 1 };
  return {
    image: { width: 640, height: 480 },
    pose: {
      time: {
        generation,
        frameId: at + 1,
        capturedAt: at,
        completedAt: at + 5,
        receivedAt: at + 10,
        captureSource: 'captureTime',
      },
      value: { landmarks, worldLandmarks: [] },
    },
    hands: null,
  };
}
function setup() {
  const project = createArmTrackingFixture();
  project.armTracking!.sides.L.enabled = true;
  project.armTracking!.sides.R.enabled = true;
  const store = createProjectStore(project),
    body = new FakeBodyTracking();
  const jobs = new Set<() => void>();
  const service = createArmService({
    store,
    tracking: { body, captureStats: () => null },
    schedule: (cb) => {
      jobs.add(cb);
      return () => {
        jobs.delete(cb);
      };
    },
  });
  const off = service.runtime.attach();
  const train = (from = 0, to = 800) => {
    let layer = null;
    for (let t = from; t <= to; t += 20) {
      body.emit(observation(t, body.status().generation));
      layer = service.runtime.tick(t + 10);
      if (layer) service.runtime.afterFrame({ layers: [layer], params: layer.values });
    }
    return layer;
  };
  return {
    store,
    body,
    service,
    jobs,
    train,
    close: () => {
      off();
      service.runtime.dispose();
    },
  };
}

describe('AT-12 CO独立確認', () => {
  it('顔の観測なしで左右を追従し、固定した手形は片側だけ変わる。設定は1回のUndoで戻る', () => {
    const s = setup();
    try {
      const settings = s.service.settings();
      settings.sides.L.handMode = 'peace';
      settings.sides.R.handMode = 'fist';
      s.service.setSettings(settings);
      const layer = s.train()!;
      expect(s.service.status().motion.L.state).toBe('tracking');
      expect(s.service.status().motion.R.state).toBe('tracking');
      expect(layer.values.HandPeaceL).toBe(1);
      expect(layer.values.HandFistR).toBe(1);
      expect(layer.values.FaceAngleX).toBeUndefined();
      s.store.undo();
      expect(s.service.settings().sides.L.handMode).toBe('auto');
      expect(s.service.settings().sides.R.handMode).toBe('auto');
    } finally {
      s.close();
    }
  });

  it('同じリグの別プロジェクトへ切り替えても、前の追従・診断を持ち越さない', () => {
    const s = setup();
    try {
      s.train();
      expect(s.service.status().motion.L.state).toBe('tracking');
      const next = structuredClone(s.store.get());
      next.id = newId();
      next.name = 'CO second project';
      s.store.load(next);
      s.service.runtime.tick(820);
      expect(['rest', 'returning']).toContain(s.service.status().motion.L.state);
      expect(s.service.diagnostics()).toBeNull();
    } finally {
      s.close();
    }
  });

  it('プロジェクト切替では途中の校正を取り消し、古い撮影の完了を待ち続けない', async () => {
    const s = setup();
    try {
      let settled = false;
      const capture = s.service.captureCalibration('neutral').then(() => {
        settled = true;
      });
      const next = structuredClone(s.store.get());
      next.id = newId();
      s.store.load(next);
      await Promise.resolve();
      expect(settled).toBe(true);
      expect(s.service.status().calibration.state).toBe('empty');
      expect(s.jobs.size).toBe(0);
      await capture;
    } finally {
      s.service.cancelCalibration();
      s.close();
    }
  });

  it('disposeで推定を止め、待っている校正も終了する', async () => {
    const s = setup();
    let settled = false;
    const capture = s.service.captureCalibration('neutral').then(() => {
      settled = true;
    });
    s.service.runtime.dispose();
    await Promise.resolve();
    try {
      expect(s.body.status().pose.state).toBe('off');
      expect(settled).toBe(true);
      expect(s.jobs.size).toBe(0);
      await capture;
    } finally {
      s.service.cancelCalibration();
      s.close();
    }
  });

  it('新世代の後の古い通知で診断を巻き戻さず、再購読でも通知を二重化しない', () => {
    const s = setup();
    try {
      const listener = vi.fn();
      s.service.onDiagnostics(listener);
      const extra = s.service.runtime.attach();
      s.body.emit(observation(100, s.body.status().generation));
      expect(listener).toHaveBeenCalledTimes(1);
      extra();
      s.service.runtime.feed(observation(500, 10));
      s.service.runtime.feed(observation(200, 9));
      expect(s.service.diagnostics()!.time).toBe(500);
    } finally {
      s.close();
    }
  });

  it('プロジェクト切替後に同じカメラ世代の古い撮影が届いても、新しいプロジェクトに採用しない', () => {
    const s = setup();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(850);
    try {
      s.train(0, 800);
      const generation = s.body.status().generation;
      const next = structuredClone(s.store.get());
      next.id = newId();
      s.store.load(next);
      expect(s.service.diagnostics()).toBeNull();
      // 最後の採用は撮影800ms、切替は850ms。撮影820msの推定が900msに遅れて完了する。
      // 撮影時刻は順行なのでAT-04の順序ガードは通るが、切替前の結果なので新プロジェクトには使わない。
      const late = observation(820, generation);
      late.pose!.time.completedAt = 880;
      late.pose!.time.receivedAt = 900;
      clock.mockReturnValue(900);
      s.service.runtime.feed(late);
      expect(s.service.diagnostics()).toBeNull();
      s.train(900, 1200);
      expect(s.service.status().motion.L.state).toBe('tracking');
      expect(s.service.diagnostics()!.time).toBe(1200);
    } finally {
      clock.mockRestore();
      s.close();
    }
  });
});
