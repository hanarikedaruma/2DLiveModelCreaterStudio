import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@app/schema';
import {
  base64ToBytes,
  bytesToBase64,
  decodeToOutput,
  encodeToOutput,
  isFromOutput,
  isToOutput,
  type FrameMessage,
  type ProjectMessage,
} from './protocol';

describe('出力ウィンドウとのメッセージ', () => {
  it('base64 で行って戻る（大きいものも）', () => {
    const big = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
    expect(bytesToBase64(new Uint8Array([0, 255, 1]))).toBe('AP8B');
  });

  it('project は JSON にしても元に戻る（素材と背景の画像は base64）', () => {
    const message: ProjectMessage = {
      type: 'project',
      project: createEmptyProject('出力'),
      assets: { a1: new Uint8Array([1, 2, 3]) },
      backgrounds: { 'backgrounds/x.png': new Uint8Array([9]) },
    };
    const wire = encodeToOutput(message);
    expect(wire).toMatchObject({ assets: { a1: 'AQID' }, backgrounds: { 'backgrounds/x.png': 'CQ==' } });
    const back = decodeToOutput(JSON.parse(JSON.stringify(wire)));
    expect(back).toEqual(message);
  });

  it('frame はそのまま', () => {
    const frame: FrameMessage = {
      type: 'frame',
      params: { FaceAngleX: 3 },
      view: { scale: 0.5, offset: { x: 1, y: 2 } },
      background: { type: 'color', color: '#00ff00' },
      size: { width: 1920, height: 1080 },
      now: 10,
    };
    expect(decodeToOutput(JSON.parse(JSON.stringify(encodeToOutput(frame))))).toEqual(frame);
  });

  it('向きごとに見分ける', () => {
    expect(isToOutput({ type: 'frame' })).toBe(true);
    expect(isToOutput({ type: 'ready' })).toBe(false);
    expect(isFromOutput({ type: 'ready' })).toBe(true);
    expect(isFromOutput({ type: 'closed' })).toBe(true);
    expect(isFromOutput(null)).toBe(false);
  });
});
