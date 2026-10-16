// アプリの枠のいちばん外側。サービス・環境設定・ダイアログ・キャンバスの状態を配り、
// Ctrl+Z（undo）・Ctrl+Shift+Z と Ctrl+Y（redo）・メニューのショートカットを処理する
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Services } from '@app/contracts';
import { createCanvasController, type CanvasController } from './canvas/controller';
import { ShellContext, type ShellContextValue } from './context';
import { DialogHost, createDialogController, type DialogController } from './dialogs';
import type { EnvironmentStore } from './environment';
import { onAppEvent } from './events';
import { isTextEditingTarget, isTypingTarget, matchesShortcut } from './keys';
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

  useEffect(() => {
    void environment.load();
  }, [environment]);
  useEffect(() => onAppEvent(SHELL_NOTIFY, (message) => value.dialogs.notify(String(message))), [value.dialogs]);

  // Undo のできる・できないでボタンを描き直すため、プロジェクトの変化を購読しておく
  useSyncExternalStore(services.store.subscribe, services.store.get);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      const { store } = services;
      if (matchesShortcut(e, 'Ctrl+Z')) {
        if (isTextEditingTarget(e.target)) return;
        e.preventDefault();
        store.undo();
        return;
      }
      if (matchesShortcut(e, 'Ctrl+Shift+Z') || matchesShortcut(e, 'Ctrl+Y')) {
        if (isTextEditingTarget(e.target)) return;
        e.preventDefault();
        store.redo();
        return;
      }
      if (isTypingTarget(e.target)) return;
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
