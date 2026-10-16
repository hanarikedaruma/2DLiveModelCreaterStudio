// プリセット（カード26）。個別に数値を変えたあと、選択肢のどれに当たるかを調べる

export const PRESET_TOLERANCE = 1e-6;

// values がプリセットのどれかと一致すれば（すべての項目の差が tolerance 以下）、最初に一致したプリセットの名前。
// どれとも一致しなければ 'custom'
export function presetOf<T extends Record<string, number>>(
  values: T,
  presets: Record<string, T>,
  tolerance = PRESET_TOLERANCE,
): string | 'custom' {
  for (const [name, preset] of Object.entries(presets)) {
    const keys = new Set([...Object.keys(preset), ...Object.keys(values)]);
    let match = true;
    for (const key of keys) {
      const a = values[key];
      const b = preset[key];
      // 片方にしか無い項目や数値でない値は一致しない
      if (a === undefined || b === undefined || !(Math.abs(a - b) <= tolerance)) {
        match = false;
        break;
      }
    }
    if (match) return name;
  }
  return 'custom';
}
