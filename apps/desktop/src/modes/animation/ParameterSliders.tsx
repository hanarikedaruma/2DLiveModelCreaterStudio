// プレビューの横のパラメータのスライダー（カード46）。今の時刻の値（補間した値）を出し、
// 動かすとその時刻のキーフレームの値を変える（無ければその時刻にキーフレームを置く）。1回の操作で1回の Undo
import { useEffect, useRef } from 'react';
import type { Animation, Parameter } from '@app/schema';
import type { ParamValues } from '@app/contracts';
import { useServices } from '../../shell/api';
import { beginLiveEdit, type LiveEdit } from '../modeling/canvas/liveEdit';
import { updateAnimationCommand } from './commands';
import { keyframeAt, roundTime, setKeyframe, trackOf } from './keyframes';
import { formatValue, parameterGroupsOf, sliderStep } from './labels';
import { animationEditor } from './state';
import { useCurrentAnimation } from './useCurrent';

export function ParameterSliders({ values }: { values: ParamValues }) {
  const services = useServices();
  const { project, animation, time } = useCurrentAnimation();
  // 操作中の編集。アニメーション・パラメータ・時刻のどれかが変わったら、前の分を確定して別の編集にする
  const liveRef = useRef<{ target: string; label: string; edit: LiveEdit } | null>(null);
  const keyTime = roundTime(time);

  const release = () => {
    liveRef.current?.edit.commit();
    liveRef.current = null;
  };
  // 外れたら操作中のものは確定する
  useEffect(() => release, []);

  const change = (anim: Animation, p: Parameter, value: number) => {
    if (animationEditor.get().playback !== 'stopped') animationEditor.set({ playback: 'stopped', time: keyTime });
    const target = `${anim.id}\n${p.id}\n${keyTime}`;
    let live = liveRef.current;
    if (!live || live.target !== target) {
      live?.edit.commit();
      const label = keyframeAt(anim, p.id, keyTime) ? 'キーフレームの値を変える' : 'キーフレームを追加';
      live = { target, label, edit: beginLiveEdit(services.store, label) };
      liveRef.current = live;
    }
    const { label } = live;
    live.edit.update(() => updateAnimationCommand(label, anim.id, (a) => setKeyframe(a, p.id, keyTime, value)));
    animationEditor.set({ selectedKey: { parameterId: p.id, time: keyTime } });
  };

  return (
    <aside className="anim-sliders" aria-label="パラメータの値">
      <p className="anim-note">
        {animation
          ? 'スライダーを動かすと、今の時刻にキーフレームを置く（あれば値を変える）'
          : 'アニメーションを選ぶと値を変えられる'}
      </p>
      {parameterGroupsOf(project.model).map(({ group, parameters }) => (
        <section key={group.id} className="anim-slider-group" aria-label={group.name}>
          <h3 className="anim-group-title">{group.name}</h3>
          {parameters.map((p) => {
            const raw = values[p.id] ?? p.default;
            const v = Math.min(p.max, Math.max(p.min, raw));
            const hasKey = animation ? keyframeAt(animation, p.id, keyTime) !== undefined : false;
            const hasTrack = animation ? trackOf(animation, p.id) !== undefined : false;
            return (
              <div
                key={p.id}
                className={hasKey ? 'anim-param keyed' : hasTrack ? 'anim-param tracked' : 'anim-param'}
                data-parameter-id={p.id}
              >
                <span className="anim-param-name" title={p.name}>
                  {p.name}
                </span>
                <input
                  type="range"
                  aria-label={p.name}
                  min={p.min}
                  max={p.max}
                  step={sliderStep(p)}
                  value={v}
                  disabled={!animation}
                  onChange={(e) => animation && change(animation, p, Number(e.currentTarget.value))}
                  onPointerUp={release}
                  onKeyUp={release}
                  onBlur={release}
                />
                <output className="anim-param-value">{formatValue(p, v)}</output>
                <span className="anim-param-mark" title={hasKey ? 'この時刻にキーフレームがある' : undefined}>
                  {hasKey ? '◆' : ''}
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </aside>
  );
}
