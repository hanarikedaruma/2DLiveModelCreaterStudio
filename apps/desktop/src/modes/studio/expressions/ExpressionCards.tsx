// スタジオの bottom の「表情」パネル（カード38・52）。表情のカードを押すたびに重ねる・外す（同時に適用する）。
// 詳細モードの設定で「1つずつ切り替え」（押した表情だけにする）に戻せる。適用中のカードには適用した順番を出す
// （フェードは services.expressions が行う）。詳細モードでは表情ごとのフェードの秒数も変えられる。
// シーンを切り替えたときの表情はシーンの見張り（scenes/watcher.ts）が適用する
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Expression } from '@app/schema';
import { DetailDisclosure, useDispatch, useEnvironment, useProject, useServices } from '../../../shell/api';
import { updateExpressionCommand } from '../../modeling/expressions/commands';
import { expressionBinding, type ExpressionCardMode } from './binding';
import './expressions.css';

export const STUDIO_EXPRESSION_PANEL = 'studioExpressions';
export const MAX_FADE_SECONDS = 10;

function formatSeconds(v: number): string {
  return String(Math.round(v * 100) / 100);
}

// 秒数の欄。入力の途中は保存せず、確定したとき（フォーカスを外す・Enter）に 0〜10 秒に丸めて保存する
function SecondsField(props: { label: string; value: number; commit(v: number): void }) {
  const text = formatSeconds(props.value);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const done = () => {
    const n = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(n)) {
      const v = Math.min(MAX_FADE_SECONDS, Math.max(0, n));
      if (formatSeconds(v) !== text) props.commit(v);
    }
    setDraft(text); // 変わったら新しい値が text で入る
  };
  return (
    <label className="sexpr-seconds">
      <span>{props.label}</span>
      <input
        type="number"
        aria-label={props.label}
        min={0}
        max={MAX_FADE_SECONDS}
        step={0.05}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Enter') done();
        }}
      />
      <span>秒</span>
    </label>
  );
}

function FadeRow({ expression }: { expression: Expression }) {
  const dispatch = useDispatch();
  const set = (patch: { fadeIn?: number; fadeOut?: number }) =>
    dispatch(updateExpressionCommand('表情のフェードの秒数を変える', expression.id, patch));
  return (
    <div className="sexpr-fade" role="group" aria-label={`「${expression.name}」のフェード`}>
      <span className="sexpr-fade-name">{expression.name}</span>
      <SecondsField label="フェードイン" value={expression.fadeIn} commit={(fadeIn) => set({ fadeIn })} />
      <SecondsField label="フェードアウト" value={expression.fadeOut} commit={(fadeOut) => set({ fadeOut })} />
    </div>
  );
}

// カードの title（押すと何が起きるか）
function cardTitle(mode: ExpressionCardMode, order: number, count: number): string {
  if (mode === 'stack') return order >= 0 ? 'もう一度押すと外す' : '押すとこの表情を重ねる';
  return order >= 0 && count === 1 ? 'もう一度押すと解除する' : '押すとこの表情だけにする';
}

// カードの押し方の設定。チェックすると STEP1 と同じ1つずつの切り替えにする（この PC に覚える）
function CardModeSetting({ mode }: { mode: ExpressionCardMode }) {
  const [, setEnv] = useEnvironment();
  return (
    <div className="sexpr-mode">
      <label className="studio-check">
        <input
          type="checkbox"
          checked={mode === 'single'}
          onChange={(e) => setEnv({ expressionMode: e.target.checked ? 'single' : 'stack' })}
        />
        1つずつ切り替え
      </label>
      <p className="studio-note">
        {mode === 'single'
          ? 'カードを押すと、その表情だけにする'
          : 'カードを押すたびに表情を重ねる・外す（後から押した表情ほど優先する）'}
      </p>
    </div>
  );
}

export function ExpressionCards() {
  const services = useServices();
  const project = useProject();
  const [env] = useEnvironment();
  // services.expressions を実行部の producer につなぐ。出力ウィンドウはスタジオの画面を離れても動き続けるので、
  // 外したとき（画面を離れたとき）もつないだままにする。services が替わったらつなぎ直す
  useEffect(() => {
    expressionBinding.bind(services.expressions);
    expressionBinding.setMode(env.expressionMode);
  }, [services, env.expressionMode]);
  const actives = useSyncExternalStore(expressionBinding.subscribe, expressionBinding.actives);
  const mode = env.expressionMode;
  const { expressions } = project;
  // 適用した順の名前（プロジェクトに無い表情は出さない）
  const names = actives.flatMap((id) => expressions.find((e) => e.id === id)?.name ?? []);

  return (
    <div className="sexpr-panel">
      {expressions.length === 0 ? (
        <p className="studio-note">表情がまだ無い（モデリングの「表情」パネルで作る）</p>
      ) : (
        <div className="sexpr-cards" role="group" aria-label="表情のカード">
          {expressions.map((e) => {
            const order = actives.indexOf(e.id);
            return (
              <button
                key={e.id}
                type="button"
                className="sexpr-card"
                aria-pressed={order >= 0}
                title={cardTitle(mode, order, actives.length)}
                onClick={() => expressionBinding.toggle(e.id, performance.now())}
              >
                <span className="sexpr-card-name">{e.name}</span>
                {e.entries.length === 0 && <span className="sexpr-card-empty">値なし</span>}
                {order >= 0 && (
                  <span className="sexpr-card-order" aria-hidden="true">
                    {order + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <p className="studio-note" aria-label="いまの表情">
        いまの表情: {names.length > 0 ? names.join('＋') : 'なし'}
      </p>
      {expressions.length > 0 && (
        <DetailDisclosure label="カードの押し方">
          <CardModeSetting mode={mode} />
        </DetailDisclosure>
      )}
      {expressions.length > 0 && (
        <DetailDisclosure label="フェードの秒数">
          <div className="sexpr-fades">
            {expressions.map((e) => (
              <FadeRow key={e.id} expression={e} />
            ))}
          </div>
        </DetailDisclosure>
      )}
    </div>
  );
}
