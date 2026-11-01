import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '@app/contracts';
import { createProjectIO } from '@app/io';
import { createAnimation } from './commands';
import { sampleAnimationData, setupAnimationScreen, step1Project } from './testShell';

const pressed = (scope: ReturnType<typeof within>, group: string) =>
  within(scope.getByRole('group', { name: group }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent);

async function answerConfirm(ok: boolean) {
  const dialog = await screen.findByRole('dialog', { name: '個別に調整した値を上書きします' });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: ok ? 'OK' : 'キャンセル' }));
  });
}

describe('登録の設定', () => {
  it('現在の姿勢からの実験設定をUndo・プリセット切替・保存後の再読込で保つ（I-060）', async () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    const box = () =>
      s.settings().getByRole('checkbox', { name: '現在の姿勢を始点にする（実験）' }) as HTMLInputElement;
    expect(box().checked).toBe(false);
    s.click(box());
    expect(s.animation().transition.startFromCurrent).toBe(true);
    expect(s.settings().getByText(/タイムラインは記録した値/)).toBeTruthy();
    act(() => s.store.undo());
    expect(box().checked).toBe(false);
    act(() => s.store.redo());
    s.click(s.settings().getByRole('button', { name: 'ゆっくり' }));
    expect(s.animation().transition.startFromCurrent).toBe(true);
    const io = createProjectIO(new MemoryFileSystem()),
      p = s.store.get();
    await io.save('/i060', p, {});
    const loaded = await io.load('/i060');
    expect(loaded.project.schemaVersion).toBe(12);
    expect(loaded.project.animations[0]!.transition.startFromCurrent).toBe(true);
    expect(loaded.project.animations[0]!.tracks).toEqual(p.animations[0]!.tracks);
  });
  it('アニメーションが無ければそう出す', () => {
    const { settings } = setupAnimationScreen();
    expect(settings().getByText('アニメーションを選ぶと設定できる')).toBeTruthy();
  });

  it('再生速度・ループ・再開始を変える（1回ずつ Undo で戻る）', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    s.enter(s.settings(), '再生速度（倍）', 1.5);
    s.click(s.settings().getByRole('checkbox', { name: 'ループ（止めるまで繰り返す）' }));
    s.click(s.settings().getByRole('button', { name: '無視' }));
    expect(s.animation()).toMatchObject({ speed: 1.5, loop: true, restart: 'ignore' });
    expect(pressed(s.settings(), '再開始')).toEqual(['無視']);
    // 一覧にもループと出る
    expect(s.list().getByRole('button', { name: 'うなずき' }).textContent).toContain('ループ');
    // 範囲の外は端にする
    s.enter(s.settings(), '再生速度（倍）', 0);
    expect(s.animation().speed).toBe(0.1);

    act(() => s.store.undo());
    expect(s.animation().speed).toBe(1.5);
    act(() => s.store.undo());
    expect(s.animation().restart).toBe('restart');
    act(() => s.store.undo());
    expect(s.animation().loop).toBe(false);
    act(() => s.store.undo());
    expect(s.animation().speed).toBe(1);
  });

  it('遷移のプリセットと「トラッキングに戻る」を選べ、数値と合成方法も常に表示する', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    expect(pressed(s.settings(), '遷移')).toEqual(['自動']);
    s.click(s.settings().getByRole('button', { name: 'ゆっくり' }));
    expect(s.animation().transition).toMatchObject({ preset: 'slow', blendIn: 0.7, blendOut: 0.8 });
    s.click(s.settings().getByRole('button', { name: 'すばやく' }));
    expect(s.animation().transition).toMatchObject({ preset: 'quick', blendIn: 0.15, blendOut: 0.2 });
    s.click(s.settings().getByRole('button', { name: '自然' }));
    expect(s.animation().transition).toMatchObject({ preset: 'natural', blendIn: 0.35, blendOut: 0.4 });
    expect(pressed(s.settings(), '遷移')).toEqual(['自然']);
    s.click(s.settings().getByRole('checkbox', { name: 'トラッキングに戻る' }));
    expect(s.animation().transition.returnToTracking).toBe(false);

    expect(s.settings().getByRole('group', { name: '合成方法' })).toBeTruthy();
    expect(s.settings().getByRole('spinbutton', { name: '始まりの遷移（blendIn、秒）' })).toBeTruthy();
  });

  it('詳細: blendIn・blendOut・カーブ・合成方法・リップシンクを維持・物理演算を維持', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));

    s.enter(s.settings(), '始まりの遷移（blendIn、秒）', 0.5);
    s.enter(s.settings(), '終わりの遷移（blendOut、秒）', 1.2);
    s.click(s.settings().getByRole('button', { name: '線形' }));
    s.click(s.settings().getByRole('button', { name: 'トラッキングに加算' }));
    s.click(s.settings().getByRole('checkbox', { name: 'リップシンクを維持' }));
    s.click(s.settings().getByRole('checkbox', { name: '物理演算を維持' }));
    expect(s.animation().transition).toEqual({
      preset: 'custom',
      blendIn: 0.5,
      blendOut: 1.2,
      curve: 'linear',
      blendMode: 'addToTracking',
      keepLipSync: false,
      keepPhysics: false,
      returnToTracking: true,
    });
    // どのプリセットとも違うのでカスタムと出る
    expect(pressed(s.settings(), '遷移')).toEqual(['カスタム']);
    expect(pressed(s.settings(), '遷移のカーブ')).toEqual(['線形']);
    expect(pressed(s.settings(), '合成方法')).toEqual(['トラッキングに加算']);
    // プリセットの値にすると、その名前に戻る
    s.enter(s.settings(), '始まりの遷移（blendIn、秒）', 0.7);
    s.enter(s.settings(), '終わりの遷移（blendOut、秒）', 0.8);
    expect(s.animation().transition.preset).toBe('slow');
  });

  it('カスタムのときにプリセットを選ぶと上書きを確かめる。キャンセルならそのまま', async () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));

    s.enter(s.settings(), '始まりの遷移（blendIn、秒）', 0.5);
    s.click(s.settings().getByRole('button', { name: 'すばやく' }));
    await answerConfirm(false);
    expect(s.animation().transition).toMatchObject({ preset: 'custom', blendIn: 0.5 });
    s.click(s.settings().getByRole('button', { name: 'すばやく' }));
    await answerConfirm(true);
    expect(s.animation().transition).toMatchObject({ preset: 'quick', blendIn: 0.15, blendOut: 0.2 });
    // プリセットからプリセットへは確かめない
    s.click(s.settings().getByRole('button', { name: 'ゆっくり' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(s.animation().transition.preset).toBe('slow');
  });

  it('影響範囲: 自動からグループごとに選べ、すべて外すと自動', () => {
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));
    const status = () => s.settings().getByLabelText('影響範囲の状態').textContent;
    expect(status()).toBe('自動（トラックのあるグループ: 顔・目・口）');
    expect(s.settings().getByRole('radio', { name: 'グループを選ぶ' })).toBeTruthy();

    s.click(s.settings().getByRole('radio', { name: 'グループを選ぶ' }));
    expect(s.animation().affectedGroups).toEqual(['face', 'eye', 'mouth']);
    const groups = () => within(s.settings().getByRole('group', { name: '影響するグループ' }));
    s.click(groups().getByRole('checkbox', { name: '目' }));
    s.click(groups().getByRole('checkbox', { name: '体' }));
    expect(s.animation().affectedGroups).toEqual(['face', 'mouth', 'body']);
    expect(status()).toBe('選んだグループ: 顔・口・体');

    s.click(s.settings().getByRole('radio', { name: '自動（トラックのあるグループ）' }));
    expect(s.animation().affectedGroups).toEqual([]);
    expect(s.settings().queryByRole('group', { name: '影響するグループ' })).toBeNull();
  });

  it('影響範囲: トラックが無くても「グループを選ぶ」で選べる。すべて外すと自動に戻る', () => {
    const empty = setupAnimationScreen(step1Project([createAnimation('空', 'empty')]));

    expect(empty.settings().getByLabelText('影響範囲の状態').textContent).toBe(
      '自動（トラックのあるグループ: まだ無い）',
    );
    empty.click(empty.settings().getByRole('radio', { name: 'グループを選ぶ' }));
    const g = () => within(empty.settings().getByRole('group', { name: '影響するグループ' }));
    empty.click(g().getByRole('checkbox', { name: '左腕' }));
    expect(empty.animation().affectedGroups).toEqual(['armL']);
    empty.click(g().getByRole('checkbox', { name: '左腕' }));
    expect(empty.animation().affectedGroups).toEqual([]);
    expect(empty.settings().getByRole('radio', { name: '自動（トラックのあるグループ）' })).toHaveProperty(
      'checked',
      true,
    );
  });

  it('登録の設定は保存される（保存して読み直しても同じ。読み直した画面にも出る）', async () => {
    const io = createProjectIO(new MemoryFileSystem());
    const s = setupAnimationScreen(step1Project([sampleAnimationData()]));

    s.enter(s.settings(), '再生速度（倍）', 1.25);
    s.click(s.settings().getByRole('checkbox', { name: 'ループ（止めるまで繰り返す）' }));
    s.click(s.settings().getByRole('radio', { name: 'グループを選ぶ' }));
    s.click(
      within(s.settings().getByRole('group', { name: '影響するグループ' })).getByRole('checkbox', { name: '口' }),
    );
    s.click(s.settings().getByRole('button', { name: 'ゆっくり' }));
    s.click(s.settings().getByRole('button', { name: 'トラッキングに加算' }));
    s.click(s.settings().getByRole('checkbox', { name: 'リップシンクを維持' }));
    s.click(s.settings().getByRole('checkbox', { name: 'トラッキングに戻る' }));
    s.click(s.settings().getByRole('button', { name: '無視' }));
    const expected = {
      ...sampleAnimationData(),
      speed: 1.25,
      loop: true,
      affectedGroups: ['face', 'eye'],
      restart: 'ignore',
      transition: {
        preset: 'slow',
        blendIn: 0.7,
        blendOut: 0.8,
        curve: 'smooth',
        blendMode: 'addToTracking',
        keepLipSync: false,
        keepPhysics: true,
        returnToTracking: false,
      },
    };
    expect(s.animation()).toEqual(expected);

    await io.save('/work/anim', s.store.get(), {});
    const { project } = await io.load('/work/anim');
    expect(project.animations).toEqual([expected]);

    // 読み直したものを開くと、設定がそのまま出る
    act(() => s.store.load(project));
    expect((s.settings().getByRole('spinbutton', { name: '再生速度（倍）' }) as HTMLInputElement).value).toBe('1.25');
    expect(s.settings().getByRole('checkbox', { name: 'ループ（止めるまで繰り返す）' })).toHaveProperty(
      'checked',
      true,
    );
    expect(pressed(s.settings(), '遷移')).toEqual(['ゆっくり']);
    expect(pressed(s.settings(), '合成方法')).toEqual(['トラッキングに加算']);
    expect(pressed(s.settings(), '再開始')).toEqual(['無視']);
    expect(s.settings().getByLabelText('影響範囲の状態').textContent).toBe('選んだグループ: 顔・目');
  });
});
