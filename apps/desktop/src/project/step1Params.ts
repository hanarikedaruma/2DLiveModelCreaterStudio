// STEP1 の標準パラメータを足す（カード34）。プロジェクトを開いたとき・新規に作ったとき（アプリイベント 'projectLoaded'）に、
// 足りない STEP1 の標準パラメータ（目 笑顔・眉・口 形 / 横幅・頬染め・体）だけを ensureStandardParameters で足す
import { ensureStandardParameters, type Project } from '@app/schema';
import type { ProjectStore } from '@app/contracts';
import { onAppEvent } from '../shell/events';
import { PROJECT_LOADED } from './actions';

// 足りないものがあるときだけ新しいプロジェクトを返す。何も足さないときは同じ参照
export function withStep1Parameters(project: Project): Project {
  const model = ensureStandardParameters(project.model, 'step1');
  return model === project.model ? project : { ...project, model };
}

// いまのプロジェクトに足す。開いた直後に行うので、履歴に積まずに置き換える（Undo で標準パラメータが消えないように）。
// 足したら true
export function applyStep1Parameters(store: ProjectStore): boolean {
  const current = store.get();
  const next = withStep1Parameters(current);
  if (next === current) return false;
  store.load(next);
  return true;
}

// 起動したときのプロジェクトにも足し、以後 'projectLoaded' のたびに足す。戻り値で外す
export function connectStep1Params(store: ProjectStore): () => void {
  applyStep1Parameters(store);
  return onAppEvent(PROJECT_LOADED, () => {
    applyStep1Parameters(store);
  });
}
