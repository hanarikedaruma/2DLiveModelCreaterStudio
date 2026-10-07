import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, getByLabelText, getByRole } from '@testing-library/dom';
import { createEmptyProject } from '@app/schema';
import type { StudioFrame } from '../modes/studio/runtime';
import { createFakeServices } from '../services';
import { registerDiagnostics, type Diagnostics } from './index';
import { RECORD_LIMIT_MS } from './collector';

const { runtime } = vi.hoisted(() => ({
  runtime: { sink: null as ((frame: StudioFrame) => void) | null },
}));
vi.mock('../modes/studio/runtime', () => ({
  studioRuntime: {
    registerFrameSink: (sink: (frame: StudioFrame) => void) => (runtime.sink = sink),
    getOutputSize: () => ({ width: 1920, height: 1080 }),
  },
}));

let api: Diagnostics | null = null;
afterEach(() => {
  if (api?.isVisible()) api.toggle();
  vi.useRealTimers();
  runtime.sink = null;
});

function setup() {
  vi.useFakeTimers();
  const services = createFakeServices();
  services.store.load(createEmptyProject('計測'));
  api = registerDiagnostics(services);
  api.toggle();
  return api;
}

const frame = (): StudioFrame => ({
  model: { parts: [], meshes: [] } as unknown as StudioFrame['model'],
  view: { scale: 1, offset: { x: 0, y: 0 } },
  background: { type: 'transparent' },
  now: 0,
  params: { EyeOpenL: 0.8, EyeOpenR: 0, MouthOpen: 0.2 },
  layers: [
    { id: 'auto', values: { EyeOpenL: 0.4, EyeOpenR: 0 }, weight: 1 },
    { id: 'expression', values: { EyeOpenL: 0.8 }, weight: 0.5, parameterWeights: { EyeOpenL: 1 } },
  ],
});

describe('計測の層の表示と記録', () => {
  it('合成前の自動・表情の値と有効な重み、最後の値を表示し、0と未担当を区別する', () => {
    setup();
    runtime.sink!(frame());
    vi.advanceTimersByTime(500);
    const table = getByRole(document.body, 'table', { name: /層ごとの値/ });
    const left = table.querySelector('[data-parameter-id="EyeOpenL"]')!;
    expect(left.querySelector('[data-layer-id="auto"]')?.textContent).toContain('0.400');
    expect(left.querySelector('[data-layer-id="expression"]')?.textContent).toContain('重み 1.000');
    expect(left.querySelector('[data-final]')?.textContent).toBe('0.800');
    const right = table.querySelector('[data-parameter-id="EyeOpenR"]')!;
    expect(right.querySelector('[data-layer-id="auto"]')?.textContent).toContain('0.000');
    expect(right.querySelector('[data-layer-id="expression"]')?.textContent).toBe('—');
  });

  it('選択は表示を閉じて開いても保ち、JSONには選んだパラメータだけを500msごとに写す', () => {
    const diagnostics = setup();
    fireEvent.click(getByLabelText(document.body, /EyeOpenR/));
    diagnostics.toggle();
    diagnostics.toggle();
    expect((getByLabelText(document.body, /EyeOpenR/) as HTMLInputElement).checked).toBe(false);
    diagnostics.startRecording();
    const source = frame();
    for (let i = 0; i < 60; i++) {
      runtime.sink!(source);
      vi.advanceTimersByTime(1000 / 60);
    }
    source.layers[0]!.values.EyeOpenL = 99;
    const record = diagnostics.stopRecording()!;
    const layers = JSON.parse(JSON.stringify(record)).samples.layers;
    expect(layers.length).toBe(2);
    expect(layers[0].parameterIds).not.toContain('EyeOpenR');
    expect(layers[0].layers[0].values).toEqual({ EyeOpenL: 0.4 });
    expect(layers[0].final.EyeOpenL).toBe(0.8);
    expect(layers[1].atMs - layers[0].atMs).toBeGreaterThanOrEqual(500);
    expect(layers[0].layers[1].parameterWeights).toEqual({ EyeOpenL: 1 });
  });

  it('表示を閉じていても記録し、5分を超えた層の値を記録しない', () => {
    const diagnostics = setup();
    diagnostics.startRecording();
    diagnostics.toggle();
    runtime.sink!(frame());
    vi.advanceTimersByTime(RECORD_LIMIT_MS + 1);
    runtime.sink!(frame());
    const record = JSON.parse(JSON.stringify(diagnostics.stopRecording()));
    expect(record.samples.layers).toHaveLength(1);
  });
});
