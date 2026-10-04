// 「閉じた目の線」のパネル（カード42）。目ごとに線の有無を出し、[なぞる] でキャンバスのツールに切り替え、[消す] で消す。
// 表示中のあいだ、ツールに services とダイアログを渡す
import { useSyncExternalStore, type FC } from 'react';
import { useCanvas, useDispatch, useProject } from '../../../shell/api';
import { useBindEnv, type EnvSlot } from '../canvas/env';
import { EYE_SIDES, closedLineOf, setClosedLine, type EyeSide } from './closedLine';
import { CLOSED_LINE_TOOL_ID, type ClosedLineTool } from './closedLineTool';
import './setupTools.css';

// L / R はキャラクターから見た左右。画面では L が右側に描かれる
const SCREEN_SIDE: Record<EyeSide, string> = { L: '右', R: '左' };

export function makeClosedLinePanel(slot: EnvSlot, closedLine: ClosedLineTool): FC {
  return function ClosedLinePanel() {
    useBindEnv(slot);
    const project = useProject();
    const dispatch = useDispatch();
    const { activeToolId, setActiveTool, requestRedraw } = useCanvas();
    const side = useSyncExternalStore(closedLine.side.subscribe, closedLine.side.get);
    const active = activeToolId === CLOSED_LINE_TOOL_ID;

    const trace = (s: EyeSide) => {
      closedLine.side.set(s);
      setActiveTool(CLOSED_LINE_TOOL_ID);
      requestRedraw();
    };
    const clear = (s: EyeSide) => {
      dispatch(setClosedLine(s, null));
      requestRedraw();
    };

    return (
      <div className="closed-line-panel">
        <p className="closed-line-hint">
          目を閉じたときのまつげの線を、左右の目それぞれ1本なぞる。まばたきで上まぶたと白目がこの線に沿って閉じる
        </p>
        <ul className="closed-line-list">
          {EYE_SIDES.map((s) => {
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
                    {line ? 'なぞり直す' : 'なぞる'}
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
          <p className="closed-line-hint closed-line-now">
            キャンバスで目 {side} の閉じた線を、目の端から端までドラッグでなぞる（Esc でやめる）
          </p>
        )}
        <p className="closed-line-hint">
          引いたあと「標準パーツの割り当て」の [かんたんセットアップ] をもう一度押すと反映される（上まぶたと白目が要る）
        </p>
      </div>
    );
  };
}
