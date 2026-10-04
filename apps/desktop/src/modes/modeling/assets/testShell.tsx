// 画面のテスト用の道具（カード17・20）。枠を描き、素材の画像の読み込みは仮のものにする（jsdom に createImageBitmap が無いため）
import { fireEvent, render } from '@testing-library/react';
import { createAssetRepository, pngSize, type Renderer, type Services } from '@app/contracts';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { Shell } from '../../../shell/Shell';

// IHDR に幅と高さだけを書いた PNG（FakeImporter と pngSize が読める）
export function pngBytes(width: number, height: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[32] = seed;
  return bytes;
}

type Decode = NonNullable<NonNullable<Parameters<typeof createAssetRepository>[0]>['decode']>;

export const fakeDecode: Decode = async (png) => {
  const { width, height } = pngSize(png);
  const image = { width, height, close() {} } as unknown as ImageBitmap;
  const imageData = { width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' } as ImageData;
  return { image, imageData };
};

const nullRenderer = (): Renderer => ({ init() {}, setTextures() {}, render() {}, dispose() {} });

export function testServices(overrides: Partial<Services> = {}): Services {
  return {
    ...createFakeServices(),
    createRenderer: nullRenderer,
    assets: createAssetRepository({ decode: fakeDecode }),
    ...overrides,
  };
}

export function renderShell(services: Services) {
  const environment = createEnvironmentStore(memoryEnvironmentStorage());
  return render(<Shell services={services} environment={environment} />);
}

// pointer でドラッグして target で離す（dnd.ts）
export function dragTo(source: Element, target: Element, options: { clientY?: number } = {}) {
  const clientY = options.clientY ?? 40;
  fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(target, { button: 0, clientX: 30, clientY });
  fireEvent.pointerUp(target, { button: 0, clientX: 30, clientY });
  // ブラウザは離したあと、押した要素と離した要素の共通の祖先に click を出す
  fireEvent.click(document.body);
}

// getBoundingClientRect を決める（jsdom は大きさを持たない）
export function stubRect(el: Element, rect: { top: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({
      top: rect.top,
      height: rect.height,
      bottom: rect.top + rect.height,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: rect.top,
    }) as DOMRect;
}
