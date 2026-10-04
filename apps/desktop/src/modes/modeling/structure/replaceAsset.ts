// 素材の差し替え。幅と高さが同じなら assetId だけを替える。
// 違うなら、キャンバス上の位置（新しい素材の offset）でメッシュを作り直し、そのメッシュの頂点のキーを新しいメッシュへ転写する
// （カード28で MVP のリセットを置き換えた）。頂点のキーがあれば「変形を新しいメッシュへ移します」と確認する
import type { Asset, Mesh } from '@app/schema';
import type { Command, Services } from '@app/contracts';
import { transferMeshKeys } from '@app/core';
import { vertexKeyCount } from '../mesh/meshOps';
import { TRANSFER_CONFIRM_MESSAGE, densityOf } from '../mesh/remesh';
import { idSequence } from './modelOps';

export const REPLACE_CONFIRM_MESSAGE = TRANSFER_CONFIRM_MESSAGE;

export type Density = 'light' | 'standard' | 'smooth';

export interface RebuiltMesh {
  vertices: Mesh['vertices'];
  uvs: Mesh['uvs'];
  triangles: Mesh['triangles'];
  density: Density;
}

export function sameSize(a: Asset | undefined, b: Asset | undefined): boolean {
  return a !== undefined && b !== undefined && a.width === b.width && a.height === b.height;
}

// mesh は大きさが違うときに作り直したもの。null なら（作れなかったとき）メッシュを外し、そのメッシュのキーも消す
export function replaceAssetCommand(
  partId: string,
  newAssetId: string,
  mesh: RebuiltMesh | null,
  options: { newId?: () => string } = {},
): Command {
  const seq = idSequence(options.newId);
  return {
    label: '素材の差し替え',
    apply(project) {
      const { model } = project;
      const index = model.parts.findIndex((p) => p.id === partId);
      const part = model.parts[index];
      const next = project.assets.find((a) => a.id === newAssetId);
      if (!part || part.kind !== 'image' || !next || part.assetId === newAssetId) return project;
      const current = project.assets.find((a) => a.id === part.assetId);
      const parts = model.parts.slice();
      if (sameSize(current, next)) {
        parts[index] = { ...part, assetId: newAssetId };
        return { ...project, model: { ...model, parts } };
      }

      const oldMeshId = part.meshId !== null && model.meshes.some((m) => m.id === part.meshId) ? part.meshId : null;
      let meshes = model.meshes;
      let bindings = model.bindings;
      let meshId: string | null = null;
      if (mesh) {
        meshId = oldMeshId ?? seq()();
        const rebuilt: Mesh = { id: meshId, ...mesh, edited: false };
        // 旧いメッシュ（基準状態）の頂点のキーを、作り直したメッシュの頂点へ転写する
        if (oldMeshId) bindings = transferMeshKeys(model, oldMeshId, rebuilt).bindings;
        meshes = oldMeshId ? meshes.map((m) => (m.id === oldMeshId ? rebuilt : m)) : [...meshes, rebuilt];
      } else if (oldMeshId) {
        meshes = meshes.filter((m) => m.id !== oldMeshId);
        bindings = bindings.filter((b) => !(b.target.type === 'mesh' && b.target.id === oldMeshId));
      }
      parts[index] = { ...part, assetId: newAssetId, meshId };
      return { ...project, model: { ...model, parts, meshes, bindings } };
    },
  };
}

// 画面から呼ぶ。差し替えたら true
export async function replaceAsset(
  services: Services,
  dialogs: { confirm(message: string): Promise<boolean>; notify(message: string): void },
  partId: string,
  newAssetId: string,
): Promise<boolean> {
  const project = services.store.get();
  const part = project.model.parts.find((p) => p.id === partId);
  const next = project.assets.find((a) => a.id === newAssetId);
  if (!part || part.kind !== 'image' || !next || part.assetId === newAssetId) return false;
  const current = project.assets.find((a) => a.id === part.assetId);
  if (sameSize(current, next)) {
    services.store.dispatch(replaceAssetCommand(partId, newAssetId, null));
    return true;
  }
  const imageData = services.assets.getImageData(newAssetId);
  if (!imageData) {
    dialogs.notify('差し替える素材の画像がまだ読み込まれていない');
    return false;
  }
  const oldMesh = project.model.meshes.find((m) => m.id === part.meshId);
  const keys = oldMesh ? vertexKeyCount(project.model, oldMesh.id) : 0;
  if (keys > 0 && !(await dialogs.confirm(REPLACE_CONFIRM_MESSAGE))) return false;
  const density = densityOf(oldMesh);
  const generated = services.meshGenerator.generate(imageData, next.offset, density);
  services.store.transaction('素材の差し替え', (dispatch) =>
    dispatch(replaceAssetCommand(partId, newAssetId, { ...generated, density })),
  );
  return true;
}
