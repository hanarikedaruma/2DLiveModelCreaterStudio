// 確認・通知・入力のダイアログ
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface Dialogs {
  confirm(message: string): Promise<boolean>;
  notify(message: string): void;
  prompt(message: string, initial?: string): Promise<string | null>;
  choose<T extends string>(message: string, choices: readonly DialogChoice<T>[]): Promise<T | null>;
}

export interface DialogChoice<T extends string = string> {
  value: T;
  label: string;
}

type Request =
  | { id: number; kind: 'confirm'; message: string; resolve: (v: boolean) => void }
  | { id: number; kind: 'prompt'; message: string; initial: string; resolve: (v: string | null) => void }
  | {
      id: number;
      kind: 'choose';
      message: string;
      choices: readonly DialogChoice[];
      resolve: (v: string | null) => void;
    };

interface DialogState {
  requests: Request[];
  toasts: { id: number; message: string }[];
}

export interface DialogController extends Dialogs {
  getState(): DialogState;
  subscribe(listener: () => void): () => void;
  answer(id: number, value: boolean | string | null): void;
  dismissToast(id: number): void;
}

export const TOAST_DURATION = 4000;

export function createDialogController(): DialogController {
  let state: DialogState = { requests: [], toasts: [] };
  let nextId = 1;
  const listeners = new Set<() => void>();
  const set = (next: DialogState) => {
    state = next;
    for (const l of [...listeners]) l();
  };

  const controller: DialogController = {
    confirm(message) {
      return new Promise((resolve) => {
        set({ ...state, requests: [...state.requests, { id: nextId++, kind: 'confirm', message, resolve }] });
      });
    },
    prompt(message, initial = '') {
      return new Promise((resolve) => {
        set({ ...state, requests: [...state.requests, { id: nextId++, kind: 'prompt', message, initial, resolve }] });
      });
    },
    choose<T extends string>(message: string, choices: readonly DialogChoice<T>[]) {
      if (choices.length === 0) return Promise.resolve(null);
      return new Promise<T | null>((resolve) => {
        set({
          ...state,
          requests: [
            ...state.requests,
            {
              id: nextId++,
              kind: 'choose',
              message,
              choices: choices.map((choice) => ({ ...choice })),
              resolve: (value) => resolve(value as T | null),
            },
          ],
        });
      });
    },
    notify(message) {
      const id = nextId++;
      set({ ...state, toasts: [...state.toasts, { id, message }] });
      setTimeout(() => controller.dismissToast(id), TOAST_DURATION);
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    answer(id, value) {
      const req = state.requests.find((r) => r.id === id);
      if (!req) return;
      if (
        req.kind === 'choose' &&
        value !== null &&
        (typeof value !== 'string' || !req.choices.some((choice) => choice.value === value))
      )
        return;
      set({ ...state, requests: state.requests.filter((r) => r.id !== id) });
      if (req.kind === 'confirm') req.resolve(value === true);
      else req.resolve(typeof value === 'string' ? value : null);
    },
    dismissToast(id) {
      if (state.toasts.some((t) => t.id === id)) set({ ...state, toasts: state.toasts.filter((t) => t.id !== id) });
    },
  };
  return controller;
}

function DialogBox({ request, controller }: { request: Request; controller: DialogController }) {
  const [text, setText] = useState(request.kind === 'prompt' ? request.initial : '');
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (request.kind === 'prompt') inputRef.current?.select();
    else okRef.current?.focus();
  }, [request.kind]);
  const ok = () => controller.answer(request.id, request.kind === 'confirm' ? true : text);
  const cancel = () => controller.answer(request.id, request.kind === 'confirm' ? false : null);
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={request.message}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
          // 選択ダイアログのEnterは、フォーカス中のボタンの標準のclickに任せる。
          if (e.key === 'Enter' && request.kind !== 'choose' && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            ok();
          }
          if (e.key === 'Tab' && request.kind === 'choose') {
            const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0 || (e.shiftKey && index === 0) || (!e.shiftKey && index === buttons.length - 1)) {
              e.preventDefault();
              (e.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
            }
          }
        }}
      >
        <p className="dialog-message">{request.message}</p>
        {request.kind === 'prompt' && (
          <input ref={inputRef} className="dialog-input" value={text} onChange={(e) => setText(e.target.value)} />
        )}
        <div className="dialog-buttons">
          {request.kind === 'choose' ? (
            request.choices.map((choice, index) => (
              <button
                type="button"
                key={choice.value}
                className={index === 0 ? 'primary' : undefined}
                ref={index === 0 ? okRef : undefined}
                onClick={() => controller.answer(request.id, choice.value)}
              >
                {choice.label}
              </button>
            ))
          ) : (
            <>
              <button type="button" onClick={cancel}>
                キャンセル
              </button>
              <button type="button" className="primary" ref={okRef} onClick={ok}>
                OK
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function DialogHost({ controller }: { controller: DialogController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const top = state.requests[0];
  return (
    <>
      {top && <DialogBox key={top.id} request={top} controller={controller} />}
      <div className="toasts" role="status" aria-live="polite">
        {state.toasts.map((t) => (
          <div key={t.id} className="toast" onClick={() => controller.dismissToast(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}
