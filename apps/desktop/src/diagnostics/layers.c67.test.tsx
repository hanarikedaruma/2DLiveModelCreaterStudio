// カード67（計測の表示に層ごとの値）のテスト。テストの担当は CL（実装の担当は CO）
// 計測の表示（registerDiagnostics）を、テストごとに作る本物の実行部（createStudioRuntime を手で tick する）につなぎ、
// 本物の合成（createParameterMixer）・自動まばたき（createAutoBlink）・表情（createExpressionController）の値を表と JSON で読む。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, getByRole, within } from '@testing-library/dom';
import { LAYER_ORDER, type Layer, type LayerId, type LayerProducer } from '@app/contracts';
import {
  BODY_FOLLOW_RATES,
  createAutoBlink,
  createBodyFollowProducer,
  createExpressionController,
  createParameterMixer,
} from '@app/core';
import { createEmptyProject, ensureStandardParameters, standardParametersFor, type Expression } from '@app/schema';
import { createStudioRuntime, type StudioFrame, type StudioRuntime } from '../modes/studio/runtime';
import { createFakeServices } from '../services';
import { createDiagnosticsCollector, RECORD_LIMIT_MS } from './collector';
import { registerDiagnostics, type Diagnostics } from './index';
import { createLayerDisplay, DEFAULT_DIAGNOSTIC_PARAMETERS, LAYER_SAMPLE_MS, sampleLayers } from './layers';

const { holder } = vi.hoisted(() => ({ holder: { runtime: null as StudioRuntime | null } }));
vi.mock('../modes/studio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modes/studio/runtime')>();
  return {
    ...actual,
    // アプリで1つの実行部の代わりに、テストごとに作った本物の実行部へつなぐ
    studioRuntime: {
      registerFrameSink: (sink: (frame: StudioFrame) => void) => holder.runtime!.registerFrameSink(sink),
      getOutputSize: () => holder.runtime!.getOutputSize(),
    },
  };
});

// 既定で表に出す9つ（顔の角度・目の開閉・口の開閉・体の角度）を、モデルのパラメータの順に並べたもの
const DEFAULT_ROWS = [
  'FaceAngleX',
  'FaceAngleY',
  'FaceAngleZ',
  'EyeOpenL',
  'EyeOpenR',
  'MouthOpen',
  'BodyAngleX',
  'BodyAngleY',
  'BodyAngleZ',
];
// 表の見出し（パラメータ・最後の値・9つの層）
const HEADERS = [
  'パラメータ',
  '最後の値',
  'カメラ',
  '自動',
  '体の追従',
  '表情',
  'ホットキー',
  'アニメーション',
  '音声',
  '周期',
  '物理',
];

const opened: Diagnostics[] = [];
let detach: (() => void) | null = null;
afterEach(() => {
  for (const diagnostics of opened.splice(0)) if (diagnostics.isVisible()) diagnostics.toggle();
  detach?.();
  detach = null;
  holder.runtime = null;
  vi.useRealTimers();
});

// カメラは始めない（＝カメラ停止中）。自動まばたきは乱数 0 で、最初の tick の 2000ms 後に閉じ始め、2080〜2120ms は閉じたまま
function setup(options: { expressions?: Expression[] } = {}) {
  vi.useFakeTimers();
  const services = createFakeServices();
  services.mixer = createParameterMixer();
  services.autoBlink = createAutoBlink(() => 0);
  const project = createEmptyProject('計測の層');
  services.store.load({
    ...project,
    model: ensureStandardParameters(project.model, 'step1'),
    expressions: options.expressions ?? [],
  });
  const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
  holder.runtime = runtime;
  detach = runtime.attach(services);
  const diagnostics = registerDiagnostics(services);
  opened.push(diagnostics);
  return { services, runtime, diagnostics };
}

function table(): HTMLTableElement {
  return getByRole(document.body, 'table', { name: /層ごとの値/ }) as HTMLTableElement;
}

function rowIds(): string[] {
  return [...table().querySelectorAll<HTMLTableRowElement>('tbody tr')].map((tr) => tr.dataset.parameterId ?? '');
}

// 1行を、データの印（data-final・data-layer-id）と見出しの列の位置の両方で読み、食い違わないことも確かめる
function readRow(parameterId: string): Record<string, string> {
  const t = table();
  const tr = t.querySelector<HTMLTableRowElement>(`tbody tr[data-parameter-id="${parameterId}"]`);
  if (!tr) throw new Error(`表に ${parameterId} の行が無い`);
  const headers = [...t.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
  const cells = [...tr.children].map((cell) => cell.textContent ?? '');
  const byHeader = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']));
  const row: Record<string, string> = {
    name: tr.querySelector('th')?.textContent ?? '',
    final: tr.querySelector('[data-final]')?.textContent ?? '',
  };
  for (const id of LAYER_ORDER) row[id] = tr.querySelector(`[data-layer-id="${id}"]`)?.textContent ?? '';
  expect(byHeader['パラメータ']).toBe(row.name);
  expect(byHeader['最後の値']).toBe(row.final);
  expect(byHeader['カメラ']).toBe(row.tracking);
  expect(byHeader['自動']).toBe(row.auto);
  expect(byHeader['表情']).toBe(row.expression);
  return row;
}

// 指定した層の列だけに値があり、ほかの層は「—」（担当しない）であること
function onlyLayers(row: Record<string, string>, expected: Partial<Record<LayerId, string>>) {
  for (const id of LAYER_ORDER) expect([id, row[id]]).toEqual([id, expected[id] ?? '—']);
}

const smile: Expression = {
  id: 'expr-smile',
  name: 'にっこり',
  entries: [
    { parameterId: 'EyeOpenL', value: -0.4, blend: 'add' },
    { parameterId: 'EyeOpenR', value: 0.5, blend: 'multiply' },
    { parameterId: 'FaceAngleX', value: 12, blend: 'add' },
    { parameterId: 'EyeSmileL', value: 0.9, blend: 'override' },
  ],
  fadeIn: 1,
  fadeOut: 0,
};

const syntheticFrame = (params: StudioFrame['params'], layers: Layer[]): StudioFrame => ({
  model: { parts: [], meshes: [] } as unknown as StudioFrame['model'],
  view: { scale: 1, offset: { x: 0, y: 0 } },
  background: { type: 'transparent' },
  now: 0,
  params,
  layers,
});

describe('カード67: 層ごとの値と最後の値の表', () => {
  it('カメラ停止中は、目の値が「自動」の列から来て最後の値と同じで、「カメラ」の列は — と読める', () => {
    const { runtime, diagnostics } = setup();
    diagnostics.toggle();
    expect(diagnostics.isVisible()).toBe(true);
    expect([...table().querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(HEADERS);
    expect(rowIds()).toEqual(DEFAULT_ROWS);

    runtime.tick(10_000); // まばたきの数え始め
    runtime.tick(12_080); // 自動まばたきで閉じている
    vi.advanceTimersByTime(LAYER_SAMPLE_MS);
    for (const id of ['EyeOpenL', 'EyeOpenR']) {
      const row = readRow(id);
      expect(row.final).toBe('0.000');
      onlyLayers(row, { auto: '0.000 / 重み 1.000・上書き' });
    }
    // 担当する層が無いパラメータは、最後の値がデフォルト値で、層の列はすべて —（0 と区別する）
    const face = readRow('FaceAngleX');
    expect(face.final).toBe('0.000');
    onlyLayers(face, {});

    runtime.tick(12_300); // まばたきが終わって開いた
    vi.advanceTimersByTime(LAYER_SAMPLE_MS);
    const open = readRow('EyeOpenL');
    expect(open.final).toBe('1.000');
    onlyLayers(open, { auto: '1.000 / 重み 1.000・上書き' });

    // 自動まばたきをオフにすると、自動の列も — になり、最後の値はデフォルト値
    runtime.setAutoBlink(false);
    runtime.tick(14_080);
    vi.advanceTimersByTime(LAYER_SAMPLE_MS);
    const off = readRow('EyeOpenL');
    expect(off.final).toBe('1.000');
    onlyLayers(off, {});
  });

  it('表情を掛けると、表情の層の値・重み・合成方法と、合成した最後の値の違いが読める', () => {
    const { services, runtime, diagnostics } = setup({ expressions: [smile] });
    const expressions = createExpressionController();
    runtime.registerLayerProducer(expressions);
    diagnostics.toggle();
    runtime.tick(10_000);
    expressions.apply(smile.id, 10_000);
    expect(services.store.get().expressions.map((e) => e.id)).toEqual(['expr-smile']);

    // fadeIn 1秒の半分（重み 0.5）
    runtime.tick(10_500);
    vi.advanceTimersByTime(LAYER_SAMPLE_MS);
    const half = readRow('EyeOpenL');
    expect(half.final).toBe('0.800'); // 1 + (-0.4 × 0.5)
    onlyLayers(half, { auto: '1.000 / 重み 1.000・上書き', expression: '-0.400 / 重み 0.500・加算' });
    const right = readRow('EyeOpenR');
    expect(right.final).toBe('0.750'); // 1 × (1 + (0.5 − 1) × 0.5)
    onlyLayers(right, { auto: '1.000 / 重み 1.000・上書き', expression: '0.500 / 重み 0.500・乗算' });
    const face = readRow('FaceAngleX');
    expect(face.final).toBe('6.000'); // 0 + 12 × 0.5
    onlyLayers(face, { expression: '12.000 / 重み 0.500・加算' });

    // 現れ終わった（重み 1）
    runtime.tick(11_000);
    vi.advanceTimersByTime(LAYER_SAMPLE_MS);
    expect(readRow('EyeOpenL')).toMatchObject({ final: '0.600', expression: '-0.400 / 重み 1.000・加算' });
    expect(readRow('FaceAngleX')).toMatchObject({ final: '12.000', expression: '12.000 / 重み 1.000・加算' });

    // 自動まばたきで閉じている間は、表情の値（-0.400）と最後の値（下限で 0）が違う
    runtime.tick(12_080);
    vi.advanceTimersByTime(LAYER_SAMPLE_MS);
    const closed = readRow('EyeOpenL');
    expect(closed.final).toBe('0.000');
    onlyLayers(closed, { auto: '0.000 / 重み 1.000・上書き', expression: '-0.400 / 重み 1.000・加算' });

    // 表情を外すと（fadeOut 0）表情の列は — に戻る
    expressions.toggle(smile.id, 12_300);
    expect(expressions.actives()).toEqual([]);
    runtime.tick(12_300);
    vi.advanceTimersByTime(LAYER_SAMPLE_MS);
    const cleared = readRow('EyeOpenL');
    expect(cleared.final).toBe('1.000');
    onlyLayers(cleared, { auto: '1.000 / 重み 1.000・上書き' });
  });

  it('同じ層の producer はすべて出し、重みは parameterWeights を優先し、値 0・重み 0 は — と区別する', () => {
    const parameters = ensureStandardParameters(createEmptyProject('表').model, 'step1').parameters;
    const display = createLayerDisplay(new Set(['MouthOpen', 'FaceAngleX']));
    display.update(
      syntheticFrame({ MouthOpen: 0.75, FaceAngleX: 0 }, [
        { id: 'expression', weight: 0.25, values: { MouthOpen: 0.5 }, blend: { MouthOpen: 'max' } },
        {
          id: 'expression',
          weight: 1,
          values: { MouthOpen: 0.2 },
          parameterWeights: { MouthOpen: 0.6 },
          blend: { MouthOpen: 'add' },
        },
        { id: 'lipSync', weight: 0, values: { MouthOpen: 0 } },
        { id: 'hotkey', weight: 0.3, values: { FaceAngleX: 0 }, parameterWeights: { FaceAngleX: 0 } },
      ]),
      parameters,
    );
    document.body.append(display.root);
    try {
      expect(rowIds()).toEqual(['FaceAngleX', 'MouthOpen']);
      const mouth = readRow('MouthOpen');
      // 最後の値は実行部の結果をそのまま出す（表示の側で合成し直さない）
      expect(mouth.final).toBe('0.750');
      onlyLayers(mouth, {
        expression: '0.500 / 重み 0.250・大きい方\n0.200 / 重み 0.600・加算',
        lipSync: '0.000 / 重み 0.000・上書き',
      });
      const face = readRow('FaceAngleX');
      expect(face.final).toBe('0.000');
      onlyLayers(face, { hotkey: '0.000 / 重み 0.000・上書き' });
      expect(within(display.root).getByText('表示するパラメータ（2）')).toBeTruthy();
    } finally {
      display.root.remove();
    }
  });

  it('表示の更新は 500ms に1回だけで、毎フレームの値で表を書き換えない', () => {
    const { runtime, diagnostics } = setup();
    let mouth = 0;
    runtime.registerLayerProducer({
      id: 'lipSync',
      produce: () => ({ id: 'lipSync', weight: 1, values: { MouthOpen: (mouth = (mouth + 0.001) % 1) } }),
    } satisfies LayerProducer);
    runtime.tick(performance.now());
    diagnostics.toggle();
    const cell = () => table().querySelector('tr[data-parameter-id="MouthOpen"] [data-final]')!.textContent;
    expect(cell()).toBe('0.001');
    const seen = [cell()];
    // 100fps で2秒。値は毎フレーム変わる
    for (let i = 0; i < 200; i++) {
      vi.advanceTimersByTime(10);
      runtime.tick(performance.now());
      if (cell() !== seen.at(-1)) seen.push(cell());
    }
    expect(mouth).toBeCloseTo(0.201, 6);
    // 表の値が変わったのは 500ms ごとの4回だけ（初めの表示を含めて5つ）
    expect(seen).toEqual(['0.001', '0.050', '0.100', '0.150', '0.200']);
  });
});

describe('カード67: 体の追従を計測の表示で読む（カード36 の「計測の表示で確認」・I-007）', () => {
  it('顔の向き（カメラの層の代わり）に合わせて、体 左右・体 傾きが「体の追従」の列から来て、顔 × 率 になる', () => {
    const { runtime, diagnostics } = setup();
    // カメラの層の代わり（本物のカメラはカード70・72）。顔 左右 20・顔 傾き −10
    runtime.registerLayerProducer({
      id: 'tracking',
      produce: (): Layer => ({ id: 'tracking', weight: 1, values: { FaceAngleX: 20, FaceAngleZ: -10 } }),
    });
    const body = createBodyFollowProducer(); // 本物の体の追従（標準の率）
    runtime.registerLayerProducer(body);
    diagnostics.toggle();
    runtime.tick(10_000);
    vi.advanceTimersByTime(LAYER_SAMPLE_MS);

    const rate = BODY_FOLLOW_RATES.standard;
    expect(rate).toBe(0.3);
    const x = readRow('BodyAngleX');
    expect(x.final).toBe((20 * rate).toFixed(3)); // 6.000
    onlyLayers(x, { bodyFollow: '6.000 / 重み 1.000・上書き' });
    const z = readRow('BodyAngleZ');
    expect(z.final).toBe('-3.000');
    onlyLayers(z, { bodyFollow: '-3.000 / 重み 1.000・上書き' });
    // 体 上下は追従しない
    onlyLayers(readRow('BodyAngleY'), {});
    // 顔の値はカメラの列から来ている
    onlyLayers(readRow('FaceAngleX'), { tracking: '20.000 / 重み 1.000・上書き' });

    // 強さを「強め」にすると、次の更新で率が変わって読める
    body.setStrength('high');
    runtime.tick(10_600);
    vi.advanceTimersByTime(LAYER_SAMPLE_MS);
    expect(readRow('BodyAngleX').final).toBe((20 * BODY_FOLLOW_RATES.high).toFixed(3)); // 9.000
  });
});

describe('カード67: 表示するパラメータの選択', () => {
  it('モデルのパラメータから選べて、モデルの順に行が並び、閉じて開いても選択を保つ', () => {
    const { runtime, diagnostics, services } = setup();
    runtime.tick(10_000);
    const before = services.store.get();
    diagnostics.toggle();
    const panel = getByRole(document.body, 'status', { name: '計測' });
    const summary = within(panel).getByText('表示するパラメータ（9）');
    fireEvent.click(summary);
    const details = summary.closest('details')!;
    details.open = true;
    const checks = within(panel).getAllByRole('checkbox') as HTMLInputElement[];
    // 選べるのはモデルのパラメータすべて（step1 の標準パラメータ）
    expect(checks.map((check) => check.labels?.[0]?.textContent)).toEqual(
      standardParametersFor('step1').map((p) => `${p.name} (${p.id})`),
    );
    expect(
      checks.filter((check) => check.checked).map((check) => check.labels?.[0]?.textContent?.match(/\((\w+)\)$/)?.[1]),
    ).toEqual(DEFAULT_ROWS);
    expect([...DEFAULT_DIAGNOSTIC_PARAMETERS].sort()).toEqual([...DEFAULT_ROWS].sort());

    fireEvent.click(within(panel).getByRole('checkbox', { name: '目 開閉 R (EyeOpenR)' }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: '瞳 左右 (EyeBallX)' }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: '頬染め (Cheek)' }));
    // 次の更新を待たずに表へ出る
    expect(rowIds()).toEqual([
      'FaceAngleX',
      'FaceAngleY',
      'FaceAngleZ',
      'EyeOpenL',
      'EyeBallX',
      'MouthOpen',
      'Cheek',
      'BodyAngleX',
      'BodyAngleY',
      'BodyAngleZ',
    ]);
    expect(within(panel).getByText('表示するパラメータ（10）')).toBeTruthy();
    const ball = readRow('EyeBallX');
    expect(ball.final).toBe('0.000');
    onlyLayers(ball, {});

    diagnostics.toggle();
    expect(document.querySelector('.diagnostics')).toBeNull();
    diagnostics.toggle();
    expect(rowIds()).toEqual([
      'FaceAngleX',
      'FaceAngleY',
      'FaceAngleZ',
      'EyeOpenL',
      'EyeBallX',
      'MouthOpen',
      'Cheek',
      'BodyAngleX',
      'BodyAngleY',
      'BodyAngleZ',
    ]);
    expect(
      (getByRole(document.body, 'checkbox', { name: '目 開閉 R (EyeOpenR)', hidden: true }) as HTMLInputElement)
        .checked,
    ).toBe(false);

    // 選択はこの表示の中だけで覚える（プロジェクトを変えない・Undo に残らない）
    expect(services.store.get()).toBe(before);
    expect(services.store.canUndo()).toBe(false);
  });

  it('別の計測の表示は既定の9つから始まる（選択をプロジェクトや設定に残さない）', () => {
    const { runtime, diagnostics, services } = setup();
    runtime.tick(10_000);
    diagnostics.toggle();
    fireEvent.click(getByRole(document.body, 'checkbox', { name: '口 開閉 (MouthOpen)', hidden: true }));
    expect(rowIds()).not.toContain('MouthOpen');
    diagnostics.toggle();

    const other = registerDiagnostics(services);
    opened.push(other);
    other.toggle();
    expect(rowIds()).toEqual(DEFAULT_ROWS);
  });
});

describe('カード67: JSON の層ごとの値', () => {
  it('カメラ停止中の記録は 500ms ごとに間引き、選んだパラメータの自動の層の値と最後の値が入る', () => {
    const { runtime, diagnostics } = setup();
    diagnostics.toggle();
    const t0 = performance.now();
    runtime.tick(t0); // まばたきの数え始め（t0 + 2080 で閉じている）
    vi.advanceTimersByTime(80);
    diagnostics.startRecording();
    // 50fps で3秒
    for (let i = 0; i < 150; i++) {
      runtime.tick(performance.now());
      vi.advanceTimersByTime(20);
    }
    const record = diagnostics.stopRecording()!;
    expect(record.kind).toBe('live2d-studio-diagnostics');
    expect(record.version).toBe(1);
    expect(record.samples.renderTimes).toHaveLength(150);
    const layers = record.samples.layers;
    expect(layers.map((sample) => sample.atMs)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
    const open = { EyeOpenL: 1, EyeOpenR: 1 };
    const closed = { EyeOpenL: 0, EyeOpenR: 0 };
    layers.forEach((sample, i) => {
      const eyes = i === 4 ? closed : open; // t0 + 2080 の記録だけ閉じている
      expect([...sample.parameterIds].sort()).toEqual([...DEFAULT_ROWS].sort());
      expect(sample.final).toEqual({
        FaceAngleX: 0,
        FaceAngleY: 0,
        FaceAngleZ: 0,
        ...eyes,
        MouthOpen: 0,
        BodyAngleX: 0,
        BodyAngleY: 0,
        BodyAngleZ: 0,
      });
      // カメラ停止中なのでトラッキングの層は無く、目は自動の層から来ている
      expect(sample.layers).toEqual([{ id: 'auto', weight: 1, values: eyes }]);
    });
    // 書き出す JSON の文字列にしても同じ値が残る
    expect(JSON.parse(JSON.stringify(record)).samples.layers).toEqual(layers);
  });

  it('表情の層の値・重み・合成方法を選んだパラメータだけ入れ、記録の途中で選択を変えるとその後の記録に入る', () => {
    const { runtime, diagnostics } = setup({ expressions: [smile] });
    const expressions = createExpressionController();
    runtime.registerLayerProducer(expressions);
    diagnostics.toggle();
    const t0 = performance.now();
    runtime.tick(t0);
    expressions.apply(smile.id, t0 - 1000); // もう現れ終わっている（重み 1）
    diagnostics.startRecording();
    for (let i = 0; i < 60; i++) {
      runtime.tick(performance.now());
      vi.advanceTimersByTime(20);
    }
    // 1.2秒たったところで、目 開閉 R を外して目 笑顔 L を足す
    fireEvent.click(getByRole(document.body, 'checkbox', { name: '目 開閉 R (EyeOpenR)', hidden: true }));
    fireEvent.click(getByRole(document.body, 'checkbox', { name: '目 笑顔 L (EyeSmileL)', hidden: true }));
    for (let i = 0; i < 60; i++) {
      runtime.tick(performance.now());
      vi.advanceTimersByTime(20);
    }
    const record = JSON.parse(JSON.stringify(diagnostics.stopRecording()));
    const samples: {
      atMs: number;
      parameterIds: string[];
      final: Record<string, number>;
      layers: Layer[];
    }[] = record.samples.layers;
    expect(samples.map((sample) => sample.atMs)).toEqual([0, 500, 1000, 1500, 2000]);
    for (const sample of samples.slice(0, 3)) {
      expect(sample.parameterIds).toContain('EyeOpenR');
      expect(sample.parameterIds).not.toContain('EyeSmileL');
      expect(sample.final.EyeOpenL).toBeCloseTo(0.6, 9); // 1 + (-0.4)
      expect(sample.final).toMatchObject({ EyeOpenR: 0.5, FaceAngleX: 12 });
      expect(sample.final).not.toHaveProperty('EyeSmileL');
      expect(sample.layers.map((layer) => layer.id)).toEqual(['auto', 'expression']);
      expect(sample.layers[1]).toEqual({
        id: 'expression',
        weight: 1,
        values: { EyeOpenL: -0.4, EyeOpenR: 0.5, FaceAngleX: 12 },
        blend: { EyeOpenL: 'add', EyeOpenR: 'multiply', FaceAngleX: 'add' },
      });
    }
    for (const sample of samples.slice(3)) {
      expect(sample.parameterIds).not.toContain('EyeOpenR');
      expect(sample.parameterIds).toContain('EyeSmileL');
      expect(sample.final.EyeOpenL).toBeCloseTo(0.6, 9);
      expect(sample.final).toMatchObject({ EyeSmileL: 0.9, FaceAngleX: 12 });
      expect(sample.final).not.toHaveProperty('EyeOpenR');
      expect(sample.layers[0]).toEqual({ id: 'auto', weight: 1, values: { EyeOpenL: 1 } });
      expect(sample.layers[1]).toEqual({
        id: 'expression',
        weight: 1,
        values: { EyeOpenL: -0.4, FaceAngleX: 12, EyeSmileL: 0.9 },
        blend: { EyeOpenL: 'add', FaceAngleX: 'add', EyeSmileL: 'override' },
      });
    }
  });

  it('sampleLayers は選んだ有限の値だけを写し、元の値が後で変わっても記録は変わらない', () => {
    const source = syntheticFrame({ EyeOpenL: 0.25, MouthOpen: 0.5, FaceAngleX: 3, HairFront: 0.1 }, [
      {
        id: 'tracking',
        weight: 0.5,
        values: { EyeOpenL: Number.NaN, MouthOpen: 0.5, FaceAngleX: Number.POSITIVE_INFINITY, HairFront: 0.1 },
        parameterWeights: { MouthOpen: 0.8, HairFront: 1 },
        blend: { MouthOpen: 'max', HairFront: 'add' },
      },
      { id: 'physics', weight: 1, values: { HairFront: 0.1 } },
    ]);
    const ids = ['EyeOpenL', 'MouthOpen', 'FaceAngleX'];
    const sample = sampleLayers(source, ids, 1500);
    expect(sample).toEqual({
      atMs: 1500,
      parameterIds: ['EyeOpenL', 'MouthOpen', 'FaceAngleX'],
      final: { EyeOpenL: 0.25, MouthOpen: 0.5, FaceAngleX: 3 },
      layers: [
        {
          id: 'tracking',
          weight: 0.5,
          values: { MouthOpen: 0.5 },
          parameterWeights: { MouthOpen: 0.8 },
          blend: { MouthOpen: 'max' },
        },
        { id: 'physics', weight: 1, values: {} },
      ],
    });
    source.params.EyeOpenL = 0.9;
    source.layers[0]!.values.MouthOpen = 0.1;
    source.layers[0]!.parameterWeights!.MouthOpen = 0;
    ids.push('HairFront');
    expect(sample.final.EyeOpenL).toBe(0.25);
    expect(sample.layers[0]!.values).toEqual({ MouthOpen: 0.5 });
    expect(sample.layers[0]!.parameterWeights).toEqual({ MouthOpen: 0.8 });
    expect(sample.parameterIds).toEqual(['EyeOpenL', 'MouthOpen', 'FaceAngleX']);
  });

  it('記録の層の値は5分で最大601件、間は500ms以上で、記録していない間と5分を過ぎた後は入れない', () => {
    const collector = createDiagnosticsCollector();
    const frame = syntheticFrame({ EyeOpenL: 0.5, MouthOpen: 0 }, [
      { id: 'auto', weight: 1, values: { EyeOpenL: 0.5 } },
    ]);
    const ids = new Set(['EyeOpenL', 'MouthOpen', 'BodyAngleX']); // BodyAngleX はこのフレームに無い
    collector.onLayerFrame(frame, 0, ids); // 記録の前
    collector.startRecording(1000, new Date('2026-10-07T00:00:00Z'));
    let calls = 0;
    for (let t = 1000; t <= 1000 + RECORD_LIMIT_MS + 5000; t += 100) {
      collector.onLayerFrame(frame, t, ids);
      calls++;
    }
    const record = collector.stopRecording(1000 + RECORD_LIMIT_MS + 5000)!;
    const samples = record.samples.layers;
    expect(calls).toBe(3051);
    expect(samples).toHaveLength(601);
    expect(samples[0]!.atMs).toBe(0);
    expect(samples.at(-1)!.atMs).toBe(RECORD_LIMIT_MS);
    expect(samples.every((s, i) => i === 0 || s.atMs - samples[i - 1]!.atMs === 500)).toBe(true);
    expect(samples[0]).toEqual({
      atMs: 0,
      parameterIds: ['EyeOpenL', 'MouthOpen'],
      final: { EyeOpenL: 0.5, MouthOpen: 0 },
      layers: [{ id: 'auto', weight: 1, values: { EyeOpenL: 0.5 } }],
    });
    // 止めた後は入れない
    collector.onLayerFrame(frame, 1000 + RECORD_LIMIT_MS + 6000, ids);
    expect(collector.stopRecording(1000 + RECORD_LIMIT_MS + 7000)).toBeNull();
    expect(samples).toHaveLength(601);
  });
});
