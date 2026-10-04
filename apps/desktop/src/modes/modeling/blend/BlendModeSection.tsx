// 「Transform」パネルの中の合成モードのセクション（カード32）。選んだ画像パーツの合成モードを選ぶ
import type { FC } from 'react';
import { useDispatch, useEditor, useProject } from '../../../shell/api';
import { BLEND_MODE_OPTIONS, blendTargets, currentBlendMode, isBlendMode, setBlendMode } from './commands';
import './blend.css';

export const BlendModeSection: FC = () => {
  const { model } = useProject();
  const [editor] = useEditor();
  const dispatch = useDispatch();
  const selected = new Set(editor.selectedPartIds);
  if (!model.parts.some((p) => selected.has(p.id))) return null;
  const current = currentBlendMode(blendTargets(model, editor.selectedPartIds));
  return (
    <div className="blend-section">
      <label className="blend-field">
        <span className="blend-label">合成モード</span>
        <select
          aria-label="合成モード"
          value={current ?? ''}
          disabled={current === null}
          onChange={(e) => {
            const mode = e.target.value;
            if (!isBlendMode(mode)) return;
            const command = setBlendMode(model, editor.selectedPartIds, mode);
            if (command) dispatch(command);
          }}
        >
          {current === 'mixed' && (
            <option value="mixed" disabled>
              （混在）
            </option>
          )}
          {current === null && <option value="">—</option>}
          {BLEND_MODE_OPTIONS.map((o) => (
            <option key={o.mode} value={o.mode}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {current === null && <p className="blend-note">グループには合成モードが無い（画像パーツを選ぶ）</p>}
    </div>
  );
};
