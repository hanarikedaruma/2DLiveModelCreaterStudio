// Tauri の上で動いているときだけ使うもの
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Windows のパス（C:\a\b）を / 区切りにする
export function toSlashPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

// 環境設定（environment.json）を置くフォルダ
export async function appConfigDirPath(): Promise<string> {
  const { appConfigDir } = await import('@tauri-apps/api/path');
  return toSlashPath(await appConfigDir());
}

// アプリのデータのフォルダ（保存先の無いプロジェクトの自動保存 unsaved/ を置く）
export async function appDataDirPath(): Promise<string> {
  const { appDataDir } = await import('@tauri-apps/api/path');
  return toSlashPath(await appDataDir());
}

// フォルダを選ぶダイアログ。選ばなければ null
export async function pickFolderWithDialog(title: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === 'string' ? toSlashPath(picked) : null;
}
