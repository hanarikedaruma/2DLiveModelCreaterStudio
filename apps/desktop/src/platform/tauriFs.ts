// Tauri の fs プラグインの上の FileSystem（カード23）。パスは / 区切りの絶対パス
import type { FileSystem } from '@app/contracts';

export class TauriFileSystem implements FileSystem {
  private fs = import('@tauri-apps/plugin-fs');

  async readText(path: string) {
    return (await this.fs).readTextFile(path);
  }
  async writeText(path: string, data: string) {
    await (await this.fs).writeTextFile(path, data);
  }
  async readBinary(path: string) {
    return (await this.fs).readFile(path);
  }
  async writeBinary(path: string, data: Uint8Array) {
    await (await this.fs).writeFile(path, data);
  }
  async exists(path: string) {
    return (await this.fs).exists(path);
  }
  // 途中のフォルダもまとめて作る。すでにあっても失敗しない
  async mkdir(path: string) {
    const fs = await this.fs;
    if (await fs.exists(path)) return;
    await fs.mkdir(path, { recursive: true });
  }
  // 直下の名前（パスではなく名前）を名前順に返す
  async list(dir: string) {
    const entries = await (await this.fs).readDir(dir);
    return entries.map((e) => e.name).sort();
  }
  async remove(path: string) {
    await (await this.fs).remove(path, { recursive: true });
  }
  // 移動先にファイルがあれば置き換える（Windows の MoveFileEx と同じ。念のため先に消す）
  async rename(from: string, to: string) {
    const fs = await this.fs;
    try {
      await fs.rename(from, to);
    } catch (e) {
      if (!(await fs.exists(to))) throw e;
      await fs.remove(to);
      await fs.rename(from, to);
    }
  }
}
