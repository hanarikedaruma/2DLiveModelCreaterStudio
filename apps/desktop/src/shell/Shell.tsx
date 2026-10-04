// アプリの枠のいちばん外側。サービス・環境設定・ダイアログ・キャンバスの状態を配り、
// Ctrl+Z（undo）・Ctrl+Shift+Z と Ctrl+Y（redo）・メニューのショートカットを処理する
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { EditorState, Services } from '@app/contracts';
import { createCanvasController, type CanvasController } from './canvas/controller';
import { ShellContext, type ShellContextValue } from './context';
import { DialogHost, createDialogController, type DialogController } from './dialogs';
import type { EnvironmentStore } from './environment';
import { onAppEvent } from './events';
import { isTypingTarget, matchesShortcut } from './keys';
import { Layout } from './Layout';
import { registry } from './registry';
import './shell.css';

// このアプリイベントを出すと、枠が通知（トースト）を出す。フックを使えない場所（メニューの run など）から使う
export const SHELL_NOTIFY = 'shell:notify';

export interface ShellProps {
  services: Services;
  environment: EnvironmentStore;
  dialogs?: DialogController;
  canvas?: CanvasController;
}

function sameLevels(a: Record<string, string>, b: Record<string, string>) {
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);
}

export function Shell({ services, environment, dialogs, canvas }: ShellProps) {
  const value = useMemo<ShellContextValue>(
    () => ({
      services,
      environment,
      dialogs: dialogs ?? createDialogController(),
      canvas: canvas ?? createCanvasController(),
    }),
    [services, environment, dialogs, canvas],
  );

  // 環境設定を読み、かんたん/詳細（uiLevel）を EditorState と揃える
  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    let previousLevels = services.editor.get().uiLevel;
    const pendingLevels: Partial<EditorState['uiLevel']> = {};
    void environment.load().then(() => {
      if (cancelled) return;
      loaded = true;
      services.editor.set({ uiLevel: { ...environment.get().uiLevel, ...pendingLevels } });
    });
    const off = services.editor.subscribe((s) => {
      if (!loaded) {
        // 読み込み中に操作したモードだけを覚える。ほかの保存済み設定は読み終えるまで書かない
        for (const mode of Object.keys(s.uiLevel) as (keyof EditorState['uiLevel'])[]) {
          if (s.uiLevel[mode] !== previousLevels[mode]) pendingLevels[mode] = s.uiLevel[mode];
        }
        previousLevels = s.uiLevel;
        return;
      }
      if (!sameLevels(s.uiLevel, environment.get().uiLevel)) environment.set({ uiLevel: s.uiLevel });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [services, environment]);

  useEffect(() => onAppEvent(SHELL_NOTIFY, (message) => value.dialogs.notify(String(message))), [value.dialogs]);

  // Undo のできる・できないでボタンを描き直すため、プロジェクトの変化を購読しておく
  useSyncExternalStore(services.store.subscribe, services.store.get);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const { store } = services;
      if (matchesShortcut(e, 'Ctrl+Z')) {
        e.preventDefault();
        store.undo();
        return;
      }
      if (matchesShortcut(e, 'Ctrl+Shift+Z') || matchesShortcut(e, 'Ctrl+Y')) {
        e.preventDefault();
        store.redo();
        return;
      }
      const item = registry.get().menuItems.find((m) => m.shortcut && matchesShortcut(e, m.shortcut));
      if (item) {
        e.preventDefault();
        item.run();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [services]);

  return (
    <ShellContext.Provider value={value}>
      <Layout />
      <DialogHost controller={value.dialogs} />
    </ShellContext.Provider>
  );
}
