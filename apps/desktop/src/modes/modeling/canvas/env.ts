// キャンバスのツールはフックを使えない素のオブジェクトなので、パネルの部品から services などを渡しておく
import { useEffect, useRef } from 'react';
import type { DeformedModel, Services, ViewTransform } from '@app/contracts';
import { useCanvas, useDialogs, useServices } from '../../../shell/api';
import type { ConfirmDialogs } from './liveEdit';

export interface ToolEnv {
  services: Services;
  dialogs: ConfirmDialogs;
  view(): ViewTransform;
  lastDeformed(): DeformedModel | null;
  requestRedraw(): void;
}

export interface EnvSlot {
  get(): ToolEnv | null;
  set(env: ToolEnv | null): void;
}

export function createEnvSlot(): EnvSlot {
  let env: ToolEnv | null = null;
  return {
    get: () => env,
    set(next) {
      env = next;
    },
  };
}

// パネルの部品の中で呼ぶ。外れたら外す
export function useBindEnv(slot: EnvSlot): void {
  const services = useServices();
  const dialogs = useDialogs();
  const { view, lastDeformed, requestRedraw } = useCanvas();
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const env: ToolEnv = { services, dialogs, view: () => viewRef.current, lastDeformed, requestRedraw };
    slot.set(env);
    return () => {
      if (slot.get() === env) slot.set(null);
    };
  }, [slot, services, dialogs, lastDeformed, requestRedraw]);
}
