import type { BlendMode } from '@app/schema';

// 合成の設定をここに集める（カード32）。色は乗算済みアルファで、シェーダーが不透明度とマスクのアルファを
// 掛けたあとの値（マスクは合成の前に掛かる。マスクで消えたところは、どの合成モードでも下の色のまま）。
// 係数はアルファのチャンネルにも同じものを使う。下の色を d、上の色を s（乗算済み）、上のアルファを a とすると:
// - normal:   s + d(1 − a)                 アルファは a + d.a(1 − a)
// - add:      s + d                        アルファは a + d.a（1 で止まる）
// - multiply: s·d + d(1 − a)               アルファは d.a のまま（透明なところには描かれない）
// - screen:   s + d(1 − s)                 アルファは a + d.a(1 − a)
export function applyBlend(gl: WebGL2RenderingContext, mode: BlendMode): void {
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  switch (mode) {
    case 'add':
      gl.blendFunc(gl.ONE, gl.ONE);
      break;
    case 'multiply':
      gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      break;
    case 'screen':
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      break;
    case 'normal':
    default:
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}
