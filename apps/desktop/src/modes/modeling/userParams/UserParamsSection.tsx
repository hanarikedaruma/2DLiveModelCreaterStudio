// パラメータパネルの「ユーザー定義パラメータ」（カード34）: 一覧・追加・編集・削除。
// 作ったパラメータはパネルの上の一覧（グループごと）にも並び、ほかのパラメータと同じようにキーを作れる
import { useState } from 'react';
import { newId, PARAMETER_GROUPS, type Parameter, type ParameterGroupId } from '@app/schema';
import { useDialogs, useDispatch, useProject, useServices } from '../../../shell/api';
import {
  addParameterCommand,
  checkForm,
  deleteMessage,
  formOf,
  keyRange,
  NEW_PARAM_FORM,
  parameterUsage,
  removeParameterCommand,
  updateParameterCommand,
  userParameters,
  type ParamForm,
} from './userParams';
import './userParams.css';

interface FormState {
  editingId: string | null; // 追加なら null
  values: ParamForm;
}

export function UserParamsSection() {
  const project = useProject();
  const dispatch = useDispatch();
  const services = useServices();
  const dialogs = useDialogs();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const model = project.model;
  const params = userParameters(model);
  const groupName = (id: ParameterGroupId) =>
    model.parameterGroups.find((g) => g.id === id)?.name ?? PARAMETER_GROUPS.find((g) => g.id === id)?.name ?? id;

  // 編集中のパラメータが Undo などで無くなったら、入力欄を閉じる
  const editing = form?.editingId ? params.find((p) => p.id === form.editingId) : undefined;
  const shownForm = form && (form.editingId === null || editing) ? form : null;

  const openForm = (next: FormState) => {
    setForm(next);
    setError(null);
  };
  const close = () => {
    setForm(null);
    setError(null);
  };

  const submit = () => {
    if (!shownForm) return;
    const checked = checkForm(model, shownForm.values, shownForm.editingId);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    dispatch(
      shownForm.editingId
        ? updateParameterCommand(shownForm.editingId, checked.fields)
        : addParameterCommand(newId(), checked.fields),
    );
    close();
  };

  const remove = async (p: Parameter) => {
    if (!(await dialogs.confirm(deleteMessage(p, parameterUsage(services.store.get(), p.id))))) return;
    services.store.dispatch(removeParameterCommand(p.id));
    if (form?.editingId === p.id) close();
    // 編集中（キャンバスのプレビュー）からも外す
    const editor = services.editor.get();
    if (editor.activeParameterIds.includes(p.id) || Object.hasOwn(editor.editorParamValues, p.id)) {
      const { [p.id]: _removed, ...values } = editor.editorParamValues;
      services.editor.set({
        activeParameterIds: editor.activeParameterIds.filter((id) => id !== p.id),
        editorParamValues: values,
      });
    }
  };

  return (
    <div className="user-params">
      <h3 className="user-params-title">ユーザー定義パラメータ</h3>
      {params.length === 0 ? (
        <p className="user-params-note">まだ無い。追加すると、上の一覧にも並ぶ（例: しっぽ・涙）</p>
      ) : (
        <ul className="user-params-list" aria-label="ユーザー定義パラメータの一覧">
          {params.map((p) => (
            <li key={p.id} className="user-params-item" data-parameter-id={p.id}>
              <span className="user-params-name">{p.name}</span>
              <span className="user-params-meta">
                {groupName(p.groupId)}・{p.min}〜{p.max}（デフォルト {p.default}）
              </span>
              <span className="user-params-buttons">
                <button
                  type="button"
                  aria-label={`${p.name} を編集`}
                  onClick={() => openForm({ editingId: p.id, values: formOf(p) })}
                >
                  編集
                </button>
                <button type="button" aria-label={`${p.name} を削除`} onClick={() => void remove(p)}>
                  削除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {shownForm ? (
        <ParamFormView
          state={shownForm}
          error={error}
          defaultLocked={editing !== undefined && keyRange(model, editing.id) !== null}
          onChange={(values) => setForm({ ...shownForm, values })}
          onSubmit={submit}
          onCancel={close}
        />
      ) : (
        <div className="user-params-actions">
          <button type="button" onClick={() => openForm({ editingId: null, values: NEW_PARAM_FORM })}>
            追加
          </button>
        </div>
      )}
    </div>
  );
}

function ParamFormView(props: {
  state: FormState;
  error: string | null;
  defaultLocked: boolean; // キーがあるのでデフォルト値は変えられない
  onChange(values: ParamForm): void;
  onSubmit(): void;
  onCancel(): void;
}) {
  const { values } = props.state;
  const adding = props.state.editingId === null;
  const set = (patch: Partial<ParamForm>) => props.onChange({ ...values, ...patch });
  const numberField = (label: string, key: 'min' | 'max' | 'defaultValue', readOnly = false) => (
    <label className="user-params-field">
      <span className="user-params-label">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={values[key]}
        readOnly={readOnly}
        aria-readonly={readOnly}
        onChange={(e) => {
          if (!readOnly) set({ [key]: e.target.value });
        }}
      />
    </label>
  );
  return (
    <form
      className="user-params-form"
      aria-label={adding ? 'パラメータの追加' : 'パラメータの編集'}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
    >
      <label className="user-params-field user-params-wide">
        <span className="user-params-label">名前</span>
        <input type="text" value={values.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      {numberField('最小', 'min')}
      {numberField('最大', 'max')}
      {numberField('デフォルト値', 'defaultValue', props.defaultLocked)}
      <label className="user-params-field">
        <span className="user-params-label">グループ</span>
        <select value={values.groupId} onChange={(e) => set({ groupId: e.target.value as ParameterGroupId })}>
          {PARAMETER_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      {props.defaultLocked && (
        <p className="user-params-note user-params-wide">キーがあるので、デフォルト値は変えられない</p>
      )}
      {props.error && (
        <p className="user-params-error user-params-wide" role="alert">
          {props.error}
        </p>
      )}
      <div className="user-params-actions user-params-wide">
        <button type="submit" className="primary">
          {adding ? '追加' : '保存'}
        </button>
        <button type="button" onClick={props.onCancel}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
