// シーンの切り替えを見張る。'sceneChanged' を出すのはここだけ（一覧の操作・ホットキー・Undo のどれで変わっても1回だけ出す）。
// ストアの使っているシーン（activeScene。activeSceneId が無ければ先頭）の id が変わったら、
// そのシーンの表情を適用してから 'sceneChanged'（値はシーンの id）を出す。
// 同じシーンのまま表情の指定だけが変わったら、表情だけを適用する
import type { Project } from '@app/schema';
import type { ExpressionController, ProjectStore } from '@app/contracts';
import { activeScene } from '../scene';
import { sceneExpressionId } from './commands';

export const SCENE_CHANGED_EVENT = 'sceneChanged';

export interface SceneWatcherDeps {
  store: Pick<ProjectStore, 'get' | 'subscribe'>;
  expressions: Pick<ExpressionController, 'apply'>;
  now(): number; // ExpressionController.apply に渡す時刻（ミリ秒）
  emit(name: string, payload?: unknown): void;
}

export interface SceneWatcher {
  // 見張りを始める。別の store・expressions でつなぎ直すと前のものは外す（同じなら now・emit だけを替える）。
  // つないだときは、使っているシーンの表情を適用する（'sceneChanged' は出さない）
  bind(deps: SceneWatcherDeps): void;
  unbind(): void;
}

interface Seen {
  sceneId: string | null;
  expressionId: string | null;
}

function seen(project: Project): Seen {
  const scene = activeScene(project);
  return { sceneId: scene?.id ?? null, expressionId: sceneExpressionId(project, scene) };
}

function applyExpression(deps: SceneWatcherDeps, id: string | null) {
  try {
    deps.expressions.apply(id, deps.now());
  } catch (e) {
    console.error('シーンの表情を適用できない', e);
  }
}

export function createSceneWatcher(): SceneWatcher {
  let current: { deps: SceneWatcherDeps; off: () => void } | null = null;

  return {
    bind(deps) {
      if (current && current.deps.store === deps.store && current.deps.expressions === deps.expressions) {
        current.deps = deps;
        return;
      }
      current?.off();
      const binding = { deps, off: () => {} };
      let last = seen(deps.store.get());
      if (last.sceneId !== null) applyExpression(deps, last.expressionId);
      binding.off = deps.store.subscribe((project) => {
        const d = binding.deps;
        const next = seen(project);
        const prev = last;
        last = next;
        if (next.sceneId === null) return; // シーンが1つも無い
        if (next.sceneId !== prev.sceneId) {
          applyExpression(d, next.expressionId);
          d.emit(SCENE_CHANGED_EVENT, next.sceneId);
        } else if (next.expressionId !== prev.expressionId) {
          applyExpression(d, next.expressionId);
        }
      });
      current = binding;
    },
    unbind() {
      current?.off();
      current = null;
    },
  };
}

// アプリで1つ。シーンのパネル（ScenePanel）が services につなぐ
export const sceneWatcher: SceneWatcher = createSceneWatcher();
