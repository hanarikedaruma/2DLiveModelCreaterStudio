// 輪郭線のパレット（輪郭線で整えるツールのときだけ出るツールのパレット。I-068）。
// 線の選択・［線を引く］・［消す］、影響幅、一緒に動かすパーツ、［線に沿って頂点を足す］、［線に合わせて整える］を出す
import { useEffect, useMemo, useState, useSyncExternalStore, type FC } from 'react';
import { CONTOUR_RADIUS_MAX, CONTOUR_RADIUS_MIN } from '@app/schema';
import { useEditor, useProject } from '../../../shell/api';
import { useBindEnv, type EnvSlot } from '../canvas/env';
import { meshTarget } from '../mesh/meshTool';
import { contourBlockReason, contourLinesOf } from './commands';
import { CONTOUR_PICK_PROMPT, type ContourEditor } from './contourTool';
import './contour.css';

const COARSE_SPACING = 10; // これより粗いと、線どおりの曲線にならない（試作: 6px で目標とのずれ 0.4px）

export function makeContourPanel(slot: EnvSlot, editor: ContourEditor): FC {
  return function ContourPanel() {
    useBindEnv(slot);
    const project = useProject();
    const [state] = useEditor();
    const tool = useSyncExternalStore(editor.state.subscribe, editor.state.get);
    const target = meshTarget(project.model, state.selectedPartIds);
    const part = target?.part ?? null;
    const mesh = target?.mesh ?? null;
    const reason = part ? contourBlockReason(project.model, part.id) : null;
    const lines = part ? contourLinesOf(project.model, part.id) : [];
    const current = lines.find((l) => l.id === tool.lineId) ?? lines[0] ?? null;
    // 別のプロジェクトを開いたら・パレットを閉じたら（ツールを替えたら）引きかけと選択をやめる
    useEffect(() => editor.clear(), [project.id]);
    useEffect(() => () => editor.clear(), []);
    // ツールに services を渡すのは描いた後（useBindEnv の effect）なので、渡し終えてから求める
    const [ready, setReady] = useState(false);
    useEffect(() => setReady(true), []);
    // 候補と頂点の間隔は、線・メッシュが変わったときだけ求め直す（キーのドラッグ中に毎回は求めない）
    const candidates = useMemo(
      () => (ready && current ? editor.candidates() : []),
      [ready, current?.id, current?.points, current?.radius, current?.withPartIds, mesh],
    );
    const spacing = useMemo(() => (ready && current ? editor.spacing() : null), [ready, current?.points, mesh]);

    return (
      <div className="contour-panel">
        {!part ? (
          <p className="contour-hint">{CONTOUR_PICK_PROMPT}</p>
        ) : (
          <>
            <div className="contour-target">
              対象: <span className="contour-name">{part.name}</span>
            </div>
            {reason && (
              <p className="contour-warning" role="status">
                {reason}
              </p>
            )}
            <label className="contour-field">
              線
              <select
                aria-label="輪郭線"
                value={current?.id ?? ''}
                disabled={lines.length === 0}
                onChange={(e) => editor.selectLine(e.currentTarget.value || null)}
              >
                {lines.length === 0 && <option value="">（まだ無い）</option>}
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}（点 {l.points.length}）
                  </option>
                ))}
              </select>
            </label>
            <div className="contour-actions">
              <button type="button" disabled={!!reason || tool.drawing} onClick={() => editor.drawNew()}>
                線を引く
              </button>
              <button type="button" disabled={!current || !!reason} onClick={() => editor.removeLine()}>
                消す
              </button>
            </div>
            {tool.drawing ? (
              <p className="contour-warning" role="status">
                輪郭をなぞる（ドラッグ）。点を順にクリックしてもよい（ダブルクリックか Enter で終わり、Esc でやめる）
              </p>
            ) : (
              !reason && (
                <p className="contour-hint">
                  点や線の無い所から輪郭をなぞると、新しい線を引く。点を順にクリックして引くときは［線を引く］
                </p>
              )
            )}
            {current && (
              <>
                <label className="contour-field">
                  影響幅 <output>{Math.round(current.radius)}px</output>
                  <input
                    type="range"
                    aria-label="輪郭線の影響幅"
                    min={CONTOUR_RADIUS_MIN}
                    max={Math.min(CONTOUR_RADIUS_MAX, Math.max(200, Math.ceil(current.radius)))}
                    step="1"
                    value={current.radius}
                    disabled={!!reason}
                    onPointerDown={() => editor.beginRadius()}
                    onKeyDown={() => editor.beginRadius()}
                    onChange={(e) => editor.setRadius(Number(e.currentTarget.value))}
                    onPointerUp={() => editor.endRadius()}
                    onKeyUp={() => editor.endRadius()}
                    onBlur={() => editor.endRadius()}
                  />
                </label>
                <fieldset className="contour-with">
                  <legend>一緒に動かすパーツ</legend>
                  {candidates.length === 0 ? (
                    <p className="contour-hint">影響幅にかかるほかの画像パーツは無い</p>
                  ) : (
                    candidates.map((p) => (
                      <label key={p.id} className="contour-check">
                        <input
                          type="checkbox"
                          checked={current.withPartIds.includes(p.id)}
                          disabled={!!reason}
                          onChange={(e) => editor.setWithPart(p.id, e.currentTarget.checked)}
                        />
                        {p.name}
                      </label>
                    ))
                  )}
                </fieldset>
                <div className="contour-actions">
                  <button type="button" disabled={!!reason} onClick={() => void editor.densify()}>
                    線に沿って頂点を足す
                  </button>
                </div>
                {spacing && (
                  <p className="contour-hint" data-testid="contour-spacing">
                    {spacing.count === 0
                      ? '線の上に頂点が無い。足すと、輪郭が線どおりの曲線になる'
                      : `線の上の頂点 ${spacing.count}（間隔 約 ${Math.round(spacing.spacing)}px）` +
                        (spacing.spacing > COARSE_SPACING ? '。粗いので、足すと輪郭が線どおりの曲線になる' : '')}
                  </p>
                )}
                <div className="contour-actions">
                  <button type="button" disabled={!!reason} onClick={() => void editor.smooth()}>
                    線に合わせて整える
                  </button>
                </div>
                <p className="contour-hint">
                  今のキー（基準状態なら基準の形）で、輪郭を線の点を通る滑らかな形にそろえる。点 {current.points.length}
                  ・選んだ点 {tool.handles.length}
                </p>
              </>
            )}
          </>
        )}
        <p className="contour-hint">
          点をドラッグして形を整える（Shift で選び足す、Alt
          で線の位置だけを直す。線の位置はすべてのキーで共通）。線をつまむと、そこに点を足して動かす。線のダブルクリックで点を足し、Delete
          で消す。右クリックで選択を外す
        </p>
      </div>
    );
  };
}
