import { useEffect, useRef, useState } from 'react';

/** Observe text, defer IME composition, debounce changes and discard only this editor's draft. */
export function useSpeechDraft(
  text: string,
  enabled: boolean,
  settingsKey: string,
  prepare: (text: string, owner: string, revision: number) => Promise<void>,
  discard: (owner: string) => Promise<void>,
) {
  const [owner] = useState(() => crypto.randomUUID());
  const [composing, setComposing] = useState(false);
  const revision = useRef(0);
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  const discardRef = useRef(discard);
  discardRef.current = discard;
  useEffect(
    () => () => {
      void discardRef.current(owner).catch(() => {});
    },
    [owner],
  );
  useEffect(() => {
    if (!enabled || composing) return;
    const mine = ++revision.current;
    const timer = setTimeout(
      () => {
        void prepareRef.current(text, owner, mine).catch(() => {});
      },
      text.trim() ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [text, enabled, composing, settingsKey, owner]);
  return { owner, onCompositionStart: () => setComposing(true), onCompositionEnd: () => setComposing(false) };
}
