// 試験だけが使う。手の21点を合成する（手基準の3D と、AT-05 で直した肩の座標の両方）。
// 判定が使うのは手首・指の付け根・指先だけなので、第2・第1関節は付け根と指先の間に置く。
import type { AssociatedHand, BodyPoint, BodySampleTime, ObservationValidity } from '@app/contracts';
import type { HandShape, Vec2 } from '@app/schema';
import type { Finger } from './features';

export type FingerRatios = Record<Finger, number>; // 手首→指先 ÷ 手首→付け根
export const SHAPE_RATIOS: Record<HandShape, FingerRatios> = {
  open: { index: 1.8, middle: 1.9, ring: 1.8, pinky: 1.75 },
  fist: { index: 0.85, middle: 0.8, ring: 0.8, pinky: 0.85 },
  point: { index: 1.8, middle: 0.85, ring: 0.8, pinky: 0.85 },
  peace: { index: 1.75, middle: 1.9, ring: 0.8, pinky: 0.8 },
};
// 掌を正面に向けて指を上（-y）へ向けた手（m）。手首が原点
const MCP: Record<Finger, [number, number]> = {
  index: [-0.025, -0.085],
  middle: [-0.005, -0.09],
  ring: [0.015, -0.085],
  pinky: [0.033, -0.075],
};
const THUMB: [number, number, number][] = [
  [-0.03, -0.02, 0.01],
  [-0.048, -0.04, 0.015],
  [-0.06, -0.058, 0.02],
  [-0.07, -0.072, 0.02],
];

export interface SyntheticHand {
  shape?: HandShape;
  ratios?: Partial<FingerRatios>;
  direction?: number; // 掌の軸の画面上の向き（度、肩の座標。-90 が上、0 が外向き、90 が下）
  tilt?: number; // 画面から奥行きへ傾ける角度（度）。90 で掌の軸がカメラへ向く
  turn?: number; // 掌の軸のまわりに手を回す角度（度）。掌が横・裏を向く
  indexBend?: number; // 人さし指だけを掌の軸から画面内で曲げる角度（度）
  wrist?: Vec2;
  scale?: number; // 手基準のm → 肩の座標（腕の長さ1）
  gesture?: AssociatedHand['gesture'];
  validity?: ObservationValidity;
  time: BodySampleTime;
  world?: boolean; // false で手基準の3Dを空にする
}

const rad = (deg: number) => (deg * Math.PI) / 180;
function rotate(p: BodyPoint, axis: 'x' | 'y' | 'z', deg: number): BodyPoint {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  if (axis === 'x') return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
  if (axis === 'y') return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
}

function fingerPoints(finger: Finger, ratio: number, bend: number): BodyPoint[] {
  const [mx, my] = MCP[finger];
  const mcp = { x: mx, y: my, z: 0 };
  const base = Math.hypot(mx, my);
  const dir = rotate({ x: mx / base, y: my / base, z: 0 }, 'z', bend);
  let tip: BodyPoint;
  if (ratio >= 1) {
    // 付け根から先へ伸ばす。手首→指先の長さが ratio × 手首→付け根 になるように
    const a = dir.x * mx + dir.y * my;
    const k = -a + Math.sqrt(a * a - base * base + (ratio * base) ** 2);
    tip = { x: mx + dir.x * k, y: my + dir.y * k, z: 0 };
  } else {
    // 掌の前（+z）へ折り込む
    const b = 0.3 * ratio * base;
    const a = Math.sqrt((ratio * base) ** 2 - b * b);
    tip = { x: (mx / base) * a, y: (my / base) * a, z: b };
  }
  const lerp = (t: number) => ({
    x: mcp.x + (tip.x - mcp.x) * t,
    y: mcp.y + (tip.y - mcp.y) * t,
    z: mcp.z + (tip.z - mcp.z) * t + (ratio < 1 ? 0.03 * Math.sin(Math.PI * t) : 0),
  });
  return [mcp, lerp(0.45), lerp(0.75), tip];
}

export function syntheticHand(options: SyntheticHand): AssociatedHand {
  const ratios = { ...SHAPE_RATIOS[options.shape ?? 'open'], ...options.ratios };
  const canonical: BodyPoint[] = [
    { x: 0, y: 0, z: 0 },
    ...THUMB.map(([x, y, z]) => ({ x, y, z })),
    ...(['index', 'middle', 'ring', 'pinky'] as Finger[]).flatMap((f) =>
      fingerPoints(f, ratios[f], f === 'index' ? (options.indexBend ?? 0) : 0),
    ),
  ];
  // 掌の軸（手首→中指の付け根）が -y になるよう少し回してから、回す・傾ける・画面内で向ける
  const palm = -Math.atan2(MCP.middle[0], -MCP.middle[1]) * (180 / Math.PI);
  const world = canonical.map((p) => {
    const turned = rotate(rotate(p, 'z', palm), 'y', options.turn ?? 0);
    return rotate(rotate(turned, 'x', options.tilt ?? 0), 'z', (options.direction ?? -90) + 90);
  });
  const wrist = options.wrist ?? { x: 0.3, y: 0.6 };
  const scale = options.scale ?? 2.2;
  return {
    time: options.time,
    validity: options.validity ?? 'valid',
    landmarks: world.map((p) => ({ x: wrist.x + p.x * scale, y: wrist.y + p.y * scale, z: p.z * scale })),
    worldLandmarks: options.world === false ? [] : world,
    gesture: options.gesture ?? null,
  };
}

export const sampleTime = (capturedAt: number, generation = 1, frameId = 0): BodySampleTime => ({
  generation,
  frameId,
  capturedAt,
  captureSource: 'captureTime',
  completedAt: capturedAt + 20,
  receivedAt: capturedAt + 22,
});
