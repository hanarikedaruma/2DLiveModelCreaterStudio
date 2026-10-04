// メッシュの作り直しと変形の転写（カード28）。形を変えるときは、頂点のキーをリセットせずに新しいメッシュへ移す
import { newId, type Mesh, type Project } from '@app/schema';
import type { Command, Services } from '@app/contracts';
import { partById } from '../canvas/parts';
import { attachNewMesh, remeshCommand, vertexKeyCount, type MeshShape } from './meshOps';

export const TRANSFER_CONFIRM_MESSAGE = '変形を新しいメッシュへ移します';

export type Density = 'light' | 'standard' | 'smooth';

export const DENSITY_OPTIONS: readonly { density: Density; label: string }[] = [
  { density: 'light', label: '軽い' },
  { density: 'standard', label: '標準' },
  { density: 'smooth', label: 'なめらか' },
];

export type ReshapeOutcome =
  { ok: true; meshId: string | null; command: Command; after?(): void } | { ok: false; error: string };

export interface ReshapeDialogs {
  confirm(message: string): Promise<boolean>;
  notify(message: string): void;
}

// 形を変える。そのメッシュの頂点のキーがあれば「変形を新しいメッシュへ移します」と確認する。
// コマンドはキーの転写とメッシュの置き換えを含み、1つの transaction で入れる（1回の Undo）。変えたら true
export async function reshapeWithTransfer(
  store: Services['store'],
  dialogs: ReshapeDialogs,
  label: string,
  build: (project: Project) => ReshapeOutcome,
): Promise<boolean> {
  const start = store.get();
  const first = build(start);
  if (!first.ok) {
    dialogs.notify(first.error);
    return false;
  }
  const keys = first.meshId ? vertexKeyCount(start.model, first.meshId) : 0;
  if (keys > 0 && !(await dialogs.confirm(TRANSFER_CONFIRM_MESSAGE))) return false;
  // 確認の間に変わっていたら作り直す
  const outcome = store.get() === start ? first : build(store.get());
  if (!outcome.ok) {
    dialogs.notify(outcome.error);
    return false;
  }
  store.transaction(label, (dispatch) => dispatch(outcome.command));
  outcome.after?.();
  return true;
}

// いまのメッシュの細かさ（無い・custom なら標準）
export function densityOf(mesh: Mesh | null | undefined): Density {
  return mesh && mesh.density !== 'custom' ? mesh.density : 'standard';
}

// 画像パーツの素材の不透明な所から、その細かさでメッシュを作る
export function generateShape(
  services: Pick<Services, 'assets' | 'meshGenerator'>,
  project: Project,
  partId: string,
  density: Density,
): { ok: true; shape: MeshShape } | { ok: false; error: string } {
  const part = partById(project.model, partId);
  if (part?.kind !== 'image') return { ok: false, error: '画像パーツを選ぶ' };
  const asset = project.assets.find((a) => a.id === part.assetId);
  const alpha = asset ? services.assets.getImageData(asset.id) : undefined;
  if (!asset || !alpha) return { ok: false, error: '素材の画像が読み込まれていない' };
  const g = services.meshGenerator.generate(alpha, asset.offset, density);
  if (g.vertices.length < 3 || g.triangles.length === 0)
    return { ok: false, error: 'メッシュを作れなかった（不透明な所が無い）' };
  return { ok: true, shape: { vertices: g.vertices, uvs: g.uvs, triangles: g.triangles } };
}

// 作ったメッシュで置き換える（キーは転写する）。メッシュが無ければ新しく付ける。手で編集した形は消えるので edited は false
export function regenerateOutcome(
  partId: string,
  shape: MeshShape,
  density: Density,
  label: string,
  options: { newMeshId?: string; after?(): void } = {},
): (project: Project) => ReshapeOutcome {
  const newMeshId = options.newMeshId ?? newId();
  return (project) => {
    const part = partById(project.model, partId);
    if (!part) return { ok: false, error: 'パーツが無い' };
    const mesh = part.meshId ? project.model.meshes.find((m) => m.id === part.meshId) : undefined;
    if (mesh)
      return {
        ok: true,
        meshId: mesh.id,
        command: remeshCommand(label, mesh.id, shape, { density, edited: false }),
        after: options.after,
      };
    return {
      ok: true,
      meshId: null,
      command: attachNewMesh(label, partId, { id: newMeshId, ...shape, density, edited: false }),
      after: options.after,
    };
  };
}

// 「変形の細かさ」を変える: その細かさでメッシュを作り直し、変形を移す（density を更新）。変えたら true
export async function changeMeshDensity(
  services: Pick<Services, 'store' | 'assets' | 'meshGenerator'>,
  dialogs: ReshapeDialogs,
  partId: string,
  density: Density,
): Promise<boolean> {
  const generated = generateShape(services, services.store.get(), partId, density);
  if (!generated.ok) {
    dialogs.notify(generated.error);
    return false;
  }
  return reshapeWithTransfer(
    services.store,
    dialogs,
    '変形の細かさの変更',
    regenerateOutcome(partId, generated.shape, density, '変形の細かさの変更'),
  );
}
