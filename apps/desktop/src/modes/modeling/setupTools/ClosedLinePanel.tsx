import { useEffect, useRef, useState, useSyncExternalStore, type FC } from 'react';
import type { BlinkImages } from '@app/contracts';
import { BLINK_LABEL, blinkBlockReason, suggestClosedEyeLine } from '@app/core';
import { useCanvas, useDialogs, useDispatch, useEditor, useProject, useServices } from '../../../shell/api';
import { useBindEnv, type EnvSlot } from '../canvas/env';
import { EYE_SIDES, SCREEN_SIDE, closedLineOf, selectedEyeSides, setClosedLine, type EyeSide } from './closedLine';
import { CLOSED_LINE_TOOL_ID, tracingHint, type ClosedLineTool } from './closedLineTool';
import './setupTools.css';

export const REPLACE_BLINK_MESSAGE =
  'この目の手修正・ロック済みの目の開閉キー、または笑顔との組み合わせキーを置き換えます。続けますか？（1回のUndoで戻せます）';

export function makeClosedLinePanel(slot: EnvSlot, closedLine: ClosedLineTool): FC {
  return function ClosedLinePanel() {
    useBindEnv(slot);
    const services = useServices(),
      project = useProject();
    const [editor, setEditor] = useEditor(),
      dispatch = useDispatch();
    const { notify, confirm } = useDialogs();
    const { activeToolId, setActiveTool, requestRedraw } = useCanvas();
    const side = useSyncExternalStore(closedLine.side.subscribe, closedLine.side.get);
    const active = activeToolId === CLOSED_LINE_TOOL_ID;
    const previousTool = useRef('');
    const [busy, setBusy] = useState(false);
    const [reasons, setReasons] = useState<Partial<Record<EyeSide, string>>>({});
    useEffect(() => {
      closedLine.setFinish(() => {
        setActiveTool(previousTool.current);
        requestRedraw();
      });
      return () => closedLine.setFinish(null);
    }, [setActiveTool, requestRedraw]);
    const selected = selectedEyeSides(project.model, editor.selectedPartIds);
    const sides = EYE_SIDES.filter((s) => selected.includes(s) || (active && s === side));
    const images = (): BlinkImages =>
      Object.fromEntries(
        services.store.get().assets.flatMap((a) => {
          const image = services.assets.getImageData(a.id);
          return image ? [[a.id, image]] : [];
        }),
      );
    const trace = (s: EyeSide, editing = false) => {
      if (!active) previousTool.current = activeToolId;
      closedLine.side.set(s);
      closedLine.setEditing(editing);
      setActiveTool(CLOSED_LINE_TOOL_ID);
      setReasons({});
      requestRedraw();
    };
    const stop = () => {
      setActiveTool(previousTool.current);
      requestRedraw();
    };
    const propose = (s: EyeSide) => {
      const line = suggestClosedEyeLine(services.store.get(), s, images());
      if (!line) {
        setReasons((r) => ({ ...r, [s]: '白目の輪郭を読み取れません。メッシュと素材を確認してください。' }));
        return;
      }
      dispatch(setClosedLine(s, line));
      setReasons({});
      requestRedraw();
    };
    const apply = async (s: EyeSide) => {
      if (busy) return;
      setBusy(true);
      try {
        for (;;) {
          const snapshot = services.store.get();
          const plan = services.autoSetup.blink(snapshot, s, images());
          if (!plan.command) {
            setReasons((r) => ({ ...r, [s]: plan.reason! }));
            return;
          }
          if (plan.replacesCustom && !(await confirm(REPLACE_BLINK_MESSAGE))) return;
          if (services.store.get() !== snapshot) continue;
          services.store.dispatch(plan.command);
          setReasons({});
          notify(`目 ${s} のまばたきを作りました。閉じ具合を動かして確認できます。`);
          requestRedraw();
          return;
        }
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="closed-line-panel">
        <p className="closed-line-hint">線は、閉じたときのまぶたの下の端です。絵について動きます。</p>
        <ul className="closed-line-list">
          {sides.map((s) => {
            const line = closedLineOf(project.model, s),
              tracing = active && side === s;
            const block = blinkBlockReason(project, s),
              reason = block ?? reasons[s];
            const open = `EyeOpen${s}`,
              value =
                editor.editorParamValues[open] ?? project.model.parameters.find((p) => p.id === open)?.default ?? 1;
            return (
              <li key={s} className={tracing ? 'closed-line-row tracing' : 'closed-line-row'} data-side={s}>
                <span className="closed-line-name">
                  目 {s}（画面の{SCREEN_SIDE[s]}）
                </span>
                <span className="closed-line-state" data-testid={`closed-line-state-${s}`}>
                  {line ? `線あり（点 ${line.points.length}）` : '線なし'}
                </span>
                <span className="closed-line-buttons">
                  <button
                    type="button"
                    disabled={busy || !!block}
                    aria-label={`目 ${s} の線の案を作る`}
                    onClick={() => propose(s)}
                  >
                    線の案を作る
                  </button>
                  <button
                    type="button"
                    disabled={busy || !!block}
                    aria-pressed={tracing}
                    aria-label={`目 ${s} の線をなぞる`}
                    onClick={() => trace(s)}
                  >
                    {line ? 'なぞり直す' : '閉じた目の線をなぞる'}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !line}
                    aria-label={`目 ${s} の線の点を動かす`}
                    onClick={() => trace(s, true)}
                  >
                    点を動かす
                  </button>
                  <button
                    type="button"
                    disabled={busy || !line}
                    aria-label={`目 ${s} の線を消す`}
                    onClick={() => {
                      dispatch(setClosedLine(s, null));
                      setReasons({});
                      requestRedraw();
                    }}
                  >
                    消す
                  </button>
                </span>
                <label className="closed-line-preview">
                  閉じ具合
                  <input
                    type="range"
                    aria-label={`目 ${s} の閉じ具合`}
                    min="0"
                    max="1"
                    step="0.05"
                    value={1 - value}
                    onChange={(e) => {
                      setEditor({
                        editorParamValues: { ...editor.editorParamValues, [open]: 1 - Number(e.target.value) },
                      });
                      requestRedraw();
                    }}
                  />
                  <output>{Math.round((1 - value) * 100)}%</output>
                </label>
                <button
                  type="button"
                  aria-label={`目 ${s} のまばたきを作る`}
                  disabled={busy || !line || !!block}
                  onClick={() => {
                    void apply(s);
                  }}
                >
                  {BLINK_LABEL}
                </button>
                {reason && (
                  <p className="closed-line-reason" role="status">
                    {reason}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {active && (
          <div className="closed-line-now">
            <p className="closed-line-hint">
              キャンバスで{closedLine.isEditing() ? '線の点をドラッグして直す（Escで終了）' : tracingHint(side)}
            </p>
            <button type="button" onClick={stop}>
              やめる
            </button>
          </div>
        )}
      </div>
    );
  };
}
