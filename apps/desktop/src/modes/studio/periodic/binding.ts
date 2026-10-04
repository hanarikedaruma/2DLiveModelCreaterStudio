// 周期アニメーション（カード48）のスタジオ側。実行部に入れる producer は、つないだ services.periodic に任せる
// （カード54までは仮実装で何も出さない。本物は @app/core の createPeriodicPlayer）。
// 有効にする周期アニメーションは、使っているシーンの periodicAnimationIds（プロジェクトにある periodic のもの）。
// シーンの切り替えは 'sceneChanged' で、同じシーンのまま一覧が変わったとき（チェック・Undo・アニメーションの削除や
// 「周期アニメーション」の切り替え）はストアの変化で setActive に渡す（変わったときだけ）
import type { Project } from '@app/schema';
import type { LayerProducer, PeriodicPlayer, ProjectStore } from '@app/contracts';
import { activeScene } from '../scene';
import { ensureStandardBreath, scenePeriodicIds } from './commands';

export interface PeriodicBindingDeps {
  periodic: PeriodicPlayer;
  store: Pick<ProjectStore, 'get' | 'subscribe' | 'load' | 'canUndo' | 'canRedo'>;
}

export interface PeriodicBinding {
  readonly producer: LayerProducer; // 実行部に登録する（id 'periodic'）。つないでいなければ何も出さない
  // services.periodic・services.store をつなぐ（同じものなら何もしない）。呼吸が無ければ標準の呼吸を作り
  // （履歴が無いときだけ）、使っているシーンの周期アニメーションを setActive に渡す
  bind(deps: PeriodicBindingDeps): void;
  unbind(): void;
  bound(): PeriodicPlayer | null;
  active(): readonly string[]; // 最後に setActive に渡した一覧（変わらなければ同じ配列）
  sceneChanged(sceneId: unknown): void; // 'sceneChanged'（値はシーンの id）。そのシーンの周期アニメーションを渡す
  projectLoaded(): void; // 'projectLoaded'。呼吸が無ければ標準の呼吸を作る
}

const EMPTY: readonly string[] = [];

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function createPeriodicBinding(): PeriodicBinding {
  let deps: PeriodicBindingDeps | null = null;
  let offStore: (() => void) | null = null;
  let active: readonly string[] = EMPTY;

  function push(target: PeriodicPlayer, project: Project, id: string | null, force = false) {
    const scene = id === null ? null : (project.studio.scenes.find((s) => s.id === id) ?? null);
    const next = scenePeriodicIds(project, scene);
    if (!force && same(next, active)) return;
    active = next.length === 0 ? EMPTY : next;
    target.setActive([...next]);
  }

  function unbind() {
    offStore?.();
    offStore = null;
    deps = null;
    active = EMPTY;
  }

  return {
    producer: { id: 'periodic', produce: (ctx) => deps?.periodic.produce(ctx) ?? null },
    bind(next) {
      if (deps && deps.periodic === next.periodic && deps.store === next.store) return;
      unbind();
      deps = next;
      const { periodic, store } = next;
      ensureStandardBreath(store);
      const project = store.get();
      push(periodic, project, activeScene(project)?.id ?? null, true);
      offStore = store.subscribe((p) => {
        const id = activeScene(p)?.id ?? null;
        // 画面を閉じた間の Undo やプロジェクト読み込みも反映する。イベントが先に届いても push は重複を除く。
        push(periodic, p, id);
      });
    },
    unbind,
    bound: () => deps?.periodic ?? null,
    active: () => active,
    sceneChanged(payload) {
      if (!deps) return;
      const project = deps.store.get();
      // 知らない値なら使っているシーン
      const id =
        typeof payload === 'string' && project.studio.scenes.some((s) => s.id === payload)
          ? payload
          : (activeScene(project)?.id ?? null);
      push(deps.periodic, project, id);
    },
    projectLoaded() {
      if (!deps) return;
      ensureStandardBreath(deps.store);
      const project = deps.store.get();
      push(deps.periodic, project, activeScene(project)?.id ?? null, true);
    },
  };
}

// アプリで1つ。スタジオの実行部（studioRuntime）に登録し、シーンのパネルの「周期アニメーション」が services をつなぐ
export const periodicBinding: PeriodicBinding = createPeriodicBinding();
