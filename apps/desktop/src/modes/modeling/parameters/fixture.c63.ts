// カード63の独立した受け入れテスト用の、2つのパーツが同じパラメータを使うモデル。
import { createEmptyProject, type Binding, type ParameterKey, type TransformDelta } from '@app/schema';
import { basePart } from '../structure/modelOps';

export const delta63 = (x: number): TransformDelta => ({
  position: { x, y: 2 },
  rotation: 9,
  scale: { x: 1.2, y: 0.8 },
  opacity: 0.7,
});
export const key63 = (
  value: number,
  x: number,
  locked = false,
  source: ParameterKey['source'] = 'manual',
): ParameterKey => ({
  coords: [value],
  delta: delta63(x),
  locked,
  source,
});

export function binding63(id: string, partId: string, locked = false): Binding {
  return {
    id,
    target: { type: 'part', id: partId },
    channel: 'transform',
    parameterIds: ['FaceAngleX'],
    keyValues: [[-30, 0, 10, 20, 30]],
    keys: [key63(-30, -11), key63(0, 0, false, 'auto'), key63(10, 7, locked), key63(20, 13), key63(30, 21)],
    generation: 'linear',
    divisions: 2,
  };
}

export function project63(locked = false) {
  const project = createEmptyProject('カード63: キーの操作');
  return {
    ...project,
    model: {
      ...project.model,
      parts: [
        basePart({ id: 'a', name: '選ぶパーツ', kind: 'image' }),
        basePart({ id: 'b', name: 'ほかのパーツ', kind: 'image' }),
      ],
      bindings: [binding63('a-key', 'a', locked), binding63('b-key', 'b')],
    },
  };
}
