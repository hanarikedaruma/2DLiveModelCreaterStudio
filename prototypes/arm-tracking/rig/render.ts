import { constrain, forward, toWorld, type Side, type HandShape, type ScenePose } from './kinematics';

export const COLORS = { L: '#087f8c', R: '#cf6a37', ink: '#183346' };
const n = (v: number) => Number(v.toFixed(4));
const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// 技術見本の専用形状。L/Rを別データにして、負倍率とUV反転を使わない。
const HAND_DATA = {
  L: {
    fingers: [
      { x: -12, length: 39 },
      { x: -3, length: 48 },
      { x: 7, length: 43 },
      { x: 16, length: 31 },
    ],
    thumb: 'M -15 -13 L -34 -30 Q -39 -38 -33 -41 Q -28 -44 -23 -35 L -12 -29 Z',
    thumbDot: -31,
    index: 0,
    middle: 1,
  },
  R: {
    fingers: [
      { x: -16, length: 30 },
      { x: -7, length: 42 },
      { x: 3, length: 47 },
      { x: 12, length: 40 },
    ],
    thumb: 'M 15 -13 L 34 -31 Q 40 -38 33 -42 Q 28 -45 23 -35 L 12 -29 Z',
    thumbDot: 31,
    index: 3,
    middle: 2,
  },
} as const;

export function handSvg(side: Side, shape: HandShape): string {
  const data = HAND_DATA[side],
    color = COLORS[side];
  const fingers = data.fingers
    .map((f, i) => {
      const extended =
        shape === 'open' ||
        (shape === 'point' && i === data.index) ||
        (shape === 'peace' && (i === data.index || i === data.middle));
      const length = extended ? f.length : 9;
      const spread =
        shape === 'peace' && extended ? (i === data.index ? (side === 'L' ? -12 : 12) : side === 'L' ? 12 : -12) : 0;
      return `<g transform="translate(${f.x} -35) rotate(${spread})"><rect x="-4" y="${-length}" width="8" height="${length + 8}" rx="4" fill="#f6dcc8" stroke="${color}" stroke-width="1.8"/></g>`;
    })
    .join('');
  return `${fingers}<path d="M -13 3 L -20 -28 Q -21 -42 -13 -43 L 13 -43 Q 22 -40 20 -28 L 13 3 Z" fill="#f6dcc8" stroke="${color}" stroke-width="2.5"/>
    <path d="${data.thumb}" fill="#f6dcc8" stroke="${color}" stroke-width="2"/>
    <circle cx="${data.thumbDot}" cy="-36" r="2.7" fill="#ac2871"/>
    <path d="M -9 -11 Q 0 -23 11 -19 M -9 -28 Q -3 -34 8 -29" fill="none" stroke="${color}" stroke-width="1.5"/>
    <text x="0" y="-15" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}">${side}</text>`;
}

export function sceneContent(scene: ScenePose, guides = true): string {
  toWorld({ x: 0, y: 0 }, scene.parent);
  const left = constrain(scene.left).pose,
    right = constrain(scene.right).pose;
  const arms = (['L', 'R'] as const).map((side) => ({
    side,
    pose: side === 'L' ? left : right,
    arm: forward(side === 'L' ? left : right, side),
    shape: side === 'L' ? scene.leftHand : scene.rightHand,
  }));
  const upper = arms
    .map(
      ({ side, arm }) =>
        `<line x1="${n(arm.shoulder.x)}" y1="${n(arm.shoulder.y)}" x2="${n(arm.elbow.x)}" y2="${n(arm.elbow.y)}" stroke="${COLORS[side]}" stroke-width="35" stroke-linecap="round"/>`,
    )
    .join('');
  const lower = arms
    .map(
      ({ arm }) =>
        `<line x1="${n(arm.elbow.x)}" y1="${n(arm.elbow.y)}" x2="${n(arm.wrist.x)}" y2="${n(arm.wrist.y)}" stroke="${COLORS.ink}" stroke-width="27" stroke-linecap="round"/><line x1="${n(arm.elbow.x)}" y1="${n(arm.elbow.y)}" x2="${n(arm.wrist.x)}" y2="${n(arm.wrist.y)}" stroke="#f6dcc8" stroke-width="23" stroke-linecap="round"/>`,
    )
    .join('');
  const hands = arms
    .map(
      ({ side, arm, shape }) =>
        `<g data-hand="${side}" transform="translate(${n(arm.wrist.x)} ${n(arm.wrist.y)}) rotate(${n(arm.handRotation)})">${handSvg(side, shape)}</g>`,
    )
    .join('');
  const guide = !guides
    ? ''
    : arms
        .map(({ side, arm }) => {
          const points = [arm.shoulder, arm.elbow, arm.wrist];
          return (
            `<polyline points="${points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')}" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="4 5"/>` +
            points
              .map(
                (p, i) =>
                  `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="4" fill="white" stroke="${COLORS.ink}" stroke-width="1.5"/><text x="${n(p.x + 7)}" y="${n(p.y + 10)}" font-size="10" fill="${COLORS.ink}">${side}${['S', 'E', 'W'][i]}</text>`,
              )
              .join('')
          );
        })
        .join('');
  const parent = scene.parent;
  return `<g font-family="Meiryo" transform="translate(0 260) rotate(${parent.rotation}) scale(${parent.scale}) translate(0 ${-260 - parent.breath})">
    <path d="M -73 217 Q -98 246 -87 430 L 87 430 Q 98 246 73 217 Z" fill="#dce6ec" stroke="#8ca2b3" stroke-width="2"/>
    ${upper}
    <path d="M -24 190 L -24 223 Q 0 238 24 223 L 24 190" fill="#f6dcc8" stroke="#ad9789" stroke-width="2"/>
    <ellipse cx="0" cy="120" rx="83" ry="92" fill="#f3e8d9" stroke="#8ca2b3" stroke-width="2"/>
    <path d="M -79 100 Q -78 23 0 26 Q 79 24 80 100 L 39 80 L 20 104 L -3 79 L -27 105 L -49 81 Z" fill="#b3c3ce"/>
    <path d="M -44 127 Q -30 119 -16 127 M 16 127 Q 30 119 44 127 M -15 162 Q 0 174 15 162" fill="none" stroke="#526779" stroke-width="3"/>
    ${lower}${hands}${guide}
  </g>`;
}

export function svgDocument(scene: ScenePose, width = 860, height = 680): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="-430 -120 860 680"><rect x="-430" y="-120" width="860" height="680" fill="#f7fafb"/><title>${safe(scene.name)}</title>${sceneContent(scene)}</svg>`;
}
