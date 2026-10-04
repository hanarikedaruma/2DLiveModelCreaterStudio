import { act, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnimation } from './commands';
import { animationEditor } from './state';
import { sampleAnimationData, setupAnimationScreen, step1Project } from './testShell';

const keyframesOf = (s: ReturnType<typeof setupAnimationScreen>, parameterId: string) =>
  s.animation().tracks.find((t) => t.parameterId === parameterId)?.keyframes ?? [];

const sliderValue = (s: ReturnType<typeof setupAnimationScreen>, name: string) =>
  Number((s.sliders().getByRole('slider', { name }) as HTMLInputElement).value);

// 行の時間の部分（◆ の親）の位置と幅を決める（jsdom にはレイアウトが無い）
function layoutLane(key: HTMLElement, width: number) {
  const lane = key.parentElement!;
  vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: width,
    bottom: 22,
    width,
    height: 22,
    x: 0,
    y: 0,
    toJSON() {},
  } as DOMRect);
  return lane;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('プレビューの値', () => {
  it('時刻 t でトラックを補間した値を evaluator に渡す（線形・なめらか・一定）。トラックの無いパラメータはデフォルト値', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    expect(s.lastParams()).toMatchObject({ FaceAngleX: 0, MouthOpen: 0, EyeOpenL: 1, EyeOpenR: 1, FaceAngleY: 0 });

    s.setTime(0.25);
    expect(s.lastParams().FaceAngleX).toBeCloseTo(5, 9); // 線形
    expect(s.lastParams().MouthOpen).toBeCloseTo(0.15625, 9); // なめらか（smoothstep）
    expect(s.lastParams().EyeOpenL).toBe(1); // 一定（前の値のまま）
    expect(s.lastParams().EyeOpenR).toBe(1); // トラックが無い → デフォルト値
    expect(s.center().getByTestId('animation-time').textContent).toBe('0.25 / 2.00 秒');

    s.setTime(0.75);
    expect(s.lastParams().FaceAngleX).toBeCloseTo(15, 9);
    expect(s.lastParams().MouthOpen).toBeCloseTo(0.84375, 9);
    expect(s.lastParams().EyeOpenL).toBe(1);

    s.setTime(1.5);
    expect(s.lastParams()).toMatchObject({ FaceAngleX: 20, MouthOpen: 1, EyeOpenL: 0 });
    // 描いている
    expect(s.renderer.render).toHaveBeenCalled();
  });

  it('横のスライダーにも今の時刻の値が出る', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    s.setTime(0.5);
    expect(sliderValue(s, '顔 左右')).toBeCloseTo(10, 9);
    expect(sliderValue(s, '口 開閉')).toBeCloseTo(0.5, 9);
    expect(sliderValue(s, '目 開閉 L')).toBe(1);
  });
});

describe('キーフレームの操作', () => {
  it('スライダーを動かすと今の時刻にキーフレームを置く（1回の操作で1回の Undo）。あれば値を変える', () => {
    const s = setupAnimationScreen(step1Project([createAnimation('A', 'a')]));
    s.setTime(0.5);
    s.slide('顔 左右', 12);
    s.slide('顔 左右', 15);
    s.release('顔 左右');
    expect(keyframesOf(s, 'FaceAngleX')).toEqual([{ time: 0.5, value: 15, curve: 'smooth' }]);
    expect(s.row('顔 左右').getByRole('button', { name: '顔 左右 0.5 秒のキーフレーム' })).toBeTruthy();
    // 選んだキーフレームになる
    expect(s.keybar().getByText('◆ 顔 左右')).toBeTruthy();

    // 同じ時刻でもう一度動かすと値を変える
    s.slide('顔 左右', -8);
    s.release('顔 左右');
    expect(keyframesOf(s, 'FaceAngleX')).toEqual([{ time: 0.5, value: -8, curve: 'smooth' }]);

    act(() => s.store.undo());
    expect(keyframesOf(s, 'FaceAngleX')).toEqual([{ time: 0.5, value: 15, curve: 'smooth' }]);
    act(() => s.store.undo());
    expect(s.animation().tracks).toEqual([]);
    act(() => s.store.redo());
    expect(keyframesOf(s, 'FaceAngleX')).toEqual([{ time: 0.5, value: 15, curve: 'smooth' }]);
  });

  it('スライダーを離す前に時刻を変えても、前の時刻のキーフレームは残り、別の操作（別の Undo）になる', () => {
    const s = setupAnimationScreen(step1Project([createAnimation('A', 'a')]));
    s.slide('顔 左右', -20);
    s.setTime(0.6);
    s.slide('顔 左右', 20);
    s.release('顔 左右');
    expect(keyframesOf(s, 'FaceAngleX')).toEqual([
      { time: 0, value: -20, curve: 'smooth' },
      { time: 0.6, value: 20, curve: 'smooth' },
    ]);
    act(() => s.store.undo());
    expect(keyframesOf(s, 'FaceAngleX').map((k) => k.time)).toEqual([0]);
  });

  it('◇ で今の時刻に今の値（補間した値・トラックが無ければデフォルト値）のキーフレームを足し、◆ で消す', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    s.setTime(0.5);
    s.click(s.row('顔 左右').getByRole('button', { name: '顔 左右のキーフレームをこの時刻に追加' }));
    expect(keyframesOf(s, 'FaceAngleX')).toEqual([
      { time: 0, value: 0, curve: 'linear' },
      { time: 0.5, value: 10, curve: 'smooth' },
      { time: 1, value: 20, curve: 'linear' },
    ]);
    s.click(s.row('目 開閉 R').getByRole('button', { name: '目 開閉 Rのキーフレームをこの時刻に追加' }));
    expect(keyframesOf(s, 'EyeOpenR')).toEqual([{ time: 0.5, value: 1, curve: 'smooth' }]);

    s.click(s.row('顔 左右').getByRole('button', { name: '顔 左右のこの時刻のキーフレームを削除' }));
    expect(keyframesOf(s, 'FaceAngleX').map((k) => k.time)).toEqual([0, 1]);
    act(() => s.store.undo());
    expect(keyframesOf(s, 'FaceAngleX').map((k) => k.time)).toEqual([0, 0.5, 1]);
    act(() => s.store.undo());
    act(() => s.store.undo());
    expect(s.animation()).toEqual(sampleAnimationData());
  });

  it('◆ を押すと選んで時刻をそこへ動かす。補間を 線形 / なめらか / 一定 で切り替える（Undo で戻る）', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    s.setTime(0.3);
    const key = s.row('顔 左右').getByRole('button', { name: '顔 左右 1 秒のキーフレーム' });
    s.click(key);
    expect(key.getAttribute('aria-pressed')).toBe('true');
    expect(animationEditor.get().time).toBe(1);
    // 選んだのは 1 秒のもの。0 秒のキーフレームの補間を変えるには 0 秒を選ぶ
    s.click(s.row('顔 左右').getByRole('button', { name: '顔 左右 0 秒のキーフレーム' }));
    const curve = (name: string) => s.keybar().getByRole('button', { name });
    expect(curve('線形').getAttribute('aria-pressed')).toBe('true');
    s.click(curve('なめらか'));
    expect(keyframesOf(s, 'FaceAngleX')[0]!.curve).toBe('smooth');
    s.click(curve('一定'));
    expect(keyframesOf(s, 'FaceAngleX')[0]!.curve).toBe('step');
    expect(curve('一定').getAttribute('aria-pressed')).toBe('true');
    // 一定にしたのでプレビューは前の値のまま
    s.setTime(0.5);
    expect(s.lastParams().FaceAngleX).toBe(0);
    act(() => s.store.undo());
    expect(keyframesOf(s, 'FaceAngleX')[0]!.curve).toBe('smooth');
    act(() => s.store.undo());
    expect(keyframesOf(s, 'FaceAngleX')[0]!.curve).toBe('linear');
  });

  it('移動: 選んだキーフレームの時刻を数値で変える。値と補間はそのまま（1回の Undo）', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    s.click(s.row('顔 左右').getByRole('button', { name: '顔 左右 1 秒のキーフレーム' }));
    s.enter(s.keybar(), 'キーフレームの時刻（秒）', 1.6);
    expect(keyframesOf(s, 'FaceAngleX')).toEqual([
      { time: 0, value: 0, curve: 'linear' },
      { time: 1.6, value: 20, curve: 'linear' },
    ]);
    // 選んだまま、時刻も追いかける
    expect(s.keybar().getByText('◆ 顔 左右')).toBeTruthy();
    expect(animationEditor.get().time).toBe(1.6);
    act(() => s.store.undo());
    expect(keyframesOf(s, 'FaceAngleX').map((k) => k.time)).toEqual([0, 1]);
  });

  it('移動: ◆ をドラッグして動かす（0.01 秒の刻み、途中は何回動かしても1回の Undo）', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    const key = s.row('口 開閉').getByRole('button', { name: '口 開閉 1 秒のキーフレーム' });
    layoutLane(key, 200); // 長さ 2 秒が 200px → 1px が 0.01 秒
    act(() => {
      fireEvent.pointerDown(key, { button: 0, pointerId: 1, clientX: 100 });
    });
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 130 });
    });
    expect(keyframesOf(s, 'MouthOpen').map((k) => k.time)).toEqual([0, 1.3]);
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 157.4 });
    });
    act(() => {
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 157.4 });
    });
    expect(keyframesOf(s, 'MouthOpen')).toEqual([
      { time: 0, value: 0, curve: 'smooth' },
      { time: 1.57, value: 1, curve: 'smooth' },
    ]);
    expect(animationEditor.get().time).toBe(1.57);
    // 離したあとの動きでは変わらない
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 10 });
    });
    expect(keyframesOf(s, 'MouthOpen').map((k) => k.time)).toEqual([0, 1.57]);
    // 範囲の外へ引っぱると端で止まる
    const moved = s.row('口 開閉').getByRole('button', { name: '口 開閉 1.57 秒のキーフレーム' });
    layoutLane(moved, 200);
    act(() => {
      fireEvent.pointerDown(moved, { button: 0, pointerId: 2, clientX: 157 });
      fireEvent.pointerMove(window, { pointerId: 2, clientX: 900 });
      fireEvent.pointerUp(window, { pointerId: 2, clientX: 900 });
    });
    expect(keyframesOf(s, 'MouthOpen').map((k) => k.time)).toEqual([0, 2]);

    act(() => s.store.undo());
    expect(keyframesOf(s, 'MouthOpen').map((k) => k.time)).toEqual([0, 1.57]);
    act(() => s.store.undo());
    expect(keyframesOf(s, 'MouthOpen').map((k) => k.time)).toEqual([0, 1]);
    expect(s.store.canUndo()).toBe(false);
  });

  it('◆ を押しただけ（動かさない）なら Undo に積まない', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    const key = s.row('口 開閉').getByRole('button', { name: '口 開閉 1 秒のキーフレーム' });
    layoutLane(key, 200);
    act(() => {
      fireEvent.pointerDown(key, { button: 0, pointerId: 1, clientX: 100 });
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 100 });
    });
    expect(s.store.canUndo()).toBe(false);
    expect(key.getAttribute('aria-pressed')).toBe('true');
  });

  it('キーボード: ←→ で 0.01 秒（Shift で 0.1 秒）動かし、Delete で消す', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    const key = () => s.row('顔 左右').getAllByRole('button', { name: /^顔 左右 .* 秒のキーフレーム$/ })[1]!;
    act(() => {
      fireEvent.keyDown(key(), { key: 'ArrowRight' });
    });
    expect(keyframesOf(s, 'FaceAngleX').map((k) => k.time)).toEqual([0, 1.01]);
    act(() => {
      fireEvent.keyDown(key(), { key: 'ArrowLeft', shiftKey: true });
    });
    expect(keyframesOf(s, 'FaceAngleX').map((k) => k.time)).toEqual([0, 0.91]);
    act(() => {
      fireEvent.keyDown(key(), { key: 'Delete' });
    });
    expect(keyframesOf(s, 'FaceAngleX').map((k) => k.time)).toEqual([0]);
    act(() => s.store.undo());
    act(() => s.store.undo());
    act(() => s.store.undo());
    expect(keyframesOf(s, 'FaceAngleX').map((k) => k.time)).toEqual([0, 1]);
  });

  it('削除: 選んだキーフレームを［キーフレームを削除］で消す。最後の1つを消すとトラックも消える（Undo で戻る）', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    s.click(s.row('目 開閉 L').getByRole('button', { name: '目 開閉 L 0 秒のキーフレーム' }));
    s.click(s.keybar().getByRole('button', { name: 'キーフレームを削除' }));
    s.click(s.row('目 開閉 L').getByRole('button', { name: '目 開閉 L 1 秒のキーフレーム' }));
    s.click(s.keybar().getByRole('button', { name: 'キーフレームを削除' }));
    expect(s.animation().tracks.map((t) => t.parameterId)).toEqual(['FaceAngleX', 'MouthOpen']);
    expect(s.center().queryByRole('group', { name: '選んだキーフレーム' })).toBeNull();
    act(() => s.store.undo());
    act(() => s.store.undo());
    expect(s.animation()).toEqual(sampleAnimationData());
  });

  it('長さを変える。いちばん後ろのキーフレームより短くはできない（1回の Undo）', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    s.enter(s.center(), '長さ（秒）', 3.5);
    expect(s.animation().duration).toBe(3.5);
    s.enter(s.center(), '長さ（秒）', 0.5);
    expect(s.animation().duration).toBe(1);
    act(() => s.store.undo());
    expect(s.animation().duration).toBe(3.5);
  });
});

describe('プレビューの再生', () => {
  function withFakeClock() {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'Date'],
    });
  }
  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('再生は今の時刻から終わりまで進めて止まる。終わりから押すと先頭から', () => {
    withFakeClock();
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    const play = s.center().getByRole('button', { name: '再生' });
    s.click(play);
    expect(play.getAttribute('aria-pressed')).toBe('true');
    advance(500);
    expect(animationEditor.get().time).toBeGreaterThan(0.4);
    expect(animationEditor.get().time).toBeLessThan(0.6);
    // プレビューも動く
    expect(s.lastParams().FaceAngleX).toBeGreaterThan(8);
    advance(2000);
    expect(animationEditor.get()).toMatchObject({ time: 2, playback: 'stopped' });
    expect(play.getAttribute('aria-pressed')).toBe('false');
    expect(s.lastParams()).toMatchObject({ FaceAngleX: 20, MouthOpen: 1, EyeOpenL: 0 });
    s.click(play);
    expect(animationEditor.get().time).toBe(0);
  });

  it('ループ再生は終わりで先頭に戻って続ける。停止で止まる（時刻は 0.01 秒に丸める）', () => {
    withFakeClock();
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    s.click(s.center().getByRole('button', { name: 'ループ再生' }));
    advance(2500);
    expect(animationEditor.get().playback).toBe('loop');
    expect(animationEditor.get().time).toBeGreaterThan(0.4);
    expect(animationEditor.get().time).toBeLessThan(0.6);
    s.click(s.center().getByRole('button', { name: '停止' }));
    const { time, playback } = animationEditor.get();
    expect(playback).toBe('stopped');
    expect(time).toBe(Number(time.toFixed(2)));
    advance(500);
    expect(animationEditor.get().time).toBe(time);
  });

  it('再生速度を掛けて進める', () => {
    withFakeClock();
    const s = setupAnimationScreen(step1Project([{ ...sampleAnimationData(), speed: 2 }]));
    s.click(s.center().getByRole('button', { name: '再生' }));
    advance(500);
    expect(animationEditor.get().time).toBeGreaterThan(0.9);
    expect(animationEditor.get().time).toBeLessThan(1.1);
  });

  it('再生中にスライダーを動かすと止めて、その時刻にキーフレームを置く', () => {
    withFakeClock();
    const s = setupAnimationScreen(step1Project([createAnimation('A', 'a')]));
    s.click(s.center().getByRole('button', { name: 'ループ再生' }));
    advance(300);
    s.slide('口 開閉', 0.5);
    s.release('口 開閉');
    const { time, playback } = animationEditor.get();
    expect(playback).toBe('stopped');
    expect(keyframesOf(s, 'MouthOpen')).toEqual([{ time, value: 0.5, curve: 'smooth' }]);
  });

  it('画面を離れると再生をやめる', () => {
    withFakeClock();
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    s.click(s.center().getByRole('button', { name: 'ループ再生' }));
    act(() => s.editor.set({ mode: 'modeling' }));
    expect(animationEditor.get().playback).toBe('stopped');
  });
});
