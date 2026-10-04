// 一覧のクリックでの選択。Ctrl・Shift なら足す・外す、それ以外はそれだけを選ぶ
export function clickSelection(current: readonly string[], id: string, additive: boolean): string[] {
  if (!additive) return [id];
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}

// 右クリックした行が選択の中なら選択全体、外ならその行だけを対象にする
export function contextTargets(current: readonly string[], id: string): string[] {
  return current.includes(id) ? [...current] : [id];
}

// 消えたパーツを選択から外す。変わらなければ同じ配列を返す
export function pruneSelection(current: readonly string[], existing: ReadonlySet<string>): readonly string[] {
  const next = current.filter((id) => existing.has(id));
  return next.length === current.length ? current : next;
}
