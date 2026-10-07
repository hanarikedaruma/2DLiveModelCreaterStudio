// Transform パネル。選択中のパーツの基準状態の値を数値で表示・編集する
// （パラメータの編集中と、値だけがデフォルト値でない間は読み取り専用）
import { useRef, useState, type FC } from 'react';
import type { Part, Project } from '@app/schema';
import type { Command, ProjectStore } from '@app/contracts';
import { patchPart } from '@app/core';
import { PanelSections, useEditor, useProject, useServices } from '../../../shell/api';
import { isPreviewOffBase } from '../../../services/keyEditor/common';
import { useBindEnv, type EnvSlot } from './env';
import { beginLiveEdit, type LiveEdit } from './liveEdit';
import './transform.css';

// 編集中のパラメータが無いのに値だけがデフォルト値でない（表情を作っている途中など）ときの案内（I-029）
export const PREVIEW_OFF_BASE_NOTE =
  'キーを編集していないパラメータの値がデフォルト値でない間は編集できない（見えている形と違うため。パラメータパネルの［値をすべて戻す］で戻す）';

export type FieldKey = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'pivotX' | 'pivotY' | 'opacity';

const FIELDS: { key: FieldKey; label: string; digits: number }[] = [
  { key: 'x', label: 'X', digits: 2 },
  { key: 'y', label: 'Y', digits: 2 },
  { key: 'rotation', label: 'Rotation', digits: 2 },
  { key: 'scaleX', label: 'Scale X', digits: 3 },
  { key: 'scaleY', label: 'Scale Y', digits: 3 },
  { key: 'pivotX', label: '回転中心 X', digits: 2 },
  { key: 'pivotY', label: '回転中心 Y', digits: 2 },
  { key: 'opacity', label: 'Opacity', digits: 2 },
];

const LABELS: Record<FieldKey, string> = {
  x: '位置の変更',
  y: '位置の変更',
  rotation: '回転の変更',
  scaleX: '拡縮の変更',
  scaleY: '拡縮の変更',
  pivotX: 'ピボットの変更',
  pivotY: 'ピボットの変更',
  opacity: '不透明度の変更',
};

export function fieldValue(part: Part, key: FieldKey): number {
  switch (key) {
    case 'x':
      return part.position.x;
    case 'y':
      return part.position.y;
    case 'rotation':
      return part.rotation;
    case 'scaleX':
      return part.scale.x;
    case 'scaleY':
      return part.scale.y;
    case 'pivotX':
      return part.pivot.x;
    case 'pivotY':
      return part.pivot.y;
    case 'opacity':
      return part.opacity;
  }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function fieldPatch(part: Part, key: FieldKey, value: number): Partial<Part> {
  switch (key) {
    case 'x':
      return { position: { x: value, y: part.position.y } };
    case 'y':
      return { position: { x: part.position.x, y: value } };
    case 'rotation':
      return { rotation: value };
    case 'scaleX':
      return { scale: { x: value, y: part.scale.y } };
    case 'scaleY':
      return { scale: { x: part.scale.x, y: value } };
    case 'pivotX':
      return { pivot: { x: value, y: part.pivot.y } };
    case 'pivotY':
      return { pivot: { x: part.pivot.x, y: value } };
    case 'opacity':
      return { opacity: clamp(value, 0, 1) };
  }
}

// 入れられない値（拡縮の 0 など）は false
export function acceptsValue(key: FieldKey, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (key === 'scaleX' || key === 'scaleY') return value !== 0;
  return true;
}

// 選んだパーツすべてに同じ値を入れる（1回の Undo）
export function setField(store: ProjectStore, partIds: string[], key: FieldKey, value: number): void {
  store.transaction(LABELS[key], (dispatch) => {
    for (const id of partIds) {
      const part = store.get().model.parts.find((p) => p.id === id);
      if (part && !Object.is(fieldValue(part, key), value))
        dispatch(patchPart(LABELS[key], id, fieldPatch(part, key, value)));
    }
  });
}

export function depthCommand(project: Project, partIds: string[], depth: number): Command | null {
  const value = clamp(depth, -1, 1);
  const ids = partIds.filter((id) => project.model.parts.some((p) => p.id === id && p.depth !== value));
  if (ids.length === 0) return null;
  const commands = ids.map((id) => patchPart('前後の位置', id, { depth: value }));
  return { label: '前後の位置', apply: (p) => commands.reduce((acc, c) => c.apply(acc), p) };
}

export function formatNumber(value: number, digits: number): string {
  const s = Number(value.toFixed(digits)).toString();
  return s === '-0' ? '0' : s;
}

function NumberField(props: {
  label: string;
  value: number;
  digits: number;
  readOnly: boolean;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatNumber(props.value, props.digits);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const text = draft.trim();
    const value = Number(text);
    if (text !== '' && Number.isFinite(value) && value !== props.value) props.onCommit(value);
  };
  return (
    <label className="transform-field">
      <span className="transform-label">{props.label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        readOnly={props.readOnly}
        aria-readonly={props.readOnly}
        onChange={(e) => {
          if (!props.readOnly) setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </label>
  );
}

export function makeTransformPanel(slot: EnvSlot): FC {
  return function TransformPanel() {
    useBindEnv(slot);
    const project = useProject();
    const [editor] = useEditor();
    const { store } = useServices();
    const liveRef = useRef<LiveEdit | null>(null);

    const parts = editor.selectedPartIds
      .map((id) => project.model.parts.find((p) => p.id === id))
      .filter((p): p is Part => p !== undefined);
    const primary = parts[0];
    const ids = parts.map((p) => p.id);
    // プレビュー中（編集していないパラメータの値がデフォルト値でない）に変えると、見えている形と違うものを編集してしまう（キャンバスでも動かせない）
    const offBase = isPreviewOffBase(project.model, editor);
    const readOnly = editor.activeParameterIds.length > 0 || offBase;

    const onDepth = (value: number) => {
      if (readOnly) return;
      liveRef.current ??= beginLiveEdit(store, '前後の位置');
      liveRef.current.update((p) => depthCommand(p, ids, value));
    };
    // 1回のスライダー操作を1回の Undo にする
    const endDepth = () => {
      liveRef.current?.commit();
      liveRef.current = null;
    };

    return (
      <div className="transform-panel">
        {primary ? (
          <>
            <div className="transform-target">
              <span className="transform-name">{primary.name}</span>
              {parts.length > 1 && <span className="transform-more">ほか {parts.length - 1} 個（同じ値を入れる）</span>}
            </div>
            {readOnly && (
              <p className="transform-readonly" role="note">
                {offBase ? PREVIEW_OFF_BASE_NOTE : 'パラメータ編集中は画面上で操作'}
              </p>
            )}
            <div className="transform-grid">
              {FIELDS.map((f) => (
                <NumberField
                  key={`${primary.id}:${f.key}`}
                  label={f.label}
                  value={fieldValue(primary, f.key)}
                  digits={f.digits}
                  readOnly={readOnly}
                  onCommit={(v) => {
                    if (acceptsValue(f.key, v)) setField(store, ids, f.key, v);
                  }}
                />
              ))}
            </div>
            <div className="transform-depth">
              <span className="transform-label">前後の位置（手前〜奥）</span>
              <div className="transform-depth-row">
                <span className="transform-depth-end">手前</span>
                <input
                  type="range"
                  className="transform-depth-slider"
                  aria-label="前後の位置（手前〜奥）"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={primary.depth}
                  disabled={readOnly}
                  onChange={(e) => onDepth(Number(e.target.value))}
                  onPointerUp={endDepth}
                  onKeyUp={endDepth}
                  onBlur={endDepth}
                />
                <span className="transform-depth-end">奥</span>
              </div>
            </div>
          </>
        ) : (
          <p className="transform-empty">パーツを選ぶと、位置・回転・拡縮を数値で編集できる</p>
        )}
        <PanelSections panelId="transform" />
      </div>
    );
  };
}
