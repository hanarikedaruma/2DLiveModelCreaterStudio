import { useEffect, useReducer, useState } from 'react';
import { useProject } from '../../../shell/api';
import { studioRuntime } from '../runtime';
import { backgroundImagePaths } from './presets';

// シーンとホットキーで同じ一覧を使う（シーンで未使用の画像も含む）。
export function useBackgroundImagePaths(): { paths: string[]; refresh(): void } {
  const project = useProject();
  const files = studioRuntime.backgroundFiles;
  const [listed, setListed] = useState<string[]>([]);
  const [version, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => files.subscribe(refresh), [files]);
  useEffect(() => {
    let alive = true;
    files.list().then(
      (paths) => {
        if (alive) setListed(paths);
      },
      (e: unknown) => console.warn('背景の画像の一覧を読めない', e),
    );
    return () => {
      alive = false;
    };
  }, [files, version, project.id]);
  return { paths: backgroundImagePaths(listed, project.studio.scenes), refresh };
}
