// アニメーション画面の中央（カード46）。上に再生の操作、その下にプレビューと横のパラメータのスライダー、下にタイムライン。
// プレビューは時刻 t でトラックを補間した値を描く（遷移は付けない。スタジオでの再生は別のカード）
import { useEffect, useMemo, useRef } from 'react';
import { useDispatch } from '../../shell/api';
import { clampSize, useElementSize, useResizableSize } from '../../shell/layoutSizes';
import { Splitter } from '../../shell/splitter';
import { updateAnimationCommand } from './commands';
import { lastKeyTime, MAX_DURATION, MIN_DURATION, roundTime, sampleAnimation, setDuration } from './keyframes';
import { formatClock, formatTime } from './labels';
import { NumberField } from './NumberField';
import { ParameterSliders } from './ParameterSliders';
import { AnimationPreview } from './Preview';
import { advanceTime, animationEditor, type Playback } from './state';
import { Timeline } from './Timeline';
import { useCurrentAnimation } from './useCurrent';
import './animation.css';

type Handle = { cancel(): void };

const schedule: (cb: () => void) => Handle =
  typeof requestAnimationFrame === 'function'
    ? (cb) => {
        const id = requestAnimationFrame(cb);
        return { cancel: () => cancelAnimationFrame(id) };
      }
    : (cb) => {
        const id = setTimeout(cb, 16);
        return { cancel: () => clearTimeout(id) };
      };

export function AnimationCenter() {
  const measured = useElementSize<HTMLDivElement>();
  const toolbar = useElementSize<HTMLDivElement>();
  const width = measured.width || 800;
  const height = measured.height || 600;
  const stacked = width <= 600;
  const timeline = useResizableSize('animation.timeline.height');
  const sliders = useResizableSize(stacked ? 'animation.sliders.height' : 'animation.sliders.width');
  const timelineMax = Math.max(120, height - (toolbar.height || 34) - 200);
  const timelineHeight = clampSize(timeline.value ?? Math.max(180, height * 0.4), 120, timelineMax);
  const mainHeight = Math.max(160, height - (toolbar.height || 34) - timelineHeight);
  const slidersMin = stacked ? 80 : 180;
  const slidersMax = stacked ? Math.max(80, mainHeight - 80) : Math.max(180, Math.min(480, width - 320));
  const slidersSize = clampSize(sliders.value ?? (stacked ? mainHeight / 2 : 260), slidersMin, slidersMax);
  const dispatch = useDispatch();
  const { project, animation, time, state, setState } = useCurrentAnimation();
  const values = useMemo(
    () => sampleAnimation(animation, project.model.parameters, time),
    [animation, project.model.parameters, time],
  );

  // 再生中は毎フレーム時刻を進める（再生速度を掛ける）。ループでなければ終わりで止まる
  const animationRef = useRef(animation);
  animationRef.current = animation;
  const playing = state.playback !== 'stopped' && animation !== null;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let handle: Handle | null = null;
    const tick = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const anim = animationRef.current;
      const current = animationEditor.get();
      if (!anim || current.playback === 'stopped') return;
      const next = advanceTime(
        Math.min(current.time, anim.duration),
        dt * anim.speed,
        anim.duration,
        current.playback === 'loop',
      );
      if (next.ended) {
        animationEditor.set({ time: next.time, playback: 'stopped' });
        return;
      }
      animationEditor.advance(next.time);
      handle = schedule(tick);
    };
    handle = schedule(tick);
    return () => handle?.cancel();
  }, [playing]);

  // 画面を離れたら再生をやめる
  useEffect(() => () => stopPlayback(), []);

  const play = (mode: Exclude<Playback, 'stopped'>) => {
    if (!animation) return;
    if (state.playback === mode) {
      stopPlayback();
      return;
    }
    setState({ playback: mode, time: time >= animation.duration ? 0 : time });
  };

  return (
    <div className="anim-center" ref={measured.ref}>
      <div className="anim-toolbar" role="toolbar" aria-label="再生" ref={toolbar.ref}>
        <button
          type="button"
          aria-label="先頭へ"
          title="先頭へ"
          disabled={!animation}
          onClick={() => setState({ time: 0 })}
        >
          ⏮
        </button>
        <button
          type="button"
          aria-pressed={state.playback === 'once'}
          title="今の時刻から終わりまで再生する"
          disabled={!animation}
          onClick={() => play('once')}
        >
          <span aria-hidden="true">▶</span> 再生
        </button>
        <button
          type="button"
          aria-pressed={state.playback === 'loop'}
          title="止めるまで繰り返し再生する"
          disabled={!animation}
          onClick={() => play('loop')}
        >
          <span aria-hidden="true">⟲</span> ループ再生
        </button>
        <button type="button" disabled={state.playback === 'stopped'} onClick={stopPlayback}>
          <span aria-hidden="true">■</span> 停止
        </button>
        <span className="anim-time" data-testid="animation-time">
          {formatClock(time)} / {formatClock(animation?.duration ?? 0)} 秒
        </span>
        <span className="spacer" />
        {animation && (
          <label className="anim-inline" title="いちばん後ろのキーフレームより短くはできない">
            長さ
            <NumberField
              className="anim-number"
              label="長さ（秒）"
              value={animation.duration}
              min={Math.max(MIN_DURATION, lastKeyTime(animation))}
              max={MAX_DURATION}
              step={0.1}
              format={formatTime}
              onCommit={(v) => dispatch(updateAnimationCommand('長さを変える', animation.id, (a) => setDuration(a, v)))}
            />
            秒
          </label>
        )}
      </div>
      <div className={`anim-main${stacked ? ' stacked' : ''}`}>
        <AnimationPreview values={values} />
        <div className={stacked ? 'row-boundary' : 'column-boundary'}>
          <Splitter
            key={stacked ? 'sliders.height' : 'sliders.width'}
            label={stacked ? 'スライダーの高さ' : 'スライダーの幅'}
            axis={stacked ? 'y' : 'x'}
            direction={-1}
            value={slidersSize}
            current={() => slidersSize}
            min={slidersMin}
            max={slidersMax}
            onPreview={sliders.preview}
            onCommit={sliders.commit}
          />
        </div>
        <div className="anim-sliders-area" style={stacked ? { height: slidersSize } : { width: slidersSize }}>
          <ParameterSliders values={values} />
        </div>
      </div>
      <div className="row-boundary">
        <Splitter
          label="タイムラインの高さ"
          axis="y"
          direction={-1}
          value={timelineHeight}
          current={() => timelineHeight}
          min={120}
          max={timelineMax}
          onPreview={timeline.preview}
          onCommit={timeline.commit}
        />
      </div>
      <div className="anim-timeline-area" style={{ height: timelineHeight }}>
        <Timeline values={values} />
      </div>
    </div>
  );
}

// 再生をやめる。止めた時刻はキーフレームの刻みに丸める
function stopPlayback() {
  const { playback, time } = animationEditor.get();
  if (playback !== 'stopped') animationEditor.set({ playback: 'stopped', time: roundTime(time) });
}
