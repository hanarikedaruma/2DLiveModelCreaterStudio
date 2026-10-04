// テスト用の道具（テストからだけ使う）
import { MemoryFileSystem, sha256Hex, type Command, type ProjectStore } from '@app/contracts';
import { createEmptyProject, newId, type Asset, type Project } from '@app/schema';

// 呼び出しを記録する MemoryFileSystem。failOn に当たるパスへの書き込みは失敗させる
export class RecordingFileSystem extends MemoryFileSystem {
  readonly calls: string[] = [];
  failOn: ((path: string) => boolean) | null = null;
  private inWriteText = false;

  override async writeText(path: string, data: string): Promise<void> {
    this.calls.push(`writeText ${path}`);
    if (this.failOn?.(path)) throw new Error(`書き込みに失敗した: ${path}`);
    this.inWriteText = true;
    try {
      await super.writeText(path, data);
    } finally {
      this.inWriteText = false;
    }
  }

  // writeText の中からも呼ばれるので、直接の呼び出しだけを記録する
  override async writeBinary(path: string, data: Uint8Array): Promise<void> {
    if (!this.inWriteText) {
      this.calls.push(`writeBinary ${path}`);
      if (this.failOn?.(path)) throw new Error(`書き込みに失敗した: ${path}`);
    }
    await super.writeBinary(path, data);
  }

  override async rename(from: string, to: string): Promise<void> {
    this.calls.push(`rename ${from} -> ${to}`);
    await super.rename(from, to);
  }

  override async remove(path: string): Promise<void> {
    this.calls.push(`remove ${path}`);
    await super.remove(path);
  }

  writes(): string[] {
    return this.calls.filter((c) => c.startsWith('write'));
  }
}

// 素材付きのプロジェクト。画像はそれぞれ違うバイト列にする
export async function projectWithAssets(
  count: number,
): Promise<{ project: Project; pngs: Record<string, Uint8Array> }> {
  const base = createEmptyProject('テストのモデル');
  const pngs: Record<string, Uint8Array> = {};
  const assets: Asset[] = [];
  for (let i = 0; i < count; i++) {
    const id = newId();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, i, i + 1, i + 2]);
    pngs[id] = png;
    assets.push({
      id,
      path: `assets/${id}.png`,
      hash: await sha256Hex(png),
      width: 10 + i,
      height: 20,
      offset: { x: i, y: 2 * i },
      canvasSize: { width: 1200, height: 1000 },
      source: { kind: 'psd', file: 'model.psd', layerName: `レイヤー${i}`, layerPath: ['頭'], hidden: i === 1 },
      sourceBlendMode: 'normal',
      sourceOpacity: 1,
    });
  }
  return { project: { ...base, assets }, pngs };
}

// 最小のストア（Undo は無い）
export function createTestStore(initial: Project): ProjectStore & { set(project: Project): void } {
  let current = initial;
  const listeners = new Set<(p: Project) => void>();
  const emit = (): void => listeners.forEach((l) => l(current));
  const set = (project: Project): void => {
    current = project;
    emit();
  };
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch: (command: Command) => set(command.apply(current)),
    transaction(_label, run) {
      let next = current;
      run((c) => {
        next = c.apply(next);
      });
      set(next);
    },
    undo() {},
    redo() {},
    canUndo: () => false,
    canRedo: () => false,
    load: set,
    set,
  };
}

export function rename(name: string): Command {
  return { label: '名前を変える', apply: (p) => ({ ...p, name }) };
}
