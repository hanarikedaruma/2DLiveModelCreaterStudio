// パラメータパネル（モデリングの右）。グループごとに行を並べ、行を押すとそのパラメータを編集中にする。
// [間を生成]・[奥行きで作り直す]・[すべて再補間]・生成方式・キーのロックは、操作ごとに1回の Undo にする
import { useEffect } from 'react';
import { PARAMETER_GROUPS, type Model, type Parameter, type ParameterGroup } from '@app/schema';
import { PanelSections, useCanvas, useDialogs, useEditor, useProject, useServices } from '../../../shell/api';
import {
  applyGeneration,
  generateBetween,
  GENERATION_CHOICES,
  generationOf,
  isDepthParameter,
  lockRange,
  rebuildDepth,
  regenerateKeys,
  toggleLockAt,
  type GenerationChoice,
} from './generate';
import type { KeyActions } from './KeySlider';
import { activeParameters, keyMarksFor, valueOf } from './marks';
import { connectEditingOverlay } from './overlay';
import { ParameterRow } from './ParameterRow';
import './parameters.css';

export const PARAMETER_PANEL_ID = 'parameters';

// 生成方式の説明（選ぶ欄のツールチップ）
const GENERATION_TITLE = GENERATION_CHOICES.map((c) => `${c.label}: ${c.hint}`).join('\n');

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

export function ParameterPanel() {
  const services = useServices();
  const project = useProject();
  const [editor, setEditor] = useEditor();
  const dialogs = useDialogs();
  const { requestRedraw } = useCanvas();

  // パネルが出ている間、キャンバスの「編集中」の表示にストアをつなぐ
  useEffect(() => {
    const disconnect = connectEditingOverlay(services);
    requestRedraw();
    return () => {
      disconnect();
      requestRedraw();
    };
  }, [services, requestRedraw]);

  const model = project.model;
  const active = activeParameters(model, editor);
  const activeIds = active.map((p) => p.id);
  const depthIds = activeIds.filter(isDepthParameter);

  // 押すと編集中にする（ほかのパラメータはデフォルト値に戻す）。編集中の行をもう一度押すと基準状態に戻る
  const toggle = (p: Parameter) => {
    if (activeIds.includes(p.id)) setEditor({ activeParameterIds: [], editorParamValues: {} });
    else setEditor({ activeParameterIds: [p.id], editorParamValues: { [p.id]: valueOf(p, editor) } });
  };

  // 編集中でない行のスライダーを動かしたら、その行を編集中にする（基準状態の編集と見た目がずれないように）
  const change = (p: Parameter, value: number) => {
    if (activeIds.includes(p.id)) setEditor({ editorParamValues: { ...editor.editorParamValues, [p.id]: value } });
    else setEditor({ activeParameterIds: [p.id], editorParamValues: { [p.id]: value } });
  };

  const generate = () => {
    if (generateBetween(services.store, services.keyGenerator, activeIds) === 0) {
      dialogs.notify('このパラメータのキーはまだ無い');
    }
  };

  const regenerateAll = () => {
    if (regenerateKeys(services.store, services.keyGenerator, activeIds) === 0) {
      dialogs.notify('このパラメータのキーはまだ無い');
    }
  };

  // 生成方式は詳細モードで選ぶ。曲面は顔の向き（FaceAngleX・FaceAngleY）のときだけ
  const detail = editor.uiLevel.modeling === 'detail';
  const generation = generationOf(model, activeIds);
  const choices = GENERATION_CHOICES.filter(
    (c) => c.id !== 'surface' || depthIds.length > 0 || generation === 'surface',
  );
  const choose = (choice: GenerationChoice) => {
    const changed = applyGeneration(services.store, services.keyGenerator, activeIds, choice);
    if (changed === 0 && choice === 'surface') dialogs.notify('曲面にできるのは、顔の向きのワープのキーだけ');
  };

  // 行のキーの印と範囲の操作（編集中の行だけで使える）
  const keyActionsFor = (p: Parameter): KeyActions => ({
    toggleLock: (value) => toggleLockAt(services.store, p.id, value),
    lockRange: (range, locked) => lockRange(services.store, p.id, range, locked),
    regenerateRange: (range) => {
      if (regenerateKeys(services.store, services.keyGenerator, [p.id], range) === 0) {
        dialogs.notify('このパラメータのキーはまだ無い');
      }
    },
  });

  return (
    <div className="parameter-panel">
      <div className="parameter-status">
        {active.length > 0 ? (
          <p className="parameter-status-text">キーを編集中: {active.map((p) => p.name).join('、')}</p>
        ) : (
          <p className="parameter-status-text parameter-hint">行を押すと、そのパラメータのキーを編集する</p>
        )}
        <div className="parameter-actions">
          <button
            type="button"
            disabled={active.length === 0}
            title="編集中のパラメータのキーの間に、中間のキーを作る"
            onClick={generate}
          >
            間を生成
          </button>
          <button
            type="button"
            disabled={active.length === 0}
            title="ロックしたキーと代表のキーを残し、中間のキーを生成方式で作り直す"
            onClick={regenerateAll}
          >
            すべて再補間
          </button>
          {depthIds.length > 0 && (
            <button
              type="button"
              title="パーツの奥行きから、顔の向きのキーを作り直す（ロックしたキーは残る）"
              onClick={() => rebuildDepth(services.store, services.keyGenerator, depthIds)}
            >
              奥行きで作り直す
            </button>
          )}
        </div>
        {detail && active.length > 0 && (
          <label className="parameter-generation" title={GENERATION_TITLE}>
            <span>生成方式</span>
            <select
              aria-label="生成方式"
              value={generation ?? 'linear'}
              disabled={generation === null}
              onChange={(e) => choose(e.currentTarget.value as GenerationChoice)}
            >
              {generation === 'mixed' && (
                <option value="mixed" disabled>
                  混在
                </option>
              )}
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {active.length > 0 && (
          <p className="parameter-hint">
            キーの印: 押すとその値へ移動、右クリックでロック、Shift＋ドラッグで範囲を選ぶ
          </p>
        )}
      </div>
      {groupsOf(model).map(({ group, parameters }) => (
        <section key={group.id} className="parameter-group" aria-label={group.name}>
          <h3 className="parameter-group-title">{group.name}</h3>
          {parameters.map((p) => (
            <ParameterRow
              key={p.id}
              parameter={p}
              value={valueOf(p, editor)}
              active={activeIds.includes(p.id)}
              marks={keyMarksFor(model, p.id)}
              onToggle={() => toggle(p)}
              onChange={(v) => change(p, v)}
              keyActions={keyActionsFor(p)}
            />
          ))}
        </section>
      ))}
      <PanelSections panelId={PARAMETER_PANEL_ID} />
    </div>
  );
}
