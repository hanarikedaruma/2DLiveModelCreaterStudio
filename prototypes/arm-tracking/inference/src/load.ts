// 合成の描画負荷。製品の描画ではない。パーツ数 × 格子のメッシュを毎フレーム CPU で変形して WebGL2 で描く。
// GPU を推定と取り合うときの描画の遅れを見るためのもので、実モデルの負荷は AT-14 で測る。
const GRID = 16;
const VERTEX = `#version 300 es
in vec2 position; in vec2 uv; out vec2 v;
void main() { v = uv; gl_Position = vec4(position, 0.0, 1.0); }`;
const FRAGMENT = `#version 300 es
precision mediump float; in vec2 v; uniform sampler2D image; uniform float alpha; out vec4 color;
void main() { vec4 c = texture(image, v); color = vec4(c.rgb, c.a * alpha); }`;

export interface RenderLoad {
  draw(time: number): void;
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
  return shader;
}

export function createRenderLoad(canvas: HTMLCanvasElement, parts: number): RenderLoad {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
  if (!gl) throw new Error('WebGL2 が使えない');
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);

  // 1 枚の模様のテクスチャを全パーツで使う
  const pattern = document.createElement('canvas');
  pattern.width = pattern.height = 512;
  const ctx = pattern.getContext('2d')!;
  for (let i = 0; i < 64; i++) {
    ctx.fillStyle = `hsla(${(i * 47) % 360}, 70%, 60%, 0.8)`;
    ctx.beginPath();
    ctx.arc((i * 97) % 512, (i * 53) % 512, 30 + (i % 5) * 12, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pattern);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

  const verts = (GRID + 1) * (GRID + 1);
  const indices = new Uint16Array(GRID * GRID * 6);
  let k = 0;
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const a = y * (GRID + 1) + x;
      indices.set([a, a + 1, a + GRID + 1, a + 1, a + GRID + 2, a + GRID + 1], k);
      k += 6;
    }
  const uv = new Float32Array(verts * 2);
  for (let i = 0; i < verts; i++) {
    uv[i * 2] = (i % (GRID + 1)) / GRID;
    uv[i * 2 + 1] = Math.floor(i / (GRID + 1)) / GRID;
  }
  const positions = new Float32Array(verts * 2 * parts);
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions.byteLength, gl.DYNAMIC_DRAW);
  const uvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  const positionAt = gl.getAttribLocation(program, 'position');
  const uvAt = gl.getAttribLocation(program, 'uv');
  const alphaAt = gl.getUniformLocation(program, 'alpha');
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  return {
    draw(time) {
      const width = Math.round(canvas.clientWidth * devicePixelRatio);
      const height = Math.round(canvas.clientHeight * devicePixelRatio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.12, 0.13, 0.15, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const s = time / 1000;
      for (let p = 0; p < parts; p++) {
        const cx = Math.sin(p * 1.7) * 0.6;
        const cy = Math.cos(p * 1.3) * 0.6;
        const size = 0.25 + (p % 7) * 0.03;
        const base = p * verts * 2;
        for (let i = 0; i < verts; i++) {
          const u = (i % (GRID + 1)) / GRID - 0.5;
          const v = Math.floor(i / (GRID + 1)) / GRID - 0.5;
          const wave = Math.sin(s * 2 + p + v * 4) * 0.08;
          positions[base + i * 2] = cx + (u + wave * v) * size;
          positions[base + i * 2 + 1] = cy + (v + wave * u) * size;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.enableVertexAttribArray(uvAt);
      gl.vertexAttribPointer(uvAt, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(alphaAt, 0.85);
      for (let p = 0; p < parts; p++) {
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(positionAt);
        gl.vertexAttribPointer(positionAt, 2, gl.FLOAT, false, 0, p * verts * 8);
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
      }
    },
    dispose() {
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(uvBuffer);
      gl.deleteBuffer(indexBuffer);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
    },
  };
}
