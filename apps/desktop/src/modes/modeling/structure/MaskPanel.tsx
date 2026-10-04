// 「パーツの設定」パネル（right）。画像パーツを選んだときにマスクを設定する（マスク元は画像パーツのみ。自身と子孫は除く）。
// かんたん: マスク元を1つ選ぶドロップダウンと、複数のマスク元・反転を一時的に開く「詳細」。
// 詳細: マスク元を複数選べる一覧（チェック）と [反転]（カード33）。
// 下に <PanelSections panelId="partSettings" /> を置き、ほかのカードの設定を入れる
import type { Model, Part } from '@app/schema';
import type { Command } from '@app/contracts';
import { DetailDisclosure, PanelSections, useDispatch, useEditor, useProject } from '../../../shell/api';
import { useUiLevel } from '../../../shell/level';
import { setMask } from './commands';
import { maskSourceState, setMaskInverted, setMaskSource } from './maskCommands';
import './structure.css';

export const PART_SETTINGS_PANEL_ID = 'partSettings';

export const MASK_HINT = '複数選ぶと、どれかの範囲を表示します。反転すると、その外側を表示します';

// ドロップダウンで、マスク元が2つ以上のときに出す選べない項目の値
const MULTIPLE = '__multiple__';

export function MaskPanel() {
  const { model } = useProject();
  const [editor] = useEditor();
  const ids = editor.selectedPartIds;
  const part = ids.length === 1 ? model.parts.find((p) => p.id === ids[0]) : undefined;
  return (
    <div className="part-settings">
      {!part ? (
        <p className="am-dim">{ids.length > 1 ? '複数のパーツを選んでいる' : 'パーツを選ぶと設定が出る'}</p>
      ) : (
        <>
          <p className="part-settings-name">
            {part.name}
            <span className="am-dim">{part.kind === 'group' ? '（グループ）' : '（画像）'}</span>
          </p>
          {part.kind === 'image' && <MaskSettings model={model} part={part} />}
        </>
      )}
      <PanelSections panelId={PART_SETTINGS_PANEL_ID} />
    </div>
  );
}

function MaskSettings({ model, part }: { model: Model; part: Part }) {
  const dispatch = useDispatch();
  const [level] = useUiLevel();
  const { options, selected } = maskSourceState(model, part);
  const inverted = part.mask?.inverted ?? false;
  const value = selected.length === 0 ? '' : selected.length === 1 ? selected[0]!.id : MULTIPLE;
  return (
    <div className="mask-settings">
      {level === 'easy' && (
        <>
          <label className="mask-field">
            <span>マスク</span>
            <select
              aria-label="マスク"
              value={value}
              onChange={(e) => {
                if (e.target.value !== MULTIPLE) dispatch(setMask(part.id, e.target.value || null));
              }}
            >
              <option value="">なし</option>
              {selected.length > 1 && (
                <option value={MULTIPLE} disabled>
                  {`複数（${selected.length}個）`}
                </option>
              )}
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {inverted && selected.length > 0 && <p className="mask-note">反転している（範囲の外を表示）</p>}
        </>
      )}
      <DetailDisclosure label="複数のマスク元・反転">
        <MaskSourceEditor part={part} options={options} selected={selected} dispatch={dispatch} />
      </DetailDisclosure>
    </div>
  );
}

// マスク元を複数選べる一覧（チェック）と [反転]
function MaskSourceEditor(props: { part: Part; options: Part[]; selected: Part[]; dispatch(c: Command): void }) {
  const { part, options, selected, dispatch } = props;
  const chosen = new Set(selected.map((p) => p.id));
  return (
    <div className="mask-editor">
      <fieldset className="mask-sources">
        <legend>マスク元</legend>
        <p className="mask-summary" data-testid="mask-summary">
          {selected.length === 0 ? 'なし' : selected.map((p) => p.name).join('、')}
        </p>
        {options.length === 0 ? (
          <p className="mask-note">マスク元にできる画像パーツが無い</p>
        ) : (
          <ul className="mask-source-list">
            {options.map((p) => (
              <li key={p.id}>
                <label className="mask-source">
                  <input
                    type="checkbox"
                    checked={chosen.has(p.id)}
                    onChange={(e) => dispatch(setMaskSource(part.id, p.id, e.target.checked))}
                  />
                  <span>{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <label className="mask-invert">
        <input
          type="checkbox"
          checked={part.mask?.inverted ?? false}
          disabled={selected.length === 0}
          onChange={(e) => dispatch(setMaskInverted(part.id, e.target.checked))}
        />
        <span>反転（範囲の外を表示）</span>
      </label>
      <p className="mask-note">{MASK_HINT}</p>
    </div>
  );
}
