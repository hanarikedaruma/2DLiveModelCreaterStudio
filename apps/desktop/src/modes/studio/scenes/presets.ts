// 背景プリセット（透明・緑・青・白・黒）と、背景の表示名。
// 色の形はホットキー（カード40）の背景の対象（'color:#rrggbb'）と同じ小文字の #rrggbb
import { sameBackground, type SceneBackground } from '../scene';

export interface BackgroundPreset {
  id: string;
  label: string;
  background: SceneBackground;
}

export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = [
  { id: 'transparent', label: '透明', background: { type: 'transparent' } },
  { id: 'green', label: '緑', background: { type: 'color', color: '#00ff00' } },
  { id: 'blue', label: '青', background: { type: 'color', color: '#0000ff' } },
  { id: 'white', label: '白', background: { type: 'color', color: '#ffffff' } },
  { id: 'black', label: '黒', background: { type: 'color', color: '#000000' } },
];

export function findBackgroundPreset(bg: SceneBackground): BackgroundPreset | null {
  return BACKGROUND_PRESETS.find((p) => sameBackground(p.background, bg)) ?? null;
}

export function fileNameOf(path: string): string {
  return path.split('/').pop() || path;
}

export function backgroundLabel(bg: SceneBackground): string {
  const preset = findBackgroundPreset(bg);
  if (preset) return preset.label;
  if (bg.type === 'image') return `画像（${fileNameOf(bg.path)}）`;
  if (bg.type === 'color') return `色（${bg.color}）`;
  return '透明';
}

// 背景の画像のプリセット: backgrounds/ にある画像と、シーンで使っている画像（重なりを除いて名前の順）
export function backgroundImagePaths(listed: readonly string[], scenes: readonly { background: SceneBackground }[]) {
  const out = new Set(listed);
  for (const s of scenes) if (s.background.type === 'image') out.add(s.background.path);
  return [...out].sort();
}
