// 「Transform」パネルの中の「不透明度（このキー）」（カード34）。パラメータの編集中に、選んだパーツの
// いまの値での不透明度をスライダーで変える。1回の操作で1回の Undo。キーの無い値ではキーを足すか確かめる。
// デフォルト値では、その値のキーがあればそのキーを（I-038）、無ければ基準状態の不透明度を変える
import { useEffect, useRef } from 'react';
import { useDialogs, useEditor, useProject, useServices } from '../../../shell/api';
import { startKeyedDrag, type KeyedDrag } from '../canvas/liveEdit';
import { activeParameters } from '../parameters/marks';
import { addKeysCommand, hasDefaultKey, isBaseState, OPACITY_LABEL, opacityAt, opacityCommand } from './opacityKey';
import './opacity.css';

export const OPACITY_SLIDER_LABEL = '不透明度（このキー）';

const BLOCKED_NOTE = {
  baseZero: '基準状態の不透明度が 0 なので、キーでは上げられない（デフォルト値でこのスライダーを上げる）',
  // デフォルト値にもキーがあると、デフォルト値のスライダーはそのキーを変えるので、基準状態は Transform で変える
  baseZeroWithDefaultKey:
    '基準状態の不透明度が 0 なので、キーでは上げられない（パラメータの編集をやめて Transform の Opacity で上げる）',
  keyZero: 'このキーの不透明度は 0 なので、倍率では上げられない',
};

const DEFAULT_KEY_NOTE =
  'デフォルト値のこのキーに記録する（基準状態の不透明度は、パラメータの編集をやめて Transform の Opacity で変える）';

const format = (v: number) => {
  const s = String(Number(v.toFixed(2)));
  return s === '-0' ? '0' : s;
};

export function OpacityKeySection() {
  const services = useServices();
  const project = useProject();
  const [editor] = useEditor();
  const dialogs = useDialogs();
  const dragRef = useRef<KeyedDrag<number> | null>(null);

  // 外れたら操作中のものは確定する
  useEffect(
    () => () => {
      dragRef.current?.release();
      dragRef.current = null;
    },
    [],
  );

  const model = project.model;
  const ids = editor.selectedPartIds.filter((id) => model.parts.some((p) => p.id === id));
  const primary = ids[0];
  if (!primary || activeParameters(model, editor).length === 0) return null;

  const state = opacityAt(services.keyEditor, project, editor, primary);
  const defaultKey = hasDefaultKey(model, editor, primary);
  const blockedNote =
    state.blocked === 'baseZero' && defaultKey
      ? BLOCKED_NOTE.baseZeroWithDefaultKey
      : state.blocked
        ? BLOCKED_NOTE[state.blocked]
        : null;

  const change = (target: number) => {
    if (!dragRef.current?.active()) {
      const { store, keyEditor } = services;
      dragRef.current = startKeyedDrag<number>({
        store,
        dialogs,
        label: OPACITY_LABEL,
        edit: (p, t) => opacityCommand(keyEditor, p, services.editor.get(), ids, t),
        addKeys: (p) => addKeysCommand(keyEditor, p, services.editor.get(), ids),
      });
    }
    dragRef.current.move(target);
  };
  const release = () => {
    dragRef.current?.release();
    dragRef.current = null;
  };

  return (
    <div className="opacity-key">
      <label className="opacity-key-field">
        <span className="opacity-key-label">{OPACITY_SLIDER_LABEL}</span>
        <span className="opacity-key-row">
          <input
            type="range"
            className="opacity-key-slider"
            aria-label={OPACITY_SLIDER_LABEL}
            min={0}
            max={1}
            step={0.01}
            value={state.value}
            onChange={(e) => change(Number(e.currentTarget.value))}
            onPointerUp={release}
            onKeyUp={release}
            onBlur={release}
          />
          <output className="opacity-key-value">{format(state.value)}</output>
        </span>
      </label>
      {state.base ? (
        <p className="opacity-key-note">
          デフォルト値では基準状態の不透明度を変える。ほかの値では、その値のキーに記録する
        </p>
      ) : isBaseState(model, editor) ? (
        <p className="opacity-key-note">{DEFAULT_KEY_NOTE}</p>
      ) : (
        state.needsKey && <p className="opacity-key-note">この値にはキーが無い（動かすと、キーを足すか確かめる）</p>
      )}
      {blockedNote && <p className="opacity-key-note opacity-key-warn">{blockedNote}</p>}
      {ids.length > 1 && <p className="opacity-key-note">選んだ {ids.length} 個に同じ値を入れる</p>}
    </div>
  );
}
