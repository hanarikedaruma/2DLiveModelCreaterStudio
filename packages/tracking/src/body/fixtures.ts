// 試験だけが使う。AT-01 の案内つき収録の点列（at01-points/1）を、推定元の通知（BodyTrackingFrame）の並びに直す。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BodyTrackingFrame, HandObservation } from '@app/contracts';

interface RecHand {
  sdkSide: string | null;
  sdkSideScore: number | null;
  gesture: string | null;
  gestureScore: number | null;
  lm: (number | null)[];
  world: (number | null)[];
}
interface RecFrame {
  t: number;
  step: string;
  pose: (number | null)[] | null;
  poseWorld: (number | null)[] | null;
  hands: RecHand[] | null;
}
interface Recording {
  camera: { width: number; height: number };
  steps: { id: string; truth: { active: ('left' | 'right')[] } }[];
  frames: RecFrame[];
}

const quads = (values: (number | null)[] | null) => {
  const out: number[][] = [];
  for (let i = 0; values && i + 3 < values.length; i += 4)
    out.push([
      values[i] ?? Number.NaN,
      values[i + 1] ?? Number.NaN,
      values[i + 2] ?? Number.NaN,
      values[i + 3] ?? Number.NaN,
    ]);
  return out;
};

export interface FixtureFrame {
  step: string;
  active: ('left' | 'right')[]; // 案内の正解（演者自身の手）
  frame: BodyTrackingFrame;
}

export function loadFixture(name: string, generation = 1): FixtureFrame[] {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const rec = JSON.parse(readFileSync(path, 'utf8')) as Recording;
  return rec.frames
    .filter((f) => f.pose !== null || f.hands !== null)
    .map((f, i) => {
      const time = {
        generation,
        frameId: i + 1,
        capturedAt: f.t,
        captureSource: 'captureTime' as const,
        completedAt: f.t + 20,
        receivedAt: f.t + 22,
      };
      const hands: HandObservation[] | null =
        f.hands?.map((h) => ({
          landmarks: quads(h.lm).map(([x, y, z]) => ({ x: x!, y: y!, z: z! })),
          worldLandmarks: quads(h.world).map(([x, y, z]) => ({ x: x!, y: y!, z: z! })),
          handedness:
            h.sdkSide === 'Left' || h.sdkSide === 'Right'
              ? { side: h.sdkSide === 'Left' ? 'left' : 'right', score: h.sdkSideScore ?? 0 }
              : null,
          gesture: h.gesture ? { name: h.gesture, score: h.gestureScore ?? 0 } : null,
        })) ?? null;
      const pose = f.pose
        ? {
            time,
            value: {
              landmarks: quads(f.pose).map(([x, y, z, v]) => ({
                x: x!,
                y: y!,
                z: z!,
                visibility: Number.isFinite(v) ? v! : 0,
              })),
              worldLandmarks: quads(f.poseWorld).map(([x, y, z]) => ({ x: x!, y: y!, z: z! })),
            },
          }
        : null;
      const frame = (
        pose
          ? { image: rec.camera, pose, hands: hands ? { time, value: hands } : null }
          : { image: rec.camera, pose: null, hands: { time, value: hands! } }
      ) as BodyTrackingFrame;
      return { step: f.step, active: rec.steps.find((s) => s.id === f.step)!.truth.active, frame };
    });
}
