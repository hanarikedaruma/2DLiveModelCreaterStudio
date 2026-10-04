import { createContext, useContext } from 'react';
import type { Services } from '@app/contracts';
import type { CanvasController } from './canvas/controller';
import type { DialogController } from './dialogs';
import type { EnvironmentStore } from './environment';

export interface ShellContextValue {
  services: Services;
  environment: EnvironmentStore;
  dialogs: DialogController;
  canvas: CanvasController;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('<Shell> の外で枠のフックを使った');
  return value;
}
