// ホットキーの対象（表情・シーン・背景・パラメータ・アニメーション）の選択肢と表示、ホットキーを書き換えるコマンド
import type { Hotkey, Project } from '@app/schema';
import type { Command } from '@app/contracts';
import { sameBackground, type SceneBackground } from '../modes/studio/scene';
import { normalizeKeys } from './keys';

export type HotkeyAction = Hotkey['action'];
export type HotkeyMode = Hotkey['mode'];

export const ACTIONS: { id: HotkeyAction; label: string }[] = [
  { id: 'expression', label: '表情' },
  { id: 'scene', label: 'シーン' },
  { id: 'background', label: '背景' },
  { id: 'parameter', label: 'パラメータ' },
  { id: 'animation', label: 'アニメーション' },
  { id: 'pauseTracking', label: 'トラッキングの一時停止' },
  { id: 'recalibrate', label: 'キャリブレーションのやり直し' },
];

export const MODE_LABEL: Record<HotkeyMode, string> = { toggle: '切り替え', hold: '押している間' };

export function actionLabel(action: HotkeyAction): string {
  return ACTIONS.find((a) => a.id === action)?.label ?? action;
}

// 対象を選ぶ動作か（pauseTracking・recalibrate は対象なし）
export function hasTarget(action: HotkeyAction): boolean {
  return action !== 'pauseTracking' && action !== 'recalibrate';
}

// 切り替え・押している間を選ぶ動作か（recalibrate は押したときに1回だけ）
export function hasMode(action: HotkeyAction): boolean {
  return action !== 'recalibrate';
}

// ---- 背景の対象 ----
// targetId は 'transparent'・'color:#rrggbb'・'image:<プロジェクトからの相対パス>'

export function backgroundTargetId(bg: SceneBackground): string {
  if (bg.type === 'color') return `color:${bg.color.toLowerCase()}`;
  if (bg.type === 'image') return `image:${bg.path}`;
  return 'transparent';
}

export function backgroundFromTargetId(id: string): SceneBackground | null {
  if (id === 'transparent') return { type: 'transparent' };
  if (id.startsWith('color:') && id.length > 6) return { type: 'color', color: id.slice(6) };
  if (id.startsWith('image:') && id.length > 6) return { type: 'image', path: id.slice(6) };
  return null;
}

export const BACKGROUND_PRESETS: { label: string; background: SceneBackground }[] = [
  { label: '透明', background: { type: 'transparent' } },
  { label: '緑', background: { type: 'color', color: '#00ff00' } },
  { label: '青', background: { type: 'color', color: '#0000ff' } },
  { label: '白', background: { type: 'color', color: '#ffffff' } },
  { label: '黒', background: { type: 'color', color: '#000000' } },
];

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

export function backgroundLabel(bg: SceneBackground): string {
  const preset = BACKGROUND_PRESETS.find((p) => sameBackground(p.background, bg));
  if (preset) return preset.label;
  if (bg.type === 'image') return `画像（${fileName(bg.path)}）`;
  if (bg.type === 'color') return `色（${bg.color}）`;
  return '透明';
}

// ---- 対象の選択肢 ----

export interface TargetOption {
  value: string; // targetId。表情の「解除」だけ ''（targetId は null）
  label: string;
  group?: string;
}

export const CLEAR_EXPRESSION_LABEL = '（表情を解除）';

export function targetOptions(action: HotkeyAction, project: Project): TargetOption[] {
  switch (action) {
    case 'expression':
      return [
        { value: '', label: CLEAR_EXPRESSION_LABEL },
        ...project.expressions.map((e) => ({ value: e.id, label: e.name })),
      ];
    case 'scene':
      return project.studio.scenes.map((s) => ({ value: s.id, label: s.name }));
    case 'background': {
      // 決まった色と、シーンで使っている色・画像
      const list = BACKGROUND_PRESETS.map((p) => p.background);
      for (const s of project.studio.scenes) {
        if (!list.some((b) => sameBackground(b, s.background))) list.push(s.background);
      }
      return list.map((b) => ({ value: backgroundTargetId(b), label: backgroundLabel(b) }));
    }
    case 'parameter': {
      const params = project.model.parameters;
      return [
        ...params.filter((p) => !p.standard).map((p) => ({ value: p.id, label: p.name, group: 'ユーザー定義' })),
        ...params.filter((p) => p.standard).map((p) => ({ value: p.id, label: p.name, group: '標準' })),
      ];
    }
    case 'animation':
      return project.animations.map((a) => ({ value: a.id, label: a.name }));
    default:
      return [];
  }
}

// 対象の名前。見つからなければ '（見つからない）'
export function targetLabel(hotkey: Pick<Hotkey, 'action' | 'targetId'>, project: Project): string {
  const { action, targetId } = hotkey;
  if (action === 'expression' && targetId === null) return CLEAR_EXPRESSION_LABEL;
  if (targetId === null) return '（見つからない）';
  if (action === 'background') {
    const bg = backgroundFromTargetId(targetId);
    return bg ? backgroundLabel(bg) : '（見つからない）';
  }
  const found = targetOptions(action, project).find((o) => o.value === targetId);
  return found?.label ?? '（見つからない）';
}

export function describeHotkey(hotkey: Hotkey, project: Project): string {
  const label = actionLabel(hotkey.action);
  return hasTarget(hotkey.action) ? `${label}: ${targetLabel(hotkey, project)}` : label;
}

// 同じキーを先に使っているホットキーがあるものの id（読めないキーは含めない）
export function duplicateHotkeyIds(hotkeys: Hotkey[]): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const h of hotkeys) {
    const keys = normalizeKeys(h.keys);
    if (keys === null) continue;
    if (seen.has(keys)) out.add(h.id);
    seen.add(keys);
  }
  return out;
}

// ---- コマンド ----

export function addHotkeyCommand(hotkey: Hotkey): Command {
  return {
    label: 'ホットキーを追加',
    apply: (p) => ({ ...p, studio: { ...p.studio, hotkeys: [...p.studio.hotkeys, hotkey] } }),
  };
}

export function removeHotkeyCommand(id: string): Command {
  return {
    label: 'ホットキーを削除',
    apply(p) {
      if (!p.studio.hotkeys.some((h) => h.id === id)) return p;
      return { ...p, studio: { ...p.studio, hotkeys: p.studio.hotkeys.filter((h) => h.id !== id) } };
    },
  };
}

// 使うシーンを変える。無いシーン・いまのシーンなら何もしない
export function setActiveSceneCommand(sceneId: string): Command {
  return {
    label: 'シーンを切り替える',
    apply(p) {
      if (p.studio.activeSceneId === sceneId || !p.studio.scenes.some((s) => s.id === sceneId)) return p;
      return { ...p, studio: { ...p.studio, activeSceneId: sceneId } };
    },
  };
}
