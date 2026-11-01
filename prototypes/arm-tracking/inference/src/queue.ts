// 処理中の1枚とは別に、最新の待ちを1枚だけ持つ。古い待ちは閉じて捨て、キューを積まない
export interface Closable {
  close(): void;
}

export class LatestSlot<T extends Closable> {
  private pending: T | null = null;
  dropped = 0;

  offer(item: T): void {
    if (this.pending) {
      this.pending.close();
      this.dropped++;
    }
    this.pending = item;
  }

  take(): T | null {
    const item = this.pending;
    this.pending = null;
    return item;
  }

  clear(): void {
    this.pending?.close();
    this.pending = null;
  }

  get waiting(): boolean {
    return this.pending !== null;
  }
}
