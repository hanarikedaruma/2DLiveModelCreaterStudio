import { useEffect, useState } from 'react';
import type { CurveGuide } from '@app/schema';
import { shoulderHostReason } from '@app/core';
import { useCanvas, useProject, useServices } from '../../../shell/api';
import { isLockedDeep } from '../canvas/parts';
import {
  collisionGuideCommand,
  DEFAULT_HAIR_COLLISION,
  editableCollider,
  patchColliderCommand,
  removeColliderCommand,
} from './collisionCommands';
import type { CurveEditor } from './curveTool';

export function ShoulderPanel({
  guide,
  curveEditor,
  editable,
}: {
  guide: CurveGuide;
  curveEditor: CurveEditor;
  editable: boolean;
}) {
  const project = useProject(),
    { store } = useServices();
  const { motionPreview } = useCanvas();
  const [host, setHost] = useState(''),
    [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<{ radius?: number; thickness?: number; name?: string }>({});
  useEffect(() => {
    setDraft({});
  }, [project, selected]);
  useEffect(() => {
    setSelected('');
    setHost('');
  }, [guide.id]);
  const collision = guide.collision ?? DEFAULT_HAIR_COLLISION;
  const colliders = project.model.shoulderColliders ?? [];
  const collider = colliders.find((c) => c.id === selected);
  const hosts = project.model.parts.filter(
    (p) => p.id !== guide.partId && !shoulderHostReason(project, p.id) && !isLockedDeep(project.model, p.id),
  );
  const hostId = hosts.some((p) => p.id === host) ? host : (hosts[0]?.id ?? '');
  const disabled = !editable || !!motionPreview;
  const commit = () => {
    if (draft.thickness !== undefined) store.dispatch(collisionGuideCommand(guide.id, { thickness: draft.thickness }));
    if (collider && (draft.name !== undefined || draft.radius !== undefined))
      store.dispatch(
        patchColliderCommand(collider.id, {
          ...(draft.name !== undefined ? { name: draft.name } : {}),
          ...(draft.radius !== undefined ? { radius: draft.radius } : {}),
        }),
      );
    setDraft({});
  };
  const cancel = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setDraft({});
    }
  };
  const result = curveEditor.snapshot()?.evaluated?.result.collision;
  return (
    <fieldset className="curve-shoulders">
      <legend>肩との接触</legend>
      <label className="curve-check">
        <input
          type="checkbox"
          checked={collision.enabled}
          disabled={(disabled && !collision.enabled) || isLockedDeep(project.model, guide.partId)}
          onChange={(e) => store.dispatch(collisionGuideCommand(guide.id, { enabled: e.currentTarget.checked }))}
        />
        肩に当てる（衝突判定）
      </label>
      <p className="curve-hint">
        髪ごとにON/OFFできます。流れ揺れがOFFでも使えます。体や服の肩の縁へ線を描いてください。
      </p>
      {result?.reason && (
        <p role="status" className="curve-warning">
          {result.reason}
        </p>
      )}
      {result?.diagnostics?.map((d) => (
        <p role="status" className="curve-warning" key={d.colliderId}>
          {colliders.find((c) => c.id === d.colliderId)?.name ?? '肩の線'}：{d.reason}
        </p>
      ))}
      <label className="curve-field">
        肩の取付先
        <select
          aria-label="肩の取付先"
          value={hostId}
          disabled={disabled}
          onChange={(e) => setHost(e.currentTarget.value)}
        >
          {!hosts.length && <option value="">メッシュのある体・服を用意してください</option>}
          {hosts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={disabled || !hostId}
        onClick={() => {
          curveEditor.clear();
          setSelected('');
          curveEditor.shoulder.draw(hostId, guide.id);
        }}
      >
        肩の線を追加
      </button>
      {colliders.map((c) => (
        <div key={c.id} className="curve-actions">
          <label className="curve-check">
            <input
              type="checkbox"
              aria-label={`${c.name}に当てる`}
              checked={collision.colliderIds.includes(c.id)}
              disabled={disabled || c.partId === guide.partId}
              onChange={(e) =>
                store.dispatch(
                  collisionGuideCommand(guide.id, {
                    colliderIds: e.currentTarget.checked
                      ? [...collision.colliderIds, c.id]
                      : collision.colliderIds.filter((id) => id !== c.id),
                  }),
                )
              }
            />
            {c.name}
          </label>
          <button
            type="button"
            disabled={!!motionPreview}
            onClick={() => {
              curveEditor.clear();
              setSelected(c.id);
              curveEditor.shoulder.select(c.id);
            }}
            aria-label={`${c.name}を編集`}
          >
            編集
          </button>
        </div>
      ))}
      <label className="curve-field">
        髪の太さの倍率 <output>{(draft.thickness ?? collision.thickness).toFixed(2)}</output>
        <input
          aria-label="衝突する髪の太さの倍率"
          type="range"
          min="0.5"
          max="2"
          step="0.05"
          value={draft.thickness ?? collision.thickness}
          disabled={disabled}
          onChange={(e) => setDraft({ thickness: Number(e.currentTarget.value) })}
          onPointerUp={commit}
          onKeyDown={cancel}
          onKeyUp={commit}
          onBlur={commit}
        />
      </label>
      {collider && (
        <>
          <label className="curve-field">
            肩の線の名前
            <input
              aria-label="肩の線の名前"
              value={draft.name ?? collider.name}
              disabled={!!motionPreview || isLockedDeep(project.model, collider.partId)}
              onChange={(e) => setDraft({ name: e.currentTarget.value })}
              onKeyDown={(e) => {
                cancel(e);
                if (e.key === 'Enter') commit();
              }}
              onBlur={commit}
            />
          </label>
          <label className="curve-field">
            肩の帯の太さ <output>{Math.round(draft.radius ?? collider.radius)}px</output>
            <input
              type="range"
              aria-label="肩の帯の太さ"
              min="1"
              max={Math.max(100, collider.radius)}
              value={draft.radius ?? collider.radius}
              disabled={!!motionPreview || isLockedDeep(project.model, collider.partId)}
              onChange={(e) => setDraft({ radius: Number(e.currentTarget.value) })}
              onPointerUp={commit}
              onKeyDown={cancel}
              onKeyUp={commit}
              onBlur={commit}
            />
          </label>
          <label className="curve-check">
            <input
              type="checkbox"
              checked={collider.enabled}
              disabled={!!motionPreview || isLockedDeep(project.model, collider.partId)}
              onChange={(e) => store.dispatch(patchColliderCommand(collider.id, { enabled: e.currentTarget.checked }))}
            />
            この肩の線を使う
          </label>
          <p className="curve-hint">
            点をドラッグして肩の縁に合わせます。Escで取消。線を削除すると、ほかの髪からの指定も外れます。
          </p>
          {!editableCollider(project.model, collider) && (
            <p className="curve-warning">
              取付先やメッシュを確認してください。対応が変わった場合は線を描き直してください。
            </p>
          )}
          <div className="curve-actions">
            <button
              type="button"
              disabled={
                disabled ||
                !!shoulderHostReason(project, collider.partId) ||
                isLockedDeep(project.model, collider.partId)
              }
              onClick={() => {
                curveEditor.clear();
                curveEditor.shoulder.draw(collider.partId, guide.id, collider.id);
              }}
            >
              肩の線を描き直す
            </button>
            <button
              type="button"
              disabled={!!motionPreview || isLockedDeep(project.model, collider.partId)}
              onClick={() => {
                curveEditor.clear();
                store.dispatch(removeColliderCommand(collider.id));
                setSelected('');
              }}
            >
              肩の線を削除
            </button>
            <button
              type="button"
              onClick={() => {
                curveEditor.clear();
                setSelected('');
              }}
            >
              髪の線へ戻る
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}
