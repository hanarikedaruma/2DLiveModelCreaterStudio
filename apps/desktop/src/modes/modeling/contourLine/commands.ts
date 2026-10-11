// 輪郭線（I-068）のコマンドと、対象の判定。どれも純粋関数
import { CONTOUR_RADIUS_MAX, CONTOUR_RADIUS_MIN, type ContourLine, type Model, type Vec2 } from '@app/schema';
import type { Command } from '@app/contracts';
import { isLockedDeep, partById } from '../canvas/parts';

export const ADD_LINE_LABEL = '輪郭線を引く';
export const REMOVE_LINE_LABEL = '輪郭線を消す';
export const EDIT_LINE_LABEL = '輪郭線の編集';

export function contourLinesOf(model: Model, partId: string): ContourLine[] {
  return (model.contourLines ?? []).filter((l) => l.partId === partId);
}

// 線を引けない・編集できない理由（できるなら null）
export function contourBlockReason(model: Model, partId: string): string | null {
  const part = partById(model, partId);
  if (part?.kind !== 'image') return '画像パーツを選んでください。';
  if (!part.meshId || !model.meshes.some((m) => m.id === part.meshId)) return '先にメッシュを自動生成してください。';
  if (isLockedDeep(model, partId)) return 'ロックしたパーツには線を引けません。';
  if (model.curveGuides?.some((g) => g.partId === partId && g.enabled))
    return '流れ線を使っているパーツには輪郭線を引けません。流れ線を外すか、キーに記録してから使ってください。';
  return null;
}

export function clampRadius(radius: number): number {
  return Math.min(CONTOUR_RADIUS_MAX, Math.max(CONTOUR_RADIUS_MIN, Math.round(radius)));
}

// 既定の影響幅: 線の長さの 1/4（16〜120px）
export function defaultRadius(length: number): number {
  return clampRadius(Math.min(120, Math.max(16, length / 4)));
}

// 「線 1」「線 2」… の空いている名前
export function nextLineName(model: Model, partId: string): string {
  const names = new Set(contourLinesOf(model, partId).map((l) => l.name));
  for (let i = 1; ; i++) if (!names.has(`線 ${i}`)) return `線 ${i}`;
}

// 隣り合う点が同じ位置にならないか（保存の検査と同じ）
export function distinctNeighbours(points: readonly Vec2[]): boolean {
  return (
    points.length >= 2 && points.slice(1).every((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y) > 1e-9)
  );
}

const editable = (model: Model, line: ContourLine | undefined): line is ContourLine =>
  !!line && contourBlockReason(model, line.partId) === null;

export function addLineCommand(line: ContourLine): Command {
  return {
    label: ADD_LINE_LABEL,
    apply(project) {
      const model = project.model;
      if (contourBlockReason(model, line.partId) !== null || !distinctNeighbours(line.points)) return project;
      if ((model.contourLines ?? []).some((l) => l.id === line.id)) return project;
      return { ...project, model: { ...model, contourLines: [...(model.contourLines ?? []), line] } };
    },
  };
}

export function patchLineCommand(
  id: string,
  patch: Partial<Pick<ContourLine, 'points' | 'radius' | 'withPartIds' | 'name'>>,
  label = EDIT_LINE_LABEL,
): Command {
  return {
    label,
    apply(project) {
      const model = project.model;
      const line = model.contourLines?.find((l) => l.id === id);
      if (!editable(model, line)) return project;
      if (patch.points && !distinctNeighbours(patch.points)) return project;
      const next: ContourLine = {
        ...line,
        ...patch,
        ...(patch.radius !== undefined ? { radius: clampRadius(patch.radius) } : {}),
        ...(patch.withPartIds ? { withPartIds: [...new Set(patch.withPartIds)].filter((p) => p !== line.partId) } : {}),
      };
      if (JSON.stringify(next) === JSON.stringify(line)) return project;
      return {
        ...project,
        model: { ...model, contourLines: model.contourLines!.map((l) => (l.id === id ? next : l)) },
      };
    },
  };
}

export function removeLineCommand(id: string): Command {
  return {
    label: REMOVE_LINE_LABEL,
    apply(project) {
      const model = project.model;
      const line = model.contourLines?.find((l) => l.id === id);
      if (!line || isLockedDeep(model, line.partId)) return project;
      return { ...project, model: { ...model, contourLines: model.contourLines!.filter((l) => l.id !== id) } };
    },
  };
}
