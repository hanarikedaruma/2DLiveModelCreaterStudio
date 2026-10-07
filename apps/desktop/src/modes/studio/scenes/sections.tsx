// 選んだ（使っている）シーンの編集。シーンのパネル（'scene'）のセクション: 背景・表情・モデルの配置
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDialogs, useDispatch, useProject, useServices } from '../../../shell/api';
import { clampModelScale } from '../placement';
import { studioRuntime } from '../runtime';
import {
  activeScene,
  sameBackground,
  sceneBackground,
  sceneModelTransform,
  setBackgroundCommand,
  setModelTransformCommand,
  type SceneBackground,
} from '../scene';
import { setSceneExpressionCommand } from './commands';
import { BACKGROUND_PRESETS, backgroundLabel, findBackgroundPreset } from './presets';
import { useBackgroundImagePaths } from './useBackgroundImagePaths';
import { removeBackgroundImage } from './backgroundRemoval';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- 背景 ----

async function readFile(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読めない'));
    reader.readAsArrayBuffer(file);
  });
}

function useBackgroundImageState(path: string | null) {
  const status = useSyncExternalStore(studioRuntime.backgrounds.subscribe, () =>
    path ? studioRuntime.backgrounds.status(path) : null,
  );
  const pending = useSyncExternalStore(studioRuntime.backgroundFiles.subscribe, () =>
    path ? studioRuntime.backgroundFiles.pending().includes(path) : false,
  );
  return { status, pending };
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

// 画像のサムネイル（object URL）。作れない環境（jsdom など）では null
function useThumbnail(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    let alive = true;
    let made: string | null = null;
    const kept = studioRuntime.backgrounds.bytes(path);
    (kept ? Promise.resolve(kept) : studioRuntime.backgroundFiles.load(path)).then(
      (bytes) => {
        if (!alive || !bytes) return;
        const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
        made = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? 'image/png' }));
        setUrl(made);
      },
      () => {}, // 読めない画像は名前だけを出す
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [path]);
  return url;
}

function ImagePresetButton(props: { path: string; index: number; pressed: boolean; onPick(): void }) {
  const url = useThumbnail(props.path);
  const label = `画像 ${props.index + 1}`;
  return (
    <button
      type="button"
      className="scene-image"
      aria-pressed={props.pressed}
      aria-label={label}
      title={props.path}
      onClick={props.onPick}
    >
      {url ? <img src={url} alt="" /> : <span>{label}</span>}
    </button>
  );
}

export function SceneBackgroundSection() {
  const project = useProject();
  const dispatch = useDispatch();
  const dialogs = useDialogs();
  const { store } = useServices();
  const [removing, setRemoving] = useState(false);
  const bg = sceneBackground(project);
  const [color, setColor] = useState(bg.type === 'color' ? bg.color : '#ff00ff');
  const colorRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const image = useBackgroundImageState(bg.type === 'image' ? bg.path : null);
  const images = useBackgroundImagePaths();

  const set = useCallback((next: SceneBackground) => dispatch(setBackgroundCommand(next)), [dispatch]);
  const isCustom = bg.type === 'color' && !findBackgroundPreset(bg);

  // 色を選ぶ途中（input）は保存せず、決めたとき（change）に保存する
  useEffect(() => {
    const input = colorRef.current;
    if (!input) return;
    const onChange = () => set({ type: 'color', color: input.value.toLowerCase() });
    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
  }, [set]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { path } = await studioRuntime.backgroundFiles.importImage({ name: file.name, data: await readFile(file) });
      set({ type: 'image', path });
      images.refresh();
    } catch (e) {
      dialogs.notify(`背景の画像を使えない: ${errorText(e)}`);
    }
  };
  const remove = async (path: string) => {
    if (removing) return;
    setRemoving(true);
    try {
      await removeBackgroundImage(store, studioRuntime.backgroundFiles, dialogs, path);
    } finally {
      setRemoving(false);
      images.refresh();
    }
  };

  return (
    <div className="studio-section">
      <h3>背景</h3>
      <div className="studio-choices" role="group" aria-label="背景">
        {BACKGROUND_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={sameBackground(bg, p.background)}
            onClick={() => set(p.background)}
          >
            {p.background.type === 'color' && (
              <span className="studio-swatch scene-swatch" style={{ background: p.background.color }} />
            )}
            {p.label}
          </button>
        ))}
        <button type="button" aria-pressed={isCustom} onClick={() => set({ type: 'color', color })}>
          任意の色
        </button>
        <input
          ref={colorRef}
          type="color"
          className="studio-color"
          aria-label="任意の色を選ぶ"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </div>
      <div className="studio-choices scene-images" role="group" aria-label="背景の画像">
        {images.paths.map((path, i) => (
          <span className="scene-image-preset" key={path}>
            <ImagePresetButton
              path={path}
              index={i}
              pressed={bg.type === 'image' && bg.path === path}
              onPick={() => set({ type: 'image', path })}
            />
            <button
              type="button"
              className="scene-image-remove"
              disabled={removing}
              aria-label={`画像 ${i + 1}（${backgroundLabel({ type: 'image', path })}）を削除`}
              onClick={() => void remove(path)}
            >
              削除
            </button>
          </span>
        ))}
        <button type="button" onClick={() => fileRef.current?.click()}>
          画像を足す…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          data-testid="studio-background-file"
          onChange={(e) => {
            const input = e.currentTarget;
            void onFile(input.files?.[0]).finally(() => {
              input.value = '';
            });
          }}
        />
      </div>
      <p className="studio-note" aria-label="いまの背景">
        いまの背景: {backgroundLabel(bg)}
      </p>
      {bg.type === 'image' && image.status === 'missing' && (
        <p className="studio-note studio-warn">画像が見つからない（プロジェクトのフォルダの {bg.path}）</p>
      )}
      {bg.type === 'image' && image.status === 'broken' && (
        <p className="studio-note studio-warn">画像として読めない（壊れているか、対応していない形式）</p>
      )}
      {bg.type === 'image' && image.pending && (
        <p className="studio-note">プロジェクトのフォルダがまだ無いので、保存するときに backgrounds/ へ写す</p>
      )}
    </div>
  );
}

// ---- 表情 ----

export const NO_EXPRESSION_LABEL = '（なし）';

export function SceneExpressionSection() {
  const project = useProject();
  const dispatch = useDispatch();
  const scene = activeScene(project);
  const head = scene?.expressionIds[0] ?? '';
  const missing = head !== '' && !project.expressions.some((e) => e.id === head);

  return (
    <div className="studio-section">
      <h3>表情</h3>
      <label className="studio-field">
        <span>表情</span>
        <select
          aria-label="シーンの表情"
          value={head}
          onChange={(e) => dispatch(setSceneExpressionCommand(e.target.value || null))}
        >
          <option value="">{NO_EXPRESSION_LABEL}</option>
          {project.expressions.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
          {missing && <option value={head}>（見つからない表情）</option>}
        </select>
      </label>
      <p className="studio-note">このシーンに切り替えたときにこの表情にする（なしなら表情を外す）</p>
      {project.expressions.length === 0 && <p className="studio-note">表情がまだ無い</p>}
    </div>
  );
}

// ---- モデルの配置 ----

function formatNumber(n: number, digits: number): string {
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}

function NumberField(props: { label: string; unit: string; value: number; digits: number; commit(v: number): void }) {
  const text = formatNumber(props.value, props.digits);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const done = () => {
    const n = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(n) && formatNumber(n, props.digits) !== text) props.commit(n);
    setDraft(text); // 変わったら新しい値が text で入る。範囲の外を丸めたときも、ここで表示を戻す
  };
  return (
    <label className="scene-number">
      <span>{props.label}</span>
      <input
        type="number"
        aria-label={props.label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Enter') done();
        }}
      />
      <span className="scene-unit">{props.unit}</span>
    </label>
  );
}

export function ScenePlacementSection() {
  const project = useProject();
  const dispatch = useDispatch();
  const t = sceneModelTransform(project);
  const set = (next: typeof t) => dispatch(setModelTransformCommand(next));

  return (
    <div className="studio-section">
      <h3>モデルの配置</h3>
      <div className="scene-placement">
        <NumberField
          label="横の位置"
          unit="px"
          value={t.position.x}
          digits={0}
          commit={(x) => set({ position: { ...t.position, x }, scale: t.scale })}
        />
        <NumberField
          label="縦の位置"
          unit="px"
          value={t.position.y}
          digits={0}
          commit={(y) => set({ position: { ...t.position, y }, scale: t.scale })}
        />
        <NumberField
          label="大きさ"
          unit="%"
          value={t.scale * 100}
          digits={1}
          commit={(percent) => set({ position: t.position, scale: clampModelScale(percent / 100) })}
        />
      </div>
      <p className="studio-note">プレビューのドラッグ（位置）とホイール（大きさ）も、このシーンに保存する</p>
    </div>
  );
}
