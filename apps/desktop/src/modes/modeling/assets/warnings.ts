// 取り込みの警告。種類ごとにまとめて出す。最後の取り込みの警告は services ごとに覚えておく（セットアップ画面は取り込むと消えるので、トレイにも出す）
import { useSyncExternalStore } from 'react';
import type { ImportWarning, Services } from '@app/contracts';

export const WARNING_TEXT: Record<ImportWarning['kind'], string> = {
  canvasMismatch: 'キャンバスサイズが違う素材があります。位置は手動で合わせてください',
  noTransparency: '背景が透過していない素材があります',
  resolution: '解像度が小さすぎる（または大きすぎる）素材があります',
  needsMerge: '統合が必要なレイヤーがあります。ペイントソフトで統合してから取り込み直してください',
};

const ORDER: ImportWarning['kind'][] = ['canvasMismatch', 'noTransparency', 'resolution', 'needsMerge'];

export interface WarningGroup {
  kind: ImportWarning['kind'];
  text: string;
  layerNames: string[]; // 重なりを除いた、出てきた順
}

export function groupWarnings(warnings: readonly ImportWarning[]): WarningGroup[] {
  return ORDER.flatMap((kind) => {
    const of = warnings.filter((w) => w.kind === kind);
    if (of.length === 0) return [];
    const layerNames = [...new Set(of.flatMap((w) => w.layerNames))];
    return [{ kind, text: WARNING_TEXT[kind], layerNames }];
  });
}

interface WarningStore {
  get(): readonly ImportWarning[];
  set(warnings: readonly ImportWarning[]): void;
  subscribe(listener: () => void): () => void;
}

const stores = new WeakMap<Services, WarningStore>();
const allStores = new Set<WarningStore>();

// プロジェクトを開き直したら前の取り込みの警告は消す（アプリイベント 'projectLoaded'）
export function clearAllImportWarnings(): void {
  for (const store of allStores) if (store.get().length > 0) store.set([]);
}

export function importWarningsOf(services: Services): WarningStore {
  let store = stores.get(services);
  if (!store) {
    let current: readonly ImportWarning[] = [];
    const listeners = new Set<() => void>();
    store = {
      get: () => current,
      set(warnings) {
        current = warnings;
        for (const l of [...listeners]) l();
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    stores.set(services, store);
    allStores.add(store);
  }
  return store;
}

export function useImportWarnings(services: Services): readonly ImportWarning[] {
  const store = importWarningsOf(services);
  return useSyncExternalStore(store.subscribe, store.get);
}
