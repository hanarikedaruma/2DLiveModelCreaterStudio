// Tauri の fs プラグインの上の FileSystem（カード23）。パスは / 区切りの絶対パス
import type { FileSystem } from '@app/contracts';
import { renameWithRetry } from './rename';

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
  // 移動先にファイルがあれば置き換える（std::fs::rename。Windows では MoveFileEx の置き換えと同じ1回の操作）。
  // 失敗しても移動先は消さず、少し待って試し直す（カード58・I-057）
  async rename(from: string, to: string) {
    const fs = await this.fs;
    await renameWithRetry((a, b) => fs.rename(a, b), from, to);
  }
}
