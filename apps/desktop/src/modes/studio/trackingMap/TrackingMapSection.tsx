// スタジオの設定（詳細）の「トラッキングの割り当て」（I-042）。標準・カスタム・無効を選び、カスタムでは
// 入力 → パラメータ（ユーザー定義も）の割り当てと、同じパラメータへの割り当ての合わせ方を編集する。プロジェクトに保存
import { useEffect, useState } from 'react';
import type { Parameter, TrackingCombineMethod, TrackingInput, TrackingMapping, TrackingSetup } from '@app/schema';
import { useDispatch, useProject } from '../../../shell/api';
import {
  COMBINE_LABELS,
  TRACKING_INPUT_LABELS,
  TRACKING_MODE_LABELS,
  addMappingCommand,
  combineOf,
  moveMappingCommand,
  removeMappingCommand,
  resetToStandardCommand,
  setCombineCommand,
  setModeCommand,
  sharedParameters,
  updateMappingCommand,
} from './commands';
import './trackingMap.css';

const MODES: TrackingSetup['mode'][] = ['standard', 'custom', 'off'];
const INPUTS = Object.keys(TRACKING_INPUT_LABELS) as TrackingInput[];
const METHODS = Object.keys(COMBINE_LABELS) as TrackingCombineMethod[];

// 数の欄。小数3桁までで見せる。Enter か外れたときに確定し、受け付けない値は元に戻す（書き換えていなければ何もしない）
const shown = (v: number) => String(Number(v.toFixed(3)));
function NumberInput(props: {
  label: string;
  value: number;
  accept?: (v: number) => boolean;
  commit(value: number): void;
}) {
  const [text, setText] = useState(shown(props.value));
  useEffect(() => setText(shown(props.value)), [props.value]);
  const done = () => {
    if (text === shown(props.value)) return;
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v) && (props.accept?.(v) ?? true)) props.commit(v);
    else setText(shown(props.value));
  };
  return (
    <input
      type="number"
      className="tracking-map-number"
      aria-label={props.label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done();
      }}
    />
  );
}

function MappingRow(props: {
  index: number;
  count: number;
  mapping: TrackingMapping;
  parameters: Parameter[];
  update(patch: Partial<TrackingMapping>): void;
}) {
  const dispatch = useDispatch();
  const { index, count, mapping: m, parameters, update } = props;
  const parameter = parameters.find((p) => p.id === m.parameterId);
  const zeroWidth = m.inputRange[0] === m.inputRange[1];
  return (
    <li className="tracking-map-row" aria-label={`割り当て ${index + 1}`}>
      <div className="tracking-map-line">
        <select aria-label="入力" value={m.input} onChange={(e) => update({ input: e.target.value as TrackingInput })}>
          {INPUTS.map((input) => (
            <option key={input} value={input}>
              {TRACKING_INPUT_LABELS[input]}
            </option>
          ))}
        </select>
        <span aria-hidden="true">→</span>
        <select aria-label="パラメータ" value={m.parameterId} onChange={(e) => update({ parameterId: e.target.value })}>
          {!parameter && <option value={m.parameterId}>（モデルに無い: {m.parameterId}）</option>}
          {parameters.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="tracking-map-line">
        <span>入力</span>
        <NumberInput
          label="入力の最小"
          value={m.inputRange[0]}
          commit={(v) => update({ inputRange: [v, m.inputRange[1]] })}
        />
        <span>〜</span>
        <NumberInput
          label="入力の最大"
          value={m.inputRange[1]}
          commit={(v) => update({ inputRange: [m.inputRange[0], v] })}
        />
      </div>
      <div className="tracking-map-line">
        <span>出力</span>
        <NumberInput
          label="出力の最小"
          value={m.outputRange[0]}
          commit={(v) => update({ outputRange: [v, m.outputRange[1]] })}
        />
        <span>〜</span>
        <NumberInput
          label="出力の最大"
          value={m.outputRange[1]}
          commit={(v) => update({ outputRange: [m.outputRange[0], v] })}
        />
      </div>
      <div className="tracking-map-line">
        <label className="studio-check">
          <input type="checkbox" checked={m.invert} onChange={(e) => update({ invert: e.target.checked })} />
          反転
        </label>
        <span>なめらかさ</span>
        <NumberInput
          label="なめらかさ"
          value={m.smoothing}
          accept={(v) => v >= 0 && v <= 1}
          commit={(v) => update({ smoothing: v })}
        />
        <span>重み</span>
        <NumberInput label="重み" value={m.weight} accept={(v) => v >= 0} commit={(v) => update({ weight: v })} />
      </div>
      <div className="tracking-map-line tracking-map-actions">
        <button type="button" disabled={index === 0} onClick={() => dispatch(moveMappingCommand(index, -1))}>
          上へ
        </button>
        <button type="button" disabled={index === count - 1} onClick={() => dispatch(moveMappingCommand(index, 1))}>
          下へ
        </button>
        <button type="button" onClick={() => dispatch(removeMappingCommand(index))}>
          削除
        </button>
      </div>
      {!parameter && <p className="studio-note studio-warn">モデルに無いパラメータなので、この割り当ては使われない</p>}
      {zeroWidth && (
        <p className="studio-note studio-warn">入力の範囲の幅が 0 なので、出力は最小か最大のどちらかになる</p>
      )}
    </li>
  );
}

export function TrackingMapSection() {
  const project = useProject();
  const dispatch = useDispatch();
  const { trackingSetup: setup, trackingMappings: mappings } = project;
  const parameters = project.model.parameters;
  const shared = sharedParameters(project);

  return (
    <div className="studio-section tracking-map">
      <h3>トラッキングの割り当て</h3>
      <div className="studio-choices" role="group" aria-label="トラッキングの割り当ての使い方">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={setup.mode === mode}
            onClick={() => dispatch(setModeCommand(mode))}
          >
            {TRACKING_MODE_LABELS[mode]}
          </button>
        ))}
      </div>
      {setup.mode === 'standard' && (
        <p className="studio-note">
          標準の割り当て（顔の向き・目・視線・口・眉）を使う。ユーザー定義のパラメータに割り当てるときは「カスタム」にする
        </p>
      )}
      {setup.mode === 'off' && (
        <p className="studio-note">
          トラッキングでパラメータを動かさない（カスタムの一覧は残る。自動まばたきは目のトラッキングの設定のまま）
        </p>
      )}
      {setup.mode === 'custom' && (
        <>
          {mappings.length === 0 && <p className="studio-note">割り当てが無いので、トラッキングでは何も動かない</p>}
          <ol className="tracking-map-list">
            {mappings.map((m, i) => (
              <MappingRow
                key={i}
                index={i}
                count={mappings.length}
                mapping={m}
                parameters={parameters}
                update={(patch) => dispatch(updateMappingCommand(i, patch))}
              />
            ))}
          </ol>
          <div className="studio-row">
            <button type="button" onClick={() => dispatch(addMappingCommand())}>
              割り当てを追加
            </button>
            <button type="button" onClick={() => dispatch(resetToStandardCommand())}>
              標準の一覧に戻す
            </button>
          </div>
          {shared.length > 0 && (
            <div className="tracking-map-combine">
              <p className="studio-note">同じパラメータへの割り当ての合わせ方</p>
              {shared.map((id) => (
                <label key={id} className="studio-field">
                  <span>{parameters.find((p) => p.id === id)?.name ?? id}</span>
                  <select
                    aria-label={`合わせ方: ${parameters.find((p) => p.id === id)?.name ?? id}`}
                    value={combineOf(setup, id)}
                    onChange={(e) => dispatch(setCombineCommand(id, e.target.value as TrackingCombineMethod))}
                  >
                    {METHODS.map((method) => (
                      <option key={method} value={method}>
                        {COMBINE_LABELS[method]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
