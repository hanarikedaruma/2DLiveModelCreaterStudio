import { useEffect, type FC } from 'react';
import { curveMeshSignature } from '@app/core';
import { useCanvas, useDialogs, useEditor, useProject, useServices } from '../../../shell/api';
import { useBindEnv, type EnvSlot } from '../canvas/env';
import { isLockedDeep } from '../canvas/parts';
import { meshTarget } from '../mesh/meshTool';
import { activeParams, isBaseState, isPreviewOffBase } from '../../../services/keyEditor/common';
import { physicsOfPart } from '../physics/commands';
import { editableGuide, gravityGuideCommand, guideOfPart, patchGuideCommand, removeGuideCommand } from './commands';
import { CURVE_TOOL_ID, type CurveEditor } from './curveTool';
import './curve.css';

export function makeCurvePanel(slot: EnvSlot, curveEditor: CurveEditor): FC {
  return function CurvePanel() {
    useBindEnv(slot);
    const project = useProject();
    const [editor] = useEditor();
    const { store } = useServices();
    const dialogs = useDialogs();
    const { activeToolId, setActiveTool } = useCanvas();
    const target = meshTarget(project.model, editor.selectedPartIds);
    const guide = target ? guideOfPart(project.model, target.part.id) : undefined;
    const canDraw =
      !!target?.mesh &&
      !!curveEditor.snapshot()?.raw &&
      !isLockedDeep(project.model, target.part.id) &&
      !project.model.parts.some((p) => p.parentId === target.part.id);
    const editable = !!guide && editableGuide(project.model, guide);
    const stale = !!guide && !!target?.mesh && guide.meshSignature !== curveMeshSignature(target.mesh);
    const limited = curveEditor.snapshot()?.evaluated?.result.status === 'limited';
    useEffect(() => {
      curveEditor.clear();
    }, [project.id, target?.part.id]);
    useEffect(() => () => curveEditor.clear(), []);
    useEffect(() => {
      if (activeToolId !== CURVE_TOOL_ID) curveEditor.clear();
    }, [activeToolId]);
    const activate = () => {
      setActiveTool(CURVE_TOOL_ID);
      curveEditor.drawNew();
    };
    const gravity = async (on: boolean) => {
      if (!guide || !editable) return;
      const before = store.get();
      if (on && physicsOfPart(before, guide.partId)) {
        const ok = await dialogs.confirm(
          'この髪の既存の揺れを解除し、流れ線の重力に切り替えますか？（Undoで戻せます）',
        );
        if (!ok || store.get() !== before) return;
      }
      store.dispatch(gravityGuideCommand(guide.id, on));
    };
    const enabled = async (on: boolean) => {
      if (!guide || !editable) return;
      const before = store.get();
      if (on && guide.gravity && physicsOfPart(before, guide.partId)) {
        const ok = await dialogs.confirm(
          'この髪の既存の揺れを解除し、流れ線の重力に切り替えますか？（Undoで戻せます）',
        );
        if (!ok || store.get() !== before) return;
      }
      store.dispatch(patchGuideCommand(guide.id, { enabled: on }));
    };
    return (
      <div className="curve-panel">
        {!target ? (
          <p className="curve-hint">髪などの画像パーツを選んで、流れ線を一本描いてください。</p>
        ) : (
          <>
            <div className="curve-target">{target.part.name}</div>
            {!target.mesh && <p className="curve-hint">先にメッシュを自動生成してください。</p>}
            {target.mesh && !canDraw && (
              <p className="curve-hint">表示とロックを確認してください。子パーツを持つ画像は対象にできません。</p>
            )}
            <button type="button" disabled={!canDraw} onClick={activate}>
              {guide ? '流れ線を描き直す' : '流れ線を描く'}
            </button>
            {guide && (
              <>
                {stale && (
                  <p className="curve-warning" role="status">
                    メッシュの形や対応が変わりました。流れ線を描き直してください。
                  </p>
                )}
                {limited && (
                  <p className="curve-warning" role="status">
                    メッシュの折れやつぶれを避けるため、曲げる量を抑えています。影響幅を広げるか、曲がりを小さくしてください。
                  </p>
                )}
                <label className="curve-check">
                  <input
                    type="checkbox"
                    checked={guide.enabled}
                    disabled={!editable}
                    onChange={(e) => void enabled(e.currentTarget.checked)}
                  />
                  流れ線の変形を使う
                </label>
                <label className="curve-check">
                  <input
                    type="checkbox"
                    checked={guide.gravity}
                    disabled={!editable}
                    onChange={(e) => void gravity(e.currentTarget.checked)}
                  />
                  重力に沿わせる
                </label>
                <label className="curve-field">
                  頭について回る区間 <output>{Math.round(guide.rootFraction * 100)}%</output>
                  <input
                    type="range"
                    aria-label="頭について回る区間"
                    min="0"
                    max="50"
                    step="1"
                    value={Math.round(guide.rootFraction * 100)}
                    disabled={!editable}
                    onPointerDown={curveEditor.beginOptions}
                    onKeyDown={curveEditor.beginOptions}
                    onChange={(e) => curveEditor.setOption({ rootFraction: Number(e.currentTarget.value) / 100 })}
                    onPointerUp={curveEditor.endOptions}
                    onKeyUp={curveEditor.endOptions}
                    onBlur={curveEditor.endOptions}
                  />
                </label>
                <label className="curve-field">
                  影響幅 <output>{Math.round(guide.radius)}px</output>
                  <input
                    type="range"
                    aria-label="流れ線の影響幅"
                    min="1"
                    max={Math.max(
                      100,
                      Math.ceil(guide.radius),
                      Math.ceil(
                        Math.hypot(
                          guide.reference[2].x - guide.reference[0].x,
                          guide.reference[2].y - guide.reference[0].y,
                        ),
                      ),
                    )}
                    step="1"
                    value={guide.radius}
                    disabled={!editable}
                    onPointerDown={curveEditor.beginOptions}
                    onKeyDown={curveEditor.beginOptions}
                    onChange={(e) => curveEditor.setOption({ radius: Number(e.currentTarget.value) })}
                    onPointerUp={curveEditor.endOptions}
                    onKeyUp={curveEditor.endOptions}
                    onBlur={curveEditor.endOptions}
                  />
                </label>
                <div className="curve-actions">
                  <button
                    type="button"
                    disabled={
                      !editable ||
                      !guide.enabled ||
                      isBaseState(activeParams(project.model, editor)) ||
                      isPreviewOffBase(project.model, editor)
                    }
                    onClick={() => void curveEditor.bake()}
                  >
                    現在のキーに形を記録
                  </button>
                  <button
                    type="button"
                    disabled={!canDraw}
                    onClick={() => {
                      curveEditor.clear();
                      store.dispatch(removeGuideCommand(guide.id));
                    }}
                  >
                    流れ線を削除
                  </button>
                </div>
                <p className="curve-hint">
                  線の設定は全姿勢に共通です。角度ごとのキーへ記録すると、この線の常時変形は解除されます。
                </p>
              </>
            )}
          </>
        )}
        {activeToolId === CURVE_TOOL_ID ? (
          <p className="curve-hint">
            根元から毛先へドラッグ（2回クリックでも可）。中間・毛先の点を動かすと周囲が滑らかに曲がります。Escで取消。根元は頭に追従します。
          </p>
        ) : (
          <button type="button" disabled={!canDraw} onClick={() => setActiveTool(CURVE_TOOL_ID)}>
            線で曲げるツールにする
          </button>
        )}
      </div>
    );
  };
}
