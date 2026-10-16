// パラメータパネル（モデリングの右）。グループごとに行を並べ、行を押すとそのパラメータを編集中にする。
// [間を生成]・[奥行きで作り直す]・[すべて再補間]・生成方式・キーのロック・キーを消す・動かすは、操作ごとに1回の Undo にする。
// 間を生成・再補間・キーを消す・動かすは、パーツを選んでいればそのパーツ（子孫も）だけに掛ける（STEP3 のカード63）
import { useEffect } from 'react';
import { MAX_BINDING_PARAMETERS, PARAMETER_GROUPS, type Model, type Parameter, type ParameterGroup } from '@app/schema';
import { PanelSections, useCanvas, useDialogs, useEditor, useProject, useServices } from '../../../shell/api';
import { InfoButton } from '../../../help/InfoButton';
import { PARAMETER_HELP_IDS } from '../../../help/infoTexts';
import {
  applyGeneration,
  deleteKeyAt,
  generateBetween,
  GENERATION_CHOICES,
  generationOf,
  hasDefaultKeyDifference,
  isDepthParameter,
  keysAt,
  lockRange,
  moveKeyAt,
  rebuildDepth,
  regenerateKeys,
  resetDefaultKeyAt,
  toggleLockAt,
  type GenerationChoice,
} from './generate';
import type { KeyActions } from './KeySlider';
import { previewParameters } from '../../../services/keyEditor/common';
import { activeParameters, keyMarksFor, near, valueOf } from './marks';
import { connectEditingOverlay } from './overlay';
import { resultLabel } from './labels';
import { ParameterRow } from './ParameterRow';
import './parameters.css';

export const PARAMETER_PANEL_ID = 'parameters';

// キーを一緒に編集できるパラメータの数（組み合わせのキー。3つ以上は I-028）
export const MAX_EDITING = MAX_BINDING_PARAMETERS;

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

  // 押すと、そのパラメータだけのキーを編集する。ほかのパラメータの値（それまで編集していたものも、プレビューの値も）は
  // すべてデフォルト値に戻し、そのパラメータのキーだけの形にする（I-085）。
  // Ctrl+クリックで編集中のパラメータに加える（組み合わせのキー。MAX_EDITING まで。ほかの値はそのまま）。
  // 編集中の行をもう一度押すと、そのパラメータの編集をやめてデフォルト値に戻す（I-028）
  const toggle = (p: Parameter, additive: boolean) => {
    const values = editor.editorParamValues;
    if (activeIds.includes(p.id)) {
      const rest = Object.fromEntries(Object.entries(values).filter(([id]) => id !== p.id));
      setEditor({ activeParameterIds: activeIds.filter((id) => id !== p.id), editorParamValues: rest });
    } else if (additive) {
      if (activeIds.length >= MAX_EDITING) {
        dialogs.notify(`キーを一緒に編集できるパラメータは ${MAX_EDITING} つまで`);
        return;
      }
      setEditor({
        activeParameterIds: [...activeIds, p.id],
        editorParamValues: { ...values, [p.id]: valueOf(p, editor) },
      });
    } else {
      setEditor({ activeParameterIds: [p.id], editorParamValues: { [p.id]: valueOf(p, editor) } });
    }
  };

  // スライダーは値を変えるだけ（編集中でない行はプレビュー。編集中のパラメータもほかの値も変えない。I-028）
  const change = (p: Parameter, value: number) =>
    setEditor({ editorParamValues: { ...editor.editorParamValues, [p.id]: value } });

  // すべての値をデフォルト値に戻す（編集中のパラメータはそのまま。I-047）
  const resetValues = () => setEditor({ editorParamValues: {} });
  const previews = previewParameters(model, editor);
  const offDefault = model.parameters.some((p) => !near(valueOf(p, editor), p.default));

  // 選んだパーツがあれば、そのパーツ（子孫も）のバインディングだけに掛ける（I-059）
  const partIds = editor.selectedPartIds;
  const scopeText = partIds.length > 0 ? `選んだパーツ（${partIds.length} 個）` : 'すべてのパーツ';
  const reportScope = (label: string, count: number) => {
    if (count === 0) {
      dialogs.notify(
        partIds.length > 0 ? '選んだパーツに、このパラメータのキーはまだ無い' : 'このパラメータのキーはまだ無い',
      );
      return;
    }
    dialogs.notify(`${label}: ${scopeText}のバインディング ${count} 個に掛けた`);
  };

  const generate = () => {
    reportScope('間を生成', generateBetween(services.store, services.keyGenerator, activeIds, partIds));
  };

  const regenerateAll = () => {
    reportScope('すべて再補間', regenerateKeys(services.store, services.keyGenerator, activeIds, undefined, partIds));
  };

  // 曲面は顔の向き（FaceAngleX・FaceAngleY）のときだけ
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
    resetDefaultKey: hasDefaultKeyDifference(model, p.id, partIds)
      ? () => {
          resetDefaultKeyAt(services.store, p.id, partIds);
          dialogs.notify(`${scopeText}の既定値キーの差を消した（基準の形に戻した）`);
        }
      : undefined,
    toggleLock: (value) => toggleLockAt(services.store, p.id, value),
    lockRange: (range, locked) => lockRange(services.store, p.id, range, locked),
    regenerateRange: (range) => {
      reportScope('選択範囲だけ再補間', regenerateKeys(services.store, services.keyGenerator, [p.id], range, partIds));
    },
    // 1つのキーを消す（I-058）。デフォルト値のキーは基準なので消さない。ロックしたキーは確かめてから
    async deleteKey(value) {
      if (near(value, p.default)) {
        dialogs.notify('デフォルト値のキーは基準なので消せない');
        return;
      }
      const at = keysAt(services.store.get().model, p.id, value, partIds);
      if (at.count === 0) {
        dialogs.notify(`${scopeText}に、${resultLabel(p, value)} のキーは無い`);
        return;
      }
      if (
        at.locked > 0 &&
        !(await dialogs.confirm(`ロックしたキー ${at.locked} 個を含む ${at.count} 個のキーを消しますか？`))
      ) {
        return;
      }
      deleteKeyAt(services.store, p.id, value, partIds);
      dialogs.notify(`${scopeText}のキーを ${at.count} 個消した（${resultLabel(p, value)}）`);
    },
    // 1つのキーを別の値へ動かす（I-058）。動かす先は入力で聞く。デフォルト値とは入れ替えない
    async moveKey(value) {
      if (near(value, p.default)) {
        dialogs.notify('デフォルト値のキーは基準なので動かせない');
        return;
      }
      const model = services.store.get().model;
      const at = keysAt(model, p.id, value, partIds);
      if (at.count === 0) {
        dialogs.notify(`${scopeText}に、${resultLabel(p, value)} のキーは無い`);
        return;
      }
      const text = await dialogs.prompt(`動かす先の値（${p.min}〜${p.max}）`, String(value));
      if (text === null) return;
      const to = Number(text.trim());
      if (!Number.isFinite(to) || to < p.min || to > p.max) {
        dialogs.notify(`動かす先は ${p.min}〜${p.max} の数にする`);
        return;
      }
      if (near(to, p.default)) {
        dialogs.notify('デフォルト値へは動かせない（デフォルト値のキーは基準）');
        return;
      }
      if (near(to, value)) return;
      const there = keysAt(model, p.id, to, partIds);
      if (
        there.count > 0 &&
        !(await dialogs.confirm(`${resultLabel(p, to)} にもキーが ${there.count} 個ある。置き換えますか？`))
      ) {
        return;
      }
      moveKeyAt(services.store, p.id, value, to, partIds);
      dialogs.notify(
        `${scopeText}のキーを ${at.count} 個、${resultLabel(p, value)} から ${resultLabel(p, to)} へ動かした`,
      );
    },
  });

  return (
    <div className="parameter-panel">
      <div className="parameter-status">
        {active.length > 0 ? (
          <p className="parameter-status-text">キーを編集中: {active.map((p) => p.name).join('、')}</p>
        ) : (
          <p className="parameter-status-text parameter-hint">
            行を押すと、そのパラメータのキーを編集する（Ctrl+クリックで組み合わせ）。編集中でない行のスライダーは見え方を確かめるだけ
          </p>
        )}
        {previews.length > 0 && (
          <p className="parameter-preview" role="status">
            プレビュー中: {previews.map((p) => `${p.name} ${resultLabel(p, valueOf(p, editor))}`).join('、')}
            （この間はパーツや頂点を動かせない。キーを編集するには行を Ctrl+クリックして加える）
          </p>
        )}
        <div className="parameter-actions">
          <button
            type="button"
            disabled={!offDefault}
            title="すべてのパラメータの値をデフォルト値に戻す（編集中のパラメータはそのまま）"
            onClick={resetValues}
          >
            値をすべて戻す
          </button>
          <InfoButton infoId={PARAMETER_HELP_IDS.generateBetween}>
            <button
              type="button"
              disabled={active.length === 0}
              title="編集中のパラメータのキーの間に、中間のキーを作る"
              onClick={generate}
            >
              間を生成
            </button>
          </InfoButton>
          <InfoButton infoId={PARAMETER_HELP_IDS.regenerateAll}>
            <button
              type="button"
              disabled={active.length === 0}
              title="ロックしたキーと代表のキーを残し、中間のキーを生成方式で作り直す"
              onClick={regenerateAll}
            >
              すべて再補間
            </button>
          </InfoButton>
          {depthIds.length > 0 && (
            <InfoButton infoId={PARAMETER_HELP_IDS.rebuildDepth}>
              <button
                type="button"
                title="パーツの奥行きから、顔の向きのキーを作り直す（ロックしたキーは残る）"
                onClick={() => rebuildDepth(services.store, services.keyGenerator, depthIds)}
              >
                奥行きで作り直す
              </button>
            </InfoButton>
          )}
        </div>
        {active.length > 0 && (
          <InfoButton infoId={PARAMETER_HELP_IDS.generation}>
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
          </InfoButton>
        )}
        {active.length > 0 && (
          <p className="parameter-hint">
            キーの印: 押すとその値へ移動、右クリックでキーの操作（ロック・消す・動かす）、Shift＋ドラッグで範囲を選ぶ
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
              onToggle={(additive) => toggle(p, additive)}
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
