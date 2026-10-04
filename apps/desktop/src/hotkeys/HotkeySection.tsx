// スタジオの設定のパネル（studioSettings）の「ホットキー」: 割り当ての一覧・追加・削除
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { newId, type Hotkey, type Project } from '@app/schema';
import { useDispatch, useProject } from '../shell/api';
import { useHotkeyBinding } from './binding';
import { needsModifier, normalizeKeys, recordKeys } from './keys';
import { hotkeyRuntime, type HotkeyRuntimeState } from './runtime';
import {
  ACTIONS,
  MODE_LABEL,
  addHotkeyCommand,
  describeHotkey,
  duplicateHotkeyIds,
  hasMode,
  hasTarget,
  removeHotkeyCommand,
  targetOptions,
  type HotkeyAction,
  type HotkeyMode,
  type TargetOption,
} from './targets';

export const CONFLICT_MESSAGE = 'ほかのアプリと重なっています';
export const DUPLICATE_MESSAGE = 'ほかのホットキーと同じキー';
export const INVALID_KEYS_MESSAGE = 'このキーは使えない';
export const NEEDS_MODIFIER_MESSAGE = 'Ctrl・Alt・Win のどれかと組み合わせる（F1〜F24・テンキーは単独でもよい）';

function rowMessage(hotkey: Hotkey, duplicates: Set<string>, state: HotkeyRuntimeState): string | null {
  if (normalizeKeys(hotkey.keys) === null) return INVALID_KEYS_MESSAGE;
  if (duplicates.has(hotkey.id)) return DUPLICATE_MESSAGE;
  if (state.statuses.get(hotkey.id) === 'conflict') return CONFLICT_MESSAGE;
  return null;
}

export function HotkeySection() {
  useHotkeyBinding();
  const project = useProject();
  const dispatch = useDispatch();
  const state = useSyncExternalStore(hotkeyRuntime.subscribe, hotkeyRuntime.getState);
  const [adding, setAdding] = useState(false);
  const { hotkeys } = project.studio;
  const duplicates = useMemo(() => duplicateHotkeyIds(hotkeys), [hotkeys]);
  const hasConflict = hotkeys.some((h) => rowMessage(h, duplicates, state) === CONFLICT_MESSAGE);

  return (
    <div className="studio-section hotkey-section">
      <h3>ホットキー</h3>
      <p className="studio-note">アプリが裏にあっても、登録したキーで操作できる</p>
      {hotkeys.length === 0 ? (
        <p className="studio-note">まだ登録していない</p>
      ) : (
        <ul className="hotkey-list" aria-label="ホットキーの一覧">
          {hotkeys.map((h) => {
            const keys = normalizeKeys(h.keys) ?? h.keys;
            const what = describeHotkey(h, project);
            const message = rowMessage(h, duplicates, state);
            return (
              <li key={h.id} className="hotkey-item" data-hotkey-id={h.id}>
                <div className="hotkey-line">
                  <kbd className="hotkey-keys">{keys}</kbd>
                  <span className="hotkey-what">{what}</span>
                  {hasMode(h.action) && <span className="hotkey-mode">{MODE_LABEL[h.mode]}</span>}
                  <button
                    type="button"
                    className="hotkey-remove"
                    aria-label={`${keys}（${what}）を削除`}
                    onClick={() => dispatch(removeHotkeyCommand(h.id))}
                  >
                    削除
                  </button>
                </div>
                {message && <p className="studio-note studio-warn hotkey-warn">{message}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {state.trackingPaused && <p className="studio-note">ホットキーでトラッキングを一時停止している</p>}
      {adding ? (
        <HotkeyForm project={project} onClose={() => setAdding(false)} />
      ) : (
        <div className="studio-row">
          <button type="button" onClick={() => setAdding(true)}>
            追加
          </button>
          {hasConflict && (
            <button type="button" disabled={state.syncing} onClick={() => hotkeyRuntime.resync()}>
              登録し直す
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// 表情はまず最初の表情を選んでおく（「解除」は選べば使える）
function defaultTarget(action: HotkeyAction, options: TargetOption[]): string | null {
  if (action === 'expression') return options.find((o) => o.value !== '')?.value ?? '';
  return options[0]?.value ?? null;
}

const EMPTY_TARGET_NOTE: Partial<Record<HotkeyAction, string>> = {
  scene: 'シーンがまだ無い',
  parameter: 'パラメータがまだ無い',
  animation: 'アニメーションがまだ無い',
};

function TargetSelect({
  options,
  value,
  onChange,
}: {
  options: TargetOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const groups = [...new Set(options.map((o) => o.group))];
  const render = (list: TargetOption[]) =>
    list.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));
  return (
    <select aria-label="対象" value={value} onChange={(e) => onChange(e.target.value)}>
      {groups.map((g) =>
        g === undefined ? (
          render(options.filter((o) => o.group === undefined))
        ) : (
          <optgroup key={g} label={g}>
            {render(options.filter((o) => o.group === g))}
          </optgroup>
        ),
      )}
    </select>
  );
}

function HotkeyForm({ project, onClose }: { project: Project; onClose: () => void }) {
  const dispatch = useDispatch();
  const [recorded, setRecorded] = useState<string | null>(null);
  const [shown, setShown] = useState(''); // 記録した（または使えなかった）キー
  const [partial, setPartial] = useState<string | null>(null); // 修飾キーだけ押している間
  const [keyError, setKeyError] = useState<string | null>(null);
  const chordDone = useRef(false); // 修飾キーを押したままキーを押し終えた
  const [action, setAction] = useState<HotkeyAction>('expression');
  const options = targetOptions(action, project);
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  const target =
    chosenTarget !== null && options.some((o) => o.value === chosenTarget)
      ? chosenTarget
      : defaultTarget(action, options);
  const [mode, setMode] = useState<HotkeyMode>('toggle');

  const reject = (keys: string, message: string) => {
    setShown(keys);
    setRecorded(null);
    setKeyError(message);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Tab はフォーカスの移動に使う
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const r = recordKeys(e);
    if (r.type === 'partial') {
      if (!chordDone.current) setPartial(r.text || null);
      return;
    }
    chordDone.current = true;
    setPartial(null);
    if (r.type === 'unsupported') return reject(r.text, INVALID_KEYS_MESSAGE);
    if (needsModifier(r.parsed)) return reject(r.keys, NEEDS_MODIFIER_MESSAGE);
    const used = project.studio.hotkeys.find((h) => normalizeKeys(h.keys) === r.keys);
    if (used) return reject(r.keys, `すでに使っている（${describeHotkey(used, project)}）`);
    setShown(r.keys);
    setRecorded(r.keys);
    setKeyError(null);
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 修飾キーを離しきったら、次の記録に備える
    if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      chordDone.current = false;
      setPartial(null);
      return;
    }
    const r = recordKeys(e);
    if (r.type === 'partial' && !chordDone.current) setPartial(r.text);
  };

  const withTarget = hasTarget(action);
  const canAdd = recorded !== null && (!withTarget || target !== null);

  const add = () => {
    if (!canAdd) return;
    dispatch(
      addHotkeyCommand({
        id: newId(),
        keys: recorded,
        action,
        targetId: withTarget && target ? target : null,
        mode: hasMode(action) ? mode : 'toggle',
      }),
    );
    onClose();
  };

  return (
    <div className="hotkey-form" role="group" aria-label="ホットキーの追加">
      <label className="studio-field">
        <span>キー</span>
        <input
          className="hotkey-recorder"
          aria-label="キー"
          readOnly
          placeholder="ここを選んでキーを押す"
          value={partial ?? shown}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={() => {
            chordDone.current = false;
            setPartial(null);
          }}
        />
      </label>
      {keyError && <p className="studio-note studio-warn">{keyError}</p>}
      <label className="studio-field">
        <span>動作</span>
        <select aria-label="動作" value={action} onChange={(e) => setAction(e.target.value as HotkeyAction)}>
          {ACTIONS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      {withTarget && (
        <label className="studio-field">
          <span>対象</span>
          {target === null ? (
            <span className="studio-note">{EMPTY_TARGET_NOTE[action] ?? '選べるものが無い'}</span>
          ) : (
            <TargetSelect options={options} value={target} onChange={setChosenTarget} />
          )}
        </label>
      )}
      {hasMode(action) && (
        <label className="studio-field">
          <span>動き</span>
          <select aria-label="動き" value={mode} onChange={(e) => setMode(e.target.value as HotkeyMode)}>
            <option value="toggle">{MODE_LABEL.toggle}</option>
            <option value="hold">{MODE_LABEL.hold}</option>
          </select>
        </label>
      )}
      <div className="studio-row">
        <button type="button" className="primary" disabled={!canAdd} onClick={add}>
          登録
        </button>
        <button type="button" onClick={onClose}>
          やめる
        </button>
      </div>
    </div>
  );
}
