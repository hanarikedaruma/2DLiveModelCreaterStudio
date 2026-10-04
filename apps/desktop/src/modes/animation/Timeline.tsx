// タイムライン（カード46）。上に時刻のつまみ、パラメータの行ごとにキーフレーム（◆）。
// ◇ で今の時刻に今の値のキーフレームを足し（◆ なら消す）、◆ を押して選ぶ・ドラッグで動かす・Delete で消す・←→ で少しずつ動かす。
// 選んだキーフレームは上の帯で時刻・補間を変えられる
import { useEffect, useRef } from 'react';
import type { Animation, Parameter } from '@app/schema';
import type { ParamValues } from '@app/contracts';
import { useDispatch, useServices } from '../../shell/api';
import { beginLiveEdit, type LiveEdit } from '../modeling/canvas/liveEdit';
import { updateAnimationCommand } from './commands';
import {
  keyframeAt,
  MIN_DURATION,
  moveKeyframe,
  removeKeyframe,
  roundTime,
  sameTime,
  setKeyframe,
  setKeyframeCurve,
  TIME_STEP,
  trackOf,
  type KeyCurve,
  type Keyframe,
} from './keyframes';
import { CURVE_CHOICES, formatTime, formatValue, parameterGroupsOf, rulerStep } from './labels';
import { NumberField } from './NumberField';
import { animationEditor, selectedKeyframe } from './state';
import { useCurrentAnimation } from './useCurrent';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

interface Drag {
  pointerId: number;
  animationId: string;
  parameterId: string;
  from: number;
  to: number;
  startX: number;
  width: number;
  span: number;
  edit: LiveEdit;
}

export function Timeline({ values }: { values: ParamValues }) {
  const services = useServices();
  const dispatch = useDispatch();
  const { project, animation, time, state } = useCurrentAnimation();
  const endDragRef = useRef<(() => void) | null>(null);

  // 外れたらドラッグ中のものは確定する
  useEffect(() => () => endDragRef.current?.(), []);

  if (!animation) {
    return (
      <div className="anim-timeline">
        <p className="anim-note anim-empty">アニメーションがまだ無い（左の［追加］で作る）</p>
      </div>
    );
  }

  const anim = animation;
  const span = Math.max(anim.duration, MIN_DURATION);
  const pct = (t: number) => `${(clamp(t, 0, span) / span) * 100}%`;
  const keyTime = roundTime(time);
  const selected = selectedKeyframe(anim, state);

  const update = (label: string, fn: (a: Animation) => Animation) =>
    dispatch(updateAnimationCommand(label, anim.id, fn));
  const stopPlayback = () => {
    if (animationEditor.get().playback !== 'stopped') animationEditor.set({ playback: 'stopped', time: keyTime });
  };
  const select = (parameterId: string, t: number) =>
    animationEditor.set({ selectedKey: { parameterId, time: t }, time: t });

  // ◇: 今の時刻に今の値でキーフレームを足す。◆: その時刻のキーフレームを消す
  const toggleKey = (p: Parameter) => {
    stopPlayback();
    if (keyframeAt(anim, p.id, keyTime)) {
      update('キーフレームを削除', (a) => removeKeyframe(a, p.id, keyTime));
      return;
    }
    const value = values[p.id] ?? p.default;
    update('キーフレームを追加', (a) => setKeyframe(a, p.id, keyTime, value));
    select(p.id, keyTime);
  };

  const moveTo = (parameterId: string, from: number, to: number) => {
    const t = roundTime(clamp(to, 0, anim.duration));
    update('キーフレームを動かす', (a) => moveKeyframe(a, parameterId, from, t));
    select(parameterId, t);
  };

  const remove = (parameterId: string, t: number) => {
    update('キーフレームを削除', (a) => removeKeyframe(a, parameterId, t));
    animationEditor.set({ selectedKey: null });
  };

  // 行の空いたところを押すと、その時刻へ
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    animationEditor.set({ time: roundTime(clamp(((e.clientX - rect.left) / rect.width) * span, 0, anim.duration)) });
  };

  // ◆ を押したら選び、そのままドラッグで動かす（1回のドラッグで1回の Undo）
  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, p: Parameter, k: Keyframe) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    endDragRef.current?.();
    animationEditor.set({ selectedKey: { parameterId: p.id, time: k.time }, time: k.time, playback: 'stopped' });
    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const drag: Drag = {
      pointerId: e.pointerId,
      animationId: anim.id,
      parameterId: p.id,
      from: k.time,
      to: k.time,
      startX: e.clientX,
      width: rect.width,
      span,
      edit: beginLiveEdit(services.store, 'キーフレームを動かす'),
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== drag.pointerId) return;
      const to = roundTime(clamp(drag.from + ((ev.clientX - drag.startX) / drag.width) * drag.span, 0, drag.span));
      if (to === drag.to) return;
      drag.to = to;
      drag.edit.update(() =>
        updateAnimationCommand('キーフレームを動かす', drag.animationId, (a) =>
          moveKeyframe(a, drag.parameterId, drag.from, to),
        ),
      );
      animationEditor.set({ selectedKey: { parameterId: drag.parameterId, time: to }, time: to });
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      drag.edit.commit();
      endDragRef.current = null;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === drag.pointerId) end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    endDragRef.current = end;
  };

  const onKeyDown = (e: React.KeyboardEvent, p: Parameter, k: Keyframe) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(p.id, k.time);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = (e.key === 'ArrowLeft' ? -1 : 1) * TIME_STEP * (e.shiftKey ? 10 : 1);
      moveTo(p.id, k.time, k.time + d);
    }
  };

  const step = rulerStep(span);
  const ticks: number[] = [];
  for (let t = 0; t <= span + 1e-9; t += step) ticks.push(roundTime(t));

  return (
    <div className="anim-timeline">
      <KeyframeBar
        animation={anim}
        selected={selected}
        parameters={project.model.parameters}
        onMove={moveTo}
        onCurve={(parameterId, t, curve) => update('補間を変える', (a) => setKeyframeCurve(a, parameterId, t, curve))}
        onRemove={remove}
      />
      {/* 目盛りは行と同じスクロールの中に置き（上に貼り付け）、行のスクロールバーがあっても位置をそろえる */}
      <div className="anim-rows">
        <div className="anim-ruler-row">
          <span className="anim-ruler-head">時刻</span>
          <div className="anim-ruler">
            {ticks.map((t) => (
              <span key={t} className="anim-tick" style={{ left: pct(t) }}>
                {formatTime(t)}
              </span>
            ))}
            <input
              type="range"
              className="anim-scrubber"
              aria-label="時刻"
              min={0}
              max={anim.duration}
              step={TIME_STEP}
              value={keyTime}
              onChange={(e) => animationEditor.set({ time: roundTime(Number(e.currentTarget.value)) })}
            />
          </div>
        </div>
        {parameterGroupsOf(project.model).map(({ group, parameters }) => (
          <div key={group.id} className="anim-row-group" role="group" aria-label={`${group.name}の行`}>
            <div className="anim-group-head">{group.name}</div>
            {parameters.map((p) => {
              const keys = trackOf(anim, p.id)?.keyframes ?? [];
              const hasKey = keys.some((k) => sameTime(k.time, keyTime));
              return (
                <div
                  key={p.id}
                  className={keys.length > 0 ? 'anim-row tracked' : 'anim-row'}
                  role="group"
                  aria-label={p.name}
                  data-parameter-id={p.id}
                >
                  <span className="anim-row-name" title={p.name}>
                    {p.name}
                  </span>
                  <button
                    type="button"
                    className="anim-row-key"
                    aria-label={
                      hasKey ? `${p.name}のこの時刻のキーフレームを削除` : `${p.name}のキーフレームをこの時刻に追加`
                    }
                    title={hasKey ? 'この時刻のキーフレームを消す' : 'この時刻に今の値でキーフレームを足す'}
                    onClick={() => toggleKey(p)}
                  >
                    {hasKey ? '◆' : '◇'}
                  </button>
                  <div className="anim-lane" onPointerDown={seek}>
                    {keys.slice(0, -1).map((k, i) => {
                      const next = keys[i + 1]!;
                      return (
                        <span
                          key={`seg-${i}`}
                          className={`anim-seg anim-seg-${k.curve}`}
                          style={{ left: pct(k.time), width: `${((next.time - k.time) / span) * 100}%` }}
                        />
                      );
                    })}
                    {keys.map((k, i) => {
                      const isSelected =
                        selected?.parameterId === p.id && selected !== null && sameTime(selected.time, k.time);
                      return (
                        <button
                          key={i}
                          type="button"
                          className="anim-key"
                          data-curve={k.curve}
                          aria-label={`${p.name} ${formatTime(k.time)} 秒のキーフレーム`}
                          aria-pressed={isSelected}
                          title={`${formatTime(k.time)} 秒・値 ${formatValue(p, k.value)}（ドラッグで動かす・Delete で消す）`}
                          style={{ left: pct(k.time) }}
                          onPointerDown={(e) => startDrag(e, p, k)}
                          onClick={() => select(p.id, k.time)}
                          onKeyDown={(e) => onKeyDown(e, p, k)}
                        >
                          ◆
                        </button>
                      );
                    })}
                    <span className="anim-playhead" style={{ left: pct(time) }} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyframeBar(props: {
  animation: Animation;
  selected: { parameterId: string; time: number } | null;
  parameters: readonly Parameter[];
  onMove(parameterId: string, from: number, to: number): void;
  onCurve(parameterId: string, time: number, curve: KeyCurve): void;
  onRemove(parameterId: string, time: number): void;
}) {
  const { animation, selected } = props;
  const key = selected ? keyframeAt(animation, selected.parameterId, selected.time) : undefined;
  if (!selected || !key) {
    return (
      <div className="anim-keybar">
        <span className="anim-note">
          ◆ を押すとキーフレームを選べる（ドラッグで動かす・Delete で消す）。◇ で今の時刻に今の値のキーフレームを足す
        </span>
      </div>
    );
  }
  const p = props.parameters.find((x) => x.id === selected.parameterId);
  return (
    <div className="anim-keybar" role="group" aria-label="選んだキーフレーム">
      <span className="anim-keybar-name">◆ {p?.name ?? selected.parameterId}</span>
      <label className="anim-inline">
        時刻
        <NumberField
          className="anim-number"
          label="キーフレームの時刻（秒）"
          value={key.time}
          min={0}
          max={animation.duration}
          step={TIME_STEP}
          format={formatTime}
          onCommit={(v) => props.onMove(selected.parameterId, key.time, v)}
        />
        秒
      </label>
      <span className="anim-keybar-value">値 {p ? formatValue(p, key.value) : key.value}</span>
      <span className="anim-label" title="このキーフレームから次のキーフレームまでの補間">
        補間
      </span>
      <div className="anim-choices" role="group" aria-label="補間">
        {CURVE_CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={key.curve === c.id}
            onClick={() => props.onCurve(selected.parameterId, key.time, c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => props.onRemove(selected.parameterId, key.time)}>
        キーフレームを削除
      </button>
    </div>
  );
}
