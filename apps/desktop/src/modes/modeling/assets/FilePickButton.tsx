// ファイルを選ぶボタン（PSD・PNG を複数）
import { useRef } from 'react';

export const ACCEPT_ASSET_FILES = '.psd,.png,image/png,image/vnd.adobe.photoshop';

export function FilePickButton({
  label,
  onFiles,
  className,
  disabled,
}: {
  label: string;
  onFiles(files: File[]): void;
  className?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => inputRef.current?.click()}>
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ASSET_FILES}
        hidden
        aria-label={label}
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}
