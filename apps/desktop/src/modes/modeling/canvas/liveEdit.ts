// 1回のドラッグを1回の Undo にする仕組み。
// store.transaction は同期で終わるので、動かすたびに「前に入れた分を Undo で戻し、ドラッグ開始の状態から作り直したコマンドを入れ直す」。
// 履歴にはいつも1つだけ積まれている
import type { Project } from '@app/schema';
import type { Command, ProjectStore } from '@app/contracts';

export interface LiveEdit {
  // ドラッグ開始の状態（前の分を戻した状態）に make のコマンドを入れる。null なら何も入れない。'needsKey' なら何も入れずに返す
  update(make: (project: Project) => Command | 'needsKey' | null): 'ok' | 'needsKey';
  commit(): void; // 今の分で確定する（以後は何もしない）
  cancel(): void; // 入れた分を戻して終わる
}

export function beginLiveEdit(store: ProjectStore, label: string): LiveEdit {
  let applied: Project | null = null; // 入れた直後の状態（履歴に1つ積んである）
  let done = false;

  const revert = () => {
    // ほかの操作で変わっていたら、それを消さないように戻さない
    if (applied && store.get() === applied && store.canUndo()) store.undo();
    applied = null;
  };

  return {
    update(make) {
      if (done) return 'ok';
      revert();
      const command = make(store.get());
      if (command === 'needsKey') return 'needsKey';
      if (command) {
        const before = store.get();
        store.transaction(label, (dispatch) => dispatch(command));
        if (store.get() !== before) applied = store.get();
      }
      return 'ok';
    },
    commit() {
      done = true;
      applied = null;
    },
    cancel() {
      if (!done) revert();
      done = true;
    },
  };
}

export const NEEDS_KEY_MESSAGE = 'この値にキーを追加して編集しますか？';

export interface ConfirmDialogs {
  confirm(message: string): Promise<boolean>;
  notify(message: string): void;
}

export interface KeyedDragOptions<C> {
  store: ProjectStore;
  dialogs: ConfirmDialogs;
  label: string;
  // project（承認済みのキーを足した後の状態）に change を入れるコマンド。変化が無ければ null
  edit(project: Project, change: C): Command | 'needsKey' | null;
  // 'needsKey' のときに足すキーのコマンド
  addKeys(project: Project, change: C): Command;
  onChange?(): void; // 確認のあとで状態が変わったとき（描き直し）
}

export interface KeyedDrag<C> {
  move(change: C): void; // ドラッグ開始からの変更（累計）
  release(): void; // ボタンを離した
  cancel(): void;
  active(): boolean;
  awaitingKey(): boolean;
  settled(): Promise<void>; // 確認を含めて終わるまで待つ（テスト用）
}

function compose(label: string, first: Command, second: Command): Command {
  return { label, apply: (p) => second.apply(first.apply(p)) };
}

// KeyEditor のコマンドでドラッグする。'needsKey' なら「この値にキーを追加して編集」を確認し、
// 承認されたらキーを足してからもう一度 edit する（キーの追加と編集で1回の Undo）
export function startKeyedDrag<C>(o: KeyedDragOptions<C>): KeyedDrag<C> {
  const live = beginLiveEdit(o.store, o.label);
  let prefix: Command | null = null; // 承認されたキーの追加
  let latest: { change: C } | null = null;
  let state: 'dragging' | 'awaiting' | 'ended' = 'dragging';
  let released = false;
  let pending: Promise<void> = Promise.resolve();

  const make = (change: C) => (project: Project) => {
    const pre = prefix;
    const command = o.edit(pre ? pre.apply(project) : project, change);
    if (command === 'needsKey' || !pre) return command;
    return command ? compose(o.label, pre, command) : pre;
  };
  const apply = () => (latest ? live.update(make(latest.change)) : 'ok');
  const end = () => {
    state = 'ended';
  };

  async function askKey() {
    state = 'awaiting';
    const ok = await o.dialogs.confirm(NEEDS_KEY_MESSAGE);
    if (state !== 'awaiting') return;
    if (!ok || !latest) {
      live.cancel();
      end();
      o.onChange?.();
      return;
    }
    // 'needsKey' のときは何も入れていないので、いまの状態がドラッグ開始の状態
    const base = o.store.get();
    const pre = prefix;
    const add = o.addKeys(pre ? pre.apply(base) : base, latest.change);
    prefix = pre ? compose(o.label, pre, add) : add;
    state = 'dragging';
    if (apply() === 'needsKey') {
      o.dialogs.notify('キーを追加できなかった');
      live.cancel();
      end();
    } else if (released) {
      live.commit();
      end();
    }
    o.onChange?.();
  }

  return {
    move(change) {
      if (state === 'ended') return;
      latest = { change };
      if (state === 'awaiting') return;
      if (apply() === 'needsKey') pending = askKey();
    },
    release() {
      released = true;
      if (state === 'dragging') {
        live.commit();
        end();
      }
    },
    cancel() {
      if (state === 'ended') return;
      live.cancel();
      end();
    },
    active: () => state !== 'ended',
    awaitingKey: () => state === 'awaiting',
    settled: () => pending,
  };
}
