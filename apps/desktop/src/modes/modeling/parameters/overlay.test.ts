import { describe, expect, it, vi } from 'vitest';
import { createEditorStore, createProjectStore, defaultEditorState } from '@app/core';
import { gridTestProject } from '../grid2d/testModel';
import { editingLabel } from './labels';
import { connectEditingOverlay, drawEditingOverlay } from './overlay';

describe('編集中の表示の折り返し', () => {
  it.each([240, 800])('幅 %i CSS px で文字と背景がキャンバス内に収まり、全文が読める', (width) => {
    const store = createProjectStore(gridTestProject());
    const editor = createEditorStore({
      ...defaultEditorState(),
      activeParameterIds: ['FaceAngleX', 'FaceAngleY'],
      editorParamValues: { FaceAngleX: -30, FaceAngleY: 30 },
    });
    const disconnect = connectEditingOverlay({ store, editor });
    const texts: { text: string; x: number; y: number }[] = [];
    const fillRect = vi.fn();
    const ctx = {
      canvas: { clientWidth: width, width: width * 2 },
      measureText: (text: string) => ({ width: text.length * 10 }),
      fillRect,
      fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
    } as unknown as CanvasRenderingContext2D;
    try {
      drawEditingOverlay(ctx, { scale: 0.5, offset: { x: 0, y: 0 } });
      expect(texts.map((line) => line.text).join('')).toBe(editingLabel(store.get(), editor.get()));
      expect(texts.length).toBe(width === 240 ? 3 : 1);
      for (const line of texts) expect(line.x + ctx.measureText(line.text).width).toBeLessThanOrEqual(width - 8);
      const [x, y, w, h] = fillRect.mock.calls[0]!;
      expect(x + w).toBeLessThanOrEqual(width - 8);
      expect(texts.at(-1)!.y + 7).toBeLessThanOrEqual(y + h);
      texts.slice(1).forEach((line, i) => expect(line.y - texts[i]!.y).toBe(20));
    } finally {
      disconnect();
    }
  });
});
