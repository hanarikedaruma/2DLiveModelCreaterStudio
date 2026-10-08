// 「パーツの設定」の物理のセクション（カード50）。画像パーツかグループを1つ選んだときに出す。
// かんたん: [揺らす]・種類（髪・布・リボン・アクセサリ）・揺れ方（控えめ〜大きめ）・根元の案内・[揺れを試す]。
// 詳細: spring・damping・gravity・inertia・range・方向・入力を数値で変える（かんたんでは「物理の数値」で一時的に開く）
import { useState } from 'react';
import { newId, type Parameter, type Part, type Physics, type Project } from '@app/schema';
import { DetailDisclosure, useDispatch, useEditor, useProject, useServices } from '../../../shell/api';
import { useConfirmOverwriteCustom } from '../../../shell/level';
import { partById } from '../canvas/parts';
import {
  disablePhysicsCommand,
  enablePhysicsCommand,
  patchPhysics,
  physicsOfPart,
  rebuildSwayCommand,
  updatePhysicsCommand,
} from './commands';
import { NumberField } from './NumberField';
import {
  applyPhysicsPreset,
  clampStrength,
  PHYSICS_DIRECTIONS,
  PHYSICS_FIELDS,
  PHYSICS_KINDS,
  physicsPresetState,
  type PhysicsKind,
  type PhysicsPresetValues,
} from './presets';
import { effectiveInputs } from './preview';
import { useSwayPreview } from './useSwayPreview';
import './physics.css';

export const ROOT_HINT =
  '根元はこのパーツのピボット（オレンジの ◎）。選択ツールで ◎ を根元へドラッグすると直せる（直したら [揺れのキーを作り直す]）';

const NEW_INPUT_WEIGHT = 0.5;

// 揺れ方の言葉（0 控えめ 〜 1 大きめ）
export function strengthWord(strength: number): string {
  if (strength < 0.2) return '控えめ';
  if (strength < 0.4) return 'やや控えめ';
  if (strength <= 0.6) return 'ふつう';
  if (strength <= 0.8) return 'やや大きめ';
  return '大きめ';
}

export function PhysicsSection() {
  const services = useServices();
  const project = useProject();
  const [editor] = useEditor();
  const dispatch = useDispatch();
  const preview = useSwayPreview();

  const ids = editor.selectedPartIds;
  const part = ids.length === 1 && ids[0] ? partById(project.model, ids[0]) : undefined;
  if (!part) return null;
  const item = physicsOfPart(project, part.id);

  const toggle = (on: boolean) => {
    preview.stop();
    if (on) {
      dispatch(enablePhysicsCommand(part.id, { physics: newId(), transform: newId(), vertices: newId() }));
      return;
    }
    dispatch(disablePhysicsCommand(part.id));
    // 消えた揺れパラメータは、編集中（キャンバスのプレビュー）からも外す
    const model = services.store.get().model;
    const state = services.editor.get();
    const gone = (id: string) => !model.parameters.some((p) => p.id === id);
    const removed = [...state.activeParameterIds, ...Object.keys(state.editorParamValues)].filter(gone);
    if (removed.length > 0) {
      services.editor.set({
        activeParameterIds: state.activeParameterIds.filter((id) => !gone(id)),
        editorParamValues: Object.fromEntries(Object.entries(state.editorParamValues).filter(([id]) => !gone(id))),
      });
    }
  };

  return (
    <div className="physics-section">
      <h3 className="physics-heading">軸揺れ</h3>
      <label className="physics-check">
        <input type="checkbox" checked={item !== undefined} onChange={(e) => toggle(e.target.checked)} />
        軸で揺らす
      </label>
      {item ? (
        <PhysicsSettings project={project} part={part} item={item} preview={preview} />
      ) : (
        <p className="physics-hint">
          オンにすると、揺れパラメータ・物理の設定・揺れのキーを自動で作る。根元はピボットなので、先に選択ツールでピボット（オレンジの
          ◎）を根元へ動かしておく
        </p>
      )}
    </div>
  );
}

function PhysicsSettings(props: {
  project: Project;
  part: Part;
  item: Physics;
  preview: ReturnType<typeof useSwayPreview>;
}) {
  const { project, part, item, preview } = props;
  const dispatch = useDispatch();
  const confirmOverwrite = useConfirmOverwriteCustom();
  const [strengthDraft, setStrengthDraft] = useState<number | null>(null);

  const update = (label: string, fn: (it: Physics) => Physics) => dispatch(updatePhysicsCommand(label, item.id, fn));
  const state = physicsPresetState(item);
  const output = project.model.parameters.find((p) => p.id === item.outputParameterId);

  // 個別に調整した値のときだけ「個別に調整した値を上書きします」を確かめる
  const chooseKind = async (kind: PhysicsKind) => {
    if (kind === item.preset && state === kind) return;
    if (!(await confirmOverwrite(state))) return;
    update('揺れの種類を変える', (it) => applyPhysicsPreset(it, kind));
  };

  const strength = strengthDraft ?? item.strength;
  const commitStrength = () => {
    if (strengthDraft === null) return;
    setStrengthDraft(null);
    update('揺れ方を変える', (it) => patchPhysics(it, { strength: clampStrength(strengthDraft) }));
  };

  return (
    <div className="physics-settings">
      <div className="physics-row">
        <span className="physics-label">種類</span>
        <div className="physics-choices" role="group" aria-label="揺れの種類">
          {PHYSICS_KINDS.map((k) => (
            <button key={k.id} type="button" aria-pressed={item.preset === k.id} onClick={() => void chooseKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {state === 'custom' && <p className="physics-hint">数値を個別に調整している（種類を選び直すと上書きする）</p>}

      <label className="physics-row">
        <span className="physics-label">揺れ方</span>
        <span className="physics-strength">
          <span className="physics-end">控えめ</span>
          <input
            type="range"
            aria-label="揺れ方"
            min={0}
            max={1}
            step={0.05}
            value={strength}
            onChange={(e) => setStrengthDraft(Number(e.currentTarget.value))}
            onPointerUp={commitStrength}
            onKeyUp={commitStrength}
            onBlur={commitStrength}
          />
          <span className="physics-end">大きめ</span>
        </span>
        <output className="physics-value" aria-label="揺れ方の値">
          {strengthWord(strength)}
        </output>
      </label>

      <p className="physics-hint">{ROOT_HINT}</p>
      <p className="physics-info" aria-label="揺れパラメータ">
        揺れパラメータ: {output?.name ?? item.outputParameterId}
        <span className="physics-dim">（パラメータパネルの「揺れもの」で動きを確かめられる）</span>
      </p>

      <div className="physics-buttons">
        <button
          type="button"
          aria-pressed={preview.playing}
          onClick={() => (preview.playing ? preview.stop() : preview.start(item.id))}
        >
          {preview.playing ? '止める' : '揺れを試す'}
        </button>
        <button
          type="button"
          onClick={() => dispatch(rebuildSwayCommand(part.id, { transform: newId(), vertices: newId() }))}
        >
          揺れのキーを作り直す
        </button>
      </div>
      {preview.playing && <p className="physics-hint">頭を左右に振ったときの揺れを再生している</p>}

      <DetailDisclosure label="物理の数値">
        <PhysicsNumbers project={project} item={item} update={update} />
      </DetailDisclosure>
    </div>
  );
}

function PhysicsNumbers(props: {
  project: Project;
  item: Physics;
  update(label: string, fn: (it: Physics) => Physics): void;
}) {
  const { project, item, update } = props;
  const params = project.model.parameters;
  const nameOf = (id: string) => params.find((p) => p.id === id)?.name ?? id;
  const inputs = effectiveInputs(item);
  const usingDefault = item.inputs.length === 0;
  const setInputs = (list: Physics['inputs']) =>
    update('物理の入力を変える', (it) => patchPhysics(it, { inputs: list }));
  const candidates: Parameter[] = params.filter(
    (p) => p.id !== item.outputParameterId && !inputs.some((x) => x.parameterId === p.id),
  );

  return (
    <div className="physics-numbers">
      <label className="physics-row">
        <span className="physics-label">方向</span>
        <select
          aria-label="揺れの方向"
          value={item.direction}
          onChange={(e) =>
            update('揺れの方向を変える', (it) =>
              patchPhysics(it, { direction: e.target.value as Physics['direction'] }),
            )
          }
        >
          {PHYSICS_DIRECTIONS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      {PHYSICS_FIELDS.map((f) => (
        <label key={f.key} className="physics-row" title={f.hint}>
          <span className="physics-label">{f.label}</span>
          <NumberField
            label={f.label}
            value={item[f.key]}
            min={f.min}
            max={f.max}
            step={f.step}
            onCommit={(v) =>
              update(`物理の ${f.label} を変える`, (it) =>
                patchPhysics(it, { [f.key]: v } as Partial<PhysicsPresetValues>),
              )
            }
          />
          <span className="physics-dim">{f.hint}</span>
        </label>
      ))}

      <fieldset className="physics-inputs">
        <legend>入力（重み）</legend>
        {usingDefault && <p className="physics-hint">既定の入力を使っている（変えると、この項目だけの入力になる）</p>}
        <ul className="physics-input-list">
          {inputs.map((x, i) => (
            <li key={x.parameterId} className="physics-row">
              <span className="physics-label">{nameOf(x.parameterId)}</span>
              <NumberField
                label={`${nameOf(x.parameterId)} の重み`}
                value={x.weight}
                min={-10}
                max={10}
                step={0.1}
                onCommit={(w) => setInputs(inputs.map((y, j) => (j === i ? { ...y, weight: w } : { ...y })))}
              />
              <button
                type="button"
                aria-label={`${nameOf(x.parameterId)} を入力から外す`}
                onClick={() => setInputs(inputs.filter((_, j) => j !== i).map((y) => ({ ...y })))}
              >
                外す
              </button>
            </li>
          ))}
        </ul>
        {!usingDefault && <p className="physics-hint">全部外すと既定の入力に戻る</p>}
        <label className="physics-row">
          <span className="physics-label">足す</span>
          <select
            aria-label="入力を足す"
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) setInputs([...inputs.map((y) => ({ ...y })), { parameterId: id, weight: NEW_INPUT_WEIGHT }]);
            }}
          >
            <option value="">（パラメータを選ぶ）</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <p className="physics-dim">長さ {Math.round(item.length)} px（パーツの高さ）</p>
    </div>
  );
}
