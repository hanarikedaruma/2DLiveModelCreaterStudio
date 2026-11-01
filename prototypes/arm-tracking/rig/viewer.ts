import {
  POSES,
  HAND_SHAPES,
  RIG,
  constrain,
  distance,
  forward,
  fromWorld,
  solveTarget,
  toWorld,
  waveAt,
  type HandShape,
  type Pose,
  type ScenePose,
  type Side,
} from './kinematics';
import { sceneContent } from './render';

const element = <T extends Element>(id: string): T => {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result as unknown as T;
};
const canvas = element<SVGSVGElement>('scene');
const preset = element<HTMLSelectElement>('preset');
const play = element<HTMLButtonElement>('play');
const status = element<HTMLOutputElement>('status');
let current: ScenePose = structuredClone(POSES[0]!);
let playing = false,
  startedAt = 0,
  frame = 0,
  dragSide: Side | null = null;
let targetMessage = '';

preset.innerHTML = POSES.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
const labels: Record<HandShape, string> = { open: 'パー', fist: 'グー', point: '指さし', peace: 'ピース' };
for (const side of ['left', 'right'] as const) {
  element<HTMLSelectElement>(`${side}-hand`).innerHTML = HAND_SHAPES.map(
    (shape) => `<option value="${shape}">${labels[shape]}</option>`,
  ).join('');
  const container = element<HTMLElement>(`${side}-angles`);
  for (const [key, label] of [
    ['shoulder', '肩'],
    ['elbow', '肘'],
    ['wrist', '手首'],
  ] as const) {
    container.insertAdjacentHTML(
      'beforeend',
      `<label>${label}<output id="${side}-${key}-value"></output><input id="${side}-${key}" type="range" min="${RIG[key][0]}" max="${RIG[key][1]}" step="1" aria-label="${side === 'left' ? '左' : '右'}${label}"></label>`,
    );
    element<HTMLInputElement>(`${side}-${key}`).addEventListener('input', (event) => {
      stop();
      current[side][key] = Number((event.target as HTMLInputElement).value);
      targetMessage = '';
      render();
    });
  }
  element<HTMLSelectElement>(`${side}-hand`).addEventListener('change', (event) => {
    current[side === 'left' ? 'leftHand' : 'rightHand'] = (event.target as HTMLSelectElement).value as HandShape;
    render();
  });
}
for (const key of ['rotation', 'scale', 'breath'] as const) {
  element<HTMLInputElement>(key).addEventListener('input', (event) => {
    current.parent[key] = Number((event.target as HTMLInputElement).value);
    render();
  });
}
element<HTMLInputElement>('guides').addEventListener('change', render);
preset.addEventListener('change', () => {
  stop();
  current = structuredClone(POSES[Number(preset.value)]!);
  targetMessage = '';
  render();
});

function stop(): void {
  playing = false;
  cancelAnimationFrame(frame);
  play.textContent = '手振りを再生';
  play.setAttribute('aria-pressed', 'false');
}
function animate(now: number): void {
  if (!playing) return;
  const wave = waveAt((now - startedAt) / 1000);
  current.left = wave.left;
  current.right = wave.right;
  render();
  frame = requestAnimationFrame(animate);
}
play.addEventListener('click', () => {
  if (playing) {
    stop();
    return;
  }
  playing = true;
  startedAt = performance.now();
  targetMessage = '';
  play.textContent = '手振りを停止';
  play.setAttribute('aria-pressed', 'true');
  frame = requestAnimationFrame(animate);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
});

function render(): void {
  canvas.innerHTML = sceneContent(current, element<HTMLInputElement>('guides').checked);
  const messages: string[] = [];
  for (const side of ['left', 'right'] as const) {
    const { pose, reasons } = constrain(current[side]);
    const a = forward(pose, side === 'left' ? 'L' : 'R');
    const s = toWorld(a.shoulder, current.parent),
      e = toWorld(a.elbow, current.parent),
      w = toWorld(a.wrist, current.parent);
    for (const key of ['shoulder', 'elbow', 'wrist'] as const) {
      element<HTMLInputElement>(`${side}-${key}`).value = String(current[side][key]);
      element<HTMLOutputElement>(`${side}-${key}-value`).value = `${pose[key].toFixed(1)}°`;
    }
    element<HTMLSelectElement>(`${side}-hand`).value = current[side === 'left' ? 'leftHand' : 'rightHand'];
    messages.push(
      `${side === 'left' ? 'L' : 'R'} 骨長 ${distance(s, e).toFixed(2)} / ${distance(e, w).toFixed(2)}${reasons.length ? `  制限: ${reasons.join('・')}` : ''}`,
    );
  }
  for (const key of ['rotation', 'scale', 'breath'] as const) {
    element<HTMLInputElement>(key).value = String(current.parent[key]);
    element<HTMLOutputElement>(`${key}-value`).value = String(Number(current.parent[key].toFixed(2)));
  }
  status.value = `${messages.join('\n')}\n${targetMessage || '掌の親指の目印は固定。手首の白い点をドラッグできます。'}`;
}

function eventPoint(event: PointerEvent): { x: number; y: number } | null {
  const matrix = canvas.getScreenCTM();
  if (!matrix) return null;
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: p.x, y: p.y };
}
canvas.addEventListener('pointerdown', (event) => {
  const p = eventPoint(event);
  if (!p) return;
  let nearest = Infinity;
  for (const side of ['L', 'R'] as const) {
    const pose = constrain(side === 'L' ? current.left : current.right).pose;
    const d = distance(p, toWorld(forward(pose, side).wrist, current.parent));
    if (d < 30 && d < nearest) {
      nearest = d;
      dragSide = side;
    }
  }
  if (dragSide) {
    stop();
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragSide) return;
  const p = eventPoint(event);
  if (!p) return;
  const key = dragSide === 'L' ? 'left' : 'right';
  const previous: Pose = constrain(current[key]).pose;
  const result = solveTarget(fromWorld(p, current.parent), dragSide, previous.wrist, previous);
  current[key] = result.pose;
  targetMessage = `${dragSide}: ${result.reason}（目標との距離 ${result.error.toFixed(1)}px）`;
  render();
});
canvas.addEventListener('pointerup', () => {
  dragSide = null;
});
canvas.addEventListener('pointercancel', () => {
  dragSide = null;
});
render();
