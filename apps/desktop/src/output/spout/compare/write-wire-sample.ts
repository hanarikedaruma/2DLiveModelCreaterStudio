// wireSample の中身を src-tauri/src/output/testdata に書く（形を変えたときだけ手で動かす）。
//   pnpm --filter @app/fixtures exec tsx ../apps/desktop/src/output/spout/compare/write-wire-sample.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wireSample } from './wireSample';

// 16 進で 32 バイトごとに改行する（差分を読みやすく）
const hex = (bytes: Uint8Array) =>
  (
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
      .join('')
      .match(/.{1,64}/g) ?? []
  ).join('\n') + '\n';

const dir = fileURLToPath(new URL('../../../../src-tauri/src/output/testdata/', import.meta.url));
const { frame, textures } = wireSample();
writeFileSync(`${dir}wire-sample-frame.hex`, hex(frame));
writeFileSync(`${dir}wire-sample-textures.hex`, hex(textures));
console.log(
  `書いた: ${dir}wire-sample-frame.hex（${frame.length} バイト）・wire-sample-textures.hex（${textures.length} バイト）`,
);
