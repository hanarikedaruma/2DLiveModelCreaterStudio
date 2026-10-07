import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Hotkey, type Project } from '@app/schema';
import {
  addHotkeyCommand,
  backgroundFromTargetId,
  backgroundTargetId,
  describeHotkey,
  duplicateHotkeyIds,
  removeHotkeyCommand,
  setActiveSceneCommand,
  targetOptions,
} from './targets';

function project(): Project {
  const p = createEmptyProject('テスト');
  const scene = p.studio.scenes[0]!;
  return {
    ...p,
    model: {
      ...p.model,
      parameters: [
        ...p.model.parameters,
        { id: 'Tears', name: '涙', groupId: 'other', min: 0, max: 1, default: 0, standard: false },
      ],
    },
    studio: {
      ...p.studio,
      scenes: [
        { ...scene, id: 's1', name: '雑談', background: { type: 'image', path: 'backgrounds/room.png' } },
        { ...scene, id: 's2', name: 'ゲーム', background: { type: 'color', color: '#FF00FF' } },
      ],
      activeSceneId: 's1',
    },
  };
}

const hk = (id: string, extra: Partial<Hotkey>): Hotkey => ({
  id,
  keys: 'F1',
  action: 'recalibrate',
  targetId: null,
  mode: 'toggle',
  ...extra,
});

describe('ホットキーの対象', () => {
  it('背景の targetId は種類と値をそのまま持つ', () => {
    expect(backgroundTargetId({ type: 'transparent' })).toBe('transparent');
    expect(backgroundTargetId({ type: 'color', color: '#00FF00' })).toBe('color:#00ff00');
    expect(backgroundTargetId({ type: 'image', path: 'backgrounds/a.png' })).toBe('image:backgrounds/a.png');
    expect(backgroundFromTargetId('image:backgrounds/a.png')).toEqual({ type: 'image', path: 'backgrounds/a.png' });
    expect(backgroundFromTargetId('color:')).toBeNull();
    expect(backgroundFromTargetId('なにか')).toBeNull();
  });

  it('背景の選択肢は決まった色と、シーンで使っている色・画像', () => {
    expect(targetOptions('background', project()).map((o) => o.label)).toEqual([
      '透明',
      '緑',
      '青',
      '白',
      '黒',
      '画像（room.png）',
      '色（#FF00FF）',
    ]);
  });
  it('シーンで使っていない画像も重複せずに背景の対象に出る', () => {
    const options = targetOptions('background', project(), ['backgrounds/unused.png', 'backgrounds/room.png']);
    expect(options.some((o) => o.value === 'image:backgrounds/unused.png')).toBe(true);
    expect(options.filter((o) => o.value === 'image:backgrounds/room.png')).toHaveLength(1);
  });

  it('パラメータはユーザー定義を先に並べる', () => {
    const options = targetOptions('parameter', project());
    expect(options[0]).toEqual({ value: 'Tears', label: '涙', group: 'ユーザー定義' });
    expect(options.slice(1).every((o) => o.group === '標準')).toBe(true);
  });

  it('表情は「解除」を先頭に置く', () => {
    expect(targetOptions('expression', project())).toEqual([{ value: '', label: '（表情を解除）' }]);
  });

  it('一覧の説明。対象が無ければ「見つからない」', () => {
    const p = project();
    expect(describeHotkey(hk('a', { action: 'scene', targetId: 's2' }), p)).toBe('シーン: ゲーム');
    expect(describeHotkey(hk('a', { action: 'scene', targetId: 'none' }), p)).toBe('シーン: （見つからない）');
    expect(describeHotkey(hk('a', { action: 'background', targetId: 'color:#000000' }), p)).toBe('背景: 黒');
    expect(describeHotkey(hk('a', { action: 'expression', targetId: null }), p)).toBe('表情: （表情を解除）');
    expect(describeHotkey(hk('a', { action: 'pauseTracking' }), p)).toBe('トラッキングの一時停止');
  });

  it('同じキー（書き方違いを含む）のあとのものを見つける', () => {
    const ids = duplicateHotkeyIds([
      hk('a', { keys: 'Ctrl+Shift+1' }),
      hk('b', { keys: 'F2' }),
      hk('c', { keys: 'shift+control+1' }),
    ]);
    expect([...ids]).toEqual(['c']);
  });
});

describe('コマンド', () => {
  it('追加と削除', () => {
    const p = project();
    const added = addHotkeyCommand(hk('a', {})).apply(p);
    expect(added.studio.hotkeys.map((h) => h.id)).toEqual(['a']);
    expect(removeHotkeyCommand('a').apply(added).studio.hotkeys).toEqual([]);
    expect(removeHotkeyCommand('none').apply(added)).toBe(added);
  });

  it('シーンの切り替え。無いシーン・いまのシーンは同じ参照を返す（Undo に積まない）', () => {
    const p = project();
    expect(setActiveSceneCommand('s2').apply(p).studio.activeSceneId).toBe('s2');
    expect(setActiveSceneCommand('s1').apply(p)).toBe(p);
    expect(setActiveSceneCommand('none').apply(p)).toBe(p);
  });
});
