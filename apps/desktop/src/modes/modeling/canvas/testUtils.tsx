// テスト用の道具（枠を描く・fixtures を開く・キャンバスを pointer で操作する）。テストからだけ使う
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { loadProjectJson, type Binding, type Project, type TransformDelta, type Vec2 } from '@app/schema';
import {
  FakeKeyEditor,
  type Command,
  type DeformedModel,
  type EditorState,
  type KeyEditor,
  type PointsTarget,
  type Renderer,
  type Services,
  type TransformChange,
  type ViewTransform,
} from '@app/contracts';
import { createFakeServices } from '../../../services';
import { createCanvasController, type CanvasController } from '../../../shell/canvas/controller';
import { canvasToScreen } from '../../../shell/canvas/view';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { Shell } from '../../../shell/Shell';

const sampleJson = Object.values(
  import.meta.glob<string>('../../../../../../fixtures/sample-model/project.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0]!;
export const sampleProject = (): Project => loadProjectJson(sampleJson);

export class RecordingRenderer implements Renderer {
  renders: { model: DeformedModel; view: ViewTransform }[] = [];
  init() {}
  setTextures() {}
  render(model: DeformedModel, view: ViewTransform) {
    this.renders.push({ model, view });
  }
  dispose() {}
}

// jsdom は大きさを持たないので、キャンバスの領域を width × height にする
export function stubSize(width: number, height: number): () => void {
  const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height });
  return () => {
    if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
    if (h) Object.defineProperty(HTMLElement.prototype, 'clientHeight', h);
  };
}

export function renderShell(overrides: (base: Services) => Partial<Services> = () => ({})) {
  const renderer = new RecordingRenderer();
  const base = createFakeServices();
  const services: Services = { ...base, createRenderer: () => renderer, ...overrides(base) };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  const canvas = createCanvasController();
  const utils = render(<Shell services={services} environment={environment} canvas={canvas} />);
  return { services, renderer, canvas, ...utils };
}

// fixtures のモデルを開き、全体表示（800×600 なら倍率 0.36）と変形の結果がそろうまで待つ
export async function openSample(shell: ReturnType<typeof renderShell>, project = sampleProject()) {
  act(() => shell.services.store.load(project));
  await waitFor(() => expect(shell.canvas.lastDeformed()?.items.length).toBe(project.model.drawOrder.length));
  await waitFor(() => expect(shell.canvas.getState().view.scale).toBeCloseTo(0.36));
}

// 次に描き直されて lastDeformed が新しくなるまで待つ
export async function redrawn(canvas: CanvasController, check: (m: DeformedModel) => void) {
  await waitFor(() => {
    const m = canvas.lastDeformed();
    expect(m).not.toBeNull();
    check(m!);
  });
}

type Extra = { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean };

// キャンバス座標で pointer を操作する
export function pointer(canvas: CanvasController) {
  const overlay = () => screen.getByTestId('canvas-overlay');
  const toScreen = (p: Vec2) => canvasToScreen(canvas.getState().view, p);
  const fire = (type: 'down' | 'move' | 'up', p: Vec2, extra: Extra = {}) => {
    const s = toScreen(p);
    const init = { button: 0, clientX: s.x, clientY: s.y, pointerId: 1, ...extra };
    if (type === 'down') fireEvent.pointerDown(overlay(), init);
    else if (type === 'move') fireEvent.pointerMove(overlay(), init);
    else fireEvent.pointerUp(overlay(), init);
  };
  return {
    toScreen,
    down: (p: Vec2, extra?: Extra) => fire('down', p, extra),
    move: (p: Vec2, extra?: Extra) => fire('move', p, extra),
    up: (p: Vec2, extra?: Extra) => fire('up', p, extra),
    click(p: Vec2, extra?: Extra) {
      fire('down', p, extra);
      fire('up', p, extra);
    },
    // from から to へ、steps 回に分けて動かす。points を渡すとその点を通る
    drag(from: Vec2, to: Vec2, extra?: Extra, steps = 4, through: Vec2[] = []) {
      fire('down', from, extra);
      let prev = from;
      for (const target of [...through, to]) {
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          fire('move', { x: prev.x + (target.x - prev.x) * t, y: prev.y + (target.y - prev.y) * t }, extra);
        }
        prev = target;
      }
      fire('up', to, extra);
    },
  };
}

// ---- キーを編集する KeyEditor の代わり ----
// 編集中のパラメータが無ければ仮実装（基準状態）。あればバインディングの最初のキーの差分を変え、
// バインディングが無ければ 'needsKey' を返す。addKeyAtCurrentValue でバインディング（キー1つ）を作る

const KEY_PARAM = 'FaceAngleX';

function bindingFor(project: Project, type: 'part' | 'mesh', id: string): Binding | undefined {
  const channel = type === 'part' ? 'transform' : 'vertices';
  return project.model.bindings.find((b) => b.channel === channel && b.target.type === type && b.target.id === id);
}

function withBinding(project: Project, binding: Binding): Project {
  const others = project.model.bindings.filter((b) => b.id !== binding.id);
  return { ...project, model: { ...project.model, bindings: [...others, binding] } };
}

export function keyBinding(type: 'part' | 'mesh', id: string, delta: TransformDelta | Vec2[]): Binding {
  return {
    id: `key-${type}-${id}`,
    target: { type, id },
    channel: type === 'part' ? 'transform' : 'vertices',
    parameterIds: [KEY_PARAM],
    keyValues: [[0, 30]],
    keys: [{ coords: [30], delta, source: 'manual', locked: false }],
    generation: 'linear',
    divisions: null,
  };
}

export class KeyedStubEditor implements KeyEditor {
  readonly base = new FakeKeyEditor();
  calls = { transformEdit: 0, pointsEdit: 0, addKey: [] as string[] };

  transformEdit(project: Project, editor: EditorState, partIds: string[], change: TransformChange) {
    this.calls.transformEdit++;
    if (editor.activeParameterIds.length === 0) return this.base.transformEdit(project, editor, partIds, change);
    if (partIds.some((id) => !bindingFor(project, 'part', id))) return 'needsKey' as const;
    return {
      label: 'キーの編集',
      apply: (p: Project) =>
        partIds.reduce((acc, id) => {
          const b = bindingFor(acc, 'part', id)!;
          const key = b.keys[0]!;
          const d = key.delta as TransformDelta;
          const delta: TransformDelta = {
            position: { x: d.position.x + (change.dPosition?.x ?? 0), y: d.position.y + (change.dPosition?.y ?? 0) },
            rotation: d.rotation + (change.dRotation ?? 0),
            scale: { x: d.scale.x * (change.scaleFactor?.x ?? 1), y: d.scale.y * (change.scaleFactor?.y ?? 1) },
            opacity: d.opacity,
          };
          return withBinding(acc, { ...b, keys: [{ ...key, delta }] });
        }, p),
    };
  }

  pointsEdit(project: Project, editor: EditorState, target: PointsTarget, moves: { index: number; d: Vec2 }[]) {
    this.calls.pointsEdit++;
    if (editor.activeParameterIds.length === 0 || target.kind !== 'mesh')
      return this.base.pointsEdit(project, editor, target, moves);
    const b = bindingFor(project, 'mesh', target.meshId);
    if (!b) return 'needsKey' as const;
    return {
      label: 'キーの編集',
      apply: (p: Project) => {
        const binding = bindingFor(p, 'mesh', target.meshId)!;
        const key = binding.keys[0]!;
        const delta = (key.delta as Vec2[]).slice();
        for (const { index, d } of moves) {
          const v = delta[index] ?? { x: 0, y: 0 };
          delta[index] = { x: v.x + d.x, y: v.y + d.y };
        }
        return withBinding(p, { ...binding, keys: [{ ...key, delta }] });
      },
    };
  }

  addKeyAtCurrentValue(_project: Project, _editor: EditorState, target: { partId: string } | PointsTarget): Command {
    const id = 'partId' in target ? target.partId : target.kind === 'mesh' ? target.meshId : target.warpId;
    this.calls.addKey.push(id);
    return {
      label: 'キーの追加',
      apply: (p) => {
        if ('partId' in target) {
          if (bindingFor(p, 'part', target.partId)) return p;
          const identity: TransformDelta = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };
          return withBinding(p, keyBinding('part', target.partId, identity));
        }
        if (target.kind !== 'mesh' || bindingFor(p, 'mesh', target.meshId)) return p;
        const mesh = p.model.meshes.find((m) => m.id === target.meshId);
        return withBinding(
          p,
          keyBinding(
            'mesh',
            target.meshId,
            (mesh?.vertices ?? []).map(() => ({ x: 0, y: 0 })),
          ),
        );
      },
    };
  }
}

// 呼ばれた描画の命令を記録する 2D コンテキスト
export class RecordingContext {
  calls: { name: string; args: number[] }[] = [];
  strokeStyle: unknown = '';
  fillStyle: unknown = '';
  lineWidth = 1;
  globalAlpha = 1;
  private record(name: string, args: unknown[]) {
    this.calls.push({ name, args: args.filter((a): a is number => typeof a === 'number') });
  }
  beginPath() {
    this.record('beginPath', []);
  }
  closePath() {
    this.record('closePath', []);
  }
  moveTo(...a: number[]) {
    this.record('moveTo', a);
  }
  lineTo(...a: number[]) {
    this.record('lineTo', a);
  }
  arc(...a: number[]) {
    this.record('arc', a);
  }
  rect(...a: number[]) {
    this.record('rect', a);
  }
  fillRect(...a: number[]) {
    this.record('fillRect', a);
  }
  strokeRect(...a: number[]) {
    this.record('strokeRect', a);
  }
  stroke() {
    this.record('stroke', []);
  }
  fill() {
    this.record('fill', []);
  }
  save() {}
  restore() {}
  setLineDash() {}
  named(name: string) {
    return this.calls.filter((c) => c.name === name).map((c) => c.args);
  }
  asContext(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }
}
