import type { TransformDelta } from '@app/schema';

// 変化なしの差分（位置・回転 0、拡縮・不透明度 1）
export function identityDelta(): TransformDelta {
  return { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };
}

// 2つの差分を合わせる。位置・回転は加算、拡縮・不透明度は乗算（新しいオブジェクトを返す）
export function composeDelta(a: TransformDelta, b: TransformDelta): TransformDelta {
  return {
    position: { x: a.position.x + b.position.x, y: a.position.y + b.position.y },
    rotation: a.rotation + b.rotation,
    scale: { x: a.scale.x * b.scale.x, y: a.scale.y * b.scale.y },
    opacity: a.opacity * b.opacity,
  };
}
