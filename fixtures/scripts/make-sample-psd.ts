// fixtures/sample-model の素材から PSD を作る（カード23の通しのテスト用）。
// `pnpm --filter @app/fixtures generate:psd [出力先]` で実行する。既定の出力先は sample-model/sample-model.psd（git には入れない）。
// レイヤーは標準パーツ1つにつき1枚。名前は standardType（例: frontHair）、重なりは描画順（背面 → 前面）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { initializeCanvas, writePsdUint8Array, type Layer, type Psd } from 'ag-psd';
import { loadProjectJson } from '@app/schema';

const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sample-model');

// ag-psd はブラウザの canvas の型を使う。node では @napi-rs/canvas を同じものとして渡す
type PsdCanvas = NonNullable<Layer['canvas']>;
type CreateCanvas = Parameters<typeof initializeCanvas>[0];

export async function makeSamplePsd(): Promise<Uint8Array> {
  initializeCanvas(((width: number, height: number) => createCanvas(width, height)) as unknown as CreateCanvas);
  const project = loadProjectJson(readFileSync(join(SAMPLE_DIR, 'project.json'), 'utf8'));
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const children: Layer[] = [];
  // drawOrder は背面 → 前面。PSD の children も先頭が背面
  for (const partId of project.model.drawOrder) {
    const part = project.model.parts.find((p) => p.id === partId);
    const asset = part?.assetId ? assets.get(part.assetId) : undefined;
    if (!part || !asset || !part.standardType) continue;
    const image = await loadImage(readFileSync(join(SAMPLE_DIR, asset.path)));
    const canvas: Canvas = createCanvas(asset.width, asset.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    children.push({
      name: part.standardType,
      left: asset.offset.x,
      top: asset.offset.y,
      canvas: canvas as unknown as PsdCanvas,
    });
  }
  const { width, height } = project.assets[0]!.canvasSize;
  const psd: Psd = { width, height, children };
  return writePsdUint8Array(psd, { generateThumbnail: false });
}

// コマンドラインから呼ばれたとき
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? resolve(process.argv[2]) : join(SAMPLE_DIR, 'sample-model.psd');
  const data = await makeSamplePsd();
  writeFileSync(out, data);
  console.log(`PSD を書き出した: ${out}（${data.length} バイト）`);
}
