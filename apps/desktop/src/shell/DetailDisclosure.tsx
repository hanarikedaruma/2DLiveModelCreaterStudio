// かんたんモードで、その項目だけ詳細を一時的に開く（カード26）。詳細モードでは中身をそのまま出す
import { useId, useState, useSyncExternalStore, type JSX } from 'react';
import { useShell } from './context';

export function DetailDisclosure(props: { label?: string; children: React.ReactNode }): JSX.Element {
  const { editor: store } = useShell().services;
  const editor = useSyncExternalStore(store.subscribe, store.get);
  const [open, setOpen] = useState(false);
  const contentId = useId();
  if (editor.uiLevel[editor.mode] === 'detail') return <>{props.children}</>;
  return (
    <div className="detail-disclosure">
      <button
        type="button"
        className="detail-disclosure-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {props.label ?? '詳細'}
      </button>
      {open && (
        <div id={contentId} className="detail-disclosure-content">
          {props.children}
        </div>
      )}
    </div>
  );
}
