// シェーダー。色はすべて乗算済みアルファで扱う

// 位置はキャンバス座標。clip = 位置 × u_scale + u_offset（背景の四角形はクリップ座標のまま渡す）
export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
uniform vec2 u_scale;
uniform vec2 u_offset;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_position * u_scale + u_offset, 0.0, 1.0);
}
`;

// 本描画。u_maskMode は 0: マスクなし、1: マスク、2: 反転マスク。マスクは描画バッファと同じ大きさの1チャンネルのテクスチャ
export const DRAW_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform sampler2D u_mask;
uniform float u_opacity;
uniform int u_maskMode;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 color = texture(u_texture, v_uv) * u_opacity;
  if (u_maskMode != 0) {
    float m = texelFetch(u_mask, ivec2(gl_FragCoord.xy), 0).r;
    color *= u_maskMode == 2 ? 1.0 - m : m;
  }
  outColor = color;
}
`;

// マスク元の形。アルファ × 不透明度を赤のチャンネルへ書く（合成は MAX で、範囲の和になる）
export const MASK_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_opacity;
in vec2 v_uv;
out vec4 outColor;
void main() {
  outColor = vec4(texture(u_texture, v_uv).a * u_opacity, 0.0, 0.0, 0.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('シェーダーを作れない');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`シェーダーのコンパイルに失敗した: ${log ?? ''}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error('プログラムを作れない');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`シェーダーのリンクに失敗した: ${log ?? ''}`);
  }
  return program;
}
