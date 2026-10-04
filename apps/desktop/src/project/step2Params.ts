// STEP2 の標準パラメータを足す（カード53）。プロジェクトを開いたとき・新規に作ったとき（アプリイベント 'projectLoaded'）に、
// 足りない STEP2 の標準パラメータ（呼吸・腕 L / R・髪揺れ 前 / 横 / 後ろ）だけを ensureStandardParameters で足す。
// 形はカード34の step1Params と同じ
import { ensureStandardParameters, type Project } from '@app/schema';
import type { ProjectStore } from '@app/contracts';
import { onAppEvent } from '../shell/events';
import { PROJECT_LOADED } from './actions';

// 足りないものがあるときだけ新しいプロジェクトを返す。何も足さないときは同じ参照
export function withStep2Parameters(project: Project): Project {
  const model = ensureStandardParameters(project.model, 'step2');
  return model === project.model ? project : { ...project, model };
}

// いまのプロジェクトに足す。開いた直後に行うので、履歴に積まずに置き換える（Undo で標準パラメータが消えないように）。
// 足したら true
export function applyStep2Parameters(store: ProjectStore): boolean {
  const current = store.get();
  const next = withStep2Parameters(current);
  if (next === current) return false;
  store.load(next);
  return true;
}

// 起動したときのプロジェクトにも足し、以後 'projectLoaded' のたびに足す。戻り値で外す
export function connectStep2Params(store: ProjectStore): () => void {
  applyStep2Parameters(store);
  return onAppEvent(PROJECT_LOADED, () => {
    applyStep2Parameters(store);
  });
}
