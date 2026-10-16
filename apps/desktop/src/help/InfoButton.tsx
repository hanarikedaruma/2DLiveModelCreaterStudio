import { useId, useRef, useState, type ReactNode } from 'react';
import { getInfoText } from './infoTexts';

// 既存のパネルの目的・手順も、外部テキストの使いどころも同じ部品で表示する。
export function InfoContent({
  info,
}: {
  info: { purpose: string; uses?: readonly string[]; steps: readonly string[] } | undefined;
}) {
  if (!info) return <p className="panel-info-purpose">説明を読み込めませんでした</p>;
  return (
    <>
      <p className="panel-info-purpose">{info.purpose}</p>
      {info.uses && info.uses.length > 0 && (
        <ul className="panel-info-uses">
          {info.uses.map((use, index) => (
            <li key={index}>{use}</li>
          ))}
        </ul>
      )}
      {info.steps.length > 0 && (
        <ol className="panel-info-steps">
          {info.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      )}
    </>
  );
}

export function InfoButton({ infoId, title, children }: { infoId: string; title?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const info = getInfoText(infoId);
  const label = `「${title ?? info?.title ?? infoId}」の説明`;
  return (
    <div
      className="info-control"
      data-info-id={infoId}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <div className="info-control-action">
        {children}
        <button
          type="button"
          className="panel-info-button"
          ref={button}
          aria-label={label}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
        >
          ⓘ
        </button>
      </div>
      {open && (
        <div className="panel-info inline-info" id={contentId} role="note" aria-label={label}>
          <InfoContent info={info} />
        </div>
      )}
    </div>
  );
}
