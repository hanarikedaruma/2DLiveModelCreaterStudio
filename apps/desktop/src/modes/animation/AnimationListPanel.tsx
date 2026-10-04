// アニメーションの一覧（アニメーションの left のパネル、カード46）。押すとそのアニメーションを編集する。
// 追加・複製・名前の変更・削除は、選んでいるアニメーションに対して行う（どれも1回の Undo）
import { newId, type Animation } from '@app/schema';
import { useDialogs, useDispatch } from '../../shell/api';
import {
  addAnimationCommand,
  createAnimation,
  duplicateAnimationCommand,
  nextAnimationName,
  removeAnimationCommand,
  renameAnimationCommand,
} from './commands';
import { formatTime } from './labels';
import { useCurrentAnimation } from './useCurrent';

export function AnimationListPanel() {
  const { project, animation, setState } = useCurrentAnimation();
  const dispatch = useDispatch();
  const dialogs = useDialogs();
  const { animations } = project;
  const index = animation ? animations.findIndex((a) => a.id === animation.id) : -1;

  const select = (id: string | null) => setState({ animationId: id, time: 0, playback: 'stopped', selectedKey: null });

  const add = () => {
    const created = createAnimation(nextAnimationName(animations));
    dispatch(addAnimationCommand(created));
    select(created.id);
  };

  const duplicate = () => {
    if (!animation) return;
    const id = newId();
    dispatch(duplicateAnimationCommand(animation.id, id));
    select(id);
  };

  const rename = async (a: Animation) => {
    const next = await dialogs.prompt('アニメーションの名前', a.name);
    if (next !== null) dispatch(renameAnimationCommand(a.id, next));
  };

  // 消したら、すぐ後ろ（無ければすぐ前）を選ぶ
  const remove = () => {
    if (!animation) return;
    const next = animations[index + 1] ?? animations[index - 1] ?? null;
    dispatch(removeAnimationCommand(animation.id));
    select(next?.id ?? null);
  };

  return (
    <div className="anim-list-panel">
      {animations.length === 0 ? (
        <p className="anim-note">アニメーションがまだ無い（［追加］で作る）</p>
      ) : (
        <ul className="anim-list" aria-label="アニメーションの一覧">
          {animations.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="anim-item"
                aria-label={a.name}
                aria-pressed={a.id === animation?.id}
                title="押すと編集する（ダブルクリックで名前の変更）"
                onClick={() => a.id !== animation?.id && select(a.id)}
                onDoubleClick={() => void rename(a)}
              >
                <span className="anim-item-name">{a.name}</span>
                <span className="anim-item-meta">
                  {formatTime(a.duration)} 秒{a.loop ? '・ループ' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="anim-actions" role="toolbar" aria-label="アニメーションの操作">
        <button type="button" onClick={add}>
          追加
        </button>
        <button type="button" disabled={!animation} onClick={duplicate}>
          複製
        </button>
        <button type="button" disabled={!animation} onClick={() => animation && void rename(animation)}>
          名前の変更
        </button>
        <button type="button" disabled={!animation} onClick={remove}>
          削除
        </button>
      </div>
    </div>
  );
}
