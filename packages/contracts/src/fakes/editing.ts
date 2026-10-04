import type { Binding, Model, Project, Vec2 } from '@app/schema';
import type {
  AutoSetup,
  Command,
  EditorState,
  KeyEditor,
  KeyGenerator,
  MeshGenerator,
  PointsTarget,
  TransformChange,
} from '../index';

// 画像全体を覆う四角形（三角形2枚）
export class FakeMeshGenerator implements MeshGenerator {
  generate(
    alpha: ImageData,
    offset: Vec2,
    _density: 'light' | 'standard' | 'smooth',
  ): { vertices: Vec2[]; uvs: Vec2[]; triangles: [number, number, number][] } {
    const { width: w, height: h } = alpha;
    return {
      vertices: [
        { x: offset.x, y: offset.y },
        { x: offset.x + w, y: offset.y },
        { x: offset.x + w, y: offset.y + h },
        { x: offset.x, y: offset.y + h },
      ],
      uvs: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      triangles: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    };
  }
}

// 何も変えないバインディングを返す
export class FakeKeyGenerator implements KeyGenerator {
  linear(binding: Binding, _divisions?: number): Binding {
    return binding;
  }

  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[] {
    return model.bindings.filter((b) => b.channel === 'transform' && b.parameterIds.includes(parameterId));
  }

  // STEP1 で足したメソッド。何も変えずに返す
  rotate(binding: Binding, _model: Model): Binding {
    return binding;
  }

  surface(binding: Binding, _model: Model): Binding {
    return binding;
  }

  ease(binding: Binding): Binding {
    return binding;
  }

  regenerate(binding: Binding, _model: Model, _range?: [number, number]): Binding {
    return binding;
  }
}

// 何も変えないコマンドを返す
export class FakeAutoSetup implements AutoSetup {
  plan(_project: Project): { command: Command; warnings: string[] } {
    return { command: { label: 'かんたんセットアップ', apply: (p) => p }, warnings: [] };
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function updateModel(project: Project, fn: (model: Model) => Model): Project {
  const model = fn(project.model);
  return model === project.model ? project : { ...project, model };
}

// 常に基準状態（Part の position・rotation・scale・pivot・opacity、メッシュの基準頂点）を変えるコマンドを返す
export class FakeKeyEditor implements KeyEditor {
  transformEdit(_project: Project, _editor: EditorState, partIds: string[], change: TransformChange): Command {
    const ids = new Set(partIds);
    return {
      label: 'パーツの変形',
      apply: (project) =>
        updateModel(project, (model) => ({
          ...model,
          parts: model.parts.map((part) => {
            if (!ids.has(part.id)) return part;
            return {
              ...part,
              position: change.dPosition
                ? { x: part.position.x + change.dPosition.x, y: part.position.y + change.dPosition.y }
                : part.position,
              rotation: part.rotation + (change.dRotation ?? 0),
              scale: change.scaleFactor
                ? { x: part.scale.x * change.scaleFactor.x, y: part.scale.y * change.scaleFactor.y }
                : part.scale,
              opacity: change.opacityFactor !== undefined ? clamp01(part.opacity * change.opacityFactor) : part.opacity,
              pivot: change.dPivot
                ? { x: part.pivot.x + change.dPivot.x, y: part.pivot.y + change.dPivot.y }
                : part.pivot,
            };
          }),
        })),
    };
  }

  pointsEdit(
    _project: Project,
    _editor: EditorState,
    target: PointsTarget,
    moves: { index: number; d: Vec2 }[],
  ): Command {
    const move = (points: Vec2[]) => {
      const out = points.slice();
      for (const { index, d } of moves) {
        const p = out[index];
        if (p) out[index] = { x: p.x + d.x, y: p.y + d.y };
      }
      return out;
    };
    return {
      label: target.kind === 'mesh' ? '頂点の移動' : '制御点の移動',
      apply: (project) =>
        updateModel(project, (model) =>
          target.kind === 'mesh'
            ? {
                ...model,
                meshes: model.meshes.map((m) => (m.id === target.meshId ? { ...m, vertices: move(m.vertices) } : m)),
              }
            : {
                ...model,
                warps: model.warps.map((w) => (w.id === target.warpId ? { ...w, points: move(w.points) } : w)),
              },
        ),
    };
  }

  addKeyAtCurrentValue(_project: Project, _editor: EditorState, _target: { partId: string } | PointsTarget): Command {
    return { label: 'キーの追加', apply: (p) => p };
  }
}
