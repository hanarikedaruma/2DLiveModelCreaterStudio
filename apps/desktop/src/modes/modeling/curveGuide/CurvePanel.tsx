import { useEffect, useState, type FC } from 'react';
import { curveMeshSignature } from '@app/core';
import { useCanvas, useDialogs, useEditor, useProject, useServices } from '../../../shell/api';
import { useShell } from '../../../shell/context';
import { useBindEnv, type EnvSlot } from '../canvas/env';
import { isLockedDeep } from '../canvas/parts';
import { meshTarget } from '../mesh/meshTool';
import { activeParams, isBaseState, isPreviewOffBase } from '../../../services/keyEditor/common';
import {
  DEFAULT_FLOW_DYNAMICS,
  curveBakeEditor,
  dynamicsGuideCommand,
  editableGuide,
  gravityGuideCommand,
  guideOfPart,
  patchGuideCommand,
  removeGuideCommand,
} from './commands';
import { startFlowPreview, stopFlowPreview } from './preview';
import { CURVE_TOOL_ID, type CurveEditor } from './curveTool';
import { ShoulderPanel } from './ShoulderPanel';
import './curve.css';

export function makeCurvePanel(slot: EnvSlot, curveEditor: CurveEditor): FC {
  return function CurvePanel() {
    useBindEnv(slot);
    const project = useProject();
    const [editor] = useEditor();
    const { store } = useServices();
    const { canvas } = useShell();
    const services = useServices();
    const dialogs = useDialogs();
    const { activeToolId, setActiveTool, motionPreview } = useCanvas();
    const [draft, setDraft] = useState<{ strength?: number; damping?: number }>({});
    const target = meshTarget(project.model, editor.selectedPartIds);
    const guide = target ? guideOfPart(project.model, target.part.id) : undefined;
    const canDraw =
      !!target?.mesh &&
      !motionPreview &&
      !!curveEditor.snapshot()?.raw &&
      !isLockedDeep(project.model, target.part.id) &&
      !project.model.parts.some((p) => p.parentId === target.part.id);
    const editable = !!guide && !motionPreview && editableGuide(project.model, guide);
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
    useEffect(() => setDraft({}), [project, target?.part.id]);
    const gravity = (on: boolean) => {
      if (!guide || !editable) return;
      store.dispatch(gravityGuideCommand(guide.id, on));
    };
    const enabled = (on: boolean) => {
      if (!guide || !editable) return;
      store.dispatch(patchGuideCommand(guide.id, { enabled: on }));
    };
    const dynamics = guide?.dynamics ?? DEFAULT_FLOW_DYNAMICS;
    const commit = () => {
      if (guide && Object.keys(draft).length) store.dispatch(dynamicsGuideCommand(guide.id, draft));
      setDraft({});
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
                <label className="curve-check">
                  <input
                    type="checkbox"
                    checked={dynamics.enabled}
                    disabled={(!editable && !dynamics.enabled) || isLockedDeep(project.model, guide.partId)}
                    onChange={(e) =>
                      store.dispatch(dynamicsGuideCommand(guide.id, { enabled: e.currentTarget.checked }))
                    }
                  />
                  流れ線で揺らす
                </label>
                {dynamics.enabled && (!guide.enabled || !guide.gravity || stale) && (
                  <p className="curve-warning" role="status">
                    {stale
                      ? 'メッシュの形が変わりました。流れ線を描き直してください。'
                      : !guide.enabled
                        ? '流れ線の変形がOFFのため、流れ揺れは停止しています。'
                        : '「重力に沿わせる」をONにすると、流れ揺れが動きます。'}
                  </p>
                )}
                <label className="curve-field">
                  揺れの形
                  <select
                    aria-label="流れ揺れのプリセット"
                    value={dynamics.preset}
                    disabled={!editable}
                    onChange={(e) =>
                      store.dispatch(
                        dynamicsGuideCommand(guide.id, { preset: e.currentTarget.value as typeof dynamics.preset }),
                      )
                    }
                  >
                    <option value="soft">柔らかめ</option>
                    <option value="normal">標準</option>
                    <option value="firm">硬め</option>
                  </select>
                </label>
                {(['strength', 'damping'] as const).map((key) => (
                  <label className="curve-field" key={key}>
                    {key === 'strength' ? '揺れの大きさ' : '収まりの速さ'}{' '}
                    <output>{Math.round((draft[key] ?? dynamics[key]) * 100)}%</output>
                    <input
                      type="range"
                      aria-label={key === 'strength' ? '流れ揺れの大きさ' : '流れ揺れの収まりの速さ'}
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round((draft[key] ?? dynamics[key]) * 100)}
                      disabled={!editable}
                      onChange={(e) => {
                        const value = Number(e.currentTarget.value) / 100;
                        setDraft((old) => ({ ...old, [key]: value }));
                      }}
                      onPointerUp={commit}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setDraft({});
                        }
                      }}
                      onKeyUp={commit}
                      onBlur={commit}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  disabled={
                    !motionPreview &&
                    (!editable || !guide.enabled || !guide.gravity || (!dynamics.enabled && !guide.collision?.enabled))
                  }
                  onClick={() => {
                    if (motionPreview) stopFlowPreview(canvas);
                    else if (!startFlowPreview(services, canvas, guide.partId))
                      dialogs.notify(
                        '頭や体の姿勢キーを作ってから試してください。パラメータを手動で動かして形を確認することもできます。',
                      );
                  }}
                >
                  {motionPreview ? '動きを止める' : '動きを試す'}
                </button>
                <p className="curve-hint">
                  線を作っただけでは揺れません。軸揺れと併用できます。試す間は頭の姿勢キーを動かし、止めると編集用の形に戻ります。
                </p>
                <ShoulderPanel guide={guide} curveEditor={curveEditor} editable={editable} />
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
                      isPreviewOffBase(project.model, curveBakeEditor(project, editor, guide.partId))
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
