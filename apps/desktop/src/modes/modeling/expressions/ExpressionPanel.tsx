// モデリングの「表情」パネル（カード38）。[新しい表情] → パラメータを動かして状態を作る（editorParamValues）→
// 名前を付けて登録する。項目の合成方法は標準の合成ルールで決め、詳細モードではグループごとに
// 「トラッキングに重ねる（ルールどおり）/ 固定する（override）」を選べる
import { useEffect, useRef, useState } from 'react';
import {
  PARAMETER_GROUPS,
  type BlendOp,
  type Expression,
  type Model,
  type Parameter,
  type ParameterGroup,
  type ParameterGroupId,
} from '@app/schema';
import type { ParamValues } from '@app/contracts';
import {
  buildExpressionEntries,
  expressionBlendFor,
  expressionGroupModesOf,
  expressionStateOf,
  type ExpressionGroupMode,
  type ExpressionGroupModes,
} from '@app/core';
import { useDispatch, useEditor, useProject } from '../../../shell/api';
import {
  addExpressionCommand,
  addExpressionsCommand,
  createExpression,
  missingStandardExpressions,
  nextExpressionName,
  removeExpressionCommand,
  STANDARD_EXPRESSION_NAMES,
  updateExpressionCommand,
} from './commands';
import './expressions.css';

export const EXPRESSION_PANEL_ID = 'expressions';

export const GROUP_MODE_CHOICES: readonly { id: ExpressionGroupMode; label: string }[] = [
  { id: 'rule', label: 'トラッキングに重ねる' },
  { id: 'fixed', label: '固定する' },
];

export const BLEND_LABELS: Record<BlendOp, string> = {
  add: '足す',
  multiply: '掛ける',
  override: '置き換える',
  max: '大きい方',
};

// モデルのグループの順。グループの一覧に無いグループのパラメータは末尾にまとめる
function groupsOf(model: Model): { group: ParameterGroup; parameters: Parameter[] }[] {
  const groups = [...model.parameterGroups];
  for (const p of model.parameters) {
    if (groups.some((g) => g.id === p.groupId)) continue;
    groups.push(PARAMETER_GROUPS.find((g) => g.id === p.groupId) ?? { id: p.groupId, name: p.groupId });
  }
  return groups
    .map((group) => ({ group, parameters: model.parameters.filter((p) => p.groupId === group.id) }))
    .filter((g) => g.parameters.length > 0);
}

const NEAR = 1e-6;

function valueOf(p: Parameter, values: ParamValues): number {
  const raw = values[p.id];
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default;
  return Math.min(p.max, Math.max(p.min, v));
}

function formatValue(p: Parameter, v: number): string {
  return Math.abs(p.max - p.min) >= 10 ? String(Math.round(v)) : v.toFixed(2);
}

interface Draft {
  expressionId: string | null; // null は新しい表情
  name: string;
  modes: ExpressionGroupModes;
}

export function ExpressionPanel() {
  const project = useProject();
  const dispatch = useDispatch();
  const [editor, setEditor] = useEditor();
  const [draft, setDraft] = useState<Draft | null>(null);
  const { parameters } = project.model;
  const values = editor.editorParamValues;

  // 作っている途中でパネルが外れたら（モードを替えたら）、キャンバスを基準状態に戻す
  const drafting = useRef(false);
  drafting.current = draft !== null;
  const setEditorRef = useRef(setEditor);
  setEditorRef.current = setEditor;
  useEffect(
    () => () => {
      if (drafting.current) setEditorRef.current({ editorParamValues: {} });
    },
    [],
  );

  // 作り始める。キーの編集はやめ、キャンバスに表情の状態を出す
  const start = (expression: Expression | null) => {
    setDraft({
      expressionId: expression?.id ?? null,
      name: expression?.name ?? nextExpressionName(project.expressions),
      modes: expression ? expressionGroupModesOf(parameters, expression) : {},
    });
    setEditor({
      activeParameterIds: [],
      editorParamValues: expression ? expressionStateOf(parameters, expression) : {},
    });
  };

  const finish = () => {
    setDraft(null);
    setEditor({ editorParamValues: {} });
  };

  const commit = (d: Draft) => {
    const entries = buildExpressionEntries(parameters, values, d.modes);
    const name = d.name.trim() || nextExpressionName(project.expressions);
    const existing = d.expressionId === null ? undefined : project.expressions.find((e) => e.id === d.expressionId);
    if (existing) dispatch(updateExpressionCommand('表情を変える', existing.id, { name, entries }));
    else dispatch(addExpressionCommand(createExpression(name, entries)));
    finish();
  };

  const setValue = (p: Parameter, v: number) => {
    const next = { ...editor.editorParamValues };
    if (Math.abs(v - p.default) <= NEAR) delete next[p.id];
    else next[p.id] = v;
    setEditor({ activeParameterIds: [], editorParamValues: next });
  };

  if (draft === null) {
    const templates = missingStandardExpressions(project);
    return (
      <div className="expr-panel">
        <div className="expr-actions">
          <button type="button" className="primary" onClick={() => start(null)}>
            新しい表情
          </button>
          <button
            type="button"
            disabled={templates.length === 0}
            title={`${STANDARD_EXPRESSION_NAMES.join('・')}（値は空。［編集］で作る）`}
            onClick={() => dispatch(addExpressionsCommand('標準の表情のひな形を追加', templates))}
          >
            標準のひな形を追加
          </button>
        </div>
        {project.expressions.length === 0 ? (
          <p className="expr-note">表情がまだ無い（［新しい表情］で作る）</p>
        ) : (
          <ul className="expr-list" aria-label="表情の一覧">
            {project.expressions.map((e) => (
              <li key={e.id} className="expr-item">
                <span className="expr-name">{e.name}</span>
                <span className="expr-count">{e.entries.length === 0 ? '値なし' : `${e.entries.length} 項目`}</span>
                <button type="button" aria-label={`「${e.name}」を編集`} onClick={() => start(e)}>
                  編集
                </button>
                <button
                  type="button"
                  aria-label={`「${e.name}」を削除`}
                  onClick={() => dispatch(removeExpressionCommand(e.id))}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const editing = draft.expressionId !== null && project.expressions.some((e) => e.id === draft.expressionId);
  const groups = groupsOf(project.model);
  const entries = buildExpressionEntries(parameters, values, draft.modes);
  const blendOf = new Map(entries.map((e) => [e.parameterId, e.blend]));
  const setMode = (groupId: ParameterGroupId, mode: ExpressionGroupMode) =>
    setDraft({ ...draft, modes: { ...draft.modes, [groupId]: mode } });

  return (
    <div className="expr-panel" aria-label="表情を作る">
      <p className="expr-heading">{editing ? '表情を編集中' : '新しい表情を作っている'}</p>
      <label className="expr-field">
        <span>名前</span>
        <input
          type="text"
          aria-label="表情の名前"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <p className="expr-note">スライダーで動かしたパラメータ（{entries.length} 個）が表情に入る</p>
      {groups.map(({ group, parameters: ps }) => (
        <section key={group.id} className="expr-group" aria-label={group.name}>
          <h3 className="expr-group-title">{group.name}</h3>
          {ps.map((p) => {
            const v = valueOf(p, values);
            const blend = blendOf.get(p.id);
            return (
              <div key={p.id} className={blend ? 'expr-param changed' : 'expr-param'} data-parameter-id={p.id}>
                <span className="expr-param-name">{p.name}</span>
                <input
                  type="range"
                  aria-label={p.name}
                  min={p.min}
                  max={p.max}
                  step={(p.max - p.min) / 100}
                  value={v}
                  onChange={(e) => setValue(p, Number(e.target.value))}
                />
                <output className="expr-param-value">{formatValue(p, v)}</output>
                <button
                  type="button"
                  className="expr-reset"
                  aria-label={`${p.name}を戻す`}
                  title="デフォルト値に戻す"
                  disabled={!blend}
                  onClick={() => setValue(p, p.default)}
                >
                  ↺
                </button>
              </div>
            );
          })}
        </section>
      ))}
      <>
        <div className="expr-modes">
          {groups.map(({ group, parameters: ps }) => {
            const mode = draft.modes[group.id] ?? 'rule';
            const changed = ps.filter((p) => blendOf.has(p.id));
            return (
              <div key={group.id} className="expr-mode">
                <span className="expr-mode-name">{group.name}</span>
                <div className="expr-choices" role="group" aria-label={`${group.name}の合成方法`}>
                  {GROUP_MODE_CHOICES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={mode === c.id}
                      onClick={() => setMode(group.id, c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {changed.length > 0 && (
                  <span className="expr-mode-result">
                    {changed.map((p) => `${p.name}: ${BLEND_LABELS[expressionBlendFor(p, mode)]}`).join('、')}
                  </span>
                )}
              </div>
            );
          })}
          <p className="expr-note">
            重ねる: 顔・体の角度・眉・口の開閉は足し、目の開閉は掛け、目の笑顔・頬染め・口の形は置き換える。固定する:
            すべて置き換える
          </p>
        </div>
      </>
      <div className="expr-actions">
        <button type="button" className="primary" onClick={() => commit(draft)}>
          {editing ? '保存' : '登録'}
        </button>
        <button type="button" onClick={finish}>
          やめる
        </button>
      </div>
    </div>
  );
}
