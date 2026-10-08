// 「閉じた目の線」のパレット（カード42）。目のパーツを選んでいる間（となぞっている間）だけ出るパーツのパレット。
// 選んだ目の側の線の有無を出し、[閉じた目の線をなぞる] でなぞるツールに切り替え、[消す] で消す。
// なぞり終えたら元のツールに戻す。表示中のあいだ、ツールに services とダイアログを渡す
import { useEffect, useRef, useSyncExternalStore, type FC } from 'react';
import { useCanvas, useDialogs, useDispatch, useEditor, useProject, useServices } from '../../../shell/api';
import { runAutoSetup } from '../assets/actions';
import { useBindEnv, type EnvSlot } from '../canvas/env';
import { EYE_SIDES, SCREEN_SIDE, closedLineOf, selectedEyeSides, setClosedLine, type EyeSide } from './closedLine';
import { CLOSED_LINE_TOOL_ID, tracingHint, type ClosedLineTool } from './closedLineTool';
import './setupTools.css';

export function makeClosedLinePanel(slot: EnvSlot, closedLine: ClosedLineTool): FC {
  return function ClosedLinePanel() {
    useBindEnv(slot);
    const services = useServices();
    const project = useProject();
    const [editor] = useEditor();
    const dispatch = useDispatch();
    const { notify } = useDialogs();
    const { activeToolId, setActiveTool, requestRedraw } = useCanvas();
    const side = useSyncExternalStore(closedLine.side.subscribe, closedLine.side.get);
    const active = activeToolId === CLOSED_LINE_TOOL_ID;
    // なぞる前のツール。なぞり終えたら・やめたらそこへ戻る（'' は既定のツール）
    const previousTool = useRef('');

    useEffect(() => {
      closedLine.setFinish(() => {
        setActiveTool(previousTool.current);
        requestRedraw();
      });
      return () => closedLine.setFinish(null);
    }, [setActiveTool, requestRedraw]);

    // 選んでいる目の側。なぞっている間は、なぞる側も出す
    const selected = selectedEyeSides(project.model, editor.selectedPartIds);
    const sides = EYE_SIDES.filter((s) => selected.includes(s) || (active && s === side));

    const trace = (s: EyeSide) => {
      if (!active) previousTool.current = activeToolId;
      closedLine.side.set(s);
      setActiveTool(CLOSED_LINE_TOOL_ID);
      requestRedraw();
    };
    const stop = () => {
      setActiveTool(previousTool.current);
      requestRedraw();
    };
    const clear = (s: EyeSide) => {
      dispatch(setClosedLine(s, null));
      requestRedraw();
    };

    return (
      <div className="closed-line-panel">
        <ul className="closed-line-list">
          {sides.map((s) => {
            const line = closedLineOf(project.model, s);
            const tracing = active && side === s;
            return (
              <li key={s} className={tracing ? 'closed-line-row tracing' : 'closed-line-row'} data-side={s}>
                <span className="closed-line-name">
                  目 {s}（画面の{SCREEN_SIDE[s]}）
                </span>
                <span className="closed-line-state" data-testid={`closed-line-state-${s}`}>
                  {line && line.length > 0 ? `線あり（点 ${line.length}）` : '線なし'}
                </span>
                <span className="closed-line-buttons">
                  <button
                    type="button"
                    aria-pressed={tracing}
                    aria-label={`目 ${s} の線をなぞる`}
                    onClick={() => trace(s)}
                  >
                    {line ? 'なぞり直す' : '閉じた目の線をなぞる'}
                  </button>
                  <button type="button" aria-label={`目 ${s} の線を消す`} disabled={!line} onClick={() => clear(s)}>
                    消す
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        {active && (
          <div className="closed-line-now">
            <p className="closed-line-hint">キャンバスで{tracingHint(side)}</p>
            <button type="button" onClick={stop}>
              やめる
            </button>
          </div>
        )}
        <div className="closed-line-apply">
          <button type="button" onClick={() => runAutoSetup(services, notify)}>
            かんたんセットアップで反映
          </button>
          <p className="closed-line-hint">標準パーツの割り当ての［かんたんセットアップ］と同じ。上まぶたと白目が要る</p>
        </div>
      </div>
    );
  };
}
